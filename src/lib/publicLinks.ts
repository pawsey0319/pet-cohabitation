export function spaceInviteUrl(token: string, options: {
  platform: string;
  browserOrigin?: string;
  publicAppUrl?: string;
}): string {
  const origin = options.platform === "web" && options.browserOrigin
    ? options.browserOrigin : options.publicAppUrl;
  if (!origin) throw new Error("尚未配置公网邀请地址，请联系管理员。");
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error("公网邀请地址配置无效。"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("公网邀请地址配置无效。");
  if (options.platform !== "web" && (url.protocol !== "https:" || /^(localhost|127\.|\[?::1\]?)/i.test(url.hostname) || url.hostname === "your-app.vercel.app")) {
    throw new Error("手机邀请必须使用正式 HTTPS 地址，不能使用本机或占位地址。");
  }
  return `${url.origin}/invite/${encodeURIComponent(token)}`;
}

export function parseSpaceInviteLink(value: string, options: Parameters<typeof spaceInviteUrl>[1]): string {
  let link: URL;
  try { link = new URL(value.trim()); } catch {
    throw new Error("请粘贴完整的群邀请链接，不是注册邀请码。");
  }
  const expectedOrigin = new URL(spaceInviteUrl("validate", options)).origin;
  if (link.origin !== expectedOrigin || link.username || link.password) {
    throw new Error("请使用当前应用的正式群邀请链接。");
  }
  const match = /^\/invite\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(link.pathname);
  if (!match) throw new Error("群邀请链接格式不正确，请让群成员重新复制完整链接。");
  return match[1].toLowerCase();
}
