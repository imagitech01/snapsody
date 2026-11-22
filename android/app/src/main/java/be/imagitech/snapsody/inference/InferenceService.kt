package be.imagitech.snapsody.inference

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.util.Log
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.gpu.GpuDelegate
import org.tensorflow.lite.gpu.GpuDelegateFactory
import java.io.Closeable
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer

/**
 * All model inference for recognition (design D3). homr's Python code calls these
 * methods through Chaquopy's Java bridge (task 3.4):
 *
 * - segnet on LiteRT, GPU delegate or XNNPACK CPU, selectable per call
 * - the transformer encoder on ONNX Runtime (CPU), once per staff
 * - the whole autoregressive decoder loop, with the key/value cache kept native
 *   between steps; one call per staff returns the token ids
 *
 * Not thread-safe: use one instance from one thread. The GPU delegate must be created,
 * run and closed on the same thread, so the app keeps the service on its single
 * inference thread ([InferenceThread]).
 */
class InferenceService(context: Context, private val threads: Int = 4) : Closeable {
    enum class Accelerator { GPU, CPU }

    private val store = ModelStore(context)
    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()

    // ---- segnet ---------------------------------------------------------------------------

    private var gpuDelegate: GpuDelegate? = null
    private var gpuThread: Thread? = null
    private val segnet = mutableMapOf<Accelerator, Interpreter>()
    private val segnetOutput: ByteBuffer =
        ByteBuffer.allocateDirect(TILE * TILE * SEGNET_CLASSES * 4).order(ByteOrder.nativeOrder())
    private val segnetLogits = FloatArray(TILE * TILE * SEGNET_CLASSES)

    /** Where the GPU delegate keeps its compiled kernels between launches (task 4.3). */
    private val gpuKernelCache = File(context.codeCacheDir, "litert_gpu").apply { mkdirs() }

    /** Init time of the last created interpreter per accelerator (ms), for logging and the self-test. */
    val segnetInitMs = mutableMapOf<Accelerator, Long>()

    /** Duration of the first inference after each interpreter was created (ms). */
    val segnetFirstRunMs = mutableMapOf<Accelerator, Long>()

    /** Tiles that segnet completed per accelerator since this service was created. */
    private val tilesRun = mutableMapOf(Accelerator.GPU to 0, Accelerator.CPU to 0)

    /**
     * The GPU error that made this service switch to the CPU (design D4, task 4.4), or null.
     * Once set, GPU requests run on the CPU until [resetGpuFailure].
     */
    var gpuFailure: Throwable? = null
        private set

    /** Told about a GPU failure (the accelerator selector records it until the next self-test). */
    var onGpuFailure: ((Throwable) -> Unit)? = null

    /**
     * Checked before every segnet tile and every decoder step (task 5.2). When it returns
     * true, the call throws [RecognitionCancelledException].
     */
    var cancelCheck: (() -> Boolean)? = null

    private fun checkCancelled() {
        if (cancelCheck?.invoke() == true) throw RecognitionCancelledException()
    }

    /** Test hook (task 4.4): the GPU fails once this many GPU tiles have completed; -1 = never. */
    internal var injectGpuFailureAfterTiles: Int = -1

    private fun segnetInterpreter(accelerator: Accelerator): Interpreter = segnet.getOrPut(accelerator) {
        val started = System.nanoTime()
        val options = Interpreter.Options()
        when (accelerator) {
            Accelerator.GPU -> {
                // The serialized kernels belong to this exact model and these options.
                val token = "segnet-${store.model("segnet").sha256.take(32)}-fp16"
                val delegate = GpuDelegate(
                    GpuDelegateFactory.Options()
                        .setPrecisionLossAllowed(true)
                        .setSerializationParams(gpuKernelCache.absolutePath, token),
                )
                gpuDelegate = delegate
                gpuThread = Thread.currentThread()
                options.addDelegate(delegate)
            }
            Accelerator.CPU -> {
                options.setNumThreads(threads)
                options.setUseXNNPACK(true)
            }
        }
        Interpreter(store.mapAsset("segnet"), options).also {
            val input = it.getInputTensor(0).shape()
            check(input.contentEquals(intArrayOf(1, TILE, TILE, 3))) { "unexpected segnet input ${input.contentToString()}" }
            segnetInitMs[accelerator] = (System.nanoTime() - started) / 1_000_000
            segnetFirstRunMs.remove(accelerator)
            Log.i(TAG, "segnet on $accelerator ready in ${segnetInitMs[accelerator]} ms")
        }
    }

    /** The GPU delegate only works on the thread that created it (LiteRT docs). */
    private fun checkGpuThread() {
        val owner = gpuThread ?: return
        check(owner == Thread.currentThread()) {
            "GPU delegate created on thread '${owner.name}' but used on '${Thread.currentThread().name}'"
        }
    }

