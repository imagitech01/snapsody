package app.snapsody.reader

import android.content.Context
import android.content.Intent
import android.util.Log
import app.snapsody.files.PluginError
import app.snapsody.inference.InferenceThread
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/**
 * The Reader plugin (practice-app design D1, D6): a thin Capacitor adapter over [ReaderHandler].
 *
 * - `read({ jobId, pages })` -> `{ jobId }`
 * - `cancel({ jobId })` -> `{ cancelled }`
 * - event `readerEvent`: the port's `ReaderEvent` plus `jobId`
 *
 * Rejections carry the port's error code ("invalid", "not-found", "failed"). Examples:
 * fixtures/bridge/reader.*.json. The handler lives as long as the process, so a job outlives the
 * activity; a recreated plugin takes over its events.
 */
@CapacitorPlugin(name = "Reader")
class ReaderPlugin : Plugin() {
    private val emit: (JSONObject) -> Unit = { event -> notifyListeners(EVENT, JSObject.fromJSONObject(event)) }

    override fun load() {
        handler(context).listener = emit
        // Run the accelerator self-test in the background when it is due (as the first version did at start).
        InferenceThread.prepare(context)
    }

    override fun handleOnDestroy() {
        val handler = handler(context)
        if (handler.listener === emit) handler.listener = null
    }

    @PluginMethod
    fun read(call: PluginCall) = answer(call) { handler(context).read(call.data) }

    @PluginMethod
    fun cancel(call: PluginCall) = answer(call) { handler(context).cancel(call.data) }

    private fun answer(call: PluginCall, block: () -> JSONObject) {
        try {
            call.resolve(JSObject.fromJSONObject(block()))
        } catch (e: PluginError) {
            call.reject(e.message, e.code)
        } catch (e: Exception) {
            Log.e(TAG, "${call.methodName} failed", e)
            call.reject(e.message ?: e.javaClass.name, "failed")
        }
    }

    companion object {
        private const val TAG = "ReaderPlugin"
        const val EVENT = "readerEvent"

        @Volatile
        private var instance: ReaderHandler? = null

        /** The process's one [ReaderHandler]. */
        @Synchronized
        fun handler(context: Context): ReaderHandler = instance ?: run {
            val app = context.applicationContext
            ReaderHandler(app.filesDir, HomrPageReader.runner(app), ServiceForeground(app)).also { instance = it }
        }

        /** The running job's handler, if there is one (for [ReaderService]). */
        internal val current: ReaderHandler? get() = instance
    }

    private class ServiceForeground(private val context: Context) : Foreground {
        override fun start() {
            context.startForegroundService(Intent(context, ReaderService::class.java))
        }

        override fun stop() {
            ReaderService.jobEnded()
        }
    }
}
