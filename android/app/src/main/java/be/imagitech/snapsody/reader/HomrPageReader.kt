package be.imagitech.snapsody.reader

import android.content.Context
import android.util.Log
import be.imagitech.snapsody.PythonEngine
import be.imagitech.snapsody.inference.InferenceThread
import com.chaquo.python.Python
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * Called by homr's Python side (ia_engine.Progress) at every progress point: it forwards the
 * progress and tells Python whether to stop.
 */
class ProgressListener internal constructor(
    private val onProgress: (String, Double) -> Unit,
    private val cancelled: () -> Boolean,
) {
    fun isCancelled(): Boolean = cancelled()

    @Suppress("unused") // detail: ia_engine's tile and staff counts, not part of the Reader's events
    fun progress(stage: String, fraction: Double, detail: String) = onProgress(stage, fraction)
}

/**
 * Reads pages with the first version's recognition: `ia_engine.run_job` (homr through Chaquopy,
 * with segnet on LiteRT and the transformer on ONNX Runtime) on the inference thread. Each page is
 * padded and recognised on its own (design D6). Next to the MusicXML, the engine reports the staff
 * positions and whether the time signature was estimated (homr patch 8, design D7).
 */
class HomrPageReader(
    private val context: Context,
    private val engine: InferenceThread.Engine,
    private val python: Python,
) : PageReader {
    private val workDir = File(context.cacheDir, "reader/${UUID.randomUUID()}")
    private var cancelled: () -> Boolean = { false }

    init {
        engine.service.cancelCheck = { cancelled() }
    }

    override fun read(image: File, progress: (String, Double) -> Unit, cancelled: () -> Boolean): PageResult {
        this.cancelled = cancelled
        val started = System.nanoTime()
        val accelerator = engine.accelerator()
        val out = File(workDir, "page-${UUID.randomUUID()}").apply { mkdirs() }
        val result = JSONObject(
            python.getModule("ia_engine")
                .callAttr("run_job", engine.service, image.path, accelerator.name, out.path, ProgressListener(progress, cancelled))
                .toString(),
        )
        val seconds = "%.1f".format((System.nanoTime() - started) / 1e9)
        return when (result.getString("status")) {
            "cancelled" -> PageResult.Cancelled
            "no_music" -> PageResult.NoMusic(result.optString("message")).also { Log.i(TAG, "${image.name}: no music after $seconds s") }
            else -> {
                val report = result.getJSONObject("report")
                Log.i(TAG, "${image.name}: read in $seconds s on ${accelerator.name}")
                PageResult.Done(
                    File(report.getString("musicxml")).readText(),
                    StaffPosition.listFrom(report.optJSONArray("staves")),
                    report.opt("timeEstimated") as? Boolean,
                )
            }
        }
    }

    override fun close() {
        engine.service.cancelCheck = null
        workDir.deleteRecursively()
    }

    companion object {
        private const val TAG = "HomrPageReader"

        /** The job runner of the app: one job is one task on the inference thread. */
        fun runner(context: Context): JobRunner {
            val app = context.applicationContext
            return JobRunner { job ->
                InferenceThread.submit(app) { engine -> job { HomrPageReader(app, engine, PythonEngine.ensureStarted(app)) } }
            }
        }
    }
}
