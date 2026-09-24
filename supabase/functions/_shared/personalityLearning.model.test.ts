import assert from "node:assert/strict";
import { extractLearningCandidates, learningTextModelName, processPetLearningJobs } from "./personalityLearning.ts";
import { TextModelAdapter } from "./modelAdapters.ts";

const claim = {
  job: { id: "job", pet_id: "pet", owner_id: "owner", kind: "style" as const, source_kind: "private" as const, lease_token: "lease" },
  source: { id: "source", content: "别着急，我会认真听你说。", created_at: "2026-09-20T00:00:00Z", speaker_id: "owner" },
  members: [],
};
async function transport(run: (requests: any[]) => Promise<void>) {
  const names = ["MODEL_MOCK_MODE", "TEXT_MODEL", "LEARNING_TEXT_MODEL", "GROUP_TEXT_MODEL", "TEXT_API_BASE_URL", "TEXT_API_KEY"];
  const previous = names.map(name => Deno.env.get(name)), fetch = globalThis.fetch, requests: any[] = [];
  Deno.env.set("MODEL_MOCK_MODE", "false"); Deno.env.set("TEXT_MODEL", "synthetic-general"); Deno.env.delete("LEARNING_TEXT_MODEL");
  Deno.env.set("GROUP_TEXT_MODEL", "synthetic-group"); Deno.env.set("TEXT_API_BASE_URL", "https://synthetic.invalid/v1"); Deno.env.set("TEXT_API_KEY", "synthetic-only");
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://synthetic.invalid/v1/chat/completions");
    const payload = JSON.parse(String(init?.body)); requests.push(payload);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ candidates: [{ trait: "gentle", quote: claim.source.content, confidence: .9 }] }) } }] });
  };
  try { await run(requests); }
  finally { globalThis.fetch = fetch; names.forEach((name, index) => previous[index] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[index]!)); }
}

Deno.test("learning route falls back to TEXT_MODEL rather than selecting group or a fixed version", async () => {
  await transport(async requests => {
    assert.equal(learningTextModelName(), "synthetic-general");
    await extractLearningCandidates(claim);
    Deno.env.set("LEARNING_TEXT_MODEL", "  ");
    await extractLearningCandidates(claim);
    assert.deepEqual(requests.map(row => row.model), ["synthetic-general", "synthetic-general"]);
  });
});

Deno.test("explicit extraction route reaches both schemas without changing the main chat model", async () => {
  await transport(async requests => {
    Deno.env.set("LEARNING_TEXT_MODEL", "  synthetic-learning  ");
    await extractLearningCandidates(claim);
    // The empty member list deliberately rejects generated relationship candidates;
    // transport assertion is separate from source-backed relation behavior tests.
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://synthetic.invalid/v1/chat/completions");
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"candidates":[]}' } }] });
    };
    try { await extractLearningCandidates({ ...claim, job: { ...claim.job, kind: "relationship", source_kind: "space" } }); }
    finally { globalThis.fetch = savedFetch; }
    assert.deepEqual(requests.map(row => row.model), ["synthetic-learning", "synthetic-learning"]);
    assert.equal(TextModelAdapter.modelName(), "synthetic-general");
    assert.equal(Deno.env.get("GROUP_TEXT_MODEL"), "synthetic-group");
  });
});

Deno.test("durable extraction reserves quota under the same configured model used by transport", async () => {
  await transport(async requests => {
    Deno.env.set("LEARNING_TEXT_MODEL", "synthetic-learning");
    let reservation: any, completion: any;
    const query: any = { then(resolve: any) { return Promise.resolve({ data: [{ id: claim.job.id }], error: null }).then(resolve); } };
    for (const method of ["select", "in", "lt", "or", "order", "limit", "eq"]) query[method] = () => query;
    const client: any = {
      from(table: string) {
        if (table === "pet_learning_jobs") return query;
        assert.equal(table, "model_runs");
        return { update(value: any) { completion = value; return { eq: async () => ({ error: null }) }; } };
      },
      async rpc(name: string, input: any) {
        if (name === "claim_pet_learning_job") return { data: claim, error: null };
        if (name === "reserve_model_run") { reservation = input; return { data: "model-run", error: null }; }
        assert.equal(name, "finish_pet_learning_job");
        assert.equal(input.p_candidates[0].trait, "gentle");
        return { data: 1, error: null };
      },
    };
    assert.equal(await processPetLearningJobs(client, { limit: 1 }), 1);
    assert.equal(reservation.target_model, "synthetic-learning");
    assert.equal(reservation.target_model, requests[0].model);
    assert.equal(completion.status, "succeeded");
  });
});
