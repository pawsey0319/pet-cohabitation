import { act, renderHook, waitFor } from "@testing-library/react-native";
import { usePersonality } from "../usePersonality";
const mockRequest = jest.fn(); let mockId = 0;
jest.mock("../client", () => ({ personalityRequest: (...args: unknown[]) => mockRequest(...args), personalityError: () => "修改尚未确认" }));
jest.mock("../../lib/uuid", () => ({ createRequestId: () => `request-${++mockId}` }));
const snapshot = { state: { revision: 3, paused: false }, evidence: [], history: [], relationships: [], jobs: [], page: 0, page_size: 30 };
beforeEach(() => { mockRequest.mockReset(); mockId = 0; });
test("ambiguous mutation retries keep request id and expected revision", async () => {
  mockRequest.mockImplementation(async (_owner, body) => { if (body.action === "state") return snapshot; throw new Error("timeout"); });
  const { result } = await renderHook(() => usePersonality("owner")); await waitFor(() => expect(result.current.data).not.toBeNull());
  await act(async () => { expect(await result.current.mutate("pause")).toBe(false); });
  await act(async () => { expect(await result.current.mutate("pause")).toBe(false); });
  const calls = mockRequest.mock.calls.filter(call => call[1].action === "pause");
  expect(calls[0][1]).toEqual({ action: "pause", expected_revision: 3, request_id: "request-1" }); expect(calls[1][1]).toEqual(calls[0][1]);
  expect(result.current.data?.state.paused).toBe(false);
});
test("confirmed changes reload authoritative state rather than inventing a successful local state", async () => {
  let paused = false;
  mockRequest.mockImplementation(async (_owner, body) => { if (body.action === "pause") { paused = true; return { revision: 4 }; } return { ...snapshot, state: { revision: paused ? 4 : 3, paused } }; });
  const { result } = await renderHook(() => usePersonality("owner")); await waitFor(() => expect(result.current.data).not.toBeNull());
  await act(async () => { expect(await result.current.mutate("pause")).toBe(true); });
  expect(result.current.data?.state).toEqual({ revision: 4, paused: true });
});
