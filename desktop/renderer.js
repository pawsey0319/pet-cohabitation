"use strict";
const api = window.petDesktop, mode = new URLSearchParams(location.search).get("mode") || "controls";
const el = id => document.getElementById(id);
let state = {}, currentImage = null, imageAddress = null, pointer = null, lastOpaque = true, longPress, longPressed = false, errorText = "";
document.body.classList.toggle("pet-mode", mode === "pet");
el(mode).hidden = false;
async function call(method, body) {
  const result = await api[method](body);
  if (!result.ok) throw Error(result.error); return result.value;
}
function error(error) { errorText = error.message; el(mode === "chat" ? "chat-status" : "controls-error").textContent = errorText; }
function update(next) {
  const wasSignedIn = state.signedIn; state = next;
  if (wasSignedIn && !state.signedIn) { el("draft").value = ""; el("password").value = ""; }
  if (mode === "controls") {
    el("login").hidden = !!state.signedIn; el("settings").hidden = !state.signedIn;
    el("pet-name").textContent = state.petName || "异宠";
    el("desktop-status").textContent = state.closing ? "正在退出并清理本机资料…" : !state.enabled ? "桌宠已关闭" : state.hidden ? "已隐藏，可从托盘恢复" : state.locked ? "设备锁定中，桌宠已隐藏" : "桌宠已开启";
    el("start").hidden = !!state.enabled; el("stop").hidden = !state.enabled; el("visibility").hidden = !state.enabled;
    el("visibility").textContent = state.hidden ? "显示桌宠" : "隐藏桌宠";
    el("controls-error").textContent = state.error || errorText;
  } else if (mode === "chat") renderChat();
  else if (mode === "pet" && imageAddress !== state.image) {
    imageAddress = state.image; currentImage = null;
    if (imageAddress) { const image = new Image(); image.onload = () => { if (imageAddress === image.src) currentImage = image; }; image.src = imageAddress; }
  }
}
function renderChat() {
  el("chat-name").textContent = state.petName || "异宠";
  const list = el("messages"), nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 70, oldScroll = list.scrollTop;
  list.replaceChildren(); const existing = new Set((state.lines || []).map(row => row.requestId).filter(Boolean));
  const line = (content, style) => { const item = document.createElement("div"); item.className = `message ${style || ""}`; item.textContent = content; list.appendChild(item); };
  for (const row of state.lines || []) line(row.content, row.role === "owner" ? "owner" : "");
  for (const row of state.pending || []) {
    if (!existing.has(row.id)) line(row.content, "owner pending");
    if (row.state === "failed") {
      const retry = document.createElement("button"); retry.className = "retry"; retry.textContent = `${row.error || "未完成"} · 重试`;
      retry.onclick = () => call("retry", { id: row.id }).catch(error); list.appendChild(retry);
    }
  }
  if (state.partial) line(state.partial, "partial");
  if (state.activeRequest) {
    const stop = document.createElement("button"); stop.className = "quiet"; stop.textContent = "停止当前回答";
    stop.onclick = () => call("stopReply", { id: state.activeRequest }).catch(error); list.appendChild(stop);
  }
  el("chat-status").textContent = state.phase || state.error || errorText;
  list.scrollTop = nearBottom ? list.scrollHeight : oldScroll;
}
el("login").addEventListener("submit", async event => {
  event.preventDefault(); const button = el("login").querySelector("button"); button.disabled = true; errorText = "";
  try { await call("login", { email: el("email").value.trim(), password: el("password").value }); el("password").value = ""; update(await call("state")); }
  catch (failure) { error(failure); } finally { button.disabled = false; }
});
for (const [id, method] of [["start", "start"], ["stop", "stop"], ["logout", "logout"], ["open-app", "openApp"], ["chat-open-app", "openApp"]]) el(id).onclick = async () => {
  const button = el(id); button.disabled = true; errorText = "";
  try { await call(method); update(await call("state")); } catch (failure) { error(failure); } finally { button.disabled = false; }
};
el("visibility").onclick = () => call(state.hidden ? "show" : "hide").then(update).catch(error);
el("composer").addEventListener("submit", async event => {
  event.preventDefault(); const snapshot = el("draft").value.trim(); if (!snapshot) return;
  const id = crypto.randomUUID(); el("draft").value = ""; errorText = "";
  try { await call("send", { id, content: snapshot }); }
  catch (failure) { if (!el("draft").value) el("draft").value = snapshot; else el("draft").value = `${snapshot}\n${el("draft").value}`; error(failure); }
});
el("draft").addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); el("composer").requestSubmit(); } });
const canvas = el("pet"), context = canvas.getContext("2d", { willReadFrequently: true });
function animate(time) {
  if (mode !== "pet") return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (currentImage && !state.locked && !state.hidden && !document.hidden) {
    const width = canvas.width, height = canvas.height, scale = Math.min(width / currentImage.width, height / currentImage.height) * .91;
    const breath = pointer ? 1 : 1 + .011 * Math.sin(time / 850);
    const w = currentImage.width * scale, h = currentImage.height * scale * breath;
    context.drawImage(currentImage, (width - w) / 2, height - h - height * .025, w, h);
  }
  requestAnimationFrame(animate);
}
if (mode === "pet") {
  requestAnimationFrame(animate);
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return; pointer = { screenX: event.screenX, screenY: event.screenY, x: window.screenX, y: window.screenY, moved: false }; longPressed = false;
    canvas.setPointerCapture(event.pointerId); void call("hit", { opaque: true }).catch(() => {});
    longPress = setTimeout(() => { if (pointer && !pointer.moved) { longPressed = true; void call("menu").catch(() => {}); } }, 550);
  });
  canvas.addEventListener("pointermove", event => {
    if (pointer) {
      const dx = event.screenX - pointer.screenX, dy = event.screenY - pointer.screenY;
      if (Math.abs(dx) + Math.abs(dy) > 5) { pointer.moved = true; clearTimeout(longPress); }
      if (pointer.moved) void call("drag", { x: Math.round(pointer.x + dx), y: Math.round(pointer.y + dy) }).catch(() => {});
      return;
    }
    const rect = canvas.getBoundingClientRect(), x = Math.floor((event.clientX - rect.left) / rect.width * canvas.width), y = Math.floor((event.clientY - rect.top) / rect.height * canvas.height);
    const opaque = x >= 0 && y >= 0 && x < canvas.width && y < canvas.height && context.getImageData(x, y, 1, 1).data[3] > 16;
    if (opaque !== lastOpaque) { lastOpaque = opaque; void call("hit", { opaque }).catch(() => {}); }
  });
  canvas.addEventListener("pointerup", () => { clearTimeout(longPress); if (pointer && !pointer.moved && !longPressed) void call("chat").catch(() => {}); pointer = null; });
  canvas.addEventListener("pointercancel", () => { clearTimeout(longPress); pointer = null; });
  canvas.addEventListener("contextmenu", event => { event.preventDefault(); void call("menu").catch(() => {}); });
}
api.subscribe(update); call("state").then(update).catch(error);
