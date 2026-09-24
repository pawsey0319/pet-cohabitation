package expo.modules.petdesktop

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Short-lived task service. Its wake lock ends with the task, independently of the overlay. */
class PetDesktopTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    if (PetDesktopService.instance == null) return null
    return HeadlessJsTaskConfig("PetDesktopRuntime", Arguments.createMap(), 180_000L, true)
  }
}
