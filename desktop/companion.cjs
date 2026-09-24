"use strict";
const { EventEmitter } = require("node:events");
const { approvedImage, upsertRequest } = require("./contracts.cjs");

class DesktopCompanion extends EventEmitter {
  constructor(client, config, store) {
    super(); this.client = client; this.config = config; this.store = store;
    this.owner = null; this.pet = null; this.lines = []; this.queue = []; this.partial = ""; this.phase = ""; this.error = null;
    this.epoch = 0; this.draining = null; this.active = null; this.channels = []; this.refreshTimer = null; this.mutations = Promise.resolve(); this.closing = false;
    client.auth.onAuthStateChange((_event, session) => {
      if (this.owner && session?.user.id !== this.owner) { this.reset(); this.emit("account-cleared"); }
    });
  }
  snapshot() { return { signedIn: !!this.owner, closing: this.closing, petName: this.pet?.name || "异宠", lines: this.lines, pending: this.queue, partial: this.partial, phase: this.phase, error: this.error, activeRequest: this.active?.id || null }; }
  changed() { this.emit("state", this.snapshot()); }
  reset() {
    this.epoch++; this.active?.controller.abort("account_changed"); this.active = null;
    this.owner = null; this.pet = null; this.lines = []; this.queue = []; this.partial = ""; this.phase = ""; this.error = null;
    clearTimeout(this.refreshTimer); for (const channel of this.channels) void this.client.removeChannel(channel); this.channels = [];
    this.changed();
  }
  async init() {
    const { data } = await this.client.auth.getSession();
    if (data.session) await this.adopt(data.session.user.id);
    return this.snapshot();
  }
  async login(email, password) {
    if(this.closing)throw Error("正在退出，请稍后重新登录。");
    const result = await this.client.auth.signInWithPassword({ email, password });
    if (result.error) throw Error("登录失败，请检查账号密码和网络。");
    await this.adopt(result.data.user.id); return this.snapshot();
  }
  async adopt(owner) {
    this.reset(); this.owner = owner;
    const epoch = this.epoch;
    const saved = await this.store.getItem(`queue:${owner}`);
    if (this.epoch !== epoch) return;
    try { this.queue = JSON.parse(saved || "[]").slice(0, 50).map(row => ({ ...row, state: row.state === "sending" ? "failed" : row.state, error: row.state === "sending" ? "上次连接中断，可沿用原请求重试。" : row.error })); }
    catch { this.queue = []; }
    this.changed();
  }
  async logout() {
    const owner = this.owner;
    this.closing=true;this.epoch++;this.active?.controller.abort("account_changed");this.partial="";this.phase="正在退出并清理本机资料";this.changed();
    try {
      // Drain any already-started encrypted writes before deleting their data.
      // Do not publish signed-out UI until the SDK has removed persisted auth.
      await this.mutations.catch(()=>{});
      if (owner) { await this.store.removeItem(`queue:${owner}`); await this.store.removeItem(`placement:${owner}`); }
      const result=await this.client.auth.signOut({ scope: "local" });
      const remaining=(await this.client.auth.getSession()).data.session;
      if(remaining)throw Error("退出未完成，请检查网络或本机存储后重试。");
      this.reset();this.emit("account-cleared");
      if(result.error)throw Error("本机已退出，云端会话撤销暂未确认。");
    } finally {this.closing=false;this.changed();}
  }
  async guard(epoch = this.epoch, owner = this.owner) {
    const session = (await this.client.auth.getSession()).data.session;
    if (this.closing || !owner || this.epoch !== epoch || this.owner !== owner || session?.user.id !== owner) throw Error("account_changed");
    return session;
  }
  async loadPet() {
    const epoch = this.epoch, owner = this.owner; await this.guard(epoch, owner);
    const { data, error } = await this.client.rpc("get_my_pet_dashboard");
    await this.guard(epoch, owner);
    if (error || data?.pet?.owner_id !== owner || data?.pet?.status !== "confirmed" || !data.current_asset?.id) throw Error("请先在 App 中确认异宠形象。");
    this.pet = data.pet;
    this.sourceAssetId = data.current_asset.id;
    const display = await this.client.functions.invoke("pet-display", { body: { action: "status", pet_id: this.pet.id } });
    await this.guard(epoch, owner);
    if (display.error || display.data?.error) throw Error("暂时无法读取透明形象，请稍后重试。");
    const imageUrl = approvedImage(display.data, data.current_asset.id, this.config.supabaseUrl);
    this.displayVersion = display.data.preference.version;
    this.approvedJob = display.data.job.id;
    await this.refresh(); this.subscribe(); return { imageUrl, owner, epoch };
  }
  async refresh() {
    if (!this.pet) return;
    const epoch = this.epoch, owner = this.owner, petId = this.pet.id;
    const result = await this.client.rpc("list_pet_private_history", { p_pet: petId, p_before_at: null, p_before_id: null, p_limit: 50 });
    await this.guard(epoch, owner);
    if (result.error) throw Error("暂时无法同步会话。");
    this.lines = (result.data || []).filter(row => row.conversation_kind === "companion").reverse().map(row => ({ id: row.id, role: row.role, content: row.content, requestId: row.request_key }));
    this.changed();
  }
  subscribe() {
    if (this.channels.length) return;
    const owner = this.owner, petId = this.pet.id;
    const channel = this.client.channel(`desktop-companion:${owner}`).on("postgres_changes", { event: "*", schema: "public", table: "pet_private_threads", filter: `pet_id=eq.${petId}` }, () => {
      clearTimeout(this.refreshTimer); this.refreshTimer = setTimeout(() => void this.refresh().catch(() => {}), 150);
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "pet_private_streams", filter: `owner_id=eq.${owner}` }, payload => {
      if (payload.new.request_id === this.active?.id && ["invalidated", "cancelled"].includes(payload.new.status)) {
        this.partial = ""; this.active.controller.abort(payload.new.status === "cancelled" ? "private_request_stopped" : "companion_context_changed"); this.changed();
      }
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "pets", filter: `id=eq.${petId}` }, payload => {
      if (payload.new.current_asset_id !== this.sourceAssetId) this.emit("asset-invalidated");
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "pet_display_preferences", filter: `pet_id=eq.${petId}` }, payload => {
      if (payload.new.version !== this.displayVersion || !payload.new.use_transparent || payload.new.approved_job_id !== this.approvedJob) this.emit("asset-invalidated");
    }).subscribe(); this.channels.push(channel);
  }
  mutate(operation) {
    const pending = this.mutations.catch(() => {}).then(operation); this.mutations = pending; return pending;
  }
  async saveQueue(owner, epoch) { await this.guard(epoch, owner); await this.store.setItem(`queue:${owner}`, JSON.stringify(this.queue)); await this.guard(epoch, owner); this.changed(); }
  async send(body) {
    const owner = this.owner, epoch = this.epoch;
    await this.mutate(async () => { await this.guard(epoch, owner); this.queue = upsertRequest(this.queue, body); await this.saveQueue(owner, epoch); });
    void this.drain(); return { accepted: true };
  }
  async retry(id) {
    const owner = this.owner, epoch = this.epoch;
    await this.mutate(async () => { await this.guard(epoch, owner); const row = this.queue.find(value => value.id === id); if (!row) throw Error("这条消息已处理。"); row.state = "queued"; row.error = null; await this.saveQueue(owner, epoch); });
    void this.drain(); return { accepted: true };
  }
  async stopReply(id) {
    const epoch = this.epoch, owner = this.owner; await this.guard(epoch, owner);
    const result = await this.client.rpc("stop_pet_private_reply", { p_pet: this.pet.id, p_request: id });
    await this.guard(epoch, owner); if (result.error) throw Error("暂时无法停止，请重试。");
    if (this.active?.id === id) this.active.controller.abort("private_request_stopped");
    this.partial = ""; this.phase = "已停止回答，已经创建的事项仍然保留。"; this.changed(); return { stopped: true };
  }
  drain() {
    if (this.draining) return this.draining;
    const owner = this.owner, epoch = this.epoch;
    this.draining = (async () => {
      while (this.owner === owner && this.epoch === epoch) {
        const row = this.queue.find(value => value.state === "queued"); if (!row) break;
        const controller = new AbortController(); this.active = { id: row.id, controller }; this.partial = ""; this.phase = "正在回应";
        await this.mutate(async () => { row.state = "sending"; await this.saveQueue(owner, epoch); });
        try {
          if (!this.pet) { const pet = await this.client.rpc("get_my_pet_dashboard"); await this.guard(epoch, owner); if (pet.error || pet.data?.pet?.owner_id !== owner) throw Error("异宠暂时不可用。"); this.pet = pet.data.pet; this.subscribe(); }
          await this.request(row, controller, owner, epoch);
          await this.mutate(async () => { await this.guard(epoch, owner); this.queue = this.queue.filter(item => item.id !== row.id); await this.saveQueue(owner, epoch); });
          this.phase = ""; await this.refresh();
        } catch (failure) {
          if (this.epoch !== epoch) return;
          this.partial = ""; const code = controller.signal.aborted ? controller.signal.reason : failure.message;
          await this.mutate(async () => { row.state = "failed"; row.error = friendlyError(code); await this.saveQueue(owner, epoch); });
          this.phase = row.error;
        } finally { if (this.active?.id === row.id) this.active = null; this.partial = ""; this.changed(); }
      }
    })().catch(error => { if (this.epoch === epoch) { this.error = friendlyError(error.message); this.changed(); } }).finally(() => { this.draining = null; });
    return this.draining;
  }
  async request(row, controller, owner, epoch) {
    const session = await this.guard(epoch, owner), transport = new AbortController();
    const stop = () => transport.abort(controller.signal.reason); controller.signal.addEventListener("abort", stop, { once: true });
    let revision; const timeout = setTimeout(() => transport.abort("private_stream_timeout"), 120_000);
    try {
      const response = await fetch(`${this.config.supabaseUrl}/functions/v1/pet-chat`, { method: "POST", headers: { "Content-Type": "application/json", apikey: this.config.publishableKey, Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ content: row.content, request_id: row.id, mode: "companion", stream: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }), signal: transport.signal });
      if (!response.ok) { const value = await response.json().catch(() => ({})); const error = Error(value.error || "private_reply_failed"); error.business = response.status < 500; throw error; }
      if (!response.headers.get("content-type")?.includes("text/event-stream")) throw Error("private_stream_unsupported");
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true }); if (buffer.length > 64000) throw Error("private_stream_invalid");
          let index;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index).trimEnd(); buffer = buffer.slice(index + 1); if (!line.startsWith("data:")) continue;
            const event = JSON.parse(line.slice(5)); await this.guard(epoch, owner); if (controller.signal.aborted) throw Error(controller.signal.reason);
            if (event.type === "accepted") revision = event.revision;
            if (event.type === "text") { this.partial = String(event.content || "").slice(0, 30000); this.changed(); }
            if (event.type === "phase") { this.phase = event.phase === "confirming" ? "正在核实回复" : "正在回应"; this.changed(); }
            if (event.type === "error") { const error = Error(event.error); error.business = true; throw error; }
            if (event.type === "done" && event.message) {
              // Even a terminal stream result is re-read under current source/revision guards.
              await this.recover(row.id, revision, controller.signal, owner, epoch); return;
            }
          }
        }
        throw Error("private_stream_interrupted");
      } finally { await reader.cancel().catch(() => {}); }
    } catch (error) {
      if (controller.signal.aborted || error.business) throw error;
      this.partial = ""; this.phase = "连接中断，正在核对原请求"; this.changed();
      await this.recover(row.id, revision, controller.signal, owner, epoch);
    } finally { clearTimeout(timeout); controller.signal.removeEventListener("abort", stop); }
  }
  async recover(id, revision, signal, owner, epoch) {
    const deadline = Date.now() + 22_000;
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort("private_reply_confirmation_pending"), 22_000);
    signal = AbortSignal.any([signal, timeout.signal]);
    const read = async query => {
      if (signal.aborted) throw Error(signal.reason); const result = await query.abortSignal(signal); await this.guard(epoch, owner);
      if (signal.aborted) throw Error(signal.reason); if (result.error) throw Error("private_reply_confirmation_unavailable"); return result.data;
    };
    try { while (Date.now() < deadline) {
      await this.guard(epoch, owner);
      const request = await read(this.client.from("pet_private_requests").select("pet_id,owner_message_id,reply_message_id").eq("owner_id", owner).eq("client_request_id", id).maybeSingle());
      if (!request) throw Error("private_reply_confirmation_pending");
      const source = await read(this.client.from("pet_private_threads").select("id,created_at,conversation_kind,reply_status,reply_error_code").eq("owner_id", owner).eq("pet_id", request.pet_id).eq("id", request.owner_message_id).eq("request_key", id).eq("role", "owner").maybeSingle());
      if (!source || source.conversation_kind !== "companion") throw Error("private_reply_confirmation_unavailable");
      const reply = request.reply_message_id ? await read(this.client.from("pet_private_threads").select("*").eq("owner_id", owner).eq("pet_id", request.pet_id).eq("id", request.reply_message_id).eq("in_reply_to_id", source.id).eq("role", "pet").eq("conversation_kind", "companion").maybeSingle()) : null;
      const ids = [source.id, ...(reply ? [reply.id, ...(reply.context_message_ids || [])] : [])];
      const [state, stream, cancelled, excluded] = await Promise.all([
        read(this.client.from("pet_companion_states").select("revision,context_started_at").eq("owner_id", owner).eq("pet_id", request.pet_id).maybeSingle()),
        read(this.client.from("pet_private_streams").select("revision,status").eq("owner_id", owner).eq("pet_id", request.pet_id).eq("request_id", id).maybeSingle()),
        read(this.client.from("pet_private_cancellations").select("request_id").eq("owner_id", owner).eq("pet_id", request.pet_id).eq("request_id", id).maybeSingle()),
        read(this.client.from("pet_private_context_exclusions").select("message_id").eq("owner_id", owner).eq("pet_id", request.pet_id).in("message_id", ids)),
      ]);
      if (cancelled || stream?.status === "cancelled") throw Error("private_request_stopped");
      if (excluded?.length) throw Error("private_request_excluded");
      const expected = revision ?? stream?.revision;
      if (!Number.isSafeInteger(expected) || stream?.status === "invalidated" || (state?.revision ?? 0) !== expected || stream && stream.revision !== expected) throw Error("companion_context_changed");
      if (state?.context_started_at && Date.parse(source.created_at) <= Date.parse(state.context_started_at)) throw Error("private_request_topic_changed");
      if (reply) return reply;
      if (source.reply_status === "failed") throw Error(source.reply_error_code || "private_reply_failed");
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw Error("private_reply_confirmation_pending");
    } catch (error) { error.business = true; throw error; }
    finally { clearTimeout(timer); }
  }
}
function friendlyError(code) {
  if (code === "account_changed") return "账号已切换，请重新登录。";
  if (code === "private_request_stopped") return "已停止回答，已创建的事项仍然保留。";
  if (["companion_context_changed", "private_request_excluded", "private_request_topic_changed"].includes(code)) return "记忆或话题已经更新，旧内容已撤下；请查看 App 后重试。";
  if (/^[a-z_0-9]+$/.test(code || "")) return "回应暂时中断，消息已保存在本机，可沿用原请求重试。";
  return String(code || "暂时无法连接，请稍后重试。").slice(0, 300);
}
module.exports = { DesktopCompanion, friendlyError };
