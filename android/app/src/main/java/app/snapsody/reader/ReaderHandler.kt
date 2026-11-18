package app.snapsody.reader

import app.snapsody.files.AppPaths
import app.snapsody.files.PluginError
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** What reading one page gave. */
sealed class PageResult {
    /**
     * The page's raw MusicXML, and next to it (design D7) where its staves are ([staves]; null when
     * homr's counts did not add up) and whether its time signature was estimated rather than read
     * ([timeEstimated]; null when unknown). The extras are sent only when known.
     */
    data class Done(
        val musicxml: String,
        val staves: List<StaffPosition>? = null,
        val timeEstimated: Boolean? = null,
    ) : PageResult()
    data class NoMusic(val message: String) : PageResult()
    /** The job was cancelled while this page was read. */
    data object Cancelled : PageResult()
}

/**
 * Where one staff is on the page image and which of the page's bars it holds (design D7): the box
 * as fractions (0..1) of the image, the bars numbered from 1 on the page, first and last included.
 * On the wire (port.ts `ReaderStaff`): `{ box: { x, y, width, height }, firstBar, lastBar }`.
 */
data class StaffPosition(
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val firstBar: Int,
    val lastBar: Int,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("box", JSONObject().put("x", x).put("y", y).put("width", width).put("height", height))
        .put("firstBar", firstBar)
        .put("lastBar", lastBar)

    companion object {
        /**
         * The engine's `staves` (ia_engine.staves_in_source), or null when there are none or one is not
         * well formed: a box value outside 0..1, or bars that do not run on from 1 without a gap.
         */
        fun listFrom(array: JSONArray?): List<StaffPosition>? {
            if (array == null || array.length() == 0) return null
            var next = 1
            val result = mutableListOf<StaffPosition>()
            for (i in 0 until array.length()) {
                val staff = array.optJSONObject(i) ?: return null
                val box = staff.optJSONObject("box") ?: return null
                val values = listOf("x", "y", "width", "height").map { key ->
                    (box.opt(key) as? Number)?.toDouble()?.takeIf { it in 0.0..1.0 } ?: return null
                }
                val first = staff.opt("firstBar") as? Int ?: return null
                val last = staff.opt("lastBar") as? Int ?: return null
                if (first != next || last < first) return null
                next = last + 1
                result += StaffPosition(values[0], values[1], values[2], values[3], first, last)
            }
            return result
        }
    }
}

/** Reads one page image. On the phone: homr through Chaquopy ([HomrPageReader]). */
interface PageReader {
    /**
     * Reads [image]. [progress] gets a stage name ("prepare", "segment", "detect", "read",
     * "write") and the fraction of the page done; [cancelled] says whether to stop. Throws when
     * the page cannot be read: that page failed, the job goes on.
     */
    fun read(image: File, progress: (stage: String, fraction: Double) -> Unit, cancelled: () -> Boolean): PageResult

    /** Called once after the last page, also when the job ends early. */
    fun close() {}
}

/** Runs a whole job off the caller's thread. On the phone: the inference thread ([InferenceThread]). */
fun interface JobRunner {
    /** Runs [job] with a [PageReader] made for it. Making the reader may throw: the job then failed. */
    fun run(job: (readerFor: () -> PageReader) -> Unit)
}

/** The foreground service a job runs under (design D6: one start per job, not per page). */
interface Foreground {
    fun start()
    fun stop()
}

/**
 * The Reader plugin's logic, without Android or Python (practice-app design D15), so it runs in
 * JVM tests against fixtures/bridge/reader.*.json. [ReaderPlugin] is the thin adapter.
 *
 * - `read({ jobId, pages })` -> `{ jobId }`: reads the pages (data-relative paths, as the Scanner
 *   returns them) in order as ONE job, under one foreground service. One job at a time.
 * - `cancel({ jobId })` -> `{ cancelled }`: stops the page being read and skips the rest.
 * - Every event goes to [listener] as one `readerEvent` payload: the port's `ReaderEvent`
 *   (web/src/platform/port.ts) plus `jobId`. For each page, in order: `progress` events (the first
 *   page starts with `queued`; the fraction never goes back within a page), then `done`,
 *   `no-music` or `failed`; a page that is cancelled sends none. The last event is `finished`
 *   (`done`, `cancelled`, or `failed` when the job itself broke), exactly once.
 */
