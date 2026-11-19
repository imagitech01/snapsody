package be.imagitech.snapsody.files

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The third local plugin (practice-app design D4): the platform port's atomic file operations,
 * a thin Capacitor adapter over [AtomicFiles]. Everything else in `Files` goes through the
 * Filesystem plugin (web/src/platform/capacitor/files.ts).
 *
 * - `writeTextAtomic({ path, text, suffix? })` -> `{}`
 * - `moveFile({ from, to })` -> `{}`
 *
 * Paths are relative to the app's data folder. Rejections carry the port's error code.
 * Examples: fixtures/bridge/atomicFiles.*.json.
 */
@CapacitorPlugin(name = "AtomicFiles")
class AtomicFilesPlugin : Plugin() {
    private val files by lazy { AtomicFiles(context.filesDir) }

    @PluginMethod
    fun writeTextAtomic(call: PluginCall) = answer(call) {
        files.writeTextAtomic(call.required("path"), call.required("text"), call.getString("suffix"))
    }

    @PluginMethod
    fun moveFile(call: PluginCall) = answer(call) {
        files.moveFile(call.required("from"), call.required("to"))
    }

    private fun PluginCall.required(key: String): String = getString(key) ?: throw PluginError("invalid", "$key is required")

    private fun answer(call: PluginCall, block: () -> Unit) {
        try {
            block()
            call.resolve(JSObject())
        } catch (e: PluginError) {
            call.reject(e.message, e.code)
        } catch (e: Exception) {
            call.reject(e.message ?: e.javaClass.name, "failed")
        }
    }
}