    /**
     * Runs segnet on [count] tiles and returns the argmax class per pixel.
     *
     * On the GPU, any error (initialisation or inference) closes the GPU interpreter,
     * records [gpuFailure], tells [onGpuFailure] and redoes the whole batch on the CPU;
     * later GPU requests then run on the CPU too. With [fallbackToCpu] false (the
     * self-test and the tests) the error is thrown instead.
     *
     * @param tiles direct buffer of count x 320 x 320 x 3 float32 (NHWC, values 0..255, native order)
     * @return count x 320 x 320 class ids (0 = background), row-major, as homr's np.argmax(axis=0)
     */
    @JvmOverloads
    fun segnetArgmax(tiles: ByteBuffer, count: Int, accelerator: Accelerator, fallbackToCpu: Boolean = true): ByteArray {
        val tileBytes = TILE * TILE * 3 * 4
        require(tiles.isDirect) { "tiles must be a direct ByteBuffer" }
        require(tiles.capacity() >= count * tileBytes) { "tiles hold ${tiles.capacity()} bytes, need ${count * tileBytes}" }
        if (accelerator == Accelerator.GPU && (gpuFailure == null || !fallbackToCpu)) {
            checkGpuThread()
            try {
                return runSegnet(tiles, count, Accelerator.GPU)
            } catch (e: RecognitionCancelledException) {
                throw e // a cancel is not a GPU failure
            } catch (e: Exception) {
                if (!fallbackToCpu) throw e
                gpuFailed(e)
            } catch (e: LinkageError) { // e.g. the GPU delegate's native library cannot load
                if (!fallbackToCpu) throw e
                gpuFailed(e)
            }
        }
        return runSegnet(tiles, count, Accelerator.CPU)
    }

    private fun gpuFailed(error: Throwable) {
        Log.w(TAG, "segnet GPU failed, continuing on the CPU", error)
        gpuFailure = error
        closeSegnet(Accelerator.GPU)
        onGpuFailure?.invoke(error)
    }

    /** Allows the GPU again (after a new self-test). */
    fun resetGpuFailure() {
        gpuFailure = null
    }

    private fun runSegnet(tiles: ByteBuffer, count: Int, accelerator: Accelerator): ByteArray {
        val tileBytes = TILE * TILE * 3 * 4
        val interpreter = segnetInterpreter(accelerator)
        val result = ByteArray(count * TILE * TILE)
        val pixels = TILE * TILE
        for (i in 0 until count) {
            checkCancelled()
            if (accelerator == Accelerator.GPU && injectGpuFailureAfterTiles >= 0 &&
                tilesRun.getValue(Accelerator.GPU) >= injectGpuFailureAfterTiles
            ) {
                throw IllegalStateException("injected GPU failure (test)")
            }
            val tile = tiles.duplicate().order(ByteOrder.nativeOrder())
            tile.position(i * tileBytes).limit((i + 1) * tileBytes)
            segnetOutput.rewind()
            val started = System.nanoTime()
            interpreter.run(tile.slice().order(ByteOrder.nativeOrder()), segnetOutput)
            if (accelerator !in segnetFirstRunMs) {
                segnetFirstRunMs[accelerator] = (System.nanoTime() - started) / 1_000_000
                Log.i(TAG, "segnet on $accelerator: first inference ${segnetFirstRunMs[accelerator]} ms (init ${segnetInitMs[accelerator]} ms)")
            }
            segnetOutput.rewind()
            segnetOutput.asFloatBuffer().get(segnetLogits) // one bulk copy, then plain array reads
            val logits = segnetLogits
            val base = i * pixels
            for (p in 0 until pixels) {
                val o = p * SEGNET_CLASSES
                var best = 0
                var bestValue = logits[o]
                for (c in 1 until SEGNET_CLASSES) {
                    val v = logits[o + c]
                    if (v > bestValue) { // strict: first maximum wins, like np.argmax
                        bestValue = v
                        best = c
                    }
                }
                result[base + p] = best.toByte()
            }
            tilesRun[accelerator] = tilesRun.getValue(accelerator) + 1
        }
        return result
    }

    private var tileBuffer: ByteBuffer? = null

    /**
     * Entry point for homr via Chaquopy (task 3.4): [tiles] are the little-endian float32
     * NHWC bytes of a tile batch. They are copied once into a reused direct ByteBuffer,
     * which LiteRT reads without further copies. A GPU request falls back to the CPU on
     * any GPU error (see [segnetArgmax]).
     */
    fun segnetArgmaxBytes(tiles: ByteArray, count: Int, accelerator: String): ByteArray {
        val buffer = tileBuffer?.takeIf { it.capacity() >= tiles.size }
            ?: ByteBuffer.allocateDirect(tiles.size).order(ByteOrder.nativeOrder()).also { tileBuffer = it }
        buffer.clear()
        buffer.put(tiles)
        buffer.rewind()
        return segnetArgmax(buffer, count, Accelerator.valueOf(accelerator))
    }

