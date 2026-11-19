package be.imagitech.snapsody.reader

import be.imagitech.snapsody.Contract
import be.imagitech.snapsody.files.PluginError
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * The Reader plugin's handler (practice-app task 10.3) against fixtures/bridge/reader.*.json: one
 * job for the ordered pages under one foreground start, the per-page events in the port's order,
 * cancel, no music, failed pages and a failed job. Python is replaced by a scripted [PageReader].
 */
class ReaderHandlerTest {
    @get:Rule
    val temp = TemporaryFolder()

    private val read = Contract.example("reader.read")
    private val jobId = read.getJSONObject("request").getString("jobId")
    private val pages = read.getJSONObject("request").getJSONArray("pages")

    private val events = mutableListOf<JSONObject>()
    private val foreground = object : Foreground {
        val log = mutableListOf<String>()
        override fun start() {
            log += "start"
        }

        override fun stop() {
            log += "stop"
        }
    }

    /** What the scripted reader does with each page, in order. */
    private var script: List<(progress: (String, Double) -> Unit, cancelled: () -> Boolean) -> PageResult> = emptyList()
    private val readImages = mutableListOf<String>()
    private var closed = 0
    private var jobFails: String? = null

    private val reader = object : PageReader {
        override fun read(image: File, progress: (String, Double) -> Unit, cancelled: () -> Boolean): PageResult {
            readImages += image.relativeTo(temp.root).invariantSeparatorsPath
            return script[readImages.size - 1](progress, cancelled)
        }

        override fun close() {
            closed += 1
        }
    }

    /** Runs the job at once, on the calling thread. */
    private val runNow = JobRunner { job -> job { jobFails?.let { throw IllegalStateException(it) } ?: reader } }

    private lateinit var handler: ReaderHandler

    @Before
    fun setUp() {
        for (i in 0 until pages.length()) File(temp.root, pages.getString(i)).apply { parentFile.mkdirs(); writeBytes(byteArrayOf(1, 2, 3)) }
        handler = ReaderHandler(temp.root, runNow, foreground).also { it.listener = { event -> events += event } }
    }

    private val musicxml = Contract.example("reader.done").getJSONObject("payload").getString("musicxml")

    private fun reads(vararg stages: Pair<String, Double>, result: PageResult = PageResult.Done(musicxml)) =
        { progress: (String, Double) -> Unit, _: () -> Boolean -> stages.forEach { (s, f) -> progress(s, f) }; result }

    private fun request(vararg paths: String = Array(pages.length()) { pages.getString(it) }) =
        JSONObject().put("jobId", jobId).put("pages", JSONArray(paths.toList()))

    /** "type:page" for the non-progress events. */
    private fun results() = events.filter { it.getString("type") != "progress" }
        .map { if (it.getString("type") == "finished") "finished:${it.getString("status")}" else "${it.getString("type")}:${it.getInt("page")}" }

    private fun assertEveryEventMatchesItsExample() {
        for (event in events) {
            val example = Contract.example("reader.${event.getString("type")}")
            assertEquals(event.toString(), emptyList<String>(), Contract.eventErrors(example, event))
            assertEquals(jobId, event.getString("jobId"))
        }
        assertEquals("finished exactly once, last", 1, events.count { it.getString("type") == "finished" })
        assertEquals("finished", events.last().getString("type"))
    }

    private fun code(block: () -> Unit): String {
        try {
            block()
        } catch (e: PluginError) {
            return e.code
        }
        fail("no PluginError")
        error("unreachable")
    }

