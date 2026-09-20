import { renderHook, waitFor } from "@testing-library/react-native";
const mockInvoke = jest.fn();
const mockMaybeSingle = jest.fn();
jest.mock("../auth/SessionProvider", () => {
  const session = { profile: { id: "owner" }, isLocalDemo: false };
  return { useSession: () => session };
});
jest.mock("../lib/supabase", () => ({ requireSupabase: () => ({
  functions: { invoke: mockInvoke },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
}) }));
import { useAIProviderHealth } from "../ai/health";
const cached = { text_online: true, image_online: true, status_code: "online", checked_at: "2026-09-01T00:00:00Z" };
beforeEach(() => { jest.clearAllMocks(); mockMaybeSingle.mockResolvedValue({ data: cached, error: null }); });
it("does not reuse an old green database row when the current health request fails", async () => {
  mockInvoke.mockResolvedValue({ data: null, error: new Error("request failed") });
  const { result } = await renderHook(() => useAIProviderHealth());
  await waitFor(() => expect(result.current.checking).toBe(false));
  expect(result.current.health.statusCode).toBe("unknown");
  expect(result.current.health.textOnline).toBe(false);
  expect(mockMaybeSingle).not.toHaveBeenCalled();
});
it("uses the current generation probe and keeps image catalog reachability distinct", async () => {
  mockInvoke.mockResolvedValue({ data: { ...cached, text_online: false, status_code: "partial", text_check: "failed", image_check: "catalog", text_error: "text_model_http_400" }, error: null });
  const { result } = await renderHook(() => useAIProviderHealth());
  await waitFor(() => expect(result.current.checking).toBe(false));
  expect(result.current.health.textOnline).toBe(false);
  expect(result.current.health.textCheck).toBe("failed");
  expect(result.current.health.imageCheck).toBe("catalog");
});
