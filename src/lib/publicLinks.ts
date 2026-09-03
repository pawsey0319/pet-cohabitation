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
