package expo.modules.petsystemvoice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

class PetSystemVoiceModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var recognitionId: String? = null
  private var speechId: String? = null
  private var speechLastUtterance: String? = null
  private var generation = 0
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private var ttsEpoch = 0
  private var ttsInitializing = false
  private val ttsWaiters = mutableListOf<(Boolean) -> Unit>()

  override fun definition() = ModuleDefinition {
    Name("PetSystemVoice")
    Events("onTranscript", "onVoiceState", "onVoiceError")
    AsyncFunction("capabilities") { language: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) { promise.resolve(mapOf("recognition" to false, "onDevice" to false, "speech" to false)); return@AsyncFunction }
      ensureTts { ready ->
        val support = if (ready) tts?.isLanguageAvailable(Locale.forLanguageTag(language)) ?: TextToSpeech.LANG_NOT_SUPPORTED else TextToSpeech.LANG_NOT_SUPPORTED
        val onDevice = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        promise.resolve(mapOf("recognition" to (SpeechRecognizer.isRecognitionAvailable(context) || onDevice), "onDevice" to onDevice, "speech" to (ready && support >= TextToSpeech.LANG_AVAILABLE)))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startRecognition") { id: String, language: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null || context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("microphone_denied", "需要麦克风权限才能语音输入。", null); return@AsyncFunction
      }
      stopAllInternal(); recognitionId = id
      if (!SpeechRecognizer.isRecognitionAvailable(context) && !(Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context))) {
        recognitionId = null; promise.reject("recognition_unavailable", "设备没有可用的系统识别服务。", null); return@AsyncFunction
      }
      val token = generation
      beginRecognition(id, language, Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context), token)
      promise.resolve()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("finishRecognition") { id: String -> if (recognitionId == id) recognizer?.stopListening() }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") { scopeId: String? ->
      if (scopeId == null || recognitionId?.startsWith(scopeId) == true || speechId?.startsWith(scopeId) == true) stopAllInternal()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("speak") { id: String, text: String, language: String, promise: Promise ->
      stopAllInternal(); speechId = id; val token = generation
      ensureTts { ready ->
        if (token != generation || speechId != id) { promise.reject("voice_cancelled", "朗读已停止。", null); return@ensureTts }
        if (!ready || (tts?.setLanguage(Locale.forLanguageTag(language)) ?: TextToSpeech.LANG_NOT_SUPPORTED) < TextToSpeech.LANG_AVAILABLE) {
          speechId = null; promise.reject("speech_language_unavailable", "系统朗读引擎不支持该语言，请检查语音设置。", null); return@ensureTts
        }
        if (text.isBlank()) { speechId = null; promise.resolve(); return@ensureTts }
        // Respect engine input limits without silently truncating long replies.
        val chunks = text.chunked((TextToSpeech.getMaxSpeechInputLength() - 16).coerceAtLeast(256))
        speechLastUtterance = "$id:${chunks.lastIndex}"
        var accepted = true
        chunks.forEachIndexed { index, chunk ->
          if (tts?.speak(chunk, if (index == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, null, "$id:$index") != TextToSpeech.SUCCESS) accepted = false
        }
        if (accepted) { sendEvent("onVoiceState", mapOf("sessionId" to id, "state" to "speaking")); promise.resolve() }
        else { stopAllInternal(); promise.reject("speech_failed", "系统朗读未启动，请重试。", null) }
      }
    }.runOnQueue(Queues.MAIN)
    OnActivityEntersBackground { main.post { stopAllInternal() } }
    OnDestroy { main.post { stopAllInternal(); ttsEpoch++; tts?.shutdown(); tts = null; ttsReady = false; ttsInitializing = false; val waiters = ttsWaiters.toList(); ttsWaiters.clear(); waiters.forEach { it(false) } } }
  }

  private fun intent(language: String) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
  }

  private fun beginRecognition(id: String, language: String, device: Boolean, token: Int) {
    val context = appContext.reactContext ?: return
    if (recognitionId != id || generation != token) return
    // Fence callbacks before disposing the old recognizer. Some engines can
    // deliver ERROR_CLIENT while cancel/destroy is still running.
    val previous = recognizer; recognizer = null
    runCatching { previous?.cancel() }; runCatching { previous?.destroy() }
    try {
      val engine = if (device && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(context) else SpeechRecognizer.createSpeechRecognizer(context)
      recognizer = engine
      engine.setRecognitionListener(object : RecognitionListener {
        private fun current() = generation == token && recognitionId == id && recognizer === engine
        override fun onReadyForSpeech(params: Bundle?) { if (current()) sendEvent("onVoiceState", mapOf("sessionId" to id, "state" to "listening", "mode" to if (device) "on_device" else "system")) }
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {} // Never persist recognition audio.
        override fun onEndOfSpeech() { if (current()) sendEvent("onVoiceState", mapOf("sessionId" to id, "state" to "processing")) }
        override fun onPartialResults(partial: Bundle?) {
          if (current()) sendEvent("onTranscript", mapOf("sessionId" to id, "text" to (partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""), "final" to false))
        }
        override fun onResults(results: Bundle?) {
          if (!current()) return
          val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
          sendEvent("onTranscript", mapOf("sessionId" to id, "text" to text, "final" to true))
          recognitionId = null; engine.destroy(); if (recognizer === engine) recognizer = null
          sendEvent("onVoiceState", mapOf("sessionId" to id, "state" to "idle"))
        }
        override fun onError(error: Int) {
          if (!current()) return
          if (device && (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE || error == SpeechRecognizer.ERROR_CLIENT)) {
            beginRecognition(id, language, false, token); return
          }
          recognitionId = null; engine.destroy(); if (recognizer === engine) recognizer = null
          sendEvent("onVoiceError", mapOf("sessionId" to id, "code" to when(error) { SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "microphone_denied"; SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no_speech"; SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "recognition_language_unavailable"; SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "recognition_network_error"; else -> "recognition_failed" }))
        }
        override fun onEvent(eventType: Int, params: Bundle?) {}
      })
      val request = intent(language)
      // API 33 can check whether this language is installed for on-device use.
      if (device && Build.VERSION.SDK_INT >= 33) engine.checkRecognitionSupport(request, context.mainExecutor, object : RecognitionSupportCallback {
        override fun onSupportResult(support: RecognitionSupport) {
          if (generation != token || recognitionId != id || recognizer !== engine) return
          val languageTag = Locale.forLanguageTag(language).language
          if (support.installedOnDeviceLanguages.any { Locale.forLanguageTag(it).language == languageTag }) engine.startListening(request)
          else beginRecognition(id, language, false, token)
        }
        override fun onError(error: Int) { if (generation == token && recognitionId == id && recognizer === engine) beginRecognition(id, language, false, token) }
      }) else engine.startListening(request)
    } catch (_: Exception) {
      if (device) beginRecognition(id, language, false, token)
      else { recognitionId = null; sendEvent("onVoiceError", mapOf("sessionId" to id, "code" to "recognition_unavailable")) }
    }
  }

  private fun ensureTts(callback: (Boolean) -> Unit) {
    if (ttsReady) { callback(true); return }
    ttsWaiters.add(callback); if (ttsInitializing) return
    val context = appContext.reactContext
    if (context == null) { val waiters = ttsWaiters.toList(); ttsWaiters.clear(); waiters.forEach { it(false) }; return }
    ttsInitializing = true; val token = ++ttsEpoch
    // A missing or hung engine must not indefinitely block capability checks.
    main.postDelayed({
      if (token == ttsEpoch && ttsInitializing) {
        ttsEpoch++; ttsInitializing = false; ttsReady = false; tts?.shutdown(); tts = null
        val waiters = ttsWaiters.toList(); ttsWaiters.clear(); waiters.forEach { it(false) }
      }
    }, 5000)
    tts = TextToSpeech(context) { status -> main.post {
      if (token != ttsEpoch) return@post
      ttsInitializing = false; ttsReady = status == TextToSpeech.SUCCESS
      tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String?) {}
        override fun onDone(id: String?) { main.post { if (id == speechLastUtterance) { val session = speechId; speechId = null; speechLastUtterance = null; if (session != null) sendEvent("onVoiceState", mapOf("sessionId" to session, "state" to "idle")) } } }
        @Deprecated("Deprecated in Java") override fun onError(id: String?) { main.post { val session = speechId; if (session != null && id?.startsWith("$session:") == true) { stopAllInternal(); sendEvent("onVoiceError", mapOf("sessionId" to session, "code" to "speech_failed")) } } }
      })
      val waiters = ttsWaiters.toList(); ttsWaiters.clear(); waiters.forEach { it(ttsReady) }
    } }
  }
  private fun stopAllInternal() {
    generation++; val previous = listOfNotNull(recognitionId, speechId); recognitionId = null; speechId = null; speechLastUtterance = null
    recognizer?.cancel(); recognizer?.destroy(); recognizer = null; tts?.stop()
    previous.forEach { sendEvent("onVoiceState", mapOf("sessionId" to it, "state" to "idle")) }
  }
}