    @Test
    fun theExampleRequestIsOneJobWithEventsPerPageInOrder() {
        script = listOf(
            reads("prepare" to 0.02, "segment" to 0.05, "segment" to 0.3, "detect" to 0.42, "read" to 0.47, "write" to 0.97),
            reads("prepare" to 0.02, "segment" to 0.05, result = PageResult.NoMusic("No noteheads or clefs found")),
        )
        assertEquals(emptyList<String>(), Contract.requestErrors(read, read.getJSONObject("request")))
        val reply = handler.read(read.getJSONObject("request"))
        assertEquals(emptyList<String>(), Contract.replyErrors(read, reply))
        assertEquals(jobId, reply.getString("jobId"))

        assertEquals(listOf(pages.getString(0), pages.getString(1)), readImages)
        assertEquals(listOf("done:0", "no-music:1", "finished:done"), results())
        val first = events.first()
        assertEquals(listOf("progress", "queued", 0), listOf(first.getString("type"), first.getString("stage"), first.getInt("page")))
        assertEveryEventMatchesItsExample()
        assertEquals("one foreground start for the whole job", listOf("start", "stop"), foreground.log)
        assertEquals(1, closed)
        assertFalse(handler.isRunning)
        // Each page's progress comes before its result, and never goes backwards.
        for (page in 0..1) {
            val indices = events.withIndex().filter { it.value.optInt("page", -1) == page }
            val fractions = indices.filter { it.value.getString("type") == "progress" }.map { it.value.getDouble("fraction") }
            assertEquals(fractions.sorted(), fractions)
            assertTrue(indices.last().value.getString("type") != "progress")
        }
    }

    @Test
    fun aPageSendsItsStavesAndTimeFlagWhenKnownAndNothingWhenNot() {
        val example = Contract.example("reader.done").getJSONObject("payload")
        val staves = StaffPosition.listFrom(example.getJSONArray("staves"))!!
        script = listOf(
            reads("prepare" to 0.1, result = PageResult.Done(musicxml, staves, true)),
            reads("prepare" to 0.1, result = PageResult.Done(musicxml)),
        )
        handler.read(request())
        val (first, second) = events.filter { it.getString("type") == "done" }
        assertEquals(example.getJSONArray("staves").toString(), first.getJSONArray("staves").toString())
        assertTrue(first.getBoolean("timeEstimated"))
        assertFalse(second.has("staves"))
        assertFalse(second.has("timeEstimated"))
        assertEveryEventMatchesItsExample()
    }

    @Test
    fun stavesThatAreNotWellFormedAreNotKept() {
        val example = Contract.example("reader.done").getJSONObject("payload").getJSONArray("staves")
        assertEquals(2, StaffPosition.listFrom(example)?.size)
        assertEquals(StaffPosition(0.0302, 0.6402, 0.5443, 0.1498, 6, 8), StaffPosition.listFrom(example)!![1])
        fun changed(index: Int, change: (JSONObject) -> Unit) = JSONArray(example.toString()).also { change(it.getJSONObject(index)) }
        assertEquals(null, StaffPosition.listFrom(null))
        assertEquals(null, StaffPosition.listFrom(JSONArray()))
        assertEquals("a box beyond the image", null, StaffPosition.listFrom(changed(0) { it.getJSONObject("box").put("width", 1.2) }))
        assertEquals("a box value missing", null, StaffPosition.listFrom(changed(1) { it.getJSONObject("box").remove("y") }))
        assertEquals("a gap in the bars", null, StaffPosition.listFrom(changed(1) { it.put("firstBar", 7) }))
        assertEquals("bars not from 1", null, StaffPosition.listFrom(changed(0) { it.put("firstBar", 2) }))
        assertEquals("a staff without bars", null, StaffPosition.listFrom(changed(1) { it.put("lastBar", 5) }))
    }

    @Test
    fun aFailedPageDoesNotStopTheJob() {
        script = listOf({ _, _ -> throw RuntimeException("The reading failed") }, reads("prepare" to 0.1))
        handler.read(request())
        assertEquals(listOf("failed:0", "done:1", "finished:done"), results())
        assertEquals("The reading failed", events.single { it.getString("type") == "failed" }.getString("message"))
        assertEveryEventMatchesItsExample()
    }

