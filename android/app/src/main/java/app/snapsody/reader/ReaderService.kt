package app.snapsody.reader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Keeps the app in the foreground while a reading job runs (design D6): one start per job. The
 * work runs on the inference thread ([ReaderHandler], [HomrPageReader]); this service only holds
 * the foreground state.
 *
 * Type `mediaProcessing` (Android's type for photo and media processing, 6 hours per 24 h, with
 * FOREGROUND_SERVICE_MEDIA_PROCESSING). `shortService` allows 3 minutes for the whole job, too
 * short for a queue of pages on the CPU (evidence/spike.md, 1.3). Below Android 14 the type is
 * not required and 0 is passed. Verified on API 36 only (spike open issue).
 */
class ReaderService : Service() {
    @Volatile
    private var timedOut = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING else 0
        // Not ServiceCompat.startForeground: androidx.core 1.17.0 masks the type with 0x40000FFF,
        // which drops mediaProcessing (0x2000) and fails with "Starting FGS with type none" (spike 1.3).
        startForeground(NOTIFICATION_ID, notification(), type)
        started = System.nanoTime()
        Log.i(TAG, "in the foreground as mediaProcessing (type $type)")
        if (ReaderPlugin.current?.isRunning != true) stopSelf()
        return START_NOT_STICKY
    }

    /** API 34: shortService only; kept for completeness. */
    override fun onTimeout(startId: Int) = timedOut()

    /** API 35+: mediaProcessing's 6 hours. API 36 calls both overloads; the job is cancelled once. */
    override fun onTimeout(startId: Int, fgsType: Int) = timedOut()

    private fun timedOut() {
        if (timedOut) return
        timedOut = true
        Log.w(TAG, "foreground time limit reached after ${"%.1f".format((System.nanoTime() - started) / 1e9)} s: cancelling the reading")
        ReaderPlugin.current?.timeLimitReached()
        stopSelf()
    }

    override fun onDestroy() {
        Log.i(TAG, "stopped after ${"%.1f".format((System.nanoTime() - started) / 1e9)} s")
        instance = null
        super.onDestroy()
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Reading pages", NotificationManager.IMPORTANCE_LOW))
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Reading the pages…")
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "ReaderService"
        private const val CHANNEL = "reader"
        private const val NOTIFICATION_ID = 1

        @Volatile
        private var instance: ReaderService? = null

        @Volatile
        private var started = 0L

        /** Called when a job ends: the service stops if it is running. */
        internal fun jobEnded() {
            instance?.let { service -> service.mainExecutor.execute { if (ReaderPlugin.current?.isRunning != true) service.stopSelf() } }
        }
    }
}
