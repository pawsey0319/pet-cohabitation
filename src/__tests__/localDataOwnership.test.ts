import AsyncStorage from "@react-native-async-storage/async-storage";
import { localDataKeys } from "../data/localData";
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

beforeEach(async () => { await AsyncStorage.clear(); });

test("export and account deletion cannot claim shared or unknown prefixed data", async () => {
  await AsyncStorage.multiSet([
    ["pet-cohabitation-mvp-v1", "shared demo records"],
    ["pet-cohabitation-future-private:bob", "another account"],
    ["pet-cohabitation-private-draft:alice", "own draft"],
    ["pet-cohabitation-private-draft:bob", "other draft"],
    ["pet-chat-messages-v1:alice:group-1", "own cache"],
    ["pet-chat-messages-v1:bob:group-1", "other cache"],
    ["pet-private-send-queue-v1:alice", "own queue"],
    ["pet-cohabitation-portrait-position-v1:alice:pet-a", "own pet position"],
    ["pet-cohabitation-portrait-position-v1:bob:pet-b", "other pet position"],
  ]);
  const own = await localDataKeys("alice");
  expect(own.sort()).toEqual([
    "pet-cohabitation-private-draft:alice", "pet-chat-messages-v1:alice:group-1", "pet-private-send-queue-v1:alice", "pet-cohabitation-portrait-position-v1:alice:pet-a",
  ].sort());
  await AsyncStorage.multiRemove(own);
  expect(await AsyncStorage.getItem("pet-cohabitation-private-draft:bob")).toBe("other draft");
  expect(await AsyncStorage.getItem("pet-cohabitation-mvp-v1")).toBe("shared demo records");
  expect(await AsyncStorage.getItem("pet-cohabitation-portrait-position-v1:bob:pet-b")).toBe("other pet position");
});

test("legacy pet data requires a matching owner before export or deletion", async () => {
  const key = "pet-cohabitation-local-pet-v2";
  await AsyncStorage.setItem(key, JSON.stringify({ pet: { ownerId: "alice" } }));
  expect(await localDataKeys("alice")).toContain(key);
  expect(await localDataKeys("bob")).not.toContain(key);
  await AsyncStorage.setItem(key, "invalid JSON");
  expect(await localDataKeys("alice")).not.toContain(key);
});
