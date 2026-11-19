package be.imagitech.snapsody.inference

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import be.imagitech.snapsody.inference.InferenceService.Accelerator
import org.json.JSONObject

/**
 * What the stored self-test decision depends on (task 4.2): the app version, the hashes of
 * the bundled models (including the self-test tile and its reference) and the GPU driver.
 * A change to any of them reruns the self-test.
 */
data class DecisionKey(val appVersion: String, val modelHashes: Map<String, String>, val gpuDriver: String) {
    fun toJson(): JSONObject = JSONObject()
        .put("appVersion", appVersion)
        .put("modelHashes", JSONObject(modelHashes.toSortedMap() as Map<*, *>))
        .put("gpuDriver", gpuDriver)

    companion object {
        fun fromJson(json: JSONObject) = DecisionKey(
            appVersion = json.getString("appVersion"),
            modelHashes = json.getJSONObject("modelHashes").let { hashes ->
                hashes.keys().asSequence().associateWith { hashes.getString(it) }
            },
            gpuDriver = json.getString("gpuDriver"),
        )

        fun current(context: Context, store: ModelStore): DecisionKey {
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(context.packageName, 0)
            }
            return DecisionKey(
                appVersion = "${info.versionName} (${info.longVersionCode})",
                modelHashes = store.models.mapValues { it.value.sha256 },
                gpuDriver = GpuInfo.driverString(),
            )
        }
    }
}

/**
 * Chooses the accelerator for segnet (design D4, tasks 4.1, 4.2 and 4.4).
 *
 * - The self-test result is stored with the [DecisionKey] it was made under, and rerun only
 *   when the current key differs (or nothing is stored).
 * - A GPU failure during recognition is stored in the same record and makes [accelerator]
 *   return the CPU until the next self-test replaces the record.
 * - The hidden "force CPU" setting (for diagnosis) overrides everything.
 *
 * [decision] may run the self-test and must then be called on the inference thread. The
 * other methods only touch preferences and are safe from any thread.
 */
class AcceleratorSelector(
    private val prefs: SharedPreferences,
    private val key: () -> DecisionKey,
    private val selfTest: SelfTest,
) {
    /** A stored decision, and whether this call ran the self-test to make it. */
    data class Decision(
        val key: DecisionKey,
        val result: SelfTestResult,
        val gpuFailed: String?,
        val decidedAt: Long,
        val ranSelfTest: Boolean,
    )

    /** Times the self-test ran through this selector (for tests and logs). */
    @Volatile
    var selfTestRuns = 0
        private set

    @Synchronized
    fun decision(): Decision {
        val current = key()
        val stored = stored()
        if (stored != null && stored.key == current) return stored
        Log.i(TAG, if (stored == null) "no stored decision: running the self-test" else "key changed: running the self-test (was ${stored.key}, now $current)")
        val result = selfTest.run()
        selfTestRuns++
        val decidedAt = System.currentTimeMillis()
        val record = JSONObject()
            .put("key", current.toJson())
            .put("result", result.toJson())
            .put("decidedAt", decidedAt)
        check(prefs.edit().putString(DECISION, record.toString()).commit()) { "could not store the accelerator decision" }
        Log.i(TAG, "decision: ${result.accelerator} (${result.reason})")
        return Decision(current, result, null, decidedAt, ranSelfTest = true)
    }

    /** The accelerator recognition should use now. */
    fun accelerator(): Accelerator {
        if (forceCpu) return Accelerator.CPU
        val decision = decision()
        return if (decision.gpuFailed != null) Accelerator.CPU else decision.result.accelerator
    }

    /** Records a GPU failure during recognition: the CPU is used until the next self-test. */
    @Synchronized
    fun markGpuFailed(error: Throwable) {
        val record = prefs.getString(DECISION, null)?.let(::JSONObject) ?: return
        record.put("gpuFailed", "${error.javaClass.simpleName}: ${error.message}")
        prefs.edit().putString(DECISION, record.toString()).commit()
        Log.w(TAG, "GPU marked failed until the next self-test: ${error.message}")
    }

    /** Hidden setting for diagnosis: always use the CPU. */
    var forceCpu: Boolean
        get() = prefs.getBoolean(FORCE_CPU, false)
        set(value) {
            prefs.edit().putBoolean(FORCE_CPU, value).commit()
            Log.i(TAG, "force CPU: $value")
        }

    /** The stored decision without checking the key or running anything, or null. */
    fun stored(): Decision? = prefs.getString(DECISION, null)?.let { text ->
        runCatching {
            val json = JSONObject(text)
            Decision(
                key = DecisionKey.fromJson(json.getJSONObject("key")),
                result = SelfTestResult.fromJson(json.getJSONObject("result")),
                gpuFailed = json.optString("gpuFailed").ifEmpty { null },
                decidedAt = json.getLong("decidedAt"),
                ranSelfTest = false,
            )
        }.onFailure { Log.w(TAG, "ignoring an unreadable stored decision", it) }.getOrNull()
    }

    /** For the bridge and logs: the stored decision and the setting, without running anything. */
    fun status(): JSONObject {
        val stored = stored()
        return JSONObject()
            .put("forceCpu", forceCpu)
            .put("decided", stored != null)
            .putOpt("accelerator", stored?.result?.accelerator?.name)
            .putOpt("reason", stored?.result?.reason)
            .putOpt("gpuFailed", stored?.gpuFailed)
            .putOpt("selfTest", stored?.result?.toJson())
            .putOpt("decidedAt", stored?.decidedAt)
    }

    companion object {
        private const val TAG = "AcceleratorSelector"
        const val PREFS = "accelerator"
        private const val DECISION = "decision"
        private const val FORCE_CPU = "forceCpu"
    }
}
