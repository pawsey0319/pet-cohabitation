import { canonicalRecallActor } from "../../supabase/functions/_shared/petRecallIdentity";

describe("pet recall identity", () => {
  it("uses one current nickname for historical rows from the same sender id", () => {
    const names = new Map([["user-1", "演示管理员"]]);
    expect(canonicalRecallActor({ sender_id: "user-1", actor_name: "AAA猪饲料批发（林森）", actor_kind: "human" }, names)).toBe("演示管理员");
    expect(canonicalRecallActor({ sender_id: "user-1", actor_name: "演示管理员", actor_kind: "human" }, names)).toBe("演示管理员");
  });

  it("does not relabel pets or agents as human profiles", () => {
    const names = new Map([["pet-1", "某位成员"]]);
    expect(canonicalRecallActor({ sender_id: "pet-1", actor_name: "阿华田", actor_kind: "pet" }, names)).toBe("阿华田");
  });
});

