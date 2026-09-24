package expo.modules.petdesktop

import android.content.Context
import android.content.Intent
import android.content.BroadcastReceiver
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode
import org.robolectric.android.controller.ServiceController
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowSettings
import org.json.JSONObject

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class PetDesktopServiceTest {
  private lateinit var context: Context
  private lateinit var service: PetDesktopService
  private lateinit var controller: ServiceController<PetDesktopService>
  private fun field(name: String) = PetDesktopService::class.java.getDeclaredField(name).apply { isAccessible = true }
  private fun invoke(name: String) = PetDesktopService::class.java.getDeclaredMethod(name).apply { isAccessible = true }.invoke(service)
  private fun editor() = field("input").get(service) as EditText
  private fun journal() = PetDesktopStore(context)
  @Before fun setup() {
    context = RuntimeEnvironment.getApplication()
    (field("journal").get(null) as? PetDesktopStore)?.close()
    field("journal").set(null, null)
    context.deleteDatabase("desktop-pet-journal.db")
    controller = Robolectric.buildService(PetDesktopService::class.java).create()
    service = controller.get()
    field("ownerId").set(service, "A"); field("petId").set(service, "pet-A"); field("hidden").set(service, false)
    invoke("openChat")
  }
  @After fun finish() {
    controller.destroy()
    (field("journal").get(null) as? PetDesktopStore)?.close(); field("journal").set(null, null)
  }
  @Test fun textWatcherCommitsWhilePanelRemainsOpen() {
    editor().setText("还未收起的草稿🙂")
    assertNotNull(field("panel").get(service))
    journal().use { assertEquals("还未收起的草稿🙂", it.openDraft("A", "pet-A").text) }
    assertEquals(1, PetDesktopService.status(context)["draftWrites"])
    assertEquals(0, PetDesktopService.status(context)["draftWriteFailures"])
  }
  @Test fun closeAndLockDetachOldEditorsWithoutLateWrites() {
    val old = editor(); old.setText("锁屏前")
    (field("receiver").get(service) as BroadcastReceiver).onReceive(context, Intent(Intent.ACTION_SCREEN_OFF))
    assertNull(field("panel").get(service))
    old.setText("已关闭编辑器的迟到变化")
    journal().use { assertEquals("锁屏前", it.openDraft("A", "pet-A").text) }
    field("locked").set(service, false); invoke("openChat")
    assertEquals("锁屏前", editor().text.toString())
  }
  @Test fun realSendButtonAndLateCompletionPreserveNextInput() {
    editor().setText("first")
    val root = field("panel").get(service) as ViewGroup
    fun send(group: ViewGroup): Button? {
      for (i in 0 until group.childCount) {
        val child = group.getChildAt(i)
        if (child is Button && child.text == "发送") return child
        if (child is ViewGroup) send(child)?.let { return it }
      }
      return null
    }
    assertTrue(send(root)!!.performClick())
    assertEquals("", editor().text.toString())
    editor().setText("next")
    val commands = PetDesktopService.pendingCommands(context)
    val sent = (0 until commands.length()).map { commands.getJSONObject(it) }.single { it.getString("kind") == "send" }
    PetDesktopService.completeCommand(context, sent.getString("id"), "A", null)
    assertEquals("next", editor().text.toString())
    journal().use { assertEquals("next", it.openDraft("A", "pet-A").text) }
  }
  @Test fun logoutRemovesWindowAndOldWatcherCannotResurrect() {
    val old = editor(); old.setText("A private")
    PetDesktopService.clearAccount(context, "A")
    assertNull(field("panel").get(service)); assertNull(PetDesktopService.instance)
    old.setText("late A private")
    journal().use {
      assertEquals("", it.openDraft("A", "pet-A").text)
      assertEquals("", it.openDraft("B", "pet-B").text)
      assertEquals(0, it.pending("A", "pet-A").length())
    }
  }
  @Test fun restartingFullOutboxStillWakesHeadlessRuntime() {
    val previous = PetDesktopService.pendingCommands(context)
    for (i in 0 until previous.length()) PetDesktopService.completeCommand(context, previous.getJSONObject(i).getString("id"), "A", null)
    journal().use { journal ->
      repeat(20) { journal.enqueue(JSONObject().put("id", "send-$it").put("kind", "send")
        .put("ownerId", "A").put("petId", "pet-A").put("requestId", "request-$it").put("content", "saved-$it")) }
    }
    val application = shadowOf(RuntimeEnvironment.getApplication())
    while (application.nextStartedService != null) { /* discard setup wake-ups */ }
    ShadowSettings.setCanDrawOverlays(true)
    val result = service.onStartCommand(Intent(context, PetDesktopService::class.java).setAction(PetDesktopService.START)
      .putExtra("ownerId", "A").putExtra("petId", "pet-A"), 0, 1)
    assertEquals(android.app.Service.START_STICKY, result)
    assertEquals(PetDesktopTaskService::class.java.name, application.nextStartedService?.component?.className)
    val pending = PetDesktopService.pendingCommands(context)
    assertEquals(21, pending.length())
    assertEquals(1, (0 until pending.length()).count { pending.getJSONObject(it).getString("kind") == "bootstrap" })
  }
}
