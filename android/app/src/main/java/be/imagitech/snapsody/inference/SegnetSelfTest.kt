package be.imagitech.snapsody.inference

import android.util.Log
import be.imagitech.snapsody.inference.InferenceService.Accelerator
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale

/** Outcome of the accelerator self-test (design D4). */
data class SelfTestResult(
    val accelerator: Accelerator,
    val reason: String,
    val symbolPixels: Int,
    val cpuAgreement: Double,
    val cpuMedianMs: Double,
    val cpuInitMs: Long,
    val gpuAgreement: Double? = null,
    val gpuMedianMs: Double? = null,
    val gpuInitMs: Long? = null,
    val gpuError: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("accelerator", accelerator.name)
        .put("reason", reason)
        .put("symbolPixels", symbolPixels)
        .put("cpuAgreement", cpuAgreement)
        .put("cpuMedianMs", cpuMedianMs)
        .put("cpuInitMs", cpuInitMs)
        .putOpt("gpuAgreement", gpuAgreement)
        .putOpt("gpuMedianMs", gpuMedianMs)
        .putOpt("gpuInitMs", gpuInitMs)
        .putOpt("gpuError", gpuError)

    companion object {
        fun fromJson(json: JSONObject) = SelfTestResult(
            accelerator = Accelerator.valueOf(json.getString("accelerator")),
            reason = json.getString("reason"),
            symbolPixels = json.getInt("symbolPixels"),
            cpuAgreement = json.getDouble("cpuAgreement"),
            cpuMedianMs = json.getDouble("cpuMedianMs"),
            cpuInitMs = json.getLong("cpuInitMs"),
            gpuAgreement = json.optDouble("gpuAgreement").takeUnless { it.isNaN() },
            gpuMedianMs = json.optDouble("gpuMedianMs").takeUnless { it.isNaN() },
            gpuInitMs = if (json.has("gpuInitMs")) json.getLong("gpuInitMs") else null,
            gpuError = json.optString("gpuError").ifEmpty { null },
        )
    }
}

/** Runs the self-test; replaceable in tests. */
fun interface SelfTest {
    fun run(): SelfTestResult
}

/**
 * The accelerator self-test (design D4, task 4.1).
 *
 * segnet runs on the bundled self-engraved reference tile (tools/models/make_selftest_tile.py)
 * on the CPU and on the GPU: one warm-up, then [RUNS] timed runs each. The GPU is chosen only
 * if its classes agree with the bundled CPU reference (LiteRT on the Mac's CPU) on at least
 * [GPU_MIN_AGREEMENT] of the symbol pixels and its median time is lower than the CPU's.
 * Otherwise, including any GPU error, the CPU is chosen. The interpreter not chosen is closed
 * to save memory.
 *
 * Must run on the inference thread ([InferenceThread]), like all GPU work.
 */
class SegnetSelfTest(private val service: InferenceService, private val store: ModelStore) : SelfTest {
    override fun run(): SelfTestResult {
        val tile = store.readVerified("selftest_tile")
        val reference = store.readVerified("selftest_reference")
        val pixels = InferenceService.TILE * InferenceService.TILE
        check(tile.size == pixels && reference.size == pixels) { "self-test tile or reference has the wrong size" }
        val input = ByteBuffer.allocateDirect(pixels * 3 * 4).order(ByteOrder.nativeOrder())
        for (value in tile) {
            val v = (value.toInt() and 0xff).toFloat()
            input.putFloat(v).putFloat(v).putFloat(v) // grey replicated to 3 channels, as homr does
        }
        input.rewind()
        val symbolPixels = reference.count { it.toInt() != 0 }

        val cpu = measure(input, reference, Accelerator.CPU)
        var gpu: Measurement? = null
        var gpuError: String? = null
        try {
            gpu = measure(input, reference, Accelerator.GPU)
        } catch (e: Exception) {
            gpuError = e.message ?: e.javaClass.name
        } catch (e: LinkageError) {
            gpuError = e.message ?: e.javaClass.name
        }

        val (accelerator, reason) = when {
            gpu == null -> Accelerator.CPU to "GPU unavailable: $gpuError"
            gpu.agreement < GPU_MIN_AGREEMENT ->
                Accelerator.CPU to "GPU differs from the CPU reference (%.3f %% < %.1f %%)".format(Locale.ROOT, gpu.agreement * 100, GPU_MIN_AGREEMENT * 100)
            gpu.medianMs >= cpu.medianMs ->
                Accelerator.CPU to "GPU not faster (median %.1f ms vs %.1f ms on the CPU)".format(Locale.ROOT, gpu.medianMs, cpu.medianMs)
            else -> Accelerator.GPU to "GPU agrees (%.3f %%) and is faster (%.1f ms vs %.1f ms)".format(Locale.ROOT, gpu.agreement * 100, gpu.medianMs, cpu.medianMs)
        }
        service.closeSegnet(if (accelerator == Accelerator.GPU) Accelerator.CPU else Accelerator.GPU)

        if (cpu.agreement < CPU_EXPECTED_AGREEMENT) {
            Log.w(TAG, "CPU agrees with the bundled reference on only %.3f %% of symbol pixels".format(Locale.ROOT, cpu.agreement * 100))
        }
        return SelfTestResult(
            accelerator = accelerator,
            reason = reason,
            symbolPixels = symbolPixels,
            cpuAgreement = cpu.agreement,
            cpuMedianMs = cpu.medianMs,
            cpuInitMs = cpu.initMs,
            gpuAgreement = gpu?.agreement,
            gpuMedianMs = gpu?.medianMs,
            gpuInitMs = gpu?.initMs,
            gpuError = gpuError,
        ).also { Log.i(TAG, "self-test: ${it.toJson()}") }
    }

    private class Measurement(val agreement: Double, val medianMs: Double, val initMs: Long)

    private fun measure(input: ByteBuffer, reference: ByteArray, accelerator: Accelerator): Measurement {
        service.closeSegnet(accelerator) // measure a fresh initialisation
        val classes = service.segnetArgmax(input, 1, accelerator, fallbackToCpu = false) // warm-up
        val initMs = service.segnetInitMs.getValue(accelerator)
        val times = DoubleArray(RUNS) {
            val started = System.nanoTime()
            service.segnetArgmax(input, 1, accelerator, fallbackToCpu = false)
            (System.nanoTime() - started) / 1e6
        }
        times.sort()
        return Measurement(agreement(classes, reference), times[RUNS / 2], initMs)
    }

    companion object {
        private const val TAG = "AcceleratorSelfTest"
        const val RUNS = 5
        const val GPU_MIN_AGREEMENT = 0.995
        private const val CPU_EXPECTED_AGREEMENT = 0.999

        /** Fraction of pixels, among those where either side is not background, with the same class. */
        fun agreement(classes: ByteArray, reference: ByteArray): Double {
            var symbol = 0
            var agree = 0
            for (i in classes.indices) {
                if (classes[i].toInt() != 0 || reference[i].toInt() != 0) {
                    symbol++
                    if (classes[i] == reference[i]) agree++
                }
            }
            check(symbol > 0) { "no symbol pixels in the self-test tile" }
            return agree.toDouble() / symbol
        }
    }
}