    /** Tiles segnet completed on [accelerator] ("GPU" or "CPU") since this service was created. */
    fun segnetTileCount(accelerator: String): Int = tilesRun.getValue(Accelerator.valueOf(accelerator))

    /** The message of [gpuFailure], for reports (null when the GPU has not failed). */
    fun gpuFailureMessage(): String? = gpuFailure?.let { it.message ?: it.javaClass.name }

    /** Releases the segnet interpreter for [accelerator], or all of them (e.g. after a GPU failure). */
    @JvmOverloads
    fun closeSegnet(accelerator: Accelerator? = null) {
        for (which in accelerator?.let { listOf(it) } ?: Accelerator.entries) {
            if (which == Accelerator.GPU && gpuThread != null && gpuThread != Thread.currentThread()) {
                Log.e(TAG, "closing the GPU delegate on '${Thread.currentThread().name}', not on its own thread '${gpuThread?.name}'")
            }
            segnet.remove(which)?.close()
            if (which == Accelerator.GPU) {
                gpuDelegate?.close()
                gpuDelegate = null
                gpuThread = null
            }
        }
    }

    // ---- transformer encoder --------------------------------------------------------------

    private val sessionOptions: OrtSession.SessionOptions by lazy {
        OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(threads)
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        }
    }
    private var encoderSession: OrtSession? = null
    private var decoderSession: OrtSession? = null
    private val encoder: OrtSession
        get() = encoderSession ?: timed("encoder session") {
            env.createSession(store.extractedFile("encoder").path, sessionOptions)
        }.also { encoderSession = it }
    private val decoder: OrtSession
        get() = decoderSession ?: timed("decoder session") {
            env.createSession(store.extractedFile("decoder").path, sessionOptions)
        }.also { decoderSession = it }

    /** The encoder output for one staff, kept as a native tensor for [decode]. */
    class EncodedStaff internal constructor(internal val context: OnnxTensor, val encodeMs: Long) : Closeable {
        val shape: LongArray get() = context.info.shape

        /** Copies the encoder output out (tests only; recognition never needs it on the JVM). */
        fun toFloatArray(): FloatArray {
            val buffer = context.floatBuffer
            return FloatArray(buffer.remaining()).also { buffer.get(it) }
        }

        override fun close() = context.close()
    }

    /**
     * Encodes one staff image.
     *
     * @param input 1 x 1 x 256 x 1280 float32, already normalised by homr's ConvertToArray
     */
    fun encode(input: FloatArray): EncodedStaff {
        require(input.size == ENCODER_H * ENCODER_W) { "encoder input has ${input.size} values, need ${ENCODER_H * ENCODER_W}" }
        val started = System.nanoTime()
        OnnxTensor.createTensor(env, FloatBuffer.wrap(input), longArrayOf(1, 1, ENCODER_H.toLong(), ENCODER_W.toLong())).use { x ->
            encoder.run(mapOf("input" to x)).use { result ->
                val output = result.get(0) as OnnxTensor
                // Copy into a tensor we own: the result's tensors die with the result.
                val data = output.floatBuffer
                val copy = OnnxTensor.createTensor(env, data, output.info.shape)
                return EncodedStaff(copy, (System.nanoTime() - started) / 1_000_000)
            }
        }
    }

    /** Entry point for homr via Chaquopy: [input] is 1x1x256x1280 little-endian float32 bytes. */
    fun encodeBytes(input: ByteArray): EncodedStaff {
        val floats = ByteBuffer.wrap(input).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        return encode(FloatArray(floats.remaining()).also { floats.get(it) })
    }

    /** Wraps a context computed elsewhere (tests: a Mac's encoder output). */
    fun encodedFrom(context: FloatArray, shape: LongArray): EncodedStaff =
        EncodedStaff(OnnxTensor.createTensor(env, FloatBuffer.wrap(context), shape), 0)

    // ---- transformer decoder --------------------------------------------------------------

    /**
     * Result of one staff's decoding.
     *
     * [tokens] holds 6 ids per step in the order rhythm, pitch, lift, position,
     * articulation, slur; [attention] holds the decoder's 2 attention values per step
     * (homr's EncodedSymbol.coordinates). The EOS step is not included.
     */
    class Decoded(val steps: Int, val tokens: IntArray, val attention: FloatArray, val decodeMs: Long)

    /** homr's ScoreDecoder.generate (greedy), with the key/value cache kept native. */
    @JvmOverloads
    fun decode(staff: EncodedStaff, maxSeqLen: Int = MAX_SEQ_LEN, eosToken: Int = EOS_TOKEN): Decoded {
        val started = System.nanoTime()
        val contextShape = staff.context.info.shape // [1, 1280, 512]
        val width = contextShape[2].toInt()
        val firstRow = FloatArray(width).also { row ->
            val all = staff.context.floatBuffer
            all.get(row, 0, width)
        }
        val contextReduced = OnnxTensor.createTensor(env, FloatBuffer.wrap(firstRow), longArrayOf(1, 1, width.toLong()))

        val headDim = DECODER_DIM / DECODER_HEADS
        val emptyCache = (0 until CACHE_TENSORS).map {
            OnnxTensor.createTensor(env, FloatBuffer.allocate(0), longArrayOf(1, DECODER_HEADS.toLong(), 0, headDim.toLong()))
        }
        var cache: List<OnnxTensor> = emptyCache
        var previous: OrtSession.Result? = null

        var rhythm = BOS_TOKEN.toLong()
        var pitch = 0L
        var lift = 0L
        var articulation = 0L
        var slur = 0L

        val tokens = ArrayList<Int>(6 * 128)
        val attention = ArrayList<Float>(2 * 128)
        var steps = 0
        try {
            for (step in 0 until maxSeqLen) {
                checkCancelled()
                val owned = listOf(
                    "rhythms" to scalar(rhythm), "pitchs" to scalar(pitch), "lifts" to scalar(lift),
                    "articulations" to scalar(articulation), "slurs" to scalar(slur),
                    "cache_len" to OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(step.toLong())), longArrayOf(1)),
                )
                val inputs = HashMap<String, OnnxTensor>(40)
                owned.forEach { (name, tensor) -> inputs[name] = tensor }
                inputs["context"] = if (step == 0) staff.context else contextReduced
                cache.forEachIndexed { i, tensor -> inputs["cache_in$i"] = tensor }

                val result = decoder.run(inputs)
                owned.forEach { it.second.close() }
                // The cache inputs of this step came from the previous result (or the empty cache).
                previous?.close() ?: emptyCache.forEach { it.close() }
                previous = result

                val rhythmId = argmaxLast(result, "out_rhythms")
                val pitchId = argmaxLast(result, "out_pitchs")
                val liftId = argmaxLast(result, "out_lifts")
                val positionId = argmaxLast(result, "out_positions")
                val articulationId = argmaxLast(result, "out_articulations")
                val slurId = argmaxLast(result, "out_slurs")
                cache = (0 until CACHE_TENSORS).map { result.get("cache_out$it").get() as OnnxTensor }

                if (rhythmId == eosToken) break
                val att = (result.get("attention").get() as OnnxTensor).floatBuffer
                tokens.addAll(listOf(rhythmId, pitchId, liftId, positionId, articulationId, slurId))
                while (att.hasRemaining()) attention.add(att.get())
                steps++

                rhythm = rhythmId.toLong()
                pitch = pitchId.toLong()
                lift = liftId.toLong()
                articulation = articulationId.toLong()
                slur = slurId.toLong()
            }
        } finally {
            previous?.close() ?: emptyCache.forEach { it.close() }
            contextReduced.close()
        }
        return Decoded(steps, tokens.toIntArray(), attention.toFloatArray(), (System.nanoTime() - started) / 1_000_000)
    }

    private fun scalar(value: Long): OnnxTensor =
        OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(value)), longArrayOf(1, 1))

    /** np.argmax(out[:, -1, :]) — first maximum wins. */
    private fun argmaxLast(result: OrtSession.Result, name: String): Int {
        val tensor = result.get(name).get() as OnnxTensor
        val shape = tensor.info.shape // [1, t, K]
        val classes = shape[2].toInt()
        val buffer = tensor.floatBuffer
        val offset = ((shape[1] - 1) * classes).toInt()
        var best = 0
        var bestValue = buffer.get(offset)
        for (k in 1 until classes) {
            val v = buffer.get(offset + k)
            if (v > bestValue) {
                bestValue = v
                best = k
            }
        }
        return best
    }

    private fun <T> timed(what: String, block: () -> T): T {
        val started = System.nanoTime()
        return block().also { Log.i(TAG, "$what ready in ${(System.nanoTime() - started) / 1_000_000} ms") }
    }

    override fun close() {
        closeSegnet()
        encoderSession?.close()
        encoderSession = null
        decoderSession?.close()
        decoderSession = null
    }

    companion object {
        private const val TAG = "InferenceService"
        const val TILE = 320
        const val SEGNET_CLASSES = 6
        const val ENCODER_H = 256
        const val ENCODER_W = 1280
        const val DECODER_DIM = 512
        const val DECODER_HEADS = 8
        const val DECODER_DEPTH = 8
        const val CACHE_TENSORS = DECODER_DEPTH * 4
        const val MAX_SEQ_LEN = 608
        const val BOS_TOKEN = 1
        const val EOS_TOKEN = 2
    }
}
