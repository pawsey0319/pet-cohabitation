import { randomUUID } from "node:crypto";
import { createRequestId } from "../lib/uuid";
import { createPetRepository } from "../data/petRepository";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
const mockChannels: string[] = [];
const mockRemoveChannel = jest.fn().mockResolvedValue("ok");
jest.mock("../lib/supabase", () => ({
  isLocalDemoMode: false,
  requireSupabase: () => ({
    channel: (name: string) => {
      mockChannels.push(name);
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  }),
}));

describe("native request IDs without browser crypto", () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  beforeEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    mockChannels.length = 0;
    mockRemoveChannel.mockClear();
  });
  afterEach(() => {
    if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
    else Reflect.deleteProperty(globalThis, "crypto");
  });
  it("uses Expo's native generator and produces server-compatible UUIDs", () => {
    const generator = jest.spyOn(globalThis.expo, "uuidv4").mockImplementation(randomUUID);
    try {
      const ids = Array.from({ length: 40 }, createRequestId);
      expect(generator).toHaveBeenCalledTimes(40);
      expect(new Set(ids).size).toBe(40);
      ids.forEach((id) => expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
    } finally { generator.mockRestore(); }
  });
  it("mounts two pet subscriptions and releases only the owner's channels", () => {
    const repo = createPetRepository({ id: "owner", email: "test@example.test", nickname: "测试", isAdmin: false });
    const stopA = repo.subscribe(() => undefined);
    const stopB = repo.subscribe(() => undefined);
    expect(mockChannels).toHaveLength(10);
    expect(new Set(mockChannels).size).toBe(10);
    stopB();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(5);
    stopA();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(10);
  });
});
