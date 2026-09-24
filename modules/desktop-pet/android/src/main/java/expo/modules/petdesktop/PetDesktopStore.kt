package expo.modules.petdesktop

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/** One journal for drafts and the native outbox, so send + consume is atomic. */
internal class PetDesktopStore(context: Context) : SQLiteOpenHelper(context.applicationContext, "desktop-pet-journal.db", null, 1) {
  data class Draft(val owner: String, val pet: String, val conversation: String, val epoch: Long, val revision: Long, val text: String)

  override fun onConfigure(db: SQLiteDatabase) {
    super.onConfigure(db)
    // Each edit returns only after SQLite has synchronized its rollback journal.
    // No debounce or async apply: a killed process cannot flush pending writes.
    db.execSQL("PRAGMA synchronous=FULL")
  }
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE epochs(owner TEXT PRIMARY KEY, epoch INTEGER NOT NULL)")
    db.execSQL("CREATE TABLE drafts(owner TEXT NOT NULL, pet TEXT NOT NULL, conversation TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(owner,pet,conversation))")
    db.execSQL("CREATE TABLE commands(id TEXT PRIMARY KEY, owner TEXT NOT NULL, pet TEXT NOT NULL, payload TEXT NOT NULL)")
    db.execSQL("CREATE TABLE imports(owner TEXT PRIMARY KEY)")
  }
  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { error("Unsupported desktop journal version") }

  private inline fun <T> transaction(block: (SQLiteDatabase) -> T): T {
    val db = writableDatabase
    db.beginTransaction()
    try { val result = block(db); db.setTransactionSuccessful(); return result }
    finally { db.endTransaction() }
  }
  private fun epoch(db: SQLiteDatabase, owner: String): Long {
    db.execSQL("INSERT OR IGNORE INTO epochs(owner,epoch) VALUES(?,0)", arrayOf(owner))
    return db.rawQuery("SELECT epoch FROM epochs WHERE owner=?", arrayOf(owner)).use { it.moveToFirst(); it.getLong(0) }
  }
  private fun read(db: SQLiteDatabase, owner: String, pet: String, conversation: String): Draft {
    val generation = epoch(db, owner)
    return db.rawQuery("SELECT revision,content FROM drafts WHERE owner=? AND pet=? AND conversation=?", arrayOf(owner, pet, conversation)).use {
      if (it.moveToFirst()) Draft(owner, pet, conversation, generation, it.getLong(0), it.getString(1))
      else Draft(owner, pet, conversation, generation, 0, "")
    }
  }
  private fun write(db: SQLiteDatabase, draft: Draft, text: String): Draft {
    val next = draft.copy(revision = draft.revision + 1, text = text)
    db.execSQL("INSERT OR REPLACE INTO drafts(owner,pet,conversation,revision,content) VALUES(?,?,?,?,?)", arrayOf<Any>(next.owner, next.pet, next.conversation, next.revision, next.text))
    return next
  }
  @Synchronized fun openDraft(owner: String, pet: String, conversation: String = "companion"): Draft = transaction { read(it, owner, pet, conversation) }

  /** Stale editors cannot overwrite newer edits, explicit deletion, or logout. */
  @Synchronized fun save(expected: Draft, text: String): Draft? = transaction { db ->
    require(text.length <= 4000)
    val current = read(db, expected.owner, expected.pet, expected.conversation)
    if (current != expected) null else if (current.text == text) current else write(db, current, text)
  }

  /** Upgrade once per owner. A tombstone survives logout, so old prefs cannot re-import. */
  @Synchronized fun importLegacy(owner: String, drafts: Map<String, String>, commands: JSONArray) = transaction { db ->
    val imported = db.rawQuery("SELECT 1 FROM imports WHERE owner=?", arrayOf(owner)).use { it.moveToFirst() }
    if (!imported) {
      for ((pet, text) in drafts) {
        val current = read(db, owner, pet, "companion")
        if (current.revision == 0L) write(db, current, text.take(4000))
      }
      for (i in 0 until commands.length()) {
        val command = commands.getJSONObject(i)
        if (command.optString("ownerId") == owner && command.optString("id").isNotBlank() && command.optString("petId").isNotBlank()) {
          db.execSQL("INSERT OR IGNORE INTO commands(id,owner,pet,payload) VALUES(?,?,?,?)", arrayOf(command.getString("id"), owner, command.getString("petId"), command.toString()))
        }
      }
      db.execSQL("INSERT INTO imports(owner) VALUES(?)", arrayOf(owner))
    }
  }

  @Synchronized fun pending(owner: String, pet: String): JSONArray {
    val rows = JSONArray()
    readableDatabase.rawQuery("SELECT payload FROM commands WHERE owner=? AND pet=? ORDER BY rowid", arrayOf(owner, pet)).use {
      while (it.moveToNext()) rows.put(JSONObject(it.getString(0)))
    }
    return rows
  }

  /** A crash after commit restores either the unsent draft OR its queued message. */
  @Synchronized fun enqueue(command: JSONObject, submitted: Draft? = null): Draft? = transaction { db ->
    val owner = command.getString("ownerId"); val pet = command.getString("petId")
    val kind = command.getString("kind")
    require(kind in setOf("send", "bootstrap", "refresh", "retry", "stop_reply"))
    val current = submitted?.let {
      require(kind == "send")
      require(it.owner == owner && it.pet == pet && it.conversation == "companion")
      require(command.getString("content") == it.text.trim())
      read(db, owner, pet, it.conversation).also { now -> check(now.epoch == it.epoch) { "desktop_account_changed" } }
    }
    // User messages cannot consume the slots needed to restart or stop a reply.
    // Bound each kind independently; coalesce repeated controls without reusing
    // their IDs, so an old completion cannot acknowledge a newer click.
    val existing = mutableListOf<JSONObject>()
    db.rawQuery("SELECT payload FROM commands WHERE owner=?", arrayOf(owner)).use {
      while (it.moveToNext()) existing.add(JSONObject(it.getString(0)))
    }
    val replaced = existing.filter {
      kind != "send" && it.optString("kind") == kind && it.optString("petId") == pet &&
        (kind in setOf("bootstrap", "refresh") || it.optString("requestId") == command.optString("requestId"))
    }
    check(existing.count { it.optString("kind") == kind } - replaced.size < 20) { "desktop_queue_full" }
    for (previous in replaced) {
      db.execSQL("DELETE FROM commands WHERE id=? AND owner=? AND pet=?", arrayOf(previous.getString("id"), owner, pet))
    }
    db.execSQL("INSERT INTO commands(id,owner,pet,payload) VALUES(?,?,?,?)", arrayOf(command.getString("id"), owner, pet, command.toString()))
    // If a newer edit exists, only the immutable submitted text is queued.
    if (current != null && current == submitted) write(db, current, "") else current
  }

  @Synchronized fun complete(owner: String, pet: String, id: String, failure: String?) = transaction { db ->
    val command = db.rawQuery("SELECT payload FROM commands WHERE id=? AND owner=? AND pet=?", arrayOf(id, owner, pet)).use {
      if (it.moveToFirst()) JSONObject(it.getString(0)) else null
    }
    if (command != null) {
      if (failure != null && command.optString("kind") == "send") {
        command.put("error", failure.take(300))
        db.execSQL("UPDATE commands SET payload=? WHERE id=? AND owner=? AND pet=?", arrayOf(command.toString(), id, owner, pet))
      } else db.execSQL("DELETE FROM commands WHERE id=? AND owner=? AND pet=?", arrayOf(id, owner, pet))
    }
  }
  @Synchronized fun retry(owner: String, pet: String, id: String) = transaction { db ->
    val command = db.rawQuery("SELECT payload FROM commands WHERE id=? AND owner=? AND pet=?", arrayOf(id, owner, pet)).use {
      if (it.moveToFirst()) JSONObject(it.getString(0)) else null
    }
    if (command != null) {
      command.remove("error")
      db.execSQL("UPDATE commands SET payload=? WHERE id=? AND owner=? AND pet=?", arrayOf(command.toString(), id, owner, pet))
    }
  }
  @Synchronized fun clearAccount(owner: String) = transaction { db ->
    val next = epoch(db, owner) + 1
    db.execSQL("UPDATE epochs SET epoch=? WHERE owner=?", arrayOf<Any>(next, owner))
    db.execSQL("DELETE FROM drafts WHERE owner=?", arrayOf(owner))
    db.execSQL("DELETE FROM commands WHERE owner=?", arrayOf(owner))
    db.execSQL("INSERT OR IGNORE INTO imports(owner) VALUES(?)", arrayOf(owner))
  }
}
