jest.mock("npm:zod@4", () => require("zod"), { virtual: true });

const { TextModelAdapter } = require("../../supabase/functions/_shared/modelAdapters");
const fetchBefore = globalThis.fetch;
const globals = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
const denoBefore = globals.Deno;
const fetchMock = jest.fn();
const digest = { topics: ["周六去公园野餐"], decisions: [], todos: [], schedules: [], pending: [], source_message_ids: ["message-1"] };
const wireDigest = { ...digest, source_message_ids: ["m1"] };
const input = { messages: [{ id: "message-1", actor: "小林", content: "周六去公园野餐", createdAt: "2026-09-03T03:00:00Z" }] };

function response(content: string, finishReason = "stop") {
  return { ok: true, json: async () => ({ choices: [{ finish_reason: finishReason, message: { content } }] }) };
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  const env: Record<string, string> = { MODEL_MOCK_MODE: "false", TEXT_API_BASE_URL: "https://provider.example.test/v1", TEXT_API_KEY: "test-key", TEXT_MODEL: "test-model" };
  globals.Deno = { env: { get: (name) => env[name] } };
});

afterAll(() => {
  globalThis.fetch = fetchBefore;
  if (denoBefore) globals.Deno = denoBefore;
  else delete globals.Deno;
});

it("retries a truncated digest once with a larger budget and original context", async () => {
  fetchMock.mockResolvedValueOnce(response('{"topics":["半截结果"],"source_message_ids":[', "length"));
  fetchMock.mockResolvedValueOnce(response(JSON.stringify(wireDigest)));
  expect(await new TextModelAdapter().summarizeSpace(input)).toEqual(digest);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  const retry = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(first.max_tokens).toBe(4096);
  expect(retry.max_tokens).toBe(8192);
  expect(retry.messages[1]).toEqual(first.messages[1]);
  expect(retry.messages.some((message: { content: string }) => message.content.includes("半截结果"))).toBe(false);
});

it("selects the schema-valid object rather than a preamble array or unrelated object", async () => {
  fetchMock.mockResolvedValueOnce(response(`[] {"unrelated":true} ${JSON.stringify(wireDigest)}`));
  expect(await new TextModelAdapter().summarizeSpace(input)).toEqual(digest);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("fails closed after two invalid structures without returning an empty summary", async () => {
  fetchMock.mockResolvedValue(response('{"unrelated":"not-a-summary"}'));
  await expect(new TextModelAdapter().summarizeSpace(input)).rejects.toThrow("text_model_invalid_structure");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not retry content-filtered output", async () => {
  fetchMock.mockResolvedValueOnce(response("", "content_filter"));
  await expect(new TextModelAdapter().summarizeSpace(input)).rejects.toThrow("text_model_content_blocked");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("maps compact source aliases and discards invented message ids", async () => {
  fetchMock.mockResolvedValueOnce(response(JSON.stringify({ ...wireDigest, source_message_ids: ["m1", "invented", "m1"] })));
  expect((await new TextModelAdapter().summarizeSpace(input)).source_message_ids).toEqual(["message-1"]);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content).toContain("[m1]");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content).not.toContain("message-1");
});

it("merges source provenance on the server instead of asking the model to reproduce UUIDs", async () => {
  fetchMock.mockResolvedValueOnce(response(JSON.stringify({ ...digest, source_message_ids: ["invented"] })));
  const result = await new TextModelAdapter().mergeSpaceDigests({ chunks: [digest, { ...digest, source_message_ids: ["message-2"] }] });
  expect(result.source_message_ids).toEqual(["message-1", "message-2"]);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content).not.toContain("source_message_ids");
});
