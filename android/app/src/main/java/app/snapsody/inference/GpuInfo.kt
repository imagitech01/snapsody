package app.snapsody.inference

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.GLES20
import android.os.Build
import android.util.Log

/** Identifies the GPU driver, so a driver update reruns the accelerator self-test (task 4.2). */
object GpuInfo {
    private const val TAG = "GpuInfo"

    /**
     * "GL_VENDOR | GL_RENDERER | GL_VERSION | build fingerprint". On the S24 GL_VERSION carries
     * the driver version ("OpenGL ES 3.2 Driver version: 25.6.4 git hash: ...").
     *
     * The build fingerprint is included because LiteRT's GPU delegate uses OpenCL where available,
     * whose driver ships with system updates and is not visible through GL.
     *
     * The query runs on a short-lived thread of its own, so no EGL context is ever left current
     * on the inference thread (the GPU delegate would pick it up).
     */
    fun driverString(): String {
        var result = "GL unavailable"
        val thread = Thread({ result = runCatching { queryGl() }.getOrElse { "GL unavailable: ${it.message}" } }, "gpu-info")
        thread.start()
        thread.join(5_000)
        return "$result | ${Build.FINGERPRINT}"
    }

    private fun queryGl(): String {
        val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        check(display != EGL14.EGL_NO_DISPLAY) { "no EGL display" }
        val version = IntArray(2)
        check(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize failed" }
        val configs = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        val attributes = intArrayOf(
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
            EGL14.EGL_NONE,
        )
        check(EGL14.eglChooseConfig(display, attributes, 0, configs, 0, 1, count, 0) && count[0] > 0) { "no EGL config" }
        val context = EGL14.eglCreateContext(
            display, configs[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0,
        )
        check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed" }
        val surface = EGL14.eglCreatePbufferSurface(display, configs[0], intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
        try {
            check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "eglMakeCurrent failed" }
            return listOf(GLES20.GL_VENDOR, GLES20.GL_RENDERER, GLES20.GL_VERSION)
                .joinToString(" | ") { GLES20.glGetString(it) ?: "?" }
                .also { Log.i(TAG, it) }
        } finally {
            EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            EGL14.eglDestroySurface(display, surface)
            EGL14.eglDestroyContext(display, context)
            EGL14.eglReleaseThread()
            // No eglTerminate: the display is shared with the rest of the process (WebView, UI).
        }
    }
}
