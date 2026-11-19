package be.imagitech.snapsody.scanner

import be.imagitech.snapsody.Contract
import be.imagitech.snapsody.files.PluginError
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException

/**
 * The Scanner plugin's handler (practice-app task 10.2) against fixtures/bridge/scanner.scan.json:
 * ML Kit's options, the stored pages and the reply, cancelling, and "unavailable".
 */
class ScannerHandlerTest {
    @get:Rule
    val temp = TemporaryFolder()

    private val example = Contract.example("scanner.scan")

    /** Sizes by file name order; rotation is recorded. */
    private class FakeImages(private val sizes: List<Pair<Int, Int>>) : PageImages {
        val uprighted = mutableListOf<String>()
        override fun upright(file: File) {
            uprighted += file.name
        }

        override fun size(file: File): Pair<Int, Int> {
            if (file.length() == 0L) throw IllegalStateException("the page is not a readable image")
            return sizes[file.name.removePrefix("page-").removeSuffix(".jpg").toInt() - 1]
        }
    }

    private fun page(vararg bytes: Int): () -> java.io.InputStream = { ByteArrayInputStream(bytes.map { it.toByte() }.toByteArray()) }

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
    fun theExampleRequestOpensMlKitInBaseModeWithGalleryImport() {
        val handler = ScannerHandler(temp.root, FakeImages(emptyList()))
        assertEquals(emptyList<String>(), Contract.requestErrors(example, example.getJSONObject("request")))
        val request = handler.request(example.getJSONObject("request"))
        assertEquals(ScannerHandler.Request(maxPages = 10, galleryImport = true, mode = ScannerHandler.Mode.BASE), request)
        assertEquals(10, handler.request(JSONObject()).maxPages)
        assertEquals(3, handler.request(JSONObject().put("maxPages", 3)).maxPages)
        for ((errorRequest, errorCode) in Contract.errors(example)) {
            if (errorRequest != null) assertEquals(errorCode, code { handler.request(errorRequest) })
        }
        assertEquals("invalid", code { handler.request(JSONObject().put("maxPages", 0)) })
        assertEquals("invalid", code { handler.request(JSONObject().put("maxPages", "ten")) })
    }

    @Test
    fun scannedPagesAreStoredUprightInOrderAsDataRelativePaths() {
        val images = FakeImages(listOf(3721 to 349, 3625 to 392))
        val handler = ScannerHandler(temp.root, images, newId = { "f8cfbf27-3a1d-4c55-9b0e-2d7f6a1c9e40" })
        val reply = handler.stored(listOf(page(0xFF, 0xD8, 1), page(0xFF, 0xD8, 2)))
        assertEquals(emptyList<String>(), Contract.replyErrors(example, reply))
        val expected = example.getJSONArray("replies").getJSONObject(0).getJSONArray("pages")
        val got = reply.getJSONArray("pages")
        assertEquals(expected.length(), got.length())
        for (i in 0 until got.length()) {
            for (key in listOf("path", "width", "height")) assertEquals(expected.getJSONObject(i).get(key), got.getJSONObject(i).get(key))
        }
        assertEquals(listOf("page-1.jpg", "page-2.jpg"), images.uprighted)
        val first = reply.getJSONArray("pages").getJSONObject(0).getString("path")
        assertArrayEquals(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), File(temp.root, first).readBytes())
        assertFalse(reply.getBoolean("cancelled"))
    }

    @Test
    fun leavingTheScannerIsCancelledNotAnError() {
        val handler = ScannerHandler(temp.root, FakeImages(emptyList()))
        for (reply in listOf(handler.cancelled(), handler.stored(emptyList()))) {
            assertEquals(emptyList<String>(), Contract.replyErrors(example, reply))
            assertTrue(reply.getBoolean("cancelled"))
            assertEquals(0, reply.getJSONArray("pages").length())
        }
        assertEquals(0, File(temp.root, "scans").listFiles().orEmpty().size)
    }

    @Test
    fun unavailableHasThePortCode() {
        val unavailable = Contract.errors(example).single { it.first == null }.second
        assertEquals(unavailable, ScannerHandler(temp.root, FakeImages(emptyList())).unavailable("Google Play services is missing").code)
    }

    @Test
    fun aPageThatCannotBeStoredFailsTheScanAndLeavesNothing() {
        val handler = ScannerHandler(temp.root, FakeImages(listOf(10 to 10, 10 to 10)), newId = { "s1" })
        assertEquals("failed", code { handler.stored(listOf(page(1), { throw IOException("gone") })) })
        assertFalse(File(temp.root, "scans/s1").exists())
        assertEquals("failed", code { handler.stored(listOf(page())) })
    }
}
