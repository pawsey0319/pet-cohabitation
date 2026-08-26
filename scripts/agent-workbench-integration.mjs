import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Supabase environment is missing");

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const createdUsers = [];

async function createUser(label) {
  const sequence = createdUsers.length;
  const email = `agent-workbench-${sequence}-${Date.now()}@example.test`;
  const password = `Agent-workbench-${sequence}-${Date.now()}`;
  const auth = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw auth.error;
  createdUsers.push(auth.data.user.id);
  const profile = await service.from("profiles").insert({ id: auth.data.user.id, email, nickname: label });
  if (profile.error) throw profile.error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { id: auth.data.user.id, client };
}

async function main() {
  const owner = await createUser("发起人");
  const memberA = await createUser("成员甲");
  const memberB = await createUser("成员乙");
  const outsider = await createUser("局外人");
  const space = await owner.client.rpc("create_relationship_space", { space_name: "Agent工作台", space_kind: "friend_circle" });
  assert.equal(space.error, null, space.error?.message);
  for (const member of [memberA, memberB]) {
    const joined = await service.from("space_members").insert({ space_id: space.data, user_id: member.id });
    assert.equal(joined.error, null, joined.error?.message);
  }

  const requestKey = crypto.randomUUID();
  const first = await owner.client.rpc("create_agent_request", {
    target_space_id: space.data,
    request_origin: "space_panel",
    request_text: "帮大家制定周末计划",
    request_kind: "group_plan",
    exact_content: null,
    target_pet_id: null,
    request_key: requestKey,
  });
  assert.equal(first.error, null, first.error?.message);
  const duplicate = await owner.client.rpc("create_agent_request", {
    target_space_id: space.data,
    request_origin: "space_panel",
    request_text: "重复提交不应新建",
    request_kind: "group_plan",
    exact_content: null,
    target_pet_id: null,
    request_key: requestKey,
  });
  assert.equal(duplicate.error, null, duplicate.error?.message);
  assert.equal(duplicate.data, first.data, "idempotent request created a second row");

  const outsiderRows = await outsider.client.from("agent_requests").select("id").eq("space_id", space.data);
  assert.equal(outsiderRows.error, null);
  assert.equal(outsiderRows.data.length, 0, "outsider read shared Agent requests");

  const request = await service.from("agent_requests").select("*").eq("id", first.data).single();
  const proposal = await service.from("agent_proposals").insert({
    request_id: request.data.id,
    space_id: space.data,
    created_by: owner.id,
    title: "周末计划",
    proposal_content: { summary: "周六下午见面" },
    member_snapshot: [owner.id, memberA.id, memberB.id],
    affected_user_ids: [memberB.id],
    required_approvals: 2,
  }).select("id").single();
  assert.equal(proposal.error, null, proposal.error?.message);

  const ownerVote = await owner.client.rpc("cast_agent_proposal_vote", { target_proposal_id: proposal.data.id, vote_decision: "approve" });
  assert.equal(ownerVote.error, null, ownerVote.error?.message);
  const memberVote = await memberA.client.rpc("cast_agent_proposal_vote", { target_proposal_id: proposal.data.id, vote_decision: "approve" });
  assert.equal(memberVote.error, null, memberVote.error?.message);
  assert.equal(memberVote.data, "pending", "proposal ignored affected-member confirmation");
  const affectedVote = await memberB.client.rpc("cast_agent_proposal_vote", { target_proposal_id: proposal.data.id, vote_decision: "approve" });
  assert.equal(affectedVote.error, null, affectedVote.error?.message);
  assert.equal(affectedVote.data, "approved");

  console.log(JSON.stringify({ requestBus: "passed", idempotency: "passed", rls: "passed", mixedVoting: "passed" }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const id of createdUsers.reverse()) await service.auth.admin.deleteUser(id).catch(() => undefined);
});
