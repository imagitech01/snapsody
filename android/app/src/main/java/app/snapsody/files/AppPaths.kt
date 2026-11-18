package app.snapsody.files

import java.io.File

/**
 * What a plugin handler rejects a call with. [code] is one of the platform port's error codes
 * (web/src/platform/port.ts `PlatformErrorCode`: "unavailable", "not-found", "exists", "invalid",
 * "failed"); the Capacitor adapter passes it to `call.reject(message, code)` and the web side
 * turns it into a `PlatformError` with the same code.
 */
class PluginError(val code: String, message: String) : Exception(message)

/**
 * The port's paths (web/src/platform/port.ts, `Files`): relative to the app's data folder
 * (`Context.filesDir`, which is also the Filesystem plugin's `Directory.Data`), "/" as the
 * separator, no ".." part. Scanned pages are returned as such paths too (`scans/<id>/page-N.jpg`).
 */
object AppPaths {
    /** The file at [path] inside [root]. Rejects with "invalid" what the port does not accept. */
    fun resolve(root: File, path: String): File {
        val parts = path.split('/').filter { it.isNotEmpty() && it != "." }
        if (parts.isEmpty() || parts.contains("..") || path.contains('\u0000')) {
            throw PluginError("invalid", "path not accepted: $path")
        }
        return File(root, parts.joinToString("/"))
    }

    /** [file] as a path relative to [root] (the reverse of [resolve]). */
    fun relative(root: File, file: File): String = file.relativeTo(root).invariantSeparatorsPath
}
