package app.snapsody

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The plugin contract examples (fixtures/bridge/, see its README) and their shape check: the same
 * rules as web/test/contract.ts.
 */
object Contract {
    private val dir = File(requireNotNull(System.getProperty("bridgeFixtures")) { "bridgeFixtures not set (app/build.gradle)" })

    /** The example `<name>.json`, e.g. "reader.read". */
    fun example(name: String): JSONObject = JSONObject(File(dir, "$name.json").readText())

    /** Every example file name (without .json) that starts with [prefix]. */
    fun names(prefix: String): List<String> =
        dir.listFiles().orEmpty().map { it.name }.filter { it.startsWith(prefix) && it.endsWith(".json") }.map { it.removeSuffix(".json") }.sorted()

    /** The reply's differences from the example's reply, or from every one of its `replies`. Empty: it matches. */
    fun replyErrors(example: JSONObject, reply: Any?): List<String> {
        val shape = example.optJSONObject("shape") ?: JSONObject()
        val alternatives = example.optJSONArray("replies")?.let { a -> (0 until a.length()).map { a.get(it) } } ?: listOf(example.get("reply"))
        val results = alternatives.map { shapeErrors(it, reply, "reply", shape) }
        return if (results.any { it.isEmpty() }) emptyList() else results.flatten()
    }

    fun requestErrors(example: JSONObject, request: Any?): List<String> =
        shapeErrors(example.get("request"), request, "request", example.optJSONObject("shape") ?: JSONObject())

    fun eventErrors(example: JSONObject, payload: Any?): List<String> =
        shapeErrors(example.get("payload"), payload, "payload", example.optJSONObject("shape") ?: JSONObject())

    /** The example's error cases: (request or null, code). */
    fun errors(example: JSONObject): List<Pair<JSONObject?, String>> {
        val list = example.optJSONArray("errors") ?: return emptyList()
        return (0 until list.length()).map { list.getJSONObject(it) }.map { it.optJSONObject("request") to it.getString("code") }
    }

    fun shapeErrors(example: Any?, actual: Any?, path: String, shape: JSONObject): List<String> {
        if (path in shape.strings("any")) return emptyList()
        if (isNull(actual) && path in shape.strings("nullable")) return emptyList()
        val want = jsonType(example)
        val got = jsonType(actual)
        if (want != got) return listOf("$path: expected $want, got $got")
        shape.optJSONObject("enum")?.optJSONArray(path)?.let { allowed ->
            val values = (0 until allowed.length()).map { allowed.get(it) }
            if (values.none { it == actual || (it is Number && actual is Number && it.toDouble() == actual.toDouble()) }) {
                return listOf("$path: $actual is not one of $allowed")
            }
        }
        return when (want) {
            "array" -> {
                val e = example as JSONArray
                val a = actual as JSONArray
                if (e.length() == 0) emptyList() else (0 until a.length()).flatMap { shapeErrors(e.get(0), a.get(it), "$path[]", shape) }
            }
            "object" -> {
                val e = example as JSONObject
                val a = actual as JSONObject
                val errors = mutableListOf<String>()
                for (key in e.keys()) {
                    val child = "$path.$key"
                    if (!a.has(key)) {
                        if (child !in shape.strings("optional")) errors += "$child: missing"
                    } else {
                        errors += shapeErrors(e.get(key), a.get(key), child, shape)
                    }
                }
                for (key in a.keys()) if (!e.has(key)) errors += "$path.$key: not in the example"
                errors
            }
            else -> emptyList()
        }
    }

    private fun isNull(value: Any?) = value == null || value == JSONObject.NULL

    private fun jsonType(value: Any?): String = when {
        isNull(value) -> "null"
        value is JSONArray -> "array"
        value is JSONObject -> "object"
        value is String -> "string"
        value is Number -> "number"
        value is Boolean -> "boolean"
        else -> value!!.javaClass.simpleName
    }

    private fun JSONObject.strings(key: String): Set<String> =
        optJSONArray(key)?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
}
