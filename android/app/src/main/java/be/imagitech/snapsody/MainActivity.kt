package be.imagitech.snapsody

import android.os.Bundle
import android.util.Log
import be.imagitech.snapsody.files.AtomicFilesPlugin
import be.imagitech.snapsody.reader.ReaderPlugin
import be.imagitech.snapsody.scanner.ScannerPlugin
import com.getcapacitor.BridgeActivity

/**
 * The Capacitor activity (practice-app design D1). Registers our three local plugins (Scanner,
 * Reader, AtomicFiles); the npm plugins (Filesystem, App, Device, KeepAwake) are registered by
 * Capacitor from capacitor.plugins.json.
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ScannerPlugin::class.java)
        registerPlugin(ReaderPlugin::class.java)
        registerPlugin(AtomicFilesPlugin::class.java)
        super.onCreate(savedInstanceState)
        // Start Python early, off the UI thread, and log whether homr imports.
        Thread({
            try {
                PythonEngine.selfTest(applicationContext)
            } catch (e: Throwable) {
                Log.e("PythonEngine", "selftest failed", e)
            }
        }, "python-start").start()
    }
}
