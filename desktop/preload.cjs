"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const methods = ["state", "login", "logout", "start", "hide", "show", "stop", "resize", "openApp", "send", "retry", "stopReply", "drag", "hit", "chat", "closeChat", "menu"];
const api = Object.fromEntries(methods.map(method => [method, body => ipcRenderer.invoke("desktop-pet", method, body || {})]));
api.subscribe = callback => {
  if (typeof callback !== "function") throw new TypeError("Expected listener");
  const listener = (_event, value) => callback(value); ipcRenderer.on("desktop-state", listener);
  return () => ipcRenderer.removeListener("desktop-state", listener);
};
contextBridge.exposeInMainWorld("petDesktop", Object.freeze(api));
