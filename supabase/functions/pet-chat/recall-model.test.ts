import assert from "node:assert/strict";
import { RECALL_RESPONSE_BUDGET_MS, TextModelAdapter } from "../_shared/modelAdapters.ts";

const input = { petName: "验收宠", personality: "", styleSignals: "", messages: [], currentMessage: "群里确定了什么？", ownerPolicy: "pet_only" as const };
async function withTransport(transport: typeof fetch, run: (adapter: TextModelAdapter) => Promise<void>) {
  const names = ["MODEL_MOCK_MODE", "TEXT_MODEL", "RECALL_TEXT_MODEL", "GROUP_TEXT_MODEL", "TEXT_API_BASE_URL", "TEXT_API_KEY"];
  const old = names.map(name => Deno.env.get(name)); const original = globalThis.fetch;
  ["false", "synthetic-default", "synthetic-recall", "synthetic-group", "https://synthetic.invalid/v1", "synthetic-only"].forEach((value, i) => Deno.env.set(names[i], value));
  globalThis.fetch = transport;
  try { await run(new TextModelAdapter()); }
  finally { globalThis.fetch = original; names.forEach((name, i) => old[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, old[i]!)); }
}

Deno.test("expired recall budget makes no provider request", async () => {
  let calls = 0;
  await withTransport(async () => { calls++; return Response.json({}); }, async adapter => {
    assert.equal(RECALL_RESPONSE_BUDGET_MS, 45_000);
    await assert.rejects(() => adapter.generatePetReply({ ...input, deadlineAt: Date.now() - 1 }), /text_model_timeout/);
    assert.equal(calls, 0);
  });
});

Deno.test("transport retry cannot restart the shared recall budget", async () => {
  let calls = 0;
  await withTransport(async (_url, init) => {
    calls++;
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal!;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }, async adapter => {
    const started = performance.now();
    await assert.rejects(() => adapter.generatePetReply({ ...input, deadlineAt: Date.now() + 35 }), /text_model_timeout/);
    assert.equal(calls, 1);
    assert.ok(performance.now() - started < 1500);
  });
});

Deno.test("HTTP retry backoff also ends at the absolute budget", async () => {
  let calls = 0;
  await withTransport(async () => { calls++; return new Response("temporary", { status: 503 }); }, async adapter => {
    await assert.rejects(() => adapter.generatePetReply({ ...input, deadlineAt: Date.now() + 35 }), /text_model_timeout/);
    assert.equal(calls, 1);
  });
});

Deno.test("slow response body is reported as timeout instead of unknown failure", async () => {
  await withTransport(async () => {
    const response = Response.json({});
    response.json = () => Promise.reject(new DOMException("body timeout", "AbortError"));
    return response;
  }, async adapter => {
    await assert.rejects(() => adapter.generatePetReply({ ...input, deadlineAt: Date.now() + 1000 }), /text_model_timeout/);
  });
});

Deno.test("structured repair consumes the same remaining budget", async () => {
  let calls = 0;
  await withTransport(async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json({ choices: [{ finish_reason: "length", message: { content: '{"content":"partial"}' } }] });
    return await new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
  }, async adapter => {
    await assert.rejects(() => adapter.generatePetReply({ ...input, deadlineAt: Date.now() + 50 }), /text_model_timeout/);
    assert.equal(calls, 2);
  });
});

Deno.test("error headers followed by a stalled body retain timeout classification", async () => {
  await withTransport(async () => {
    const response = new Response("", { status: 400 });
    response.clone = () => { const copy = new Response(); copy.json = () => Promise.reject(new DOMException("error body timeout", "TimeoutError")); return copy; };
    return response;
  }, async adapter => {
    await assert.rejects(() => adapter.generatePetReply({ ...input, deadlineAt: Date.now() + 1000 }), /text_model_timeout/);
  });
});

Deno.test("recall gets its whole remaining budget while default requests retain 30 seconds", async () => {
  const original = AbortSignal.timeout, timeouts: number[] = [];
  AbortSignal.timeout = (milliseconds: number) => { timeouts.push(milliseconds); return new AbortController().signal; };
  try {
    await withTransport(async () => Response.json({ choices: [{ message: { content: '{"content":"尚未决定。"}' }, finish_reason: "stop" }] }), async adapter => {
      await adapter.generatePetReply({ ...input, deadlineAt: Date.now() + 45_000 });
      await adapter.generatePetReply(input);
      assert.ok(timeouts[0] > 44_000 && timeouts[0] <= 45_000);
      assert.equal(timeouts[1], 30_000);
    });
  } finally { AbortSignal.timeout = original; }
});

Deno.test("recall model override and coverage do not change other request defaults", async () => {
  const bodies: any[] = [];
  await withTransport(async (_url, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    return Response.json({ choices: [{ message: { content: '{"content":"尚未决定。"}' }, finish_reason: "stop" }] });
  }, async adapter => {
    await adapter.generatePetReply({ ...input, model: TextModelAdapter.recallModelName(), coverageNote: "使用最近 24 条，未覆盖更早消息。" });
    await adapter.generatePetReply(input);
    assert.deepEqual(bodies.map(body => body.model), ["synthetic-recall", "synthetic-default"]);
    assert.match(bodies[0].messages[0].content, /使用最近 24 条/);
    assert.match(bodies[0].messages[0].content, /不将讨论说成已经执行/);
    Deno.env.delete("RECALL_TEXT_MODEL"); assert.equal(TextModelAdapter.recallModelName(), "synthetic-default");
    assert.equal(Deno.env.get("GROUP_TEXT_MODEL"), "synthetic-group");
  });
});
