import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { MurmurService, type IngestResult } from '../../src/app/service';
import { DummyConnector, MemoryDummyBackend } from '../../src/connectors/dummy/connector';
import type { Connectors } from '../../src/connectors/types';
import { AiSummarizer } from '../../src/derivation/summarizer';
import {
  canonicalJson,
  deriveViewer,
  Directory,
  getTaskView,
  Seed,
  visibleSignals,
  type AiDecision,
  type DecisionRequest,
  type Projections,
} from '../../src/domain';
import { createApp } from '../../src/http/app';
import { AiDecider, AiReplyEstimator, type Decider, type ReplyEstimator } from '../../src/ingest/deciders';
import { RecordReplayLlm, type LlmClient } from '../../src/ingest/llm';
import { memoryRepo } from '../../src/store/memory';
import type { Repo } from '../../src/store/types';
import { InboundSignalBody } from '../../src/api/schemas';
import { counterIds, ManualClock } from './clock';
import { FsRecordingStore } from './recordings';

// シナリオ（fixtures/<name>/）を流し込んで最後まで回し、expected.json と比べる。

export const FIXTURES_DIR = join(import.meta.dirname, '../../fixtures');

export const ScenarioConfig = z.object({
  title: z.string(),
  tenant: z.string(),
  hypotheses: z.array(z.string()),
  /** desk-checked = 机上シミュレーション済み、draft = スタンドで回す前の下書き、stand-recorded = スタンド主導の記録を固めたもの */
  status: z.enum(['desk-checked', 'draft', 'stand-recorded']),
  echoObserved: z.boolean().default(false),
  notes: z.string().optional(),
});

const Bind = z.record(z.string(), z.string());

export const Tool = z.enum([
  'list_my_tasks',
  'get_task',
  'set_attribute',
  'propose_derivation',
  'list_proposals',
  'approve_derivation',
  'reject_derivation',
  'close_task',
  'reopen_task',
  'correct_ingest',
  'explain_ignore',
  'get_list',
]);
export type Tool = z.infer<typeof Tool>;

export const Step = z.union([
  z.object({
    id: z.string(),
    at: z.string(),
    signal: z.record(z.string(), z.unknown()),
    /** 観測された送信の返事期待（ヒント実行での推定の代わり） */
    estimate: z.string().nullable().optional(),
    bind: Bind.optional(),
    note: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    at: z.string(),
    action: z.object({ tool: Tool, as: z.string(), input: z.record(z.string(), z.unknown()).default({}) }),
    bind: Bind.optional(),
    note: z.string().optional(),
  }),
  z.object({ id: z.string(), at: z.string(), cron: z.literal(true), note: z.string().optional() }),
]);
export type Step = z.infer<typeof Step>;

export const Label = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new'), list: z.string(), title: z.string().optional() }),
  z.object({ kind: z.literal('attach'), task: z.string() }),
  z.object({ kind: z.literal('ignore'), reason: z.string().optional() }),
  z.object({ kind: z.literal('merged') }),
  z.object({ kind: z.literal('duplicate') }),
]);
export type Label = z.infer<typeof Label>;

const TaskExpectation = z
  .object({
    ballAt: z.unknown(),
    status: z.enum(['open', 'closed']),
    overdue: z.boolean(),
    attributes: z.record(z.string(), z.unknown()),
    listId: z.string(),
    replyExpectedBy: z.string().nullable(),
    unansweredSince: z.string().nullable(),
  })
  .partial()
  .strict();

const VisibilityCheck = z.union([
  z.object({
    as: z.string(),
    task: z.string(),
    access: z.enum(['full', 'summary']).nullable(),
    mustContain: z.array(z.string()).default([]),
    mustNotContain: z.array(z.string()).default([]),
  }),
  z.object({ as: z.string(), signals: z.number() }),
  z.object({ ghostParty: z.string() }),
]);

export const Expected = z.object({
  ingest: z.record(z.string(), Label),
  checkpoints: z
    .array(
      z.object({
        after: z.string(),
        tasks: z.record(z.string(), TaskExpectation).default({}),
        derivations: z.record(z.string(), z.string()).default({}),
      }),
    )
    .default([]),
  final: z
    .object({
      tasks: z.record(z.string(), TaskExpectation).default({}),
      derivations: z.record(z.string(), z.string()).default({}),
      taskCount: z.number().optional(),
      ignoredCount: z.number().optional(),
      eventCounts: z.record(z.string(), z.number()).default({}),
    })
    .default({ tasks: {}, derivations: {}, eventCounts: {} }),
  visibility: z.array(VisibilityCheck).default([]),
});
export type Expected = z.infer<typeof Expected>;

