// One synthetic failed-case replay. It does not call Supabase or persist memory.
import { extractLearningCandidates } from '../supabase/functions/_shared/personalityLearning.ts';
const reportFile = Deno.args[0];
if (!/^test-results\/learning-cloud-[0-9a-f-]+\.json$/.test(reportFile ?? '')) throw new Error('synthetic_cloud_report_required');
const report = JSON.parse(await Deno.readTextFile(reportFile));
const observation = report.observations.find(row => row.kind === 'relationship' && row.synthetic_input);
if (!observation) throw new Error('synthetic_input_missing');
for (const line of (await Deno.readTextFile('test-results/current-models.private.env')).split(/\r?\n/)) {
  const match = /^(TEXT_MODEL|TEXT_API_KEY|TEXT_API_BASE_URL)=(.*)$/.exec(line.trim());
  if (match) Deno.env.set(match[1], match[2].trim().replace(/^"|"$/g, ''));
}
const selected = Deno.env.get('LEARNING_TEXT_MODEL')?.trim();
if (!selected || /grok/i.test(selected)) throw new Error('explicit_non_grok_learning_model_required');
Deno.env.set('MODEL_MOCK_MODE', 'false');
const endpoint = Deno.env.get('TEXT_API_BASE_URL').replace(/\/+$/, '') + '/chat/completions';
const realFetch = globalThis.fetch, calls = [];
globalThis.fetch = async (input, init) => {
  if (String(input) !== endpoint) throw new Error('unexpected_model_endpoint');
  const start = performance.now();
  const response = await realFetch(input, init), body = await response.clone().json();
  const raw = body.choices?.[0]?.message?.content;
  let parsed = null; try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { /* Invalid content stays unparsed. */ }
  calls.push({ elapsed_ms: Math.round(performance.now() - start), model: body.model, status: response.status, finish_reason: body.choices?.[0]?.finish_reason, parsed });
  return response;
};
let validated, error = null;
try {
  const sample = observation.synthetic_input, job = observation.cloud_job;
  validated = await extractLearningCandidates({ job: { ...job, lease_token: crypto.randomUUID() }, source: { id: job.source_id, content: sample.content, created_at: job.created_at, speaker_id: sample.speaker_id }, members: sample.members });
} catch (reason) { error = reason instanceof Error && /^[a-z_]+$/.test(reason.message) ? reason.message : 'diagnostic_failed'; }
finally {
  globalThis.fetch = realFetch;
  const result = { synthetic_input: observation.synthetic_input, prior_cloud_relationships: observation.relationships, calls, validated, error, scope: 'Local one-case replay against current product model; not a cloud-job acceptance result.' };
  const output = reportFile.replace('.json', '.diagnostic.json'); await Deno.writeTextFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ model: selected, calls: calls.length, raw_candidates: calls.at(-1)?.parsed?.candidates, validated, error, report: output }, null, 2));
}
