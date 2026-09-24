// Test entry only: never packaged. Prevent startup-registration writes while
// exercising the real application and observe its actual tray menu objects.
const path = require("node:path");
const { app, Tray } = require("electron");
if (app.isPackaged || !process.argv.includes("--smoke-test") || !process.env.PET_DESKTOP_TEST_DATA) throw Error("isolated_interaction_test_required");
global.__desktopInteraction = { startupWrites: [], trayMenu: null, trayUpdates: 0, logoutDelayMs: 0 };
const realFetch=global.fetch;
global.fetch=async (...args)=>{
  const response=await realFetch(...args);
  if(String(args[0]).includes("/auth/v1/logout") && global.__desktopInteraction.logoutDelayMs)await new Promise(resolve=>setTimeout(resolve,global.__desktopInteraction.logoutDelayMs));
  return response;
};
app.setLoginItemSettings = value => { global.__desktopInteraction.startupWrites.push(value); };
const setContextMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu) {
  global.__desktopInteraction.trayMenu = menu;
  global.__desktopInteraction.trayUpdates++;
  return setContextMenu.call(this, menu);
};
require(path.resolve(__dirname, "../main.cjs"));