export interface Scenario {
  name: string;
  dir: string;
  config: z.infer<typeof ScenarioConfig>;
  seed: Seed;
  steps: Step[];
  expected: Expected;
}

export function listScenarios(): string[] {
  return ['repair-estimate', 'development', 'absence', 'complaint'].filter((n) => existsSync(join(FIXTURES_DIR, n)));
}

export function loadScenario(name: string): Scenario {
  const dir = join(FIXTURES_DIR, name);
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  const steps = read('signals.jsonl')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .map((l, i) => {
      try {
        return Step.parse(JSON.parse(l));
      } catch (e) {
        throw new Error(`${name}/signals.jsonl line ${i + 1}: ${(e as Error).message}`);
      }
    });
  return {
    name,
    dir,
    config: ScenarioConfig.parse(JSON.parse(read('scenario.json'))),
    seed: Seed.parse(JSON.parse(read('seed.json'))),
    steps,
    expected: Expected.parse(JSON.parse(read('expected.json'))),
  };
}

// ---- 実行 ----

export type DeciderMode = { kind: 'hint' } | { kind: 'ai'; mode: 'replay' | 'record' | 'rerecord'; live?: LlmClient; model: string };

export interface StepRecord {
  step: Step;
  ingest?: IngestResult;
  response?: { status: number; body: unknown };
  cron?: { ingested: IngestResult[]; overdue: number };
  /** AI 判断の confidence（AI モードのみ） */
  confidence?: number;
}

export interface Run {
  scenario: Scenario;
  service: MurmurService;
  repo: Repo;
  bindings: Record<string, string>;
  records: StepRecord[];
  checkpointErrors: string[];
  backend: MemoryDummyBackend;
}

class HintDecider implements Decider {
  current: { stepId: string; label?: Label } = { stepId: '' };
  constructor(private readonly resolve: (s: string) => string) {}
  async decide(req: DecisionRequest): Promise<{ raw: AiDecision; by: 'human' }> {
    const label = this.current.label;
    if (!label) throw new Error(`step ${this.current.stepId}: AI 判断が必要だが expected.json に正解ラベルがない`);
    const base = { task_id: null, list_id: null, title: null, reason: `fixture hint (${this.current.stepId})`, confidence: 1 };
    switch (label.kind) {
      case 'new':
        return { raw: { ...base, decision: 'new', list_id: label.list, title: label.title ?? req.signal.subject ?? null }, by: 'human' };
      case 'attach':
        return { raw: { ...base, decision: 'attach', task_id: this.resolve(label.task) }, by: 'human' };
      case 'ignore':
        return { raw: { ...base, decision: 'ignore', reason: label.reason ?? base.reason }, by: 'human' };
      default:
        throw new Error(`step ${this.current.stepId}: ${label.kind} のはずが AI 判断に来た`);
    }
  }
}

/** AI 判断の confidence を拾うための包み */
class ObservedDecider implements Decider {
  last: number | undefined;
  constructor(private readonly inner: Decider) {}
  async decide(req: DecisionRequest) {
    const r = await this.inner.decide(req);
    this.last = r.raw.confidence;
    return r;
  }
}

