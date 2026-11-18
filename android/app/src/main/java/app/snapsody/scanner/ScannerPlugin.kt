package app.snapsody.scanner

import android.app.Activity
import android.content.ActivityNotFoundException
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts.StartIntentSenderForResult
import app.snapsody.files.PluginError
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import java.io.File
import java.io.InputStream

/**
 * Where scanned pages come from instead of ML Kit. Null in the app; the smoke test (practice-app
 * task 10.6) sets one that returns a bundled page. Returns the pages, or null for "cancelled".
 */
fun interface PageSource {
    fun pages(request: ScannerHandler.Request): List<() -> InputStream>?
}

/**
 * The Scanner plugin (practice-app design D1): a thin Capacitor adapter over [ScannerHandler].
 *
 * `scan({ maxPages? })` -> `{ cancelled: false, pages: [{ path, width, height }] }` or
 * `{ cancelled: true, pages: [] }`; rejects with code "unavailable" when the scanner cannot run,
 * "invalid" for a bad `maxPages`, "failed" otherwise. Examples: fixtures/bridge/scanner.scan.json.
 *
 * ML Kit hands out an IntentSender, so the plugin registers its own StartIntentSenderForResult
 * launcher through the bridge in [load] (Capacitor's @ActivityCallback only takes an Intent).
 * [load] runs while the activity is created, which is when launchers must be registered.
 */
@CapacitorPlugin(name = "Scanner")
class ScannerPlugin : Plugin() {
    private lateinit var launcher: ActivityResultLauncher<IntentSenderRequest>
    private lateinit var handler: ScannerHandler
    private var pending: PluginCall? = null

    override fun load() {
        handler = ScannerHandler(context.filesDir, AndroidPageImages)
        launcher = bridge.registerForActivityResult(StartIntentSenderForResult()) { result -> onScanned(result) }
    }

    @PluginMethod
    fun scan(call: PluginCall) {
        if (pending != null) return call.reject("a scan is already open", "failed")
        val request = try {
            handler.request(call.data)
        } catch (e: PluginError) {
            return call.reject(e.message, e.code)
        }
        pageSource?.let { source ->
            Thread({ finish(call) { source.pages(request)?.let { handler.stored(it) } ?: handler.cancelled() } }, "scan-source").start()
            return
        }
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(request.galleryImport)
            .setPageLimit(request.maxPages)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_BASE)
            .build()
        pending = call
        GmsDocumentScanning.getClient(options).getStartScanIntent(activity)
            .addOnSuccessListener { sender ->
                try {
                    launcher.launch(IntentSenderRequest.Builder(sender).build())
                } catch (e: ActivityNotFoundException) {
                    unavailable(call, e)
                }
            }
            .addOnFailureListener { e -> unavailable(call, e) }
    }

    private fun unavailable(call: PluginCall, e: Exception) {
        Log.w(TAG, "document scanner unavailable", e)
        pending = null
        val error = handler.unavailable(e.message ?: e.javaClass.name)
        call.reject(error.message, error.code)
    }

    private fun onScanned(result: ActivityResult) {
        val call = pending ?: return
        pending = null
        if (result.resultCode != Activity.RESULT_OK) return call.resolve(JSObject.fromJSONObject(handler.cancelled()))
        val uris = GmsDocumentScanningResult.fromActivityResultIntent(result.data)?.pages?.map { it.imageUri }.orEmpty()
        val resolver = context.applicationContext.contentResolver
        val pages = uris.map { uri -> { requireNotNull(resolver.openInputStream(uri)) { "cannot open $uri" } } }
        // Copying a few MB per page is quick, but keep it off the main thread anyway.
        Thread({ finish(call) { handler.stored(pages) } }, "scan-store").start()
    }

    private fun finish(call: PluginCall, block: () -> org.json.JSONObject) {
        try {
            val reply = block()
            Log.i(TAG, "scan returned ${reply.getJSONArray("pages").length()} pages")
            call.resolve(JSObject.fromJSONObject(reply))
        } catch (e: PluginError) {
            Log.e(TAG, "scan failed", e)
            call.reject(e.message, e.code)
        } catch (e: Exception) {
            Log.e(TAG, "scan failed", e)
            call.reject(e.message ?: e.javaClass.name, "failed")
        }
    }

    companion object {
        private const val TAG = "ScannerPlugin"
        private const val JPEG_QUALITY = 95

        /** Replaces ML Kit when set (practice-app task 10.6's smoke test). */
        @Volatile
        var pageSource: PageSource? = null
    }

    /** EXIF rotation and size with Android's bitmap decoder (as the first version's MlKitPageSource.storePage). */
    private object AndroidPageImages : PageImages {
        override fun upright(file: File) {
            val orientation = ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            val degrees = when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> return
            }
            val bitmap = BitmapFactory.decodeFile(file.path) ?: error("the page is not a readable image")
            val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees) }, true)
            file.outputStream().use { rotated.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
        }

        override fun size(file: File): Pair<Int, Int> {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.path, bounds)
            check(bounds.outWidth > 0 && bounds.outHeight > 0) { "the page is not a readable image" }
            return bounds.outWidth to bounds.outHeight
        }
    }
}
