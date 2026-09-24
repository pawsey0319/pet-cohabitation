import { approvedDesktopImage, parseDesktopCommand, type ApprovedPetDisplay } from "../contracts";
const state = (): ApprovedPetDisplay => ({ source_asset_id: "asset", url: "https://example.supabase.co/storage/v1/object/sign/pet-portraits/p.png?token=fixture", job: { id: "job", status: "succeeded" }, preference: { version: 4, use_transparent: true, approved_job_id: "job", approved_source_asset_id: "asset", approved_display_version: 4, approved_at: "2026-09-20" } });
test("only exact approved transparent version can become a desktop pet", () => {
  expect(approvedDesktopImage(state(), "asset", "https://example.supabase.co")).toContain("p.png");
  for (const mutate of [(row: ApprovedPetDisplay) => { row.preference.approved_at = null; }, (row: ApprovedPetDisplay) => { row.preference.approved_display_version = 3; }, (row: ApprovedPetDisplay) => { row.preference.approved_job_id = "old"; }, (row: ApprovedPetDisplay) => { row.preference.use_transparent = false; }, (row: ApprovedPetDisplay) => { row.source_asset_id = "old"; }]) {
    const row = state(); mutate(row); expect(() => approvedDesktopImage(row, "asset", "https://example.supabase.co")).toThrow();
  }
});
test("arbitrary remote, local, and unsigned image URLs cannot enter native image loading", () => {
  for (const url of ["http://127.0.0.1/private", "file:///data/data/app/secrets", "https://attacker.invalid/storage/v1/object/sign/a", "https://example.supabase.co/rest/v1/profiles"]) expect(() => approvedDesktopImage({ ...state(), url }, "asset", "https://example.supabase.co")).toThrow();
});
test("native commands require immutable request identity and bounded text", () => {
  const valid = { id: "command", ownerId: "owner", petId: "pet", kind: "send", requestId: "request", content: "晚上好" };
  expect(parseDesktopCommand(valid)).toEqual(valid);
  for (const change of [{ requestId: null }, { ownerId: "" }, { content: " " }, { kind: "set_token" }, { content: "x".repeat(4001) }]) expect(() => parseDesktopCommand({ ...valid, ...change })).toThrow();
});
