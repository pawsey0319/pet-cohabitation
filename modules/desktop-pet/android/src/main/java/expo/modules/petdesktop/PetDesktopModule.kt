package expo.modules.petdesktop

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PetDesktopModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PetDesktop")
    Events("onDesktopPetState")
    OnCreate { PetDesktopService.stateListener = { state -> sendEvent("onDesktopPetState", state) } }
    OnDestroy { PetDesktopService.stateListener = null }
    AsyncFunction("status") { PetDesktopService.status(requireNotNull(appContext.reactContext)) }.runOnQueue(Queues.MAIN)
    AsyncFunction("requestPermission") {
      val context = requireNotNull(appContext.reactContext)
      // This is only called by the explicit Enable button. It does not grant permission.
      val activity = requireNotNull(appContext.currentActivity) { "请在异宠设置中开启桌宠。" }
      activity.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")))
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("start") { ownerId: String, petId: String ->
      val context = requireNotNull(appContext.reactContext)
      require(Build.VERSION.SDK_INT >= 26) { "桌宠需要 Android 8 或更新版本。" }
      require(appContext.currentActivity != null) { "请先打开 App，再手动开启桌宠。" }
      require(Settings.canDrawOverlays(context)) { "请先允许在其他应用上层显示。" }
      require(ownerId.matches(Regex("[a-zA-Z0-9-]{1,80}")) && petId.matches(Regex("[a-zA-Z0-9-]{1,80}"))) { "账号或异宠信息无效。" }
      val intent = Intent(context, PetDesktopService::class.java).setAction(PetDesktopService.START)
        .putExtra("ownerId", ownerId).putExtra("petId", petId)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("hide") { PetDesktopService.instance?.hidePet() }.runOnQueue(Queues.MAIN)
    AsyncFunction("show") { PetDesktopService.instance?.showPet() }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") { ownerId: String? ->
      val context = requireNotNull(appContext.reactContext)
      PetDesktopService.stop(context, ownerId)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("clearAccount") { ownerId: String ->
      val context = requireNotNull(appContext.reactContext)
      PetDesktopService.clearAccount(context, ownerId)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setSize") { size: Int -> PetDesktopService.instance?.setPetSize(size) }.runOnQueue(Queues.MAIN)
    AsyncFunction("pendingCommands") { PetDesktopService.pendingCommands(requireNotNull(appContext.reactContext)).toString() }.runOnQueue(Queues.MAIN)
    AsyncFunction("completeCommand") { id: String, ownerId: String, error: String? ->
      PetDesktopService.completeCommand(requireNotNull(appContext.reactContext), id, ownerId, error)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("applyImage") { ownerId: String, petId: String, url: String, version: String, name: String ->
      PetDesktopService.instance?.applyImage(ownerId, petId, url, version, name)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("publish") { ownerId: String, petId: String, json: String ->
      PetDesktopService.instance?.publish(ownerId, petId, json)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("invalidateImage") { ownerId: String, petId: String ->
      PetDesktopService.instance?.invalidateImage(ownerId, petId)
    }.runOnQueue(Queues.MAIN)
  }
}
