import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Supabase environment is missing");

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = Date.now();
let userId;
let spaceId;

async function waitForRequest(requestId, timeoutMs = 130_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await service.from("agent_requests").select("*").eq("id", requestId).single();
    if (result.error) throw result.error;
    if (["completed", "failed"].includes(result.data.status)) return result.data;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("summary request did not finish");
}

try {
  const email = `summary-diagnostic-${suffix}@example.test`;
  const password = `Summary-pass-${suffix}`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const profile = await service.from("profiles").insert({ id: userId, email, nickname: "摘要诊断用户" });
  if (profile.error) throw profile.error;
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const space = await client.rpc("create_relationship_space", { space_name: "摘要诊断空间", space_kind: "friend_circle" });
  if (space.error) throw space.error;
  spaceId = space.data;
  const membership = await service.from("space_members").select("joined_at").eq("space_id", spaceId).eq("user_id", userId).single();
  if (membership.error) throw membership.error;
  const base = Math.max(Date.now() + 10, Date.parse(membership.data.joined_at) + 10);
  const read = await service.from("space_members").update({ last_read_at: new Date(base - 1).toISOString() }).eq("space_id", spaceId).eq("user_id", userId);
  if (read.error) throw read.error;
  const rows = Array.from({ length: 70 }, (_, index) => ({
    client_id: `summary-diagnostic-${suffix}-${index}`,
    space_id: spaceId,
    sender_id: null,
    actor_kind: "space_agent",
    actor_id: spaceId,
    actor_name: "空间记录",
    kind: "system",
    text: index === 0 ? "开头：小林建议周六下午去公园野餐" : index === 69 ? "结尾：大家决定由小周准备雨天备选地点" : `讨论记录 ${index + 1}：继续确认食物和出发时间`,
    permission_source: "cloud_summary_diagnostic",
    created_at: new Date(base + index).toISOString(),
  }));
  const inserted = await service.from("messages").insert(rows);
  if (inserted.error) throw inserted.error;
  const waitForSnapshot = base + rows.length - Date.now() + 20;
  if (waitForSnapshot > 0) await new Promise((resolve) => setTimeout(resolve, waitForSnapshot));
  const request = await client.rpc("create_agent_request", {
    target_space_id: spaceId,
    request_origin: "space_panel",
    request_text: "最近群里具体聊了什么？",
    request_kind: "read_summary",
    exact_content: null,
    target_pet_id: null,
    request_key: `summary-diagnostic-${suffix}`,
  });
  if (request.error) throw request.error;
  const invoked = await client.functions.invoke("space-agent", { body: { request_id: request.data } });
  if (invoked.error) throw invoked.error;
  const terminal = await waitForRequest(request.data);
  const jobs = await service.from("agent_jobs").select("status,error_code,attempts,created_at,started_at,completed_at").eq("agent_request_id", request.data);
  const runs = await service.from("model_runs").select("run_kind,model,status,error_code,latency_ms,created_at").eq("space_id", spaceId).order("created_at", { ascending: false });
  console.log(JSON.stringify({
    invoke: invoked.data,
    request: { status: terminal.status, review_reason: terminal.review_reason, result: terminal.result },
    jobs: jobs.data,
    model_runs: runs.data,
  }, null, 2));
} finally {
  if (spaceId) await service.from("spaces").delete().eq("id", spaceId);
  if (userId) await service.auth.admin.deleteUser(userId);
}
