package expo.modules.petdesktop

// Host-only boundary: tests never execute the React Native headless service.
class PetDesktopTaskService : android.app.Service() {
  override fun onBind(intent: android.content.Intent?): android.os.IBinder? = null
}
