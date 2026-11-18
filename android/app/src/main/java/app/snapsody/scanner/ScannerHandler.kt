package app.snapsody.scanner

import app.snapsody.files.AppPaths
import app.snapsody.files.PluginError
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.util.UUID

/** What the Scanner plugin does to a stored page image: on the phone, EXIF rotation and the decoded size. */
interface PageImages {
    /** Turns the image at [file] upright, in place, when its EXIF orientation says it is rotated. */
    fun upright(file: File)

    /** Width and height in pixels; throws when [file] is not a readable image. */
    fun size(file: File): Pair<Int, Int>
}

/**
 * The Scanner plugin's logic, without Android or ML Kit (practice-app design D15), so it runs in
 * JVM tests against fixtures/bridge/scanner.scan.json. [ScannerPlugin] is the thin adapter.
 *
 * `scan({ maxPages })` opens ML Kit's document scanner in BASE mode with gallery import, for up
 * to `maxPages` pages (1 to [MAX_PAGES], [MAX_PAGES] when left out). The pages the user keeps are
 * copied, upright, to `scans/<id>/page-<n>.jpg` in the app's data folder, and returned as such
 * relative paths: the port's `Files` and the Reader accept them as they are.
 */
class ScannerHandler(
    private val root: File,
    private val images: PageImages,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    /** How the scanner is opened. */
    data class Request(val maxPages: Int, val galleryImport: Boolean, val mode: Mode)

    enum class Mode {
        /** ML Kit's SCANNER_MODE_BASE: crop, rotate and reorder, no filters or cleaning. */
        BASE,
    }

    /** The request for a `scan` call's options. Rejects with "invalid" a page count outside 1 to [MAX_PAGES]. */
    fun request(options: JSONObject): Request {
        val maxPages = if (options.has("maxPages")) options.optInt("maxPages", -1) else MAX_PAGES
        if (maxPages !in 1..MAX_PAGES) throw PluginError("invalid", "maxPages must be 1 to $MAX_PAGES, not ${options.opt("maxPages")}")
        return Request(maxPages = maxPages, galleryImport = true, mode = Mode.BASE)
    }

    /** The scanner could not be started (Google Play services missing or outdated, the scanner module unavailable, no camera). */
    fun unavailable(reason: String): PluginError = PluginError("unavailable", "the page scanner is not available: $reason")

    /** The user left the scanner without pages. */
    fun cancelled(): JSONObject = JSONObject().put("cancelled", true).put("pages", JSONArray())

    /**
     * Stores the pages the scanner returned, in their order, and gives the reply. No pages is the
     * same as cancelling. Rejects with "failed" when a page cannot be copied or read.
     */
    fun stored(pages: List<() -> InputStream>): JSONObject {
        if (pages.isEmpty()) return cancelled()
        val id = newId()
        val folder = File(root, "scans/$id")
        if (!folder.mkdirs()) throw PluginError("failed", "could not create scans/$id")
        val list = JSONArray()
        try {
            pages.forEachIndexed { index, open ->
                val file = File(folder, "page-${index + 1}.jpg")
                open().use { input -> file.outputStream().use { input.copyTo(it) } }
                images.upright(file)
                val (width, height) = images.size(file)
                list.put(JSONObject().put("path", AppPaths.relative(root, file)).put("width", width).put("height", height))
            }
        } catch (e: Exception) {
            folder.deleteRecursively()
            throw PluginError("failed", "could not store the scanned pages: ${e.message ?: e.javaClass.name}")
        }
        return JSONObject().put("cancelled", false).put("pages", list)
    }

    companion object {
        /** The most pages one scan takes (design D6; the add-music flow asks for this many). */
        const val MAX_PAGES = 10
    }
}
