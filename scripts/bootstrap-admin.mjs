import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const nickname = process.env.BOOTSTRAP_ADMIN_NICKNAME?.trim() || "空间管理员";

if (!url || !serviceKey || !email || !password) {
  throw new Error("需要 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、BOOTSTRAP_ADMIN_EMAIL、BOOTSTRAP_ADMIN_PASSWORD");
}
if (password.length < 8) throw new Error("管理员密码至少 8 位");

const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const existing = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (existing.error) throw existing.error;
let user = existing.data.users.find((item) => item.email?.toLowerCase() === email);
if (!user) {
  const created = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nickname } });
  if (created.error) throw created.error;
  user = created.data.user;
}
const profile = await client.from("profiles").upsert({ id: user.id, email, nickname, is_admin: true }, { onConflict: "id" });
if (profile.error) throw profile.error;
console.log(`管理员已就绪：${email}`);
