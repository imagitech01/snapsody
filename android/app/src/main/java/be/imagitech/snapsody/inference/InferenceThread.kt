package be.imagitech.snapsody.inference

import android.content.Context
import android.util.Log
import be.imagitech.snapsody.inference.InferenceService.Accelerator
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * The app's single inference thread and the objects that live on it.
 *
 * LiteRT's GPU delegate must be created, run and closed on one thread, so the
 * [InferenceService] is only ever touched here: the accelerator self-test, every
 * recognition (homr's Python calls into the service run on the calling thread) and any
 * GPU fallback. Work is queued with [submit].
 */
object InferenceThread {
    private const val TAG = "InferenceThread"

    @Volatile
    private var thread: Thread? = null
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "inference").also { thread = it }
    }

    private var engine: Engine? = null

    /** The service and the selector, wired together. Only used on the inference thread. */
    class Engine(context: Context) {
        val service = InferenceService(context)
        val selector: AcceleratorSelector = selector(context)

        init {
            // A GPU error during recognition is remembered until the next self-test (task 4.4).
            service.onGpuFailure = { selector.markGpuFailed(it) }
        }

        /**
         * The accelerator for the next recognition; runs the self-test when needed (task 4.2).
         * If deciding fails for any reason, recognition uses the CPU (design D4).
         */
        fun accelerator(): Accelerator {
            if (selector.forceCpu) return Accelerator.CPU
            return try {
                val decision = selector.decision()
                if (decision.ranSelfTest) service.resetGpuFailure()
                selector.accelerator()
            } catch (e: Exception) {
                Log.e(TAG, "accelerator decision failed, using the CPU", e)
                Accelerator.CPU
            }
        }

        private fun selector(context: Context): AcceleratorSelector {
            val app = context.applicationContext
            val store = ModelStore(app)
            val key by lazy { DecisionKey.current(app, store) } // fixed for the life of the process
            return AcceleratorSelector(
                prefs = app.getSharedPreferences(AcceleratorSelector.PREFS, Context.MODE_PRIVATE),
                key = { key },
                selfTest = SegnetSelfTest(service, store),
            )
        }
    }

    fun isCurrent(): Boolean = Thread.currentThread() == thread

    /** Runs [block] on the inference thread with the (lazily created) engine. */
    fun <T> submit(context: Context, block: (Engine) -> T): Future<T> {
        val app = context.applicationContext
        return executor.submit<T> {
            val current = engine ?: Engine(app).also { engine = it }
            block(current)
        }
    }

    /** At app start: run the self-test in the background if it is due (task 4.1). */
    fun prepare(context: Context) {
        submit(context) { engine ->
            try {
                Log.i(TAG, "accelerator for recognition: ${engine.accelerator()}")
            } catch (e: Throwable) {
                Log.e(TAG, "accelerator self-test failed", e)
            }
        }
    }

    /**
     * A selector for what only touches preferences (the force-CPU setting, [AcceleratorSelector.status]),
     * usable from any thread. Its [AcceleratorSelector.decision] is not available.
     */
    fun settings(context: Context) = AcceleratorSelector(
        prefs = context.applicationContext.getSharedPreferences(AcceleratorSelector.PREFS, Context.MODE_PRIVATE),
        key = { error("decisions are made on the inference thread") },
        selfTest = { error("the self-test runs on the inference thread") },
    )
}
