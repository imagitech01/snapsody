package app.snapsody

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.snapsody.scanner.PageSource
import app.snapsody.scanner.ScannerPlugin
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The device layer's only test (openspec test-pyramid design T7, practice-app design D15 and task
 * 10.6): a scanned page becomes a saved piece that renders, plays, and survives an activity restart,
 * on the real Capacitor WebView, plugins, Python and models. It checks that each step completes,
 * nothing more: no music comparison, no accelerator and no timing, so it passes on the emulator's CPU.
 *
 * The page is the self-engraved one from androidTest/assets/fixtures/ (tools/models/make_inference_fixtures.py).
 * It comes through [ScannerPlugin.pageSource] instead of ML Kit's scanner, as a JPEG like the scanner's.
 * The web layer has no test hooks in the app build: the test reads the screen through the DOM
 * (`data-screen`, `data-step`, `data-piece-id`, the accessible names of the buttons) and presses
 * buttons by their names, in English (the emulator's language).
 */
@RunWith(AndroidJUnit4::class)
class EndToEndSmokeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext
    private val pieces = File(context.filesDir, "pieces")
    private var created: String? = null

    private fun ids(): Set<String> = pieces.list { f, n -> File(f, n).isDirectory && !n.startsWith(".") }.orEmpty().toSet()

    private fun evaluate(scenario: ActivityScenario<MainActivity>, script: String): String {
        var result = "null"
        val latch = CountDownLatch(1)
        scenario.onActivity { a -> a.bridge.webView.evaluateJavascript(script) { result = it ?: "null"; latch.countDown() } }
        assertTrue("evaluateJavascript timed out", latch.await(10, TimeUnit.SECONDS))
        return result
    }

    /** The value of a JavaScript expression that gives a string (or null), unquoted. */
    private fun text(scenario: ActivityScenario<MainActivity>, expression: String): String? {
        val json = evaluate(scenario, "(() => { const v = ($expression); return v == null ? null : String(v) })()")
        return if (json == "null") null else JSONObject("{\"v\":$json}").getString("v")
    }

    private fun isTrue(scenario: ActivityScenario<MainActivity>, expression: String) = evaluate(scenario, "!!($expression)") == "true"

    private fun waitFor(what: String, timeoutMs: Long = 30_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(200)
        }
        throw AssertionError("timed out waiting for $what")
    }

    /** The enabled button named [name] (its aria-label, else its text without the aria-hidden parts), as a JavaScript expression. */
    private fun button(name: String) =
        "[...document.querySelectorAll('button')].find(b => !b.disabled && (b.getAttribute('aria-label') ?? " +
            "(c => { c.querySelectorAll('[aria-hidden=\"true\"]').forEach(e => e.remove()); return c.textContent.trim() })(b.cloneNode(true))) === ${JSONObject.quote(name)})"

    private fun click(scenario: ActivityScenario<MainActivity>, name: String) {
        waitFor("the button '$name'") { isTrue(scenario, button(name)) }
        evaluate(scenario, "${button(name)}.click()")
    }

    private fun launch(): ActivityScenario<MainActivity> {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        waitFor("the practice home", 60_000) { isTrue(scenario, button("Add music")) }
        return scenario
    }

    private fun waitForRenderedScore(scenario: ActivityScenario<MainActivity>) =
        waitFor("the rendered score", 60_000) { isTrue(scenario, "document.querySelector('[data-screen=\"practice\"] .score-view svg g.note')") }

    /** The bundled page, re-encoded as the scanner's JPEG. */
    private fun scannedPage(): ByteArray {
        val png = instrumentation.context.assets.open("fixtures/engraved_page.png").use { BitmapFactory.decodeStream(it) }
        return ByteArrayOutputStream().also { png.compress(Bitmap.CompressFormat.JPEG, 95, it) }.toByteArray()
    }

    @After
    fun cleanUp() {
        ScannerPlugin.pageSource = null
        created?.let { File(pieces, it).deleteRecursively() }
    }

    @Test
    fun scannedPageBecomesAPieceThatRendersPlaysAndSurvivesARestart() {
        val page = scannedPage()
        ScannerPlugin.pageSource = PageSource { listOf({ ByteArrayInputStream(page) }) }
        val before = ids()

        // 1-3. Add music: the hint (unless switched off), the injected page, reading, the saved piece.
        var scenario = launch()
        val id: String
        try {
            click(scenario, "Add music")
            val started = System.currentTimeMillis()
            var hinted = false
            waitFor("practice on the new piece after reading", 600_000) {
                val step = text(scenario, "document.querySelector('[data-screen=\"add-music\"]')?.dataset.step")
                if (step == "hint" && !hinted) {
                    hinted = true
                    click(scenario, "Open the scanner")
                }
                if (step == "no-music" || step == "failed" || step == "unavailable") {
                    throw AssertionError("adding music ended '$step': ${text(scenario, "document.querySelector('[data-screen=\"add-music\"]').textContent")}")
                }
                isTrue(scenario, "document.querySelector('[data-screen=\"practice\"]')")
            }
            Log.i(TAG, "reading and save took ${(System.currentTimeMillis() - started) / 1000} s")
            id = (ids() - before).single()
            created = id
            assertEquals(id, text(scenario, "document.querySelector('[data-screen=\"practice\"]').dataset.pieceId"))
            val info = JSONObject(File(pieces, "$id/piece.json").readText())
            assertTrue("bars in piece.json", info.getInt("bars") > 0)
            assertTrue("the score file", File(pieces, "$id/${info.getString("score")}").length() > 0)
            assertTrue("the page photo", File(pieces, "$id/pages/1/source.jpg").length() > 0)
            assertTrue("the page's reading", File(pieces, "$id/pages/1/recognised.musicxml").length() > 0)

            // 4-5. It renders, and a few beats play: a note is highlighted and the music goes on.
            waitForRenderedScore(scenario)
            click(scenario, "Play")
            waitFor("playback", 30_000) { isTrue(scenario, "document.querySelector('.score-view g.note.hl')") }
            Thread.sleep(2_000)
            assertTrue("still playing", isTrue(scenario, "${button("Pause")} && document.querySelector('.score-view g.note.hl')"))
            assertTrue("no sound problem", !isTrue(scenario, "document.querySelector('.practice-problem')"))
            click(scenario, "Pause")
            waitFor("paused") { isTrue(scenario, button("Play")) }
        } finally {
            scenario.close()
        }

        // 6. A fresh activity continues the piece, and it opens and renders.
        scenario = launch()
        try {
            click(scenario, "Continue practising")
            waitForRenderedScore(scenario)
            assertEquals(id, text(scenario, "document.querySelector('[data-screen=\"practice\"]').dataset.pieceId"))
        } finally {
            scenario.close()
        }
    }

    companion object {
        private const val TAG = "EndToEndSmokeTest"
    }
}