    @Test
    fun cancelAbandonsThePageSkipsTheRestAndFinishesCancelled() {
        val cancel = Contract.example("reader.cancel")
        File(temp.root, "scans/x/page-3.jpg").apply { parentFile.mkdirs(); writeBytes(byteArrayOf(1)) }
        var cancelReply: JSONObject? = null
        script = listOf(
            reads("prepare" to 0.1),
            { progress, cancelled ->
                progress("segment", 0.2)
                cancelReply = handler.cancel(cancel.getJSONObject("request"))
                progress("segment", 0.3) // after cancel: not sent
                assertTrue(cancelled())
                PageResult.Cancelled
            },
            reads(),
        )
        handler.read(request(pages.getString(0), pages.getString(1), "scans/x/page-3.jpg"))
        assertEquals(emptyList<String>(), Contract.replyErrors(cancel, cancelReply))
        assertTrue(cancelReply!!.getBoolean("cancelled"))
        assertEquals("page 3 is not read", 2, readImages.size)
        assertEquals(listOf("done:0", "finished:cancelled"), results())
        assertEquals(0.2, events.last { it.getString("type") == "progress" }.getDouble("fraction"), 0.0)
        assertEveryEventMatchesItsExample()
        assertEquals(listOf("start", "stop"), foreground.log)

        val late = handler.cancel(cancel.getJSONObject("request"))
        assertEquals(emptyList<String>(), Contract.replyErrors(cancel, late))
        assertFalse("nothing to cancel after finished", late.getBoolean("cancelled"))
    }

    @Test
    fun aPageThatThrowsAfterCancelIsCancelledNotFailed() {
        script = listOf({ _, _ ->
            handler.cancel(JSONObject().put("jobId", jobId))
            throw RuntimeException("interrupted")
        })
        handler.read(request(pages.getString(0)))
        assertEquals(listOf("finished:cancelled"), results())
    }

    @Test
    fun theTimeLimitCancelsTheJob() {
        script = listOf({ _, cancelled ->
            handler.timeLimitReached()
            handler.timeLimitReached()
            assertTrue(cancelled())
            PageResult.Cancelled
        })
        handler.read(request(pages.getString(0)))
        assertEquals(listOf("finished:cancelled"), results())
    }

    @Test
    fun aJobThatBreaksFinishesFailedWithAMessage() {
        jobFails = "Python could not start"
        handler.read(request())
        assertEquals(listOf("finished:failed"), results())
        assertEquals("Python could not start", events.last().getString("message"))
        assertEveryEventMatchesItsExample()
        assertEquals(listOf("start", "stop"), foreground.log)
    }

    @Test
    fun progressIsClampedAndUnknownStagesAreDropped() {
        script = listOf(reads("prepare" to 0.5, "segment" to 0.4, "tiles" to 0.6, "write" to 1.7))
        handler.read(request(pages.getString(0)))
        val progress = events.filter { it.getString("type") == "progress" }.map { it.getString("stage") to it.getDouble("fraction") }
        assertEquals(listOf("queued" to 0.0, "prepare" to 0.5, "segment" to 0.5, "write" to 1.0), progress)
        assertEveryEventMatchesItsExample()
    }

    @Test
    fun theErrorExamplesAreRejectedWithTheirCodes() {
        for ((errorRequest, errorCode) in Contract.errors(read)) {
            if (errorRequest != null) assertEquals(errorRequest.toString(), errorCode, code { handler.read(errorRequest) })
        }
        assertEquals("invalid", code { handler.read(JSONObject().put("pages", JSONArray(listOf(pages.getString(0))))) })
        assertEquals("nothing started", emptyList<JSONObject>(), events)
        assertEquals(emptyList<String>(), foreground.log)

        // Another job still running: "failed" (the example without a request).
        val busyCode = Contract.errors(read).single { it.first == null }.second
        var pending: (() -> Unit)? = null
        val later = ReaderHandler(temp.root, { job -> pending = { job { reader } } }, foreground)
        script = listOf(reads(), reads())
        later.read(request())
        assertTrue(later.isRunning)
        assertEquals(busyCode, code { later.read(request()) })
        pending!!()
        assertFalse(later.isRunning)
    }

    @Test
    fun aJobThatCannotBeScheduledFinishesFailedAndFreesTheReader() {
        val broken = ReaderHandler(temp.root, { throw IllegalStateException("executor shut down") }, foreground).also { it.listener = { e -> events += e } }
        assertEquals("failed", code { broken.read(request()) })
        assertEquals(listOf("finished:failed"), results())
        assertFalse(broken.isRunning)
        assertEveryEventMatchesItsExample()
    }
}
