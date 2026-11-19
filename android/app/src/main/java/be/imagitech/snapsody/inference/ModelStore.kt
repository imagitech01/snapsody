package be.imagitech.snapsody.inference

import android.content.Context
import android.content.res.AssetManager
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.security.MessageDigest

/**
 * The recognition models bundled as assets (assets/models, see tools/models/package_models.py).
 *
 * models.json lists each model's role, file name and SHA-256. The hashes identify the
 * model versions (also used to key the accelerator self-test, task 4.2).
 */
class ModelStore(context: Context) {
    data class Model(val role: String, val file: String, val bytes: Long, val sha256: String)

    private val app = context.applicationContext
    private val assets: AssetManager = app.assets

    val models: Map<String, Model> = JSONObject(
        assets.open("$DIR/models.json").bufferedReader().use { it.readText() },
    ).getJSONArray("models").let { array ->
        (0 until array.length()).map { array.getJSONObject(it) }.associate {
            it.getString("role") to Model(it.getString("role"), it.getString("file"), it.getLong("bytes"), it.getString("sha256"))
        }
    }

    fun model(role: String): Model = models[role] ?: error("no '$role' model in $DIR/models.json")

    /** Memory-maps an uncompressed asset (no copy): used for the LiteRT segnet model. */
    fun mapAsset(role: String): MappedByteBuffer {
        val fd = assets.openFd("$DIR/${model(role).file}")
        return fd.use {
            FileInputStream(it.fileDescriptor).channel.use { channel ->
                channel.map(FileChannel.MapMode.READ_ONLY, it.startOffset, it.declaredLength)
            }
        }
    }

    /** Reads a small asset (the self-test tile and reference) and checks it against its hash. */
    fun readVerified(role: String): ByteArray {
        val model = model(role)
        val bytes = assets.open("$DIR/${model.file}").use { it.readBytes() }
        val actual = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        check(actual == model.sha256) { "${model.file}: sha256 $actual does not match models.json ${model.sha256}" }
        return bytes
    }

    /**
     * Returns a file path for the model, extracting it once into app-private storage.
     * ONNX Runtime needs a path (or a heap copy). The copy is checked against its hash and
     * kept under a directory named after that hash, so model updates never mix.
     */
    @Synchronized
    fun extractedFile(role: String): File {
        val model = model(role)
        val dir = File(app.noBackupFilesDir, "models/${model.sha256}")
        val target = File(dir, model.file)
        if (target.isFile && target.length() == model.bytes) return target
        dir.mkdirs()
        val partial = File(dir, model.file + ".partial")
        val digest = MessageDigest.getInstance("SHA-256")
        assets.open("$DIR/${model.file}").use { input ->
            partial.outputStream().use { output ->
                val buffer = ByteArray(1 shl 20)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                    output.write(buffer, 0, read)
                }
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != model.sha256) {
            partial.delete()
            error("model ${model.file}: sha256 $actual does not match models.json ${model.sha256}")
        }
        check(partial.renameTo(target)) { "could not move $partial to $target" }
        // Remove extracted copies of older model versions.
        File(app.noBackupFilesDir, "models").listFiles()?.forEach { other ->
            if (other.isDirectory && other.name != model.sha256 && models.values.none { it.sha256 == other.name }) {
                other.deleteRecursively()
            }
        }
        return target
    }

    companion object {
        const val DIR = "models"
    }
}
