package be.imagitech.snapsody

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Proves the JVM unit-test setup (docs/testing.md): the real org.json is on the test classpath, not the android.jar stub. */
class JvmSetupTest {
    @Test
    fun realOrgJsonIsUsed() {
        assertEquals("{\"a\":1}", JSONObject().put("a", 1).toString())
    }
}
