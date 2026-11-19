package be.imagitech.snapsody.files

import be.imagitech.snapsody.Contract
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * The native atomic write (practice-app design D4, task 10.5): a crash between any two steps
 * leaves the old or the new content at the target, never no file; a file-over-file move replaces
 * the target in one step. The steps run on the JVM's rename(2) (`Files.move` with ATOMIC_MOVE),
 * the same system call as `Os.rename` on the phone.
 */
class AtomicFilesTest {
    @get:Rule
    val temp = TemporaryFolder()

    /** A "crash": an Error the handler does not catch, so no clean-up runs, as when the process dies. */
    private class Crash : Error("crash")

    /** The JVM's steps, logging each one, checking [invariant] before it, and crashing at step [crashAt] (1-based). */
    private class Steps(private val root: File, private val crashAt: Int = 0, private val invariant: () -> Unit = {}) : FileSteps {
        val log = mutableListOf<String>()

        private fun step(name: String) {
            invariant()
            log += name
            if (log.size == crashAt) throw Crash()
        }

        private fun rel(file: File) = file.relativeTo(root).invariantSeparatorsPath

        override fun writeSynced(file: File, bytes: ByteArray) {
            step("write ${rel(file)}")
            FileOutputStream(file).use {
                it.write(bytes)
                it.fd.sync()
            }
        }

        override fun rename(from: File, to: File) {
            step("rename ${rel(from)} -> ${rel(to)}")
            Files.move(from.toPath(), to.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        }

        override fun syncFolder(folder: File) {
            step("sync ${rel(folder).ifEmpty { "." }}")
        }

        override fun delete(file: File) {
            file.delete()
        }
    }

    private fun root() = temp.newFolder("files")

    private fun errorCode(block: () -> Unit): String {
        try {
            block()
        } catch (e: PluginError) {
            return e.code
        }
        fail("no PluginError")
        error("unreachable")
    }

    @Test
    fun writeIsTempThenFsyncThenRenameThenFolderSync() {
        val root = root()
        File(root, "pieces/p1").mkdirs()
        File(root, "pieces/p1/practice.json").writeText("old")
        val steps = Steps(root)
        AtomicFiles(root, steps).writeTextAtomic("pieces/p1/practice.json", "new", "0mwm3nbwg-k3j5h2q9")
        assertEquals(
            listOf(
                "write pieces/p1/practice.json.tmp-0mwm3nbwg-k3j5h2q9",
                "rename pieces/p1/practice.json.tmp-0mwm3nbwg-k3j5h2q9 -> pieces/p1/practice.json",
                "sync pieces/p1",
            ),
            steps.log,
        )
        assertEquals("new", File(root, "pieces/p1/practice.json").readText())
        assertEquals(listOf("practice.json"), File(root, "pieces/p1").list()!!.toList())
    }

    @Test
    fun aCrashAtAnyStepNeverLeavesTheTargetMissing() {
        for (crashAt in 1..4) {
            val root = temp.newFolder("crash-$crashAt")
            val target = File(root, "pieces/p1/piece.json").apply { parentFile.mkdirs(); writeText("old") }
            val invariant = {
                assertTrue("crash at $crashAt: the target is there between steps", target.isFile)
                assertTrue("crash at $crashAt: old or new, never half", target.readText() in setOf("old", "new"))
            }
            val steps = Steps(root, crashAt, invariant)
            try {
                AtomicFiles(root, steps).writeTextAtomic("pieces/p1/piece.json", "new", null)
            } catch (_: Crash) {
            }
            invariant()
            val expected = if (crashAt <= 2) "old" else "new"
            assertEquals("crash at $crashAt", expected, target.readText())
            val leftovers = target.parentFile.list()!!.filter { it != "piece.json" }
            if (crashAt == 2) {
                assertEquals("a crash before the rename leaves the temp for the start-up sweep", 1, leftovers.size)
                assertTrue(leftovers.single().matches(Regex("piece\\.json\\.tmp-[0-9a-z]{9}-[0-9a-z]{8}")))
                assertEquals("new", File(target.parentFile, leftovers.single()).readText())
            } else {
                assertEquals("crash at $crashAt", emptyList<String>(), leftovers)
            }
        }
    }

    @Test
    fun aCrashOfAFirstWriteLeavesNoFileOrTheWholeFile() {
        for (crashAt in 1..6) {
            val root = temp.newFolder("first-$crashAt")
            val target = File(root, "settings.json")
            try {
                AtomicFiles(root, Steps(root, crashAt)).writeTextAtomic("settings.json", "{\"a\":1}", null)
            } catch (_: Crash) {
            }
            assertTrue("crash at $crashAt", !target.exists() || target.readText() == "{\"a\":1}")
        }
    }