export async function runScenario(scenario: Scenario, opts: { repo?: Repo; decider?: DeciderMode } = {}): Promise<Run> {
  const repo = opts.repo ?? memoryRepo();
  await repo.master.replaceSeed(scenario.seed);
  const clock = new ManualClock(scenario.steps[0]?.at);
  const backend = new MemoryDummyBackend();
  const connectors: Connectors = Object.fromEntries(
    (['email', 'slack', 'line', 'jira', 'bitbucket'] as const).map((ch) => [ch, new DummyConnector(ch, backend, { echoObserved: scenario.config.echoObserved })]),
  );
  const bindings: Record<string, string> = {};
  let service!: MurmurService;

  const resolve = (v: string): string => {
    if (v.startsWith('$sent:')) {
      return sentRefOf(v.slice(6));
    }
    if (v.startsWith('$')) {
      const b = bindings[v.slice(1)];
      if (b === undefined) throw new Error(`unbound ${v}`);
      return b;
    }
    return v;
  };
  let latestState: Projections | undefined;
  const sentRefOf = (alias: string) => {
    const id = bindings[alias];
    const ref = id && latestState?.derivations[id]?.sentRef;
    if (!ref) throw new Error(`no sentRef for ${alias}`);
    return ref;
  };
  const subst = (v: unknown): unknown =>
    typeof v === 'string' ? resolve(v) : Array.isArray(v) ? v.map(subst) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x)])) : v;

  let decider: Decider;
  let estimator: ReplyEstimator;
  let summarizer: AiSummarizer | undefined;
  const hint = new HintDecider(resolve);
  let currentEstimate: string | null = null;
  if (opts.decider?.kind === 'ai') {
    const llm = new RecordReplayLlm(opts.decider.mode, new FsRecordingStore(join(scenario.dir, 'recordings')), opts.decider.live);
    decider = new AiDecider(llm, opts.decider.model);
    estimator = new AiReplyEstimator(llm, opts.decider.model);
    summarizer = new AiSummarizer(llm, opts.decider.model);
  } else {
    decider = hint;
    estimator = { estimate: async () => ({ replyExpectedBy: currentEstimate, by: currentEstimate ? 'ai' : 'none' }) };
  }
  const observed = new ObservedDecider(decider);

  service = new MurmurService({
    repo,
    clock,
    newId: counterIds(),
    decider: observed,
    estimator,
    summarizer,
    connectors,
    policy: { ignoreThreshold: 0.8 },
  });
  // スタンドと同じ HTTP API を通す（ユーザー識別はテスト用にそのまま User ID）
  const http = createApp({
    service: () => service,
    authenticate: async (token) => token,
    webhookVerify: async () => false,
  });

  const records: StepRecord[] = [];
  const checkpointErrors: string[] = [];
  const tenant = scenario.config.tenant;

  for (const step of scenario.steps) {
    clock.set(step.at);
    latestState = await service.state(tenant);
    const rec: StepRecord = { step };
    if ('signal' in step) {
      const label = scenario.expected.ingest[step.id];
      hint.current = { stepId: step.id, label };
      currentEstimate = step.estimate ?? null;
      observed.last = undefined;
      const inbound = InboundSignalBody.parse(subst(step.signal));
      rec.ingest = await service.ingest(tenant, inbound);
      rec.confidence = observed.last;
      if (step.bind) {
        for (const [alias, path] of Object.entries(step.bind)) {
          const v = (rec.ingest as Record<string, unknown>)[path];
          if (typeof v === 'string') bindings[alias] = v;
          else throw new Error(`step ${step.id}: ${path} を ${alias} に束縛できない（結果: ${JSON.stringify(rec.ingest)}）`);
        }
      }
    } else if ('action' in step) {
      const input = subst(step.action.input) as Record<string, unknown>;
      rec.response = await callTool(http, step.action.tool, step.action.as, input);
      if (rec.response.status >= 400) {
        throw new Error(`step ${step.id} ${step.action.tool} failed: ${rec.response.status} ${JSON.stringify(rec.response.body)}`);
      }
      if (step.bind) {
        for (const [alias, path] of Object.entries(step.bind)) {
          const v = getPath(rec.response.body, path);
          if (typeof v !== 'string') throw new Error(`step ${step.id}: ${path} が文字列でない`);
          bindings[alias] = v;
        }
      }
    } else {
      hint.current = { stepId: step.id };
      const ingested = await service.pollConnectors();
      const overdue = await service.checkOverdue();
      rec.cron = { ingested, overdue };
    }
    records.push(rec);

    for (const cp of scenario.expected.checkpoints.filter((c) => c.after === step.id)) {
      const p = await service.state(tenant);
      checkpointErrors.push(...compareTasks(p, cp.tasks, resolve, `checkpoint after ${step.id}`));
      checkpointErrors.push(...compareDerivations(p, cp.derivations, resolve, `checkpoint after ${step.id}`));
    }
  }
  return { scenario, service, repo, bindings, records, checkpointErrors, backend };
}

