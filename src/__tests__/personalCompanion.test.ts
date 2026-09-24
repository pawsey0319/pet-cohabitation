jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../lib/supabase", () => ({ isLocalDemoMode: true }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createPetRepository, localPetStorageKey } from "../data/petRepository";
import { localDataKeys } from "../data/localData";
import { currentPrivateMessages, privateContinuation, validatePersonalMemory } from "../pets/companion";
import { buildPrivateCompanionMessages, requestsSpaceRecall } from "../../supabase/functions/_shared/privateCompanion";
import type { PetPrivateMessage } from "../data/types";

const profile = { id: "alice", email: "alice@example.test", nickname: "Alice" };
const message = (id: string, role: "owner" | "pet", content: string, time: string): PetPrivateMessage => ({ id, role, content, createdAt: time });
beforeEach(async () => { await AsyncStorage.clear(); });

test("personal memory questions and social feelings do not request group recall", () => {
  expect(requestsSpaceRecall("你记得我的偏好吗", ["朋友小窝"])).toBe(false);
  expect(requestsSpaceRecall("我最近害怕在人群里说话", ["朋友小窝"])).toBe(false);
  expect(requestsSpaceRecall("我在朋友小窝上次聊过什么", ["朋友小窝"])).toBe(true);
  expect(requestsSpaceRecall("你记得上次群聊的讨论吗", ["朋友小窝"])).toBe(true);
});

test("manual memory changes preserve continuity and history; removal excludes linked sources", async () => {
  const repo = createPetRepository(profile);
  await repo.createPet("芽芽");
  for (let i = 0; i < 6; i++) await repo.chat(`第${i}件事`);
  await repo.chat("我喜欢咖啡");
  const source = (await repo.listPrivateMessages()).at(-2)!;
  await repo.savePersonalMemory({ content: "我喜欢咖啡", sourceMessageId: source.id });
  const memory = (await repo.getCompanionContext()).memories[0];
  expect((await repo.chat("你还记得我的偏好吗")).content).toContain("咖啡");
  await repo.savePersonalMemory({ id: memory.id, content: "我现在喜欢茶" });
  const context = await repo.getCompanionContext();
  expect(context.contextStartedAt).toBeNull();
  expect(currentPrivateMessages(await repo.listPrivateMessages(), context.contextStartedAt).length).toBeGreaterThan(0);
  expect(context.memories[0].content).toBe("我现在喜欢茶");
  expect(context.manualHistory?.[0].content).toBe("我喜欢咖啡");
  await repo.startNewConversation();
  expect((await repo.getCompanionContext()).memories).toHaveLength(1);
  expect((await repo.chat("接着刚才说")).content).toContain("还没有可以接续");
  await repo.removePersonalMemory(memory.id);
  expect((await repo.getCompanionContext()).memories).toHaveLength(0);
  expect((await repo.getCompanionContext()).excludedMessageIds).toContain(source.id);
  expect((await repo.listPrivateMessages()).some((item) => item.id === source.id)).toBe(true);
});

test("pet stores and local exports cannot pick up another profile's private memories", async () => {
  const repo = createPetRepository(profile);
  await repo.createPet("芽芽");
  await repo.savePersonalMemory({ content: "Alice secret" });
  const raw = (await AsyncStorage.getItem(localPetStorageKey("alice")))!;
  await AsyncStorage.setItem("pet-cohabitation-local-pet-v2", raw);
  const bob = createPetRepository({ ...profile, id: "bob" });
  expect(await bob.getPet()).toBeNull();
  expect((await bob.getCompanionContext()).memories).toHaveLength(0);
  await bob.createPet("另一只");
  await bob.savePersonalMemory({ content: "Bob secret" });
  expect((await repo.getCompanionContext()).memories[0].content).toBe("Alice secret");
  expect(await localDataKeys("bob")).toEqual([localPetStorageKey("bob")]);
  expect(await localDataKeys("alice")).not.toContain(localPetStorageKey("bob"));
});