    @Test
    fun aFailedWriteThatIsSeenRemovesItsTemp() {
        val root = root()
        File(root, "settings.json").writeText("old")
        val failing = object : FileSteps by Steps(root) {
            override fun rename(from: File, to: File) = throw java.io.IOException("disk full")
            override fun delete(file: File) {
                file.delete()
            }
        }
        assertEquals("failed", errorCode { AtomicFiles(root, failing).writeTextAtomic("settings.json", "new", null) })
        assertEquals("old", File(root, "settings.json").readText())
        assertEquals(listOf("settings.json"), root.list()!!.toList())
    }

    @Test
    fun writeCreatesTheFoldersAboveAndRefusesAFolderTargetAndBadPaths() {
        val root = root()
        AtomicFiles(root, Steps(root)).writeTextAtomic("pieces/.tmp-p2/pages/1/x.json", "x", null)
        assertEquals("x", File(root, "pieces/.tmp-p2/pages/1/x.json").readText())
        assertEquals("exists", errorCode { AtomicFiles(root, Steps(root)).writeTextAtomic("pieces", "x", null) })
        assertEquals("invalid", errorCode { AtomicFiles(root, Steps(root)).writeTextAtomic("../x.json", "x", null) })
        assertEquals("invalid", errorCode { AtomicFiles(root, Steps(root)).writeTextAtomic("x.json", "x", "../../evil") })
    }

    @Test
    fun moveFileReplacesAFileInOneStepAndKeepsTheTargetThereThroughout() {
        val root = root()
        val from = File(root, "pieces/p1/piece.json.tmp-0mwm3nbwg-k3j5h2q9").apply { parentFile.mkdirs(); writeText("new") }
        val to = File(root, "pieces/p1/piece.json").apply { writeText("old") }
        val steps = Steps(root, invariant = { assertTrue(to.isFile) })
        AtomicFiles(root, steps).moveFile(AppPaths.relative(root, from), "pieces/p1/piece.json")
        assertEquals(listOf("rename pieces/p1/piece.json.tmp-0mwm3nbwg-k3j5h2q9 -> pieces/p1/piece.json", "sync pieces/p1"), steps.log)
        assertEquals("new", to.readText())
        assertFalse(from.exists())
    }

    @Test
    fun moveFileCreatesFoldersAndRefusesWhatThePortRefuses() {
        val root = root()
        File(root, "a.txt").writeText("a")
        File(root, "pieces/p1").mkdirs()
        val files = AtomicFiles(root, Steps(root))
        files.moveFile("a.txt", "deep/er/b.txt")
        assertEquals("a", File(root, "deep/er/b.txt").readText())
        assertEquals("not-found", errorCode { files.moveFile("a.txt", "c.txt") })
        assertEquals("exists", errorCode { files.moveFile("deep/er/b.txt", "pieces") })
        assertEquals("invalid", errorCode { files.moveFile("pieces", "elsewhere") })
        assertEquals("invalid", errorCode { files.moveFile("deep/er/b.txt", "../../b.txt") })
        files.moveFile("deep/er/b.txt", "deep/er/b.txt")
        assertEquals("a", File(root, "deep/er/b.txt").readText())
    }

    @Test
    fun theContractExamplesMatch() {
        val write = Contract.example("atomicFiles.writeTextAtomic")
        val move = Contract.example("atomicFiles.moveFile")
        val root = root()
        File(root, "pieces/3b0c9d6e-1f2a-4b3c-8d4e-5f6a7b8c9d0e").mkdirs()
        File(root, "settings.json").writeText("{}")
        val files = AtomicFiles(root, Steps(root))

        val request = write.getJSONObject("request")
        files.writeTextAtomic(request.getString("path"), request.getString("text"), request.optString("suffix").ifEmpty { null })
        assertEquals(request.getString("text"), File(root, request.getString("path")).readText())
        assertEquals(emptyList<String>(), Contract.replyErrors(write, JSONObject()))
        for ((errorRequest, code) in Contract.errors(write)) {
            assertEquals(errorRequest.toString(), code, errorCode { files.writeTextAtomic(errorRequest!!.getString("path"), errorRequest.getString("text"), null) })
        }

        val moveRequest = move.getJSONObject("request")
        File(root, moveRequest.getString("from")).writeText("{\"format\":2}")
        files.moveFile(moveRequest.getString("from"), moveRequest.getString("to"))
        assertEquals("{\"format\":2}", File(root, moveRequest.getString("to")).readText())
        for ((errorRequest, code) in Contract.errors(move)) {
            assertEquals(errorRequest.toString(), code, errorCode { files.moveFile(errorRequest!!.getString("from"), errorRequest.getString("to")) })
        }
    }

    @Test
    fun theNativeSuffixHasTheWebFormat() {
        assertEquals("0mwm3nbwg", AtomicFiles.tempSuffix(1795005028096).substringBefore('-'))
        assertTrue(AtomicFiles.SUFFIX.matches(AtomicFiles.tempSuffix()))
    }
}
