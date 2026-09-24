package expo.modules.petdesktop

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.view.*
import android.view.inputmethod.InputMethodManager
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.min

/** User-started foreground overlay. The app's ReactHost owns all auth and chat requests. */
class PetDesktopService : Service() {
  companion object {
    const val START = "pet.desktop.START"
    private const val SHOW = "pet.desktop.SHOW"
    private const val HIDE = "pet.desktop.HIDE"
    private const val STOP = "pet.desktop.STOP"
    private const val CHANNEL = "desktop-pet"
    private const val NOTIFICATION = 71209
    private const val PREFS = "desktop-pet-v1"
    var instance: PetDesktopService? = null
      private set
    var stateListener: ((Map<String, Any?>) -> Unit)? = null
    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private var journal: PetDesktopStore? = null
    private fun store(context: Context): PetDesktopStore = journal ?: PetDesktopStore(context).also { journal = it }
    fun status(context: Context): Map<String, Any?> {
      val live = instance
      return mapOf("supported" to (Build.VERSION.SDK_INT >= 26), "permission" to Settings.canDrawOverlays(context), "running" to (live != null),
        "hidden" to (live?.hidden ?: true), "ownerId" to live?.ownerId, "petId" to live?.petId,
        "error" to (live?.error ?: prefs(context).getString("lastError", null)), "size" to (live?.size ?: 112), "imageReady" to (live?.bitmap != null),
        "draftWrites" to (live?.draftWrites ?: 0), "draftWriteMaxMs" to (live?.draftWriteMaxMs ?: 0L), "draftWriteFailures" to (live?.draftWriteFailures ?: 0))
    }
    fun stop(context: Context, owner: String?) {
      val current = instance
      if (current != null) current.stopForAccount(owner)
      else if (owner == null || prefs(context).getString("activeOwner", null) == owner) {
        prefs(context).edit().remove("activeOwner").remove("activePet").commit()
        context.stopService(Intent(context, PetDesktopService::class.java))
      }
    }
    fun clearAccount(context: Context, owner: String) {
      stop(context, owner)
      store(context).clearAccount(owner)
      val values = prefs(context); val editor = values.edit()
      for (key in values.all.keys) if (key.startsWith("account:$owner:")) editor.remove(key)
      if (values.getString("activeOwner", null) == owner) editor.remove("activeOwner").remove("activePet")
      editor.commit()
    }
    fun pendingCommands(context: Context): JSONArray {
      val live = instance ?: return JSONArray()
      return store(context).pending(live.ownerId, live.petId)
    }
    fun completeCommand(context: Context, id: String, owner: String, failure: String?) {
      val live = instance ?: return
      if (live.ownerId != owner) return
      store(context).complete(owner, live.petId, id, failure)
      if (failure != null) live.setError(failure) else live.renderChat()
    }
  }