class ReaderHandler(
    private val root: File,
    private val runner: JobRunner,
    private val foreground: Foreground,
) {
    /** Where the events go (the plugin's `notifyListeners`). Events while it is null are dropped. */
    @Volatile
    var listener: ((JSONObject) -> Unit)? = null

    private class Job(val id: String, val pages: List<File>) {
        @Volatile
        var cancelled = false
    }

    private val lock = Any()
    private var current: Job? = null

    val isRunning: Boolean get() = synchronized(lock) { current != null }

    fun read(request: JSONObject): JSONObject {
        val jobId = request.optString("jobId").takeIf { it.isNotBlank() } ?: throw PluginError("invalid", "jobId is required")
        val list = request.optJSONArray("pages") ?: throw PluginError("invalid", "pages is required")
        if (list.length() == 0) throw PluginError("invalid", "no pages")
        val pages = (0 until list.length()).map { index ->
            val path = list.opt(index) as? String ?: throw PluginError("invalid", "pages[$index] is not a path")
            AppPaths.resolve(root, path).also { if (!it.isFile) throw PluginError("not-found", "no image at $path") }
        }
        val job = Job(jobId, pages)
        synchronized(lock) {
            if (current != null) throw PluginError("failed", "a reading is already running")
            current = job
            progress(job, 0, "queued", 0.0)
        }
        try {
            foreground.start()
            runner.run { readerFor -> run(job, readerFor) }
        } catch (e: Exception) {
            val message = "the reading could not start: ${e.message ?: e.javaClass.name}"
            synchronized(lock) {
                current = null
                emit(event("finished", job).put("status", "failed").put("message", message))
            }
            foreground.stop()
            throw PluginError("failed", message)
        }
        return JSONObject().put("jobId", jobId)
    }

    fun cancel(request: JSONObject): JSONObject {
        val jobId = request.optString("jobId").takeIf { it.isNotBlank() } ?: throw PluginError("invalid", "jobId is required")
        val cancelled = synchronized(lock) {
            current?.takeIf { it.id == jobId }?.also { it.cancelled = true } != null
        }
        return JSONObject().put("cancelled", cancelled)
    }

    /** The foreground service's time limit: the running job is cancelled. Safe to call more than once. */
    fun timeLimitReached() {
        synchronized(lock) { current?.cancelled = true }
    }

    private fun run(job: Job, readerFor: () -> PageReader) {
        var status = "done"
        var message: String? = null
        try {
            val reader = readerFor()
            try {
                for ((index, image) in job.pages.withIndex()) {
                    if (job.cancelled) break
                    readPage(job, reader, index, image)
                }
            } finally {
                reader.close()
            }
            if (job.cancelled) status = "cancelled"
        } catch (e: Throwable) {
            status = if (job.cancelled) "cancelled" else "failed"
            message = if (status == "failed") e.message ?: e.javaClass.name else null
        } finally {
            val finished = event("finished", job).put("status", status)
            message?.let { finished.put("message", it) }
            synchronized(lock) {
                current = null
                emit(finished)
            }
            foreground.stop()
        }
    }

    private fun readPage(job: Job, reader: PageReader, index: Int, image: File) {
        var last = if (index == 0) 0.0 else -1.0
        val onProgress = { stage: String, fraction: Double ->
            if (stage in STAGES && !job.cancelled) {
                val value = fraction.coerceIn(0.0, 1.0).coerceAtLeast(last.coerceAtLeast(0.0))
                last = value
                progress(job, index, stage, value)
            }
        }
        val result = try {
            reader.read(image, onProgress) { job.cancelled }
        } catch (e: Exception) {
            if (job.cancelled) PageResult.Cancelled else return emit(event("failed", job, index).put("message", e.message ?: e.javaClass.name))
        }
        when {
            result is PageResult.Cancelled || job.cancelled -> Unit
            result is PageResult.Done -> emit(done(job, index, result))
            result is PageResult.NoMusic -> emit(event("no-music", job, index).put("message", result.message))
        }
    }

    private fun done(job: Job, page: Int, result: PageResult.Done): JSONObject {
        val event = event("done", job, page).put("musicxml", result.musicxml)
        result.staves?.let { staves -> event.put("staves", JSONArray(staves.map { it.toJson() })) }
        result.timeEstimated?.let { event.put("timeEstimated", it) }
        return event
    }

    private fun progress(job: Job, page: Int, stage: String, fraction: Double) {
        emit(event("progress", job, page).put("stage", stage).put("fraction", fraction))
    }

    private fun event(type: String, job: Job, page: Int? = null): JSONObject {
        val event = JSONObject().put("type", type)
        page?.let { event.put("page", it) }
        return event.put("pages", job.pages.size).put("jobId", job.id)
    }

    private fun emit(event: JSONObject) {
        try {
            listener?.invoke(event)
        } catch (_: Exception) {
            // A listener that fails (the web page is gone) does not stop the job.
        }
    }

    companion object {
        /** The stages a page goes through after "queued" (port.ts `ReaderStage`), as ia_engine.py names them. */
        val STAGES = setOf("prepare", "segment", "detect", "read", "write")
    }
}