async function callTool(http: ReturnType<typeof createApp>, tool: Tool, as: string, input: Record<string, unknown>) {
  const enc = encodeURIComponent;
  const route: Record<Tool, () => [string, string, unknown?]> = {
    list_my_tasks: () => ['GET', `/api/tasks?${new URLSearchParams(input as Record<string, string>)}`],
    get_task: () => ['GET', `/api/tasks/${enc(String(input.task_id))}`],
    set_attribute: () => ['POST', `/api/tasks/${enc(String(input.task_id))}/attributes`, { name: input.name, value: input.value }],
    propose_derivation: () => ['POST', '/api/derivations', input],
    list_proposals: () => ['GET', `/api/proposals${input.list_id ? `?list_id=${enc(String(input.list_id))}` : ''}`],
    approve_derivation: () => ['POST', `/api/derivations/${enc(String(input.derivation_id))}/approve`, { from_address: input.from_address }],
    reject_derivation: () => ['POST', `/api/derivations/${enc(String(input.derivation_id))}/reject`, { reason: input.reason }],
    close_task: () => ['POST', `/api/tasks/${enc(String(input.task_id))}/close`, { reason: input.reason }],
    reopen_task: () => ['POST', `/api/tasks/${enc(String(input.task_id))}/reopen`, {}],
    correct_ingest: () => ['POST', `/api/signals/${enc(String(input.signal_id))}/correct`, { decision: input.decision, reason: input.reason }],
    explain_ignore: () => ['GET', `/api/ignores${input.since ? `?since=${enc(String(input.since))}` : ''}`],
    get_list: () => ['GET', `/api/lists/${enc(String(input.list_id))}`],
  };
  const [method, path, body] = route[tool]();
  const res = await http.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-murmur-identity': as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as unknown };
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function compareTasks(p: Projections, tasks: Expected['final']['tasks'], resolve: (s: string) => string, where: string): string[] {
  const errors: string[] = [];
  for (const [alias, exp] of Object.entries(tasks)) {
    const id = resolve(alias);
    const t = p.tasks[id];
    if (!t) {
      errors.push(`${where}: task ${alias} (${id}) がない`);
      continue;
    }
    for (const [k, v] of Object.entries(exp)) {
      const actual = (t as unknown as Record<string, unknown>)[k];
      const want = k === 'attributes' ? v : resolveDeep(v, resolve);
      if (canonicalJson(actual) !== canonicalJson(want)) {
        errors.push(`${where}: ${alias}.${k} = ${canonicalJson(actual)}（期待 ${canonicalJson(want)}）`);
      }
    }
  }
  return errors;
}

function resolveDeep(v: unknown, resolve: (s: string) => string): unknown {
  if (typeof v === 'string') return v.startsWith('$') ? resolve(v) : v;
  if (Array.isArray(v)) return v.map((x) => resolveDeep(x, resolve));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveDeep(x, resolve)]));
  return v;
}

function compareDerivations(p: Projections, ds: Record<string, string>, resolve: (s: string) => string, where: string): string[] {
  return Object.entries(ds).flatMap(([alias, status]) => {
    const d = p.derivations[resolve(alias)];
    return d?.status === status ? [] : [`${where}: derivation ${alias} は ${d?.status ?? '(なし)'}（期待 ${status}）`];
  });
}

// ---- 検証 ----

export interface IngestMetrics {
  total: number;
  correct: number;
  anchor: { total: number; correct: number };
  ai: { total: number; correct: number };
  mismatches: string[];
  confidences: number[];
}

/** H6: 正解ラベルとの一致率 */
export async function ingestMetrics(run: Run): Promise<IngestMetrics> {
  const m: IngestMetrics = { total: 0, correct: 0, anchor: { total: 0, correct: 0 }, ai: { total: 0, correct: 0 }, mismatches: [], confidences: [] };
  const p = await run.service.state(run.scenario.config.tenant);
  const resolve = (s: string) => (s.startsWith('$') ? (run.bindings[s.slice(1)] ?? s) : s);
  for (const rec of run.records) {
    if (!rec.ingest) continue;
    const label = run.scenario.expected.ingest[rec.step.id];
    if (!label) continue;
    m.total++;
    const r = rec.ingest;
    let ok = false;
    switch (label.kind) {
      case 'merged':
      case 'duplicate':
        ok = r.status === label.kind;
        break;
      case 'ignore':
        ok = r.status === 'ignored';
        break;
      case 'attach':
        ok = r.status === 'attached' && r.taskId === resolve(label.task);
        break;
      case 'new':
        ok = r.status === 'created' && !!r.taskId && p.tasks[r.taskId]?.listId === label.list;
        break;
    }
    if (ok) m.correct++;
    else m.mismatches.push(`${rec.step.id}: 期待 ${canonicalJson(label)}、実際 ${canonicalJson(r)}`);
    if ('decidedBy' in r) {
      const bucket = r.decidedBy === 'anchor' ? m.anchor : m.ai;
      bucket.total++;
      if (ok) bucket.correct++;
    }
    if (rec.confidence !== undefined) m.confidences.push(rec.confidence);
  }
  return m;
}

