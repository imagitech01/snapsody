package be.imagitech.snapsody

import android.content.Context
import android.util.Log
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform

/** Starts Chaquopy's Python and gives access to the ia_engine module (design D3). */
object PythonEngine {
    private const val TAG = "PythonEngine"

    @Synchronized
    fun ensureStarted(context: Context): Python {
        if (!Python.isStarted()) {
            val started = System.nanoTime()
            Python.start(AndroidPlatform(context.applicationContext))
            Log.i(TAG, "Python started in ${(System.nanoTime() - started) / 1_000_000} ms")
        }
        return Python.getInstance()
    }

    /** Imports homr and its native dependencies; logs and returns the report (task 3.2). */
    fun selfTest(context: Context): String {
        val report = ensureStarted(context).getModule("ia_engine").callAttr("selftest").toString()
        Log.i(TAG, "selftest: $report")
        return report
    }
}