test("memory sources, Unicode length and capacity are validated, and capacity recovers after removal", async () => {
  const repo = createPetRepository(profile);
  await repo.createPet("芽芽");
  const petReply = await repo.chat("hello");
  await expect(repo.savePersonalMemory({ content: "invalid", sourceMessageId: petReply.id })).rejects.toThrow("自己");
  await expect(repo.savePersonalMemory({ content: "invalid", sourceMessageId: "group-message-id" })).rejects.toThrow("自己");
  expect(validatePersonalMemory("😀".repeat(400))).toHaveLength(800);
  expect(() => validatePersonalMemory("😀".repeat(401))).toThrow("400");
  for (let i = 0; i < 20; i++) await repo.savePersonalMemory({ content: `Memory ${i}` });
  await expect(repo.savePersonalMemory({ content: "one too many" })).rejects.toThrow("20");
  const first = (await repo.getCompanionContext()).memories[0];
  await repo.savePersonalMemory({ id: first.id, content: "editable while full" });
  await repo.removePersonalMemory(first.id);
  await repo.savePersonalMemory({ content: "available again" });
  expect((await repo.getCompanionContext()).memories).toHaveLength(20);
});

test("tight consecutive turns keep unique IDs and all history beyond the model window", async () => {
  const repo = createPetRepository(profile); await repo.createPet("芽芽");
  for (let i = 0; i < 24; i++) await repo.chat(`message ${i}`);
  const messages = await repo.listPrivateMessages();
  expect(messages).toHaveLength(48);
  expect(new Set(messages.map((item) => item.id)).size).toBe(48);
  expect(messages.at(-1)?.content).not.toContain("聊了五次");
});

test("reunion uses a real owner quote, skips acknowledgements and uses the last interaction for its clock", () => {
  const messages = [message("1", "owner", "明天我要去面试", "2026-09-06T08:00:00Z"), message("2", "pet", "我会一直等你", "2026-09-06T08:01:00Z"), message("3", "owner", "嗯", "2026-09-07T07:59:00Z")];
  const result = privateContinuation(messages, null, Date.parse("2026-09-07T08:00:00Z"));
  expect(result?.message.id).toBe("1"); expect(result?.isReunion).toBe(false);
  expect(privateContinuation(messages.slice(0, 2), null, Date.parse("2026-09-07T08:00:00Z"))?.isReunion).toBe(true);
  expect(privateContinuation(messages, "2026-09-07T08:00:00Z", Date.parse("2026-09-07T08:01:00Z"))).toBeNull();
  expect(privateContinuation([messages[1]], null, Date.parse("2026-09-07T08:00:00Z"))).toBeNull();
});

test("the UI respects PostgreSQL's sub-millisecond reset boundary", () => {
  const messages = [message("old", "owner", "old", "2026-09-07T08:00:00.123100+00:00"), message("new", "owner", "new", "2026-09-07T08:00:00.123900+00:00")];
  expect(currentPrivateMessages(messages, "2026-09-07T08:00:00.123500+00:00").map((item) => item.id)).toEqual(["new"]);
});

test("private prompts preserve conversation roles, include the current turn once and discard old context", () => {
  const payload = buildPrivateCompanionMessages({ petName: "芽芽", personality: "curious", styles: [], memories: [{ content: "我喜欢茶", updated_at: "2026-09-07" }], recalledMessages: [], contextStartedAt: "2026-09-07T00:00:00Z", messages: [
    { role: "owner", content: "OLD COFFEE", created_at: "2026-09-06T00:00:00Z" },
    { role: "owner", content: "hello", created_at: "2026-09-07T08:00:00Z" },
    { role: "pet", content: "hi", created_at: "2026-09-07T08:01:00Z" },
    { role: "owner", content: "CURRENT QUESTION", created_at: "2026-09-07T08:02:00Z" },
  ] });
  expect(payload.slice(-3).map((item) => item.role)).toEqual(["user", "assistant", "user"]);
  expect(payload.filter((item) => item.content.endsWith("CURRENT QUESTION"))).toHaveLength(1);
  expect(JSON.stringify(payload)).not.toContain("OLD COFFEE");
  expect(payload[1].content).toContain("我喜欢茶");
});
