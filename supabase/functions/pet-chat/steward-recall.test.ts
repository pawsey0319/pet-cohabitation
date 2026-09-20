import assert from "node:assert/strict";
import { generateStewardReply } from "../_shared/petSteward.ts";

for (const scenario of ["expired-placeholder", "first-timeout", "retry-timeout", "stop-before-fallback"]) {
  Deno.test(`steward ${scenario} preserves deadline and truthful outcomes`, async () => {
    const originalNow = Date.now, oldMock = Deno.env.get("MODEL_MOCK_MODE");
    let now = originalNow(), calls = 0, stopped = false;
    Date.now = () => now; Deno.env.set("MODEL_MOCK_MODE", "true");
    const question = "查看合成群之前的消息";
    const client = { from(table: string) {
      const builder: any = {
        select() { return builder; }, eq() { return builder; },
        maybeSingle() { return Promise.resolve({ error: null, data: table === "space_members" ? { joined_at: "join" } : table === "pet_private_threads" ? { id: "source", content: question, reply_error_code: stopped ? "private_request_stopped" : null } : null }); },
        then(resolve: (value: unknown) => void) { resolve({ error: null, data: [{ space_id: "space", joined_at: "join", spaces: { name: "合成群" } }] }); },
      }; return builder;
    } };
    const adapter = { async generatePetReply(input: { deadlineAt?: number }) {
      calls++;
      if (scenario === "first-timeout" || scenario === "retry-timeout" && calls === 2) throw new Error("text_model_timeout");
      if (scenario === "expired-placeholder" || scenario === "stop-before-fallback") now = input.deadlineAt!;
      if (scenario === "stop-before-fallback") stopped = true;
      return { content: "等我先查", concerns_owner: false, risk: "none" };
    } };
    try {
      const run = () => generateStewardReply(client as any, { ownerId: "owner", pet: { id: "pet", name: "合成宠", personality_summary: "" }, content: question, ownerMessageId: "source", thread: [], setReplyStatus: async () => {} }, { adapter: adapter as any, recall: async () => ({ messages: [{ actor: "[群聊回忆·合成群] 合成乙", content: "我负责带三瓶水。" }], sources: [] }) });
      if (scenario === "expired-placeholder") { const result = await run(); assert.match(result.content, /原话摘录/); assert.match(result.content, /合成乙/); assert.equal(calls, 1); }
      else if (scenario === "stop-before-fallback") { await assert.rejects(run, /private_request_stopped/); assert.equal(calls, 1); }
      else { await assert.rejects(run, /text_model_timeout/); assert.equal(calls, scenario === "first-timeout" ? 1 : 2); }
    } finally { Date.now = originalNow; oldMock === undefined ? Deno.env.delete("MODEL_MOCK_MODE") : Deno.env.set("MODEL_MOCK_MODE", oldMock); }
  });
}
