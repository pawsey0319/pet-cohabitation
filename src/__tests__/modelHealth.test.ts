jest.mock("npm:zod@4", () => require("zod"), { virtual: true });
const mockRun = jest.fn(async (..._args: unknown[]) => "run-1");
const mockFinish = jest.fn(async (..._args: unknown[]) => undefined);
const mockWrite = jest.fn(async () => ({ error: null }));
jest.mock("../../supabase/functions/_shared/quota", () => ({ reserveModelRun: (...args: unknown[]) => mockRun(...args), finishModelRun: (...args: unknown[]) => mockFinish(...args) }));
jest.mock("../../supabase/functions/_shared/supabase", () => ({
  authenticatedUser: async () => ({ id: "test-owner" }), requirePost: () => undefined,
  serviceClient: () => ({ from: () => ({ upsert: mockWrite }) }),
}));
const globals = globalThis as typeof globalThis & { Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void } };
const originalDeno = globals.Deno;
const originalFetch = globalThis.fetch;
let handler: (request: Request) => Promise<Response>;
let textSucceeds = false;
beforeAll(() => {
  const env: Record<string, string> = { TEXT_API_BASE_URL: "https://test.invalid/v1", IMAGE_API_BASE_URL: "https://test.invalid/v1", TEXT_API_KEY: "synthetic", IMAGE_API_KEY: "synthetic", TEXT_MODEL: "test-text", IMAGE_MODEL: "test-image" };
  globals.Deno = { env: { get: (name) => env[name] }, serve: (next) => { handler = next; } };
  require("../../supabase/functions/model-health/index");
});
beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn(async (_url, init) => init?.method === "POST"
    ? textSucceeds
      ? new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }))
      : new Response(JSON.stringify({ error: { type: "MissingSessionID" } }), { status: 400 })
    : new Response(JSON.stringify({ data: [{ id: "test-image" }] })));
});
afterAll(() => { globals.Deno = originalDeno; globalThis.fetch = originalFetch; });
it("catalog HTTP 200 cannot make a rejected text generation look usable", async () => {
  textSucceeds = false;
  const payload = await (await handler(new Request("https://app.invalid", { method: "POST" }))).json();
  expect(payload).toMatchObject({ text_online: false, image_online: true, text_check: "failed", image_check: "catalog", status_code: "partial", text_error: "text_model_provider_session_required" });
});
it("reports structured text success while keeping image generation unverified", async () => {
  textSucceeds = true;
  const payload = await (await handler(new Request("https://app.invalid", { method: "POST" }))).json();
  expect(payload).toMatchObject({ text_online: true, text_check: "generation", image_check: "catalog" });
  expect(mockRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ runKind: "text_health_check", ownerId: "test-owner", dailyLimit: 30 }));
});