  private val main = Handler(Looper.getMainLooper())
  private val downloads = Executors.newSingleThreadExecutor()
  private lateinit var windows: WindowManager
  private var ownerId = ""
  private var petId = ""
  private var petName = "异宠"
  private var hidden = true
  private var locked = false
  private var size = 112
  private var generation = 0
  private var bitmap: Bitmap? = null
  private var imageVersion: String? = null
  private var error: String? = null
  private var petView: ImageView? = null
  private var petParams: WindowManager.LayoutParams? = null
  private var panel: LinearLayout? = null
  private var chatLines: LinearLayout? = null
  private var chatScroll: ScrollView? = null
  private var input: EditText? = null
  private var draft: PetDesktopStore.Draft? = null
  private var draftWatcher: TextWatcher? = null
  private var updatingDraft = false
  private var draftWrites = 0
  private var draftWriteMaxMs = 0L
  private var draftWriteFailures = 0
  private var petLongPress: Runnable? = null
  private var viewState = JSONObject()
  private var breathing: ObjectAnimator? = null
  private var popup: PopupWindow? = null
  private var registered = false
  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      when (intent?.action) {
        Intent.ACTION_SCREEN_OFF -> { locked = true; removeWindows() }
        Intent.ACTION_USER_PRESENT -> { locked = false; showIfReady() }
        Intent.ACTION_SCREEN_ON -> { locked = (getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked; if (!locked) showIfReady() }
        Intent.ACTION_CONFIGURATION_CHANGED -> { removeWindows(); showIfReady() }
      }
    }
  }
  private val permissionWatch = object : Runnable {
    override fun run() {
      if (!Settings.canDrawOverlays(this@PetDesktopService)) { setError("悬浮权限已关闭，请重新授权。"); stopForAccount(null); return }
      if ((getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked && !locked) { locked = true; removeWindows() }
      main.postDelayed(this, 1500)
    }
  }

  override fun onCreate() {
    super.onCreate(); instance = this; windows = getSystemService(WINDOW_SERVICE) as WindowManager
    locked = (getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
    val filter = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_USER_PRESENT); addAction(Intent.ACTION_CONFIGURATION_CHANGED) }
    if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, RECEIVER_NOT_EXPORTED) else registerReceiver(receiver, filter)
    registered = true
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "桌面异宠", NotificationManager.IMPORTANCE_LOW).apply { description = "你主动开启的桌宠，可随时隐藏或停止"; setSound(null, null); enableVibration(false); lockscreenVisibility = Notification.VISIBILITY_SECRET })
  }
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Promotion happens immediately, before async image/auth checks.
    if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(NOTIFICATION, notification())
    if (intent?.action == STOP) { stopForAccount(null); return START_NOT_STICKY }
    if (ownerId.isNotBlank() && intent?.action == HIDE) { hidePet(); return START_STICKY }
    if (ownerId.isNotBlank() && intent?.action == SHOW) { showPet(); return START_STICKY }
    instance = this; generation++; removeWindows(); bitmap = null; imageVersion = null; viewState = JSONObject()
    val stored = prefs(this)
    ownerId = intent?.getStringExtra("ownerId") ?: stored.getString("activeOwner", "") ?: ""
    petId = intent?.getStringExtra("petId") ?: stored.getString("activePet", "") ?: ""
    if (ownerId.isBlank() || petId.isBlank() || !Settings.canDrawOverlays(this)) { stopForAccount(null); return START_NOT_STICKY }
    try {
      val prefix = "account:$ownerId:"
      val legacyDrafts = stored.all.entries.filter { it.key.startsWith(prefix) && it.key.endsWith(":draft") }
        .associate { it.key.removePrefix(prefix).removeSuffix(":draft") to (it.value as? String ?: "") }
      store(this).importLegacy(ownerId, legacyDrafts, JSONArray(stored.getString("account:$ownerId:commands", "[]")))
      val cleanup = stored.edit().remove("account:$ownerId:commands")
      for (key in stored.all.keys) if (key.startsWith(prefix) && key.endsWith(":draft")) cleanup.remove(key)
      cleanup.commit()
    } catch (_: Exception) { setError("桌宠本机记录暂时无法读取，内容未清除，请稍后重试。"); stopForAccount(null); return START_NOT_STICKY }
    stored.edit().putString("activeOwner", ownerId).putString("activePet", petId).remove("lastError").commit()
    size = stored.getInt(accountKey("size"), 112).coerceIn(72, 180)
    hidden = when (intent?.action) { START, SHOW -> false; HIDE -> true; else -> stored.getBoolean(accountKey("hidden"), true) }
    persistPlacement(); main.removeCallbacks(permissionWatch); main.post(permissionWatch)
    // Process restoration verifies the current account and approved image before showing anything.
    enqueue("bootstrap"); emit(); return START_STICKY
  }
  private fun accountKey(key: String) = "account:$ownerId:$petId:$key"
  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
  private fun dimensions(): Pair<Int, Int> {
    if (Build.VERSION.SDK_INT >= 30) { val bounds = windows.currentWindowMetrics.bounds; return Pair(bounds.width(), bounds.height()) }
    return Pair(resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels)
  }
  private fun notification(): Notification {
    fun action(label: String, code: Int, command: String) = Notification.Action.Builder(null, label,
      PendingIntent.getService(this, code, Intent(this, PetDesktopService::class.java).setAction(command), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build()
    return Notification.Builder(this, CHANNEL).setSmallIcon(applicationInfo.icon).setContentTitle("桌面异宠")
      .setContentText(if (hidden) "已隐藏，点击显示可恢复" else "桌宠正在运行，可随时隐藏或停止")
      .setVisibility(Notification.VISIBILITY_SECRET).setOngoing(true).setOnlyAlertOnce(true)
      .addAction(action(if (hidden) "显示" else "隐藏", 1, if (hidden) SHOW else HIDE))
      .addAction(action("停止桌宠", 2, STOP)).build()
  }
  private fun emit() {
    (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION, notification())
    stateListener?.invoke(status(this))
  }
  fun setError(message: String) {
    error = message.take(300); prefs(this).edit().putString("lastError", error).apply()
    if (panel != null) renderChat(); emit()
  }
  fun hidePet() { hidden = true; persistPlacement(); removeWindows(); emit() }
  fun showPet() {
    if (!Settings.canDrawOverlays(this)) { setError("请在 App 设置中恢复悬浮权限。"); stopForAccount(null); return }
    hidden = false; persistPlacement(); showIfReady(); emit()
  }
  fun stopForAccount(owner: String?) {
    if (owner != null && owner != ownerId) return
    generation++; hidden = true; removeWindows(); bitmap = null; viewState = JSONObject()
    prefs(this).edit().remove("activeOwner").remove("activePet").commit()
    main.removeCallbacks(permissionWatch)
    if (instance === this) instance = null
    stateListener?.invoke(status(this)); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
  }
  fun setPetSize(value: Int) {
    size = value.coerceIn(72, 180); persistPlacement(); removeWindows(); showIfReady(); emit()
  }
  private fun persistPlacement() {
    if (ownerId.isBlank()) return
    val editor = prefs(this).edit().putInt(accountKey("size"), size).putBoolean(accountKey("hidden"), hidden)
    petParams?.let { p -> val (width, height) = dimensions(); editor.putFloat(accountKey("x"), p.x.toFloat() / (width - p.width).coerceAtLeast(1)); editor.putFloat(accountKey("y"), p.y.toFloat() / (height - p.height).coerceAtLeast(1)) }
    editor.apply()
  }
  fun applyImage(owner: String, pet: String, address: String, version: String, name: String) {
    if (owner != ownerId || pet != petId || instance !== this) return
    val url = URL(address); require(url.protocol == "https" && url.path.startsWith("/storage/v1/object/sign/")) { "形象地址无效。" }
    petName = name.take(40)
    if (imageVersion == version && bitmap != null) { showIfReady(); return }
    val epoch = ++generation
    downloads.execute {
      try {
        val connection = url.openConnection() as HttpURLConnection
        connection.connectTimeout = 12_000; connection.readTimeout = 20_000; connection.instanceFollowRedirects = false
        val bytes = try {
          require(connection.responseCode == 200) { "形象下载失败，请重新开启桌宠。" }
          require(connection.contentLengthLong <= 8 * 1024 * 1024) { "形象文件过大。" }
          connection.inputStream.use { stream ->
            val out = ByteArrayOutputStream(); val buffer = ByteArray(8192)
            while (true) { val count = stream.read(buffer); if (count < 0) break; require(out.size() + count <= 8 * 1024 * 1024); out.write(buffer, 0, count) }
            out.toByteArray()
          }
        } finally { connection.disconnect() }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth in 32..4096 && bounds.outHeight in 32..4096) { "透明形象尺寸无效。" }
        val image = requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size))
        require(image.hasAlpha()) { "这张图没有透明通道，请先确认透明本体。" }
        var clear = 0; var opaque = 0
        for (x in 0 until image.width step (image.width / 64).coerceAtLeast(1)) for (y in 0 until image.height step (image.height / 64).coerceAtLeast(1)) {
          val alpha = Color.alpha(image.getPixel(x, y)); if (alpha < 10) clear++; if (alpha > 220) opaque++
        }
        require(clear >= 10 && opaque >= 10) { "图片未通过真实透明检查，请检查异宠本体。" }
        main.post { if (generation == epoch && instance === this && ownerId == owner && petId == pet) {
          bitmap = image; imageVersion = version; error = null; removeWindows(); showIfReady(); emit()
        } }
      } catch (failure: Exception) { main.post { if (generation == epoch && instance === this) setError(failure.message ?: "形象暂时无法载入，请重试。") } }
    }
  }
  private fun showIfReady() {
    if (hidden || locked || bitmap == null || petView != null || instance !== this) return
    if (!Settings.canDrawOverlays(this)) { stopForAccount(null); return }
    val (width, height) = dimensions(); val pixels = dp(size)
    val params = WindowManager.LayoutParams(pixels, pixels, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL, PixelFormat.TRANSLUCENT).apply {
      gravity = Gravity.TOP or Gravity.LEFT
      x = (prefs(this@PetDesktopService).getFloat(accountKey("x"), 0.88f).coerceIn(0f, 1f) * (width - pixels).coerceAtLeast(0)).toInt()
      y = (prefs(this@PetDesktopService).getFloat(accountKey("y"), 0.45f).coerceIn(0f, 1f) * (height - pixels).coerceAtLeast(0)).toInt()
    }
    val image = ImageView(this).apply { setImageBitmap(bitmap); scaleType = ImageView.ScaleType.FIT_CENTER; contentDescription = "$petName，点击聊天，长按设置，拖动移动"; setPadding(dp(6), dp(6), dp(6), dp(6)) }
    var downX = 0f; var downY = 0f; var initialX = 0; var initialY = 0; var moved = false; var longPressed = false
    val longPress = Runnable { if (!moved && !hidden && !locked && instance === this && image.isAttachedToWindow) { longPressed = true; showMenu(image) } }
    petLongPress = longPress
    image.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; initialX = params.x; initialY = params.y; moved = false; longPressed = false; main.postDelayed(longPress, 550); breathing?.pause(); true }
        MotionEvent.ACTION_MOVE -> {
          val deltaX = event.rawX - downX; val deltaY = event.rawY - downY
          if (abs(deltaX) + abs(deltaY) > dp(8)) { moved = true; main.removeCallbacks(longPress); popup?.dismiss() }
          params.x = (initialX + deltaX.toInt()).coerceIn(0, (width - pixels).coerceAtLeast(0)); params.y = (initialY + deltaY.toInt()).coerceIn(0, (height - pixels).coerceAtLeast(0))
          if (image.isAttachedToWindow) windows.updateViewLayout(image, params); true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          main.removeCallbacks(longPress); persistPlacement(); breathing?.resume()
          if (!moved && !longPressed && event.actionMasked == MotionEvent.ACTION_UP) { image.performClick(); if (panel == null) openChat() else closeChat() }
          true
        }
        else -> false
      }
    }
    petParams = params; petView = image
    try {
      windows.addView(image, params)
      breathing = ObjectAnimator.ofFloat(image, "scaleY", 1f, 0.975f, 1f).apply { duration = 3800; repeatCount = ValueAnimator.INFINITE; start() }
    } catch (_: Exception) { petView = null; setError("系统暂时无法显示桌宠，请检查悬浮权限。"); stopForAccount(null) }
  }
  private fun showMenu(anchor: View) {
    popup?.dismiss()
    val choices = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; background = background() }
    listOf("隐藏" to { hidePet() }, "变小" to { setPetSize(size - 20) }, "变大" to { setPetSize(size + 20) }, "停止桌宠" to { stopForAccount(null) }).forEach { (label, action) -> choices.addView(button(label) { popup?.dismiss(); action() }) }
    popup = PopupWindow(choices, dp(132), WindowManager.LayoutParams.WRAP_CONTENT, true).apply { elevation = dp(8).toFloat(); setBackgroundDrawable(background()); showAsDropDown(anchor) }
  }
  private fun background() = GradientDrawable().apply { setColor(Color.rgb(250, 250, 247)); cornerRadius = dp(16).toFloat(); setStroke(dp(1), Color.rgb(220, 222, 218)) }
  private fun button(label: String, action: () -> Unit) = Button(this).apply { text = label; isAllCaps = false; textSize = 13f; setOnClickListener { action() }; minHeight = dp(44) }
  private fun openChat() {
    if (locked || hidden || panel != null) return
    val openedDraft = try { store(this).openDraft(ownerId, petId) }
      catch (_: Exception) { setError("草稿暂时无法读取，请稍后重试。"); return }
    draft = openedDraft
    val (screenWidth, screenHeight) = dimensions()
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; background = background(); setPadding(dp(10), dp(4), dp(10), dp(10)); elevation = dp(8).toFloat() }
    val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
    header.addView(TextView(this).apply { text = petName; textSize = 17f; setTextColor(Color.BLACK) }, LinearLayout.LayoutParams(0, dp(48), 1f))
    header.addView(button("打开 App") { openApp() }); header.addView(button("收起") { closeChat() }); root.addView(header)
    chatLines = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    chatScroll = ScrollView(this).apply { isFillViewport = false; addView(chatLines) }
    root.addView(chatScroll, LinearLayout.LayoutParams(-1, 0, 1f))
    val composer = LinearLayout(this).apply { gravity = Gravity.BOTTOM }
    val editor = EditText(this).apply {
      hint = "和${petName}说点什么"; textSize = 15f; setTextColor(Color.BLACK); maxLines = 4
      inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
      filters = arrayOf(android.text.InputFilter.LengthFilter(4000))
      setText(openedDraft.text)
    }; input = editor
    val watcher = object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
      override fun afterTextChanged(s: Editable?) {
        if (!updatingDraft && input === editor && instance === this@PetDesktopService) persistDraft(editor)
      }
    }
    draftWatcher = watcher; editor.addTextChangedListener(watcher)
    composer.addView(editor, LinearLayout.LayoutParams(0, -2, 1f))
    composer.addView(button("发送") {
      val content = editor.text.toString().trim(); if (content.isEmpty() || !persistDraft(editor)) return@button
      val submitted = draft ?: return@button
      if (enqueue("send", content, UUID.randomUUID().toString(), submitted)) {
        // The journal has atomically stored the message and consumed this version.
        // Reflect its latest draft; no later async receipt can clear newer input.
        updatingDraft = true
        try { editor.setText(draft?.text ?: ""); editor.setSelection(editor.text.length) }
        finally { updatingDraft = false }
      }
    }); root.addView(composer)
    val params = WindowManager.LayoutParams(min(dp(360), screenWidth - dp(16)), min(dp(460), (screenHeight * 0.64).toInt()),
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL, PixelFormat.TRANSLUCENT).apply {
      gravity = Gravity.TOP or Gravity.LEFT; x = dp(8); y = dp(44); softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
    }
    root.setOnKeyListener { _, key, event -> if (key == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) { closeChat(); true } else false }
    panel = root
    try { windows.addView(root, params); renderChat(); enqueue("refresh") }
    catch (_: Exception) { closeChat(); setError("聊天窗暂时无法打开，请使用 App。") }
  }
  private fun persistDraft(editor: EditText): Boolean {
    val expected = draft ?: return false
    if (expected.text == editor.text.toString()) return true
    val started = SystemClock.elapsedRealtime()
    return try {
      val saved = store(this).save(expected, editor.text.toString())
      if (saved == null) { draftWriteFailures++; setError("账号或草稿已变化，请收起后重新打开；当前输入尚未保存。"); false }
      else { draft = saved; true }
    } catch (_: Exception) { draftWriteFailures++; setError("草稿未能保存，请保持小窗打开并稍后重试。"); false }
    finally {
      // Counts/durations only. Never log draft text or account identifiers.
      draftWrites++; draftWriteMaxMs = maxOf(draftWriteMaxMs, SystemClock.elapsedRealtime() - started)
    }
  }
  private fun closeChat() {
    input?.let {
      draftWatcher?.let { watcher -> it.removeTextChangedListener(watcher) }
      // Every edit has already been committed; closing must not resurrect a stale draft.
      (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(it.windowToken, 0)
    }
    panel?.let { if (it.isAttachedToWindow) windows.removeViewImmediate(it) }
    panel = null; input = null; draft = null; draftWatcher = null; chatLines = null; chatScroll = null
  }
  private fun removeWindows() {
    petLongPress?.let { main.removeCallbacks(it) }; petLongPress = null
    popup?.dismiss(); popup = null; breathing?.cancel(); breathing = null; closeChat()
    petView?.let { if (it.isAttachedToWindow) windows.removeViewImmediate(it) }; petView = null
  }
  private fun openApp() {
    closeChat()
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    launch.data = Uri.parse("pet-cohabitation://pet"); startActivity(launch)
  }
  private fun enqueue(kind: String, content: String? = null, requestId: String? = null, submitted: PetDesktopStore.Draft? = null): Boolean {
    if (instance !== this || ownerId.isBlank()) return false
    val command = JSONObject().put("id", UUID.randomUUID().toString()).put("kind", kind).put("ownerId", ownerId).put("petId", petId)
    if (content != null) command.put("content", content); if (requestId != null) command.put("requestId", requestId)
    try {
      val remaining = store(this).enqueue(command, submitted)
      if (submitted != null) draft = remaining
    } catch (failure: Exception) {
      setError(if (failure.message == "desktop_queue_full") "尚有较多消息等待处理，请稍后再发送。" else "消息未保存，输入仍然保留。")
      return false
    }
    try { startService(Intent(this, PetDesktopTaskService::class.java)) }
    catch (_: Exception) { setError("后台会话暂时不能启动，消息已保存在本机，请打开 App 重试。"); return true }
    renderChat(); return true
  }
  fun publish(owner: String, pet: String, json: String) {
    if (owner != ownerId || pet != petId || instance !== this || json.length > 200_000) return
    viewState = try { JSONObject(json) } catch (_: Exception) { return }; error = null; renderChat()
  }
  fun invalidateImage(owner: String, pet: String) {
    if (owner != ownerId || pet != petId || instance !== this) return
    setError("异宠形象或透明审批已更新，请确认后重新开启桌宠。")
    stopForAccount(owner)
  }
  private fun renderChat() {
    val container = chatLines ?: return
    val oldScroll = chatScroll?.scrollY ?: 0
    val atBottom = chatScroll?.let { it.getChildAt(0).height - it.scrollY - it.height < dp(72) } ?: true
    container.removeAllViews()
    fun line(text: String, own: Boolean = false) { container.addView(TextView(this).apply {
      this.text = text.take(16000); textSize = 15f; setTextColor(Color.rgb(35, 38, 34)); setPadding(dp(9), dp(9), dp(9), dp(9)); setTextIsSelectable(true)
      gravity = if (own) Gravity.END else Gravity.START
    }, LinearLayout.LayoutParams(-1, -2)) }
    val lines = viewState.optJSONArray("lines") ?: JSONArray()
    for (i in 0 until lines.length()) { val row = lines.getJSONObject(i); line(row.optString("content") + when(row.optString("status")) { "queued" -> "\n等待发送"; "sending" -> "\n正在回应"; "failed" -> "\n未完成，可重试"; else -> "" }, row.optString("role") == "owner") }
    val pending = pendingCommands(this)
    for (i in 0 until pending.length()) {
      val row = pending.getJSONObject(i)
      if (row.optString("kind") == "send") {
        line(row.optString("content") + if (row.has("error")) "\n消息未发送，已保存在本机" else "\n已保存在本机，等待发送", true)
        if (row.has("error")) container.addView(button("重试这条消息") {
          try { store(this).retry(ownerId, petId, row.getString("id")) }
          catch (_: Exception) { setError("重试状态未保存，请稍后重试。"); return@button }
          try { startService(Intent(this, PetDesktopTaskService::class.java)) } catch (_: Exception) { setError("请打开 App 后重试。"); }
        })
      }
    }
    val partial = viewState.optString("partial"); if (partial.isNotEmpty()) line(partial)
    val phase = error ?: viewState.optString("phase"); if (phase.isNotEmpty()) line(phase)
    val failed = viewState.optJSONArray("failedRequests") ?: JSONArray()
    for (i in 0 until failed.length()) { val row = failed.getJSONObject(i); container.addView(button("重试：${row.optString("error").take(45)}") { enqueue("retry", requestId = row.optString("id")) }) }
    val active = viewState.optString("activeRequest"); if (active.isNotEmpty() && active != "null") container.addView(button("停止当前回答") { enqueue("stop_reply", requestId = active) })
    chatScroll?.post { if (atBottom) chatScroll?.fullScroll(View.FOCUS_DOWN) else chatScroll?.scrollTo(0, oldScroll) }
  }
  override fun onDestroy() {
    generation++; removeWindows(); main.removeCallbacksAndMessages(null); downloads.shutdownNow()
    if (registered) unregisterReceiver(receiver)
    if (instance === this) instance = null
    stateListener?.invoke(status(this)); super.onDestroy()
  }
}
