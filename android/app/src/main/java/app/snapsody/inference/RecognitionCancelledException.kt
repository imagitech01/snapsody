package app.snapsody.inference

/** Thrown by [InferenceService] when the running recognition was cancelled (task 5.2). */
class RecognitionCancelledException : RuntimeException("recognition cancelled")
