import { Hono, type Context } from 'hono';
import { ZodError } from 'zod';
import { DomainError } from '../domain';
import type { MurmurService } from '../app/service';
import {
  ApproveBody,
  CloseBody,
  CorrectIngestBody,
  ExplainIgnoreQuery,
  InboundSignalBody,
  ListMyTasksQuery,
  ListProposalsQuery,
  ProposeDerivationBody,
  RejectBody,
  SetAttributeBody,
} from '../api/schemas';
import { bearerToken } from '../auth/claims';
import { renderTimeline } from './timeline';

export interface HttpOptions {
  /** リクエストごとにサービスを組み立てる（Worker では DB 接続をリクエスト単位で張る） */
  service: (c: Context) => Promise<MurmurService> | MurmurService;
  /** 伝搬されたユーザー識別を検証して sub（User ID）を返す。失敗なら null */
  authenticate: (token: string) => Promise<string | null>;
  webhookVerify: (body: string, signature: string) => Promise<boolean>;
  timelineToken?: string;
}

type Env = { Variables: { userId: string; service: MurmurService } };

const STATUS: Record<DomainError['code'], 400 | 403 | 404 | 409> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

export function createApp(opts: HttpOptions) {
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: err.code, message: err.message }, STATUS[err.code]);
    if (err instanceof ZodError) return c.json({ error: 'invalid', message: err.issues }, 400);
    console.error(err);
    return c.json({ error: 'internal', message: 'internal error' }, 500);
  });

  app.use('*', async (c, next) => {
    c.set('service', await opts.service(c));
    await next();
  });

  // ---- スタンド向け API（ゲートウェイ経由。ゲートウェイが署名したユーザー識別を必須にする） ----

  const api = new Hono<Env>();
  api.use('*', async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    const userId = token ? await opts.authenticate(token) : null;
    if (!userId) return c.json({ error: 'unauthenticated' }, 401);
    c.set('userId', userId);
    await next();
  });

  const json = async (c: Context) => {
    try {
      return await c.req.json();
    } catch {
      return {};
    }
  };

  api.get('/me', async (c) => c.json(await c.var.service.me(c.var.userId)));

  api.get('/tasks', async (c) => {
    const q = ListMyTasksQuery.parse(c.req.query());
    return c.json(await c.var.service.listMyTasks(c.var.userId, q.filter, q.tenant));
  });

  api.get('/tasks/:id', async (c) => c.json(await c.var.service.getTask(c.var.userId, c.req.param('id'))));

  api.post('/tasks/:id/attributes', async (c) => {
    const b = SetAttributeBody.parse(await json(c));
    return c.json(await c.var.service.setAttribute(c.var.userId, { taskId: c.req.param('id'), name: b.name, value: b.value }));
  });

  api.post('/tasks/:id/close', async (c) => {
    const b = CloseBody.parse(await json(c));
    return c.json(await c.var.service.closeTask(c.var.userId, { taskId: c.req.param('id'), reason: b.reason }));
  });

  api.post('/tasks/:id/reopen', async (c) => c.json(await c.var.service.reopenTask(c.var.userId, { taskId: c.req.param('id') })));

  api.post('/derivations', async (c) => {
    const b = ProposeDerivationBody.parse(await json(c));
    const d = await c.var.service.proposeDerivation(c.var.userId, {
      taskId: b.task_id,
      targetListId: b.target_list,
      title: b.title,
      body: b.body,
      instruction: b.instruction,
      attachments: b.attachments,
      toPartyIds: b.to_parties,
      replyExpected: b.reply_expected ?? null,
      replyToDerivationId: b.reply_to,
    });
    return c.json(d, 201);
  });

  api.get('/proposals', async (c) => {
    const q = ListProposalsQuery.parse(c.req.query());
    return c.json(await c.var.service.listProposals(c.var.userId, q.list_id));
  });

  api.post('/derivations/:id/approve', async (c) => {
    const b = ApproveBody.parse(await json(c));
    return c.json(await c.var.service.approveDerivation(c.var.userId, { derivationId: c.req.param('id'), fromAddress: b.from_address }));
  });

  api.post('/derivations/:id/reject', async (c) => {
    const b = RejectBody.parse(await json(c));
    return c.json(await c.var.service.rejectDerivation(c.var.userId, { derivationId: c.req.param('id'), reason: b.reason }));
  });

  api.post('/signals/:id/correct', async (c) => {
    const b = CorrectIngestBody.parse(await json(c));
    const d = b.decision;
    const decision =
      d.kind === 'attach'
        ? { kind: 'attach' as const, taskId: d.task_id }
        : d.kind === 'new'
          ? { kind: 'new' as const, listId: d.list_id, title: d.title }
          : { kind: 'ignore' as const };
    return c.json(await c.var.service.correctIngest(c.var.userId, { signalId: c.req.param('id'), decision, reason: b.reason }));
  });

  api.get('/ignores', async (c) => {
    const q = ExplainIgnoreQuery.parse(c.req.query());
    return c.json(await c.var.service.explainIgnore(c.var.userId, q.since));
  });

  api.get('/lists/:id', async (c) => c.json(await c.var.service.getList(c.var.userId, c.req.param('id'))));

  app.route('/api', api);

  // ---- 公開ルート: Webhook と timeline.html だけ ----

  app.post('/webhooks/dummy/:tenantId', async (c) => {
    const raw = await c.req.text();
    const sig = c.req.header('x-murmur-signature') ?? '';
    if (!(await opts.webhookVerify(raw, sig))) return c.json({ error: 'bad signature' }, 401);
    const parsed = InboundSignalBody.array().parse(JSON.parse(raw));
    const results = [];
    for (const s of parsed) results.push(await c.var.service.ingest(c.req.param('tenantId'), s));
    return c.json(results);
  });

  app.get('/timeline.html', async (c) => {
    // 読み取り専用の確認用ページ。全リストが見えるので TIMELINE_TOKEN を知っている人だけ
    if (!opts.timelineToken || c.req.query('token') !== opts.timelineToken) return c.text('not found', 404);
    const tenantId = c.req.query('tenant') ?? '';
    const service = c.var.service;
    const [p, dir] = await Promise.all([service.state(tenantId), service.directory()]);
    return c.html(renderTimeline(dir, p));
  });

  return app;
}
