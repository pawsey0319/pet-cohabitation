package expo.modules.petdesktop

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class PetDesktopStoreTest {
  private lateinit var context: Context
  private lateinit var store: PetDesktopStore
  @Before fun setup() {
    context = RuntimeEnvironment.getApplication()
    context.deleteDatabase("desktop-pet-journal.db")
    store = PetDesktopStore(context)
  }
  @After fun finish() { store.close() }
  private fun reopen() { store.close(); store = PetDesktopStore(context) }
  private fun command(id: String, text: String = "first", owner: String = "A", pet: String = "pet-A") = JSONObject()
    .put("id", id).put("requestId", "request-$id").put("kind", "send")
    .put("ownerId", owner).put("petId", pet).put("content", text)

  @Test fun editPersistsWithoutClosingPanel() {
    var draft = store.openDraft("A", "pet-A")
    for (text in listOf("刚", "刚输入", "刚输入的草稿")) draft = store.save(draft, text)!!
    reopen()
    assertEquals("刚输入的草稿", store.openDraft("A", "pet-A").text)
  }
  @Test fun atomicSendSurvivesRestartWithoutRestoringSubmittedDraft() {
    val draft = store.save(store.openDraft("A", "pet-A"), "  first  ")!!
    assertEquals("", store.enqueue(command("one"), draft)!!.text)
    reopen()
    assertEquals("", store.openDraft("A", "pet-A").text)
    assertEquals("first", store.pending("A", "pet-A").getJSONObject(0).getString("content"))
    assertEquals(1, store.pending("A", "pet-A").length())
  }
  @Test fun submitCannotConsumeNewerDraft() {
    val submitted = store.save(store.openDraft("A", "pet-A"), "first")!!
    val newer = store.save(submitted, "second")!!
    assertEquals(newer, store.enqueue(command("one"), submitted))
    store.complete("A", "pet-A", "one", null)
    reopen()
    assertEquals("second", store.openDraft("A", "pet-A").text)
  }
  @Test fun staleSaveCannotUndoEditOrExplicitDeletion() {
    val old = store.save(store.openDraft("A", "pet-A"), "first")!!
    val newer = store.save(old, "second")!!
    assertNull(store.save(old, "late first"))
    val deleted = store.save(newer, "")!!
    assertNull(store.save(newer, "late second"))
    assertEquals(deleted, store.openDraft("A", "pet-A"))
  }
  @Test fun logoutRejectsLateSavesAndCommandsEvenAfterRelogin() {
    val old = store.save(store.openDraft("A", "pet-A"), "first")!!
    store.clearAccount("A")
    reopen()
    val newSession = store.openDraft("A", "pet-A")
    assertTrue(newSession.epoch > old.epoch)
    assertNull(store.save(old, "late"))
    assertThrows(IllegalStateException::class.java) { store.enqueue(command("old"), old) }
    assertEquals("", store.openDraft("A", "pet-A").text)
    assertEquals(0, store.pending("A", "pet-A").length())
  }
  @Test fun scopesAreIndependentIncludingSameOwnerOtherPetAndConversation() {
    store.save(store.openDraft("A", "pet-A"), "private A")
    store.save(store.openDraft("A", "pet-B"), "other pet")
    store.save(store.openDraft("A", "pet-A", "steward"), "other conversation")
    store.save(store.openDraft("B", "pet-A"), "private B")
    store.enqueue(command("B", owner = "B", pet = "pet-B"))
    assertEquals(0, store.pending("A", "pet-A").length())
    store.clearAccount("A")
    assertEquals("private B", store.openDraft("B", "pet-A").text)
    assertEquals(1, store.pending("B", "pet-B").length())
    assertEquals("", store.openDraft("A", "pet-B").text)
    assertEquals("", store.openDraft("A", "pet-A", "steward").text)
  }
  @Test fun failedDuplicateInsertRollsBackDraftConsumption() {
    store.enqueue(command("same"))
    val draft = store.save(store.openDraft("A", "pet-A"), "second")!!
    assertThrows(android.database.sqlite.SQLiteConstraintException::class.java) { store.enqueue(command("same", "second"), draft) }
    reopen()
    assertEquals("second", store.openDraft("A", "pet-A").text)
    assertEquals(1, store.pending("A", "pet-A").length())
  }
  @Test fun fullQueueRetainsDraft() {
    repeat(20) { store.enqueue(command("$it")) }
    val draft = store.save(store.openDraft("A", "pet-A"), "first")!!
    assertThrows(IllegalStateException::class.java) { store.enqueue(command("overflow"), draft) }
    reopen()
    assertEquals(draft, store.openDraft("A", "pet-A"))
    assertEquals(20, store.pending("A", "pet-A").length())
  }
  private fun control(id: String, kind: String, request: String = "active") = JSONObject()
    .put("id", id).put("kind", kind).put("ownerId", "A").put("petId", "pet-A").put("requestId", request)
  @Test fun fullOutboxStillAllowsRecoveryAndStop() {
    repeat(20) { store.enqueue(command("$it")) }
    store.enqueue(control("boot", "bootstrap"))
    store.enqueue(control("refresh", "refresh"))
    store.enqueue(control("stop", "stop_reply"))
    reopen()
    val rows = store.pending("A", "pet-A")
    assertEquals(23, rows.length())
    assertThrows(IllegalStateException::class.java) { store.enqueue(command("overflow")) }
  }
  @Test fun repeatedControlsStayBoundedAndOldReceiptCannotClearReplacement() {
    repeat(30) {
      store.enqueue(control("boot-$it", "bootstrap"))
      store.enqueue(control("refresh-$it", "refresh"))
      store.enqueue(control("stop-$it", "stop_reply"))
      store.enqueue(control("retry-$it", "retry"))
    }
    store.complete("A", "pet-A", "boot-0", null)
    store.complete("A", "pet-A", "retry-0", null)
    reopen()
    val rows = store.pending("A", "pet-A")
    assertEquals(4, rows.length())
    assertTrue((0 until rows.length()).all { rows.getJSONObject(it).getString("id").endsWith("-29") })
  }
  @Test fun retryCapacityDoesNotBlockStopOrClearUnsentText() {
    repeat(20) { store.enqueue(control("retry-$it", "retry", "request-$it")) }
    val draft = store.save(store.openDraft("A", "pet-A"), "first")!!
    assertThrows(IllegalStateException::class.java) { store.enqueue(control("overflow", "retry", "request-overflow")) }
    store.enqueue(control("stop", "stop_reply"))
    assertEquals(draft, store.openDraft("A", "pet-A"))
    assertEquals(21, store.pending("A", "pet-A").length())
  }
  @Test fun failureRetryAndLateReceiptDoNotConsumeFollowingDraft() {
    val first = store.save(store.openDraft("A", "pet-A"), "first")!!
    val empty = store.enqueue(command("one"), first)!!
    store.save(empty, "second")
    store.complete("A", "pet-A", "one", "offline")
    reopen()
    assertEquals("offline", store.pending("A", "pet-A").getJSONObject(0).getString("error"))
    store.retry("A", "pet-A", "one")
    assertFalse(store.pending("A", "pet-A").getJSONObject(0).has("error"))
    store.complete("B", "pet-A", "one", null)
    store.complete("A", "pet-other", "one", null)
    assertEquals(1, store.pending("A", "pet-A").length())
    store.complete("A", "pet-A", "one", null)
    assertEquals("second", store.openDraft("A", "pet-A").text)
  }
  @Test fun legacyImportIsIdempotentAndCannotResurrectAfterLogout() {
    val rows = JSONArray().put(command("legacy")).put(command("foreign", owner = "B"))
    store.importLegacy("A", mapOf("pet-A" to "legacy draft", "pet-B" to "other"), rows)
    store.importLegacy("A", mapOf("pet-A" to "wrong"), rows)
    reopen()
    assertEquals("legacy draft", store.openDraft("A", "pet-A").text)
    assertEquals(1, store.pending("A", "pet-A").length())
    assertEquals(0, store.pending("B", "pet-A").length())
    store.clearAccount("A")
    store.importLegacy("A", mapOf("pet-A" to "resurrect"), rows)
    assertEquals("", store.openDraft("A", "pet-A").text)
    assertEquals(0, store.pending("A", "pet-A").length())
  }
  @Test fun journalUsesFullSynchronousWrites() {
    store.readableDatabase.rawQuery("PRAGMA synchronous", null).use { it.moveToFirst(); assertEquals(2, it.getInt(0)) }
  }
}
