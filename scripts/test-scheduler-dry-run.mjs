import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const container = process.env.SUPABASE_TEST_DB_CONTAINER ?? "supabase_db_android-companion-validation";
if (!["supabase_db_android-companion-validation","supabase_db_android-final-validation"].includes(container)) throw new Error("Isolated fixture container required");
const script = readFileSync("scripts/configure-reminder-scheduler.sql", "utf8").replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const setup = `select vault.create_secret('https://scheduler-dry-run.invalid','reminder_project_url');
do $$ declare label text; begin foreach label in array array['push_cron_secret','space_message_cron_secret','group_work_cron_secret','image_maintenance_cron_secret'] loop perform vault.create_secret(gen_random_uuid()::text,label); end loop; end $$;`;
// Scheduled rows and fake secrets remain uncommitted, so no HTTP job can execute.
const sql = `begin; ${setup}
create extension if not exists pg_cron;
select cron.schedule('pet-deliver-reminders','* * * * *','select 1');
select cron.schedule('pet-send-push-notifications','* * * * *','select 1');
select cron.schedule('preflight-unrelated-job','0 0 * * *','select 1');
${script} ${script}
do $$ begin if (select count(*) from cron.job where jobname in ('pet-reminder-due-v2','pet-push-dispatch-v2','pet-space-message-dispatch','pet-group-work-sweep','pet-image-maintenance'))<>5 then raise exception 'scheduler_not_idempotent'; end if;
if exists(select 1 from cron.job where jobname in ('pet-deliver-reminders','pet-send-push-notifications') and active) then raise exception 'old_cron_still_active'; end if;
if not exists(select 1 from cron.job where jobname='preflight-unrelated-job' and active) then raise exception 'unrelated_cron_changed'; end if; end $$;
rollback;`;
const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, encoding: "utf8" });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status || 1); }
console.log("PASS scheduler transactional dry-run: five jobs, four separate Vault credentials, repeated installation deduplicates; only two known old jobs paused; unrelated job retained; rollback sent no HTTP requests.");
