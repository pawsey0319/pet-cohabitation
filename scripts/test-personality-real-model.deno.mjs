// Six synthetic cases through the unchanged production extraction path.
// No database client, users, messages or memories are created or read.
import { extractLearningCandidates, learningTextModelName } from '../supabase/functions/_shared/personalityLearning.ts';
import { TextModelAdapter } from '../supabase/functions/_shared/modelAdapters.ts';

const envFile = 'test-results/current-models.private.env';
const reportPath = `test-results/personality-real-model-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const allowed = new Set(['TEXT_MODEL', 'TEXT_API_BASE_URL', 'TEXT_API_KEY', 'LEARNING_TEXT_MODEL', 'GROUP_TEXT_MODEL', 'RECALL_TEXT_MODEL']);
for (const line of (await Deno.readTextFile(envFile)).split(/\r?\n/)) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (!match || !allowed.has(match[1])) continue;
  let value = match[2].trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  Deno.env.set(match[1], value);
}
const relationshipDiagnostics = Deno.args.includes('--relationship-diagnostics');
const selectionArgs = Deno.args.filter(value => value !== '--relationship-diagnostics');
if (selectionArgs.length) {
  if (selectionArgs.length !== 1 || !['--learning-from-group', '--learning-from-recall'].includes(selectionArgs[0])) throw new Error('invalid_learning_test_mode');
  const sourceName = selectionArgs[0] === '--learning-from-group' ? 'GROUP_TEXT_MODEL' : 'RECALL_TEXT_MODEL';
  const sourceModel = Deno.env.get(sourceName)?.trim();
  if (!sourceModel) throw new Error('verified_source_model_missing');
  Deno.env.set('LEARNING_TEXT_MODEL', sourceModel);
}
Deno.env.set('MODEL_MOCK_MODE', 'false');
const configuredModel = learningTextModelName();
if (!configuredModel) throw new Error('text_model_missing');
if (/grok/i.test(configuredModel)) {
  console.log(JSON.stringify({ stopped: true, configured_model: configuredModel, reason: 'Grok requires the user to choose a model for this call.' }));
  Deno.exit(2);
}
if (!Deno.env.get('TEXT_API_BASE_URL') || !Deno.env.get('TEXT_API_KEY')) throw new Error('text_model_configuration_missing');
const endpoint = `${Deno.env.get('TEXT_API_BASE_URL').replace(/\/+$/, '')}/chat/completions`;
const originalFetch = globalThis.fetch;
let trace = [];
function parseRaw(value) {
  if (typeof value !== 'string') return null;
  try {
    const data = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    return Array.isArray(data.candidates) ? data.candidates : null;
  } catch { return null; }
}
globalThis.fetch = async (input, init) => {
  const target = input instanceof Request ? input.url : String(input);
  if (target !== endpoint) throw new Error('unexpected_model_destination');
  const sent = JSON.parse(String(init?.body ?? '{}'));
  if (sent.model !== configuredModel) throw new Error('unexpected_model_selection');
  const started = performance.now();
  const attempt = { requested_model: sent.model, reported_model: null, http_status: null, elapsed_ms: null, finish_reason: null, raw_candidates: null, transport_error: null };
  trace.push(attempt);
  let response;
  try { response = await originalFetch(input, init); }
  catch (reason) {
    attempt.elapsed_ms = Math.round(performance.now() - started);
    attempt.transport_error = reason instanceof Error && ['TimeoutError', 'AbortError'].includes(reason.name) ? reason.name : 'transport_failed';
    throw reason;
  }
  let payload;
  try { payload = await response.clone().json(); } catch { /* Production handles parse errors and retry. */ }
  const reportedModel = typeof payload?.model === 'string' && /^[a-zA-Z0-9._:/-]{1,100}$/.test(payload.model) ? payload.model : null;
  Object.assign(attempt, { reported_model: reportedModel, http_status: response.status, elapsed_ms: Math.round(performance.now() - started), finish_reason: payload?.choices?.[0]?.finish_reason ?? null, raw_candidates: parseRaw(payload?.choices?.[0]?.message?.content) });
  return response;
};

const ids = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222', c: '33333333-3333-4333-8333-333333333333' };
const members = [{ id: ids.a, name: '小林' }, { id: ids.b, name: '小周' }, { id: ids.c, name: '小许' }];
const exact = (rows, content) => Array.isArray(rows) && rows.every(row => typeof row.quote === 'string' && content.includes(row.quote));
const none = rows => Array.isArray(rows) && rows.length === 0;
const cases = [
  { id: 'gentle_direct_expression', kind: 'style', speaker: ids.a, content: '别着急，你可以按自己的节奏说，我会认真听；即使还没有答案，也不用责怪自己。', expected: '至少一个 gentle 候选，所有候选均有连续原话；候选本身不表示已形成稳定性格。', accepts: (rows, content) => exact(rows, content) && rows.some(row => row.trait === 'gentle' && row.confidence >= .75) },
  { id: 'reported_roleplay_is_not_personality', kind: 'style', speaker: ids.a, content: '朋友让我代发这句台词：别着急，我会一直陪着你。我只是在角色扮演，引用的是他的话，别把这当成我的真实说话习惯。', expected: '空候选；转述和角色扮演不构成本人风格依据。', accepts: none },
  { id: 'explicit_joke_is_not_personality', kind: 'style', speaker: ids.a, content: '我说自己是全世界最凶的人只是开玩笑，别当真；这也不代表我平时的性格。', expected: '空候选；明确否认真实性的玩笑不能成为稳定风格依据。', accepts: none },
  { id: 'self_stated_relationship', kind: 'relationship', speaker: ids.a, content: '小周是我同事，我们在同一个项目组工作。', expected: '小林本人→小周的同事关系，self_stated，assert，原话准确。', accepts: (rows, content) => exact(rows, content) && rows.length === 1 && rows[0].subject_id === ids.a && rows[0].object_id === ids.b && rows[0].assertion === 'self_stated' && rows[0].operation === 'assert' && /同事/.test(rows[0].relation) },
  { id: 'third_party_relationship_is_attributed', kind: 'relationship', speaker: ids.c, content: '小林告诉我，他和小周是同事；这只是我转述小林的话。', expected: '小许转述小林→小周的关系，reported；不能当成小许本人关系或已核实事实。', accepts: (rows, content) => exact(rows, content) && rows.length === 1 && rows[0].subject_id === ids.a && rows[0].object_id === ids.b && rows[0].assertion === 'reported' && rows[0].operation === 'assert' && /同事/.test(rows[0].relation) },
  { id: 'ambiguous_duplicate_names_are_skipped', kind: 'relationship', speaker: ids.a, content: '小周是我同事。', members: [{ id: ids.a, name: '小林' }, { id: ids.b, name: '小周' }, { id: ids.c, name: '小周' }], expected: '空候选；两个小周都在群内，不能用同名猜测对象。', accepts: none },
];
if (relationshipDiagnostics) {
  // Reproduce the cloud sample using unrelated synthetic UUIDs and both member
  // orders. Save raw and validated candidates before judging the result.
  cases.splice(0, cases.length, ...Array.from({ length: 6 }, (_, index) => {
    const owner = crypto.randomUUID(), peer = crypto.randomUUID();
    const members = [{ id: owner, name: '合成小林' }, { id: peer, name: '合成小周' }];
    if (index % 2) members.reverse();
    return { id: `cloud_relationship_direction_${index + 1}`, kind: 'relationship', speaker: owner, members,
      content: '合成小周是我同事，我们在同一个项目组工作。',
      expected: '本人与合成小周的一条对称同事关系，精确原话，self_stated/assert；任一端顺序均不得误标reported。',
      accepts: (rows, content) => exact(rows, content) && rows.length === 1 && rows[0].subject_id !== rows[0].object_id && [rows[0].subject_id, rows[0].object_id].every(id => [owner, peer].includes(id)) && rows[0].assertion === 'self_stated' && rows[0].operation === 'assert' && /同事/.test(rows[0].relation) };
  }));
}
const results = [];
try {
  for (const test of cases) {
    trace = [];
    const started = performance.now();
    let candidates = [], error = null;
    try {
      candidates = await extractLearningCandidates({ job: { id: crypto.randomUUID(), pet_id: crypto.randomUUID(), owner_id: ids.a, kind: test.kind, source_kind: test.kind === 'style' ? 'private' : 'space', lease_token: crypto.randomUUID() }, source: { id: crypto.randomUUID(), content: test.content, created_at: new Date().toISOString(), speaker_id: test.speaker }, members: test.members ?? members });
    } catch (reason) { error = reason instanceof Error && /^[a-zA-Z0-9_:-]{1,100}$/.test(reason.message) ? reason.message : 'extraction_failed'; }
    const lastRaw = trace.at(-1)?.raw_candidates;
    const pipelinePass = !error && test.accepts(candidates, test.content);
    const rawVerdict = !Array.isArray(lastRaw) ? 'unavailable_requires_review' : test.accepts(lastRaw, test.content) ? 'pass' : 'fail';
    const result = { case_id: test.id, kind: test.kind, synthetic_input: test.content, synthetic_speaker_id: test.speaker, synthetic_members: test.members ?? members, expected: test.expected, elapsed_ms: Math.round(performance.now() - started), pipeline_pass: pipelinePass, raw_model_verdict: rawVerdict, candidates, error, model_calls: trace };
    results.push(result);
    await Deno.writeTextFile(reportPath, JSON.stringify({ configured_model: configuredModel, adapter_model: TextModelAdapter.modelName(), concurrency: 'Non-exclusive; another group-chat evaluation may run concurrently.', cases: results, complete: false }, null, 2));
    console.log(JSON.stringify({ case_id: test.id, pipeline_pass: pipelinePass, raw_model_verdict: rawVerdict, elapsed_ms: result.elapsed_ms, error }));
    if (trace.some(call => /grok/i.test(call.reported_model ?? ''))) break;
  }
} finally {
  globalThis.fetch = originalFetch;
  const report = { configured_model: configuredModel, adapter_model: TextModelAdapter.modelName(), actual_response_models: [...new Set(results.flatMap(row => row.model_calls.map(call => call.reported_model)).filter(Boolean))], complete: results.length === cases.length, pipeline_passed: results.filter(row => row.pipeline_pass).length, raw_model_passed: results.filter(row => row.raw_model_verdict === 'pass').length, cases: results, concurrency: 'Non-exclusive; another group-chat evaluation may run concurrently.', limits: ['Six synthetic cases, no production conversations read.', 'No memory writes or learning jobs submitted.', 'Validates extraction only; does not establish long-term personality behavior, cross-day learning quality, device behavior or recall quality.', 'A rule-filtered empty result is distinguished from a correct raw model decision.', 'Latency includes real transport and production retries; not an exclusive performance benchmark.'] };
  await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ configured_model: configuredModel, actual_response_models: report.actual_response_models, completed: results.length, pipeline_passed: report.pipeline_passed, raw_model_passed: report.raw_model_passed, report: reportPath }));
  if (!report.complete || report.pipeline_passed !== cases.length || report.raw_model_passed !== cases.length) Deno.exit(1);
}
