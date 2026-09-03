import { parseSpaceInviteLink, spaceInviteUrl } from "../lib/publicLinks";

describe("spaceInviteUrl", () => {
  it("uses the configured public site on Android and iOS", () => {
    for (const platform of ["android", "ios"]) {
      expect(spaceInviteUrl("token", { platform, publicAppUrl: "https://pet-cohabitation-public.vercel.app/" })).toBe("https://pet-cohabitation-public.vercel.app/invite/token");
    }
  });

  it("keeps the actual browser origin on Web including local testing", () => {
    expect(spaceInviteUrl("token", { platform: "web", browserOrigin: "http://localhost:8082", publicAppUrl: "https://different.example.test" })).toBe("http://localhost:8082/invite/token");
  });

  it("rejects missing, local and placeholder native settings", () => {
    for (const publicAppUrl of [undefined, "http://localhost:8081", "https://127.0.0.1", "https://[::1]", "https://your-app.vercel.app"]) {
      expect(() => spaceInviteUrl("token", { platform: "android", publicAppUrl })).toThrow();
    }
  });

  it("rejects credentials and non-HTTP schemes", () => {
    for (const publicAppUrl of ["https://user:password@example.test", "javascript:alert(1)"]) {
      expect(() => spaceInviteUrl("token", { platform: "android", publicAppUrl })).toThrow();
    }
  });

  it("encodes the token and does not retain configuration query parameters", () => {
    expect(spaceInviteUrl("a/b?c", { platform: "android", publicAppUrl: "https://example.test/path?config=1" })).toBe("https://example.test/invite/a%2Fb%3Fc");
  });
});

describe("pasted group invitations", () => {
  const options = { platform: "android", publicAppUrl: "https://pet-cohabitation-public.vercel.app" };
  const token = "cfd54a31-09b4-4e40-b605-9f0ea751da13";
  it("extracts a full native invitation without opening an external site", () => {
    expect(parseSpaceInviteLink(`  ${options.publicAppUrl}/invite/${token}  `, options)).toBe(token);
  });
  it("accepts the current web origin for local testing", () => {
    expect(parseSpaceInviteLink(`http://localhost:8082/invite/${token}`, { platform: "web", browserOrigin: "http://localhost:8082" })).toBe(token);
  });
  it.each(["ABCDEF123456", token, "javascript:alert(1)", `https://evil.test/invite/${token}`, `https://pet-cohabitation-public.vercel.app.evil.test/invite/${token}`, `https://user:pass@pet-cohabitation-public.vercel.app/invite/${token}`, `${options.publicAppUrl}/invite/not-a-token`, `${options.publicAppUrl}/invite/${token}/extra`])("rejects registration codes, malformed links and foreign sites: %s", (value) => {
    expect(() => parseSpaceInviteLink(value, options)).toThrow();
  });
});
