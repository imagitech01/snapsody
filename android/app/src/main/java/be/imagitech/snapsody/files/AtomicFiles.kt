package be.imagitech.snapsody.files

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.ThreadLocalRandom

/**
 * The steps an atomic write is made of, one call each, so a JVM test can check the files between
 * them and stop ("crash") at any of them. [Posix] is the real thing on the phone.
 */
interface FileSteps {
    /** Writes [bytes] to [file] (created or truncated) and flushes it to the disk (fsync). */
    fun writeSynced(file: File, bytes: ByteArray)

    /** Renames [from] to [to] in one atomic step (rename(2)): an existing file at [to] is replaced, never deleted first. */
    fun rename(from: File, to: File)

    /** Flushes [folder]'s entries to the disk (fsync on the folder), so a rename in it survives a power cut. */
    fun syncFolder(folder: File)

    /** Deletes [file], if it is there. */
    fun delete(file: File)

    /** On the phone: `FileDescriptor.sync`, `Os.rename` and `Os.fsync` on the folder. */
    object Posix : FileSteps {
        override fun writeSynced(file: File, bytes: ByteArray) {
            FileOutputStream(file).use { out ->
                out.write(bytes)
                out.fd.sync()
            }
        }

        override fun rename(from: File, to: File) {
            try {
                Os.rename(from.path, to.path)
            } catch (e: ErrnoException) {
                throw IOException("rename ${from.name} to ${to.name}: ${e.message}", e)
            }
        }

        override fun syncFolder(folder: File) {
            try {
                val fd = Os.open(folder.path, OsConstants.O_RDONLY, 0)
                try {
                    Os.fsync(fd)
                } finally {
                    Os.close(fd)
                }
            } catch (e: ErrnoException) {
                throw IOException("fsync ${folder.name}: ${e.message}", e)
            }
        }

        override fun delete(file: File) {
            file.delete()
        }
    }
}

/**
 * The atomic file operations of the platform port that Capacitor's Filesystem plugin cannot do
 * (practice-app design D4, "Atomic writes"): its `rename` deletes the target before renaming, and
 * it never fsyncs. Plain class, no Capacitor, so it runs in JVM tests; [AtomicFilesPlugin] is its
 * thin adapter.
 *
 * - [writeTextAtomic]: writes `<target>.tmp-<suffix>`, fsyncs it, renames it over the target in
 *   one step, then fsyncs the folder. A crash at any point leaves the old file or the new one at
 *   the target, never nothing, plus at most a stray temp file for the start-up sweep.
 * - [moveFile]: the port's `rename` for a file. An existing target file is replaced in one step.
 */
class AtomicFiles(private val root: File, private val steps: FileSteps = FileSteps.Posix) {
    /** [suffix]: the web side's `tempSuffix()` (nine base-36 digits of ms since 1970, "-", random characters); made here when null. */
    fun writeTextAtomic(path: String, text: String, suffix: String?) {
        val target = AppPaths.resolve(root, path)
        if (suffix != null && !SUFFIX.matches(suffix)) throw PluginError("invalid", "temp suffix not accepted: $suffix")
        if (target.isDirectory) throw PluginError("exists", "$path is a folder")
        val folder = target.parentFile!!
        makeFolders(folder)
        val temp = File(folder, "${target.name}.tmp-${suffix ?: tempSuffix()}")
        try {
            steps.writeSynced(temp, text.toByteArray(Charsets.UTF_8))
            steps.rename(temp, target)
        } catch (e: IOException) {
            // Still running: the failure is seen, so the temp file goes again (a crash leaves it to the sweep).
            steps.delete(temp)
            throw PluginError("failed", "could not write $path: ${e.message}")
        }
        sync(folder)
    }

    /** Moves the file [from] to [to], replacing a file there in one step and creating the folders above [to]. */
    fun moveFile(from: String, to: String) {
        val source = AppPaths.resolve(root, from)
        val target = AppPaths.resolve(root, to)
        if (!source.exists()) throw PluginError("not-found", "nothing at $from")
        if (source.isDirectory) throw PluginError("invalid", "$from is a folder; folders are moved with the Filesystem plugin")
        if (target.isDirectory) throw PluginError("exists", "$to is a folder")
        if (source.canonicalFile == target.canonicalFile) return
        makeFolders(target.parentFile!!)
        try {
            steps.rename(source, target)
        } catch (e: IOException) {
            throw PluginError("failed", "could not move $from to $to: ${e.message}")
        }
        sync(target.parentFile!!)
        if (source.parentFile != target.parentFile) sync(source.parentFile!!)
    }

    private fun makeFolders(folder: File) {
        if (folder.isDirectory) return
        if (folder.exists()) throw PluginError("exists", "${AppPaths.relative(root, folder)} is a file")
        makeFolders(folder.parentFile!!)
        if (!folder.mkdir() && !folder.isDirectory) throw PluginError("failed", "could not create ${AppPaths.relative(root, folder)}")
        sync(folder.parentFile!!)
    }

    /** A folder fsync that fails does not undo the write: the rename has happened, only its durability is weaker. */
    private fun sync(folder: File) {
        try {
            steps.syncFolder(folder)
        } catch (e: IOException) {
            Log.w(TAG, "folder fsync failed: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "AtomicFiles"

        /** `tempSuffix` in web/src/platform/atomicWrite.ts. */
        val SUFFIX = Regex("[0-9a-z]{9}-[0-9a-z]{1,32}")

        /** The same format as `tempSuffix` (web/src/platform/atomicWrite.ts), for a caller that sends none. */
        fun tempSuffix(now: Long = System.currentTimeMillis()): String {
            val time = now.coerceAtLeast(0).toString(36).padStart(9, '0')
            val random = (1..8).map { "0123456789abcdefghijklmnopqrstuvwxyz"[ThreadLocalRandom.current().nextInt(36)] }.joinToString("")
            return "$time-$random"
        }
    }
}