export interface Verification {
  errors: string[];
  metrics: IngestMetrics;
  approvals: { total: number; internal: number; external: number };
  replayHashMatches: boolean;
  taskHash: string;
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** H1: 投影を全削除してイベントからリプレイし、Task 投影のハッシュが元と一致するか */
export async function replayCheck(service: MurmurService, tenantId: string): Promise<{ before: string; after: string; fullMatch: boolean }> {
  const original = await service.state(tenantId);
  const before = await sha256(canonicalJson(original.tasks));
  const rebuilt = await service.rebuild(tenantId);
  const after = await sha256(canonicalJson(rebuilt.tasks));
  return { before, after, fullMatch: canonicalJson(original) === canonicalJson(rebuilt) };
}

export async function verifyScenario(run: Run): Promise<Verification> {
  const { scenario, service } = run;
  const tenant = scenario.config.tenant;
  const errors = [...run.checkpointErrors];
  const resolve = (s: string) => {
    if (!s.startsWith('$')) return s;
    const v = run.bindings[s.slice(1)];
    if (!v) throw new Error(`unbound ${s}`);
    return v;
  };
  const p = await service.state(tenant);
  const f = scenario.expected.final;
  errors.push(...compareTasks(p, f.tasks, resolve, 'final'));
  errors.push(...compareDerivations(p, f.derivations, resolve, 'final'));
  if (f.taskCount !== undefined && Object.keys(p.tasks).length !== f.taskCount) {
    errors.push(`final: タスク数 ${Object.keys(p.tasks).length}（期待 ${f.taskCount}）`);
  }
  const ignored = p.ignoreLog.filter((e) => e.overriddenAtSeq === null).length;
  if (f.ignoredCount !== undefined && ignored !== f.ignoredCount) errors.push(`final: 無視 ${ignored} 件（期待 ${f.ignoredCount}）`);
  const events = await run.repo.events.read(tenant);
  for (const [type, n] of Object.entries(f.eventCounts)) {
    const actual = events.filter((e) => e.type === type).length;
    if (actual !== n) errors.push(`final: ${type} が ${actual} 件（期待 ${n}）`);
  }
  // 無視は全件、理由付きの監査イベントが残る
  for (const e of events) {
    if (e.type === 'IngestDecided' && e.payload.decision.kind === 'ignore' && !e.payload.reason.trim()) {
      errors.push(`ignore without reason: seq ${e.seq}`);
    }
  }

  // H3 可視性
  const dir = new Directory(scenario.seed);
  for (const check of scenario.expected.visibility) {
    if ('ghostParty' in check) {
      const party = dir.party(check.ghostParty);
      if (!party) errors.push(`visibility: party ${check.ghostParty} がない`);
      else if (party.userId) errors.push(`visibility: ${check.ghostParty} はゴーストではない`);
      continue;
    }
    const viewer = deriveViewer(dir, check.as);
    if ('signals' in check) {
      const n = visibleSignals(viewer, p).length;
      if (n !== check.signals) errors.push(`visibility: ${check.as} の見えるシグナル ${n} 件（期待 ${check.signals}）`);
      continue;
    }
    const view = getTaskView(dir, viewer, p, resolve(check.task));
    const access = view?.access ?? null;
    if (access !== check.access) errors.push(`visibility: ${check.as} → ${check.task} は ${access}（期待 ${check.access}）`);
    const json = JSON.stringify(view ?? null);
    for (const s of check.mustContain) if (!json.includes(s)) errors.push(`visibility: ${check.as} → ${check.task} に「${s}」が見えない`);
    for (const s of check.mustNotContain) if (json.includes(s)) errors.push(`visibility: ${check.as} → ${check.task} に「${s}」が見えてしまう`);
  }

  const metrics = await ingestMetrics(run);
  errors.push(...metrics.mismatches.map((m) => `ingest: ${m}`));

  const approvals = { total: 0, internal: 0, external: 0 };
  for (const e of events) {
    if (e.type !== 'DerivationApproved') continue;
    approvals.total++;
    if (p.derivations[e.payload.derivationId]?.mode === 'internal') approvals.internal++;
    else approvals.external++;
  }

  const replay = await replayCheck(service, tenant);
  if (replay.before !== replay.after || !replay.fullMatch) errors.push(`H1: リプレイ後の投影が一致しない (${replay.before} != ${replay.after})`);

  return { errors, metrics, approvals, replayHashMatches: replay.before === replay.after && replay.fullMatch, taskHash: replay.before };
}
