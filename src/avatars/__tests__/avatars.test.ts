import { avatarAssetId, petAvatarId, petAvatarReference, stableAvatarMembers } from "../types";
test("avatar references accept UUID pointers and keep external URLs separate", () => {
  expect(avatarAssetId("avatar://11111111-1111-4111-8111-111111111111")).toBe("11111111-1111-4111-8111-111111111111");
  expect(avatarAssetId("avatar://../private")).toBeNull();
  expect(avatarAssetId("https://example.test/photo.png")).toBeNull();
});
test("pet avatar references address the pet rather than its owner's picture", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  expect(petAvatarId(petAvatarReference(id))).toBe(id);
  expect(petAvatarId(`avatar://${id}`)).toBeNull();
  expect(petAvatarId("pet-avatar://../private")).toBeNull();
});
test("member mosaics are stable across shuffled data, deduplicate and cap at nine", () => {
  const input = Array.from({ length: 12 }, (_, index) => ({ id: String(index).padStart(2, "0"), nickname: "测试", joinedAt: "2026-09-11T00:00:00Z" }));
  expect(stableAvatarMembers([...input].reverse())).toEqual(input.slice(0, 9));
  expect(stableAvatarMembers([input[0], input[0]])).toHaveLength(1);
});
