import { Hono, type Context } from 'hono';
import { ZodError } from 'zod';
import { DomainError } from '../domain';
import type { MurmurService } from '../app/service';
import {
  AddNoteBody,
  ClaimBody,
  DismissBody,
  GetThreadQuery,
  InboundItemBody,
  LinkBody,
  ListListsQuery,
  ListThreadsQuery,
  MoveSignalBody,
  RecordSentBody,
  ReopenBody,
  SetAttributeBody,
} from '../api/schemas';
import { bearerToken } from '../auth/claims';
import { adminHref, renderAdminIndex, renderAdminList, renderAdminThread, renderTimeline } from './admin';

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

  api.get('/threads', async (c) => {
    const q = ListThreadsQuery.parse(c.req.query());
    return c.json(await c.var.service.listThreads(c.var.userId, { filter: q.filter, tenantId: q.tenant, dataSourceId: q.data_source, since: q.since }));
  });

  api.get('/threads/:id', async (c) => {
    const q = GetThreadQuery.parse(c.req.query());
    return c.json(await c.var.service.getThread(c.var.userId, c.req.param('id'), { since: q.since }));
  });

  api.post('/notes', async (c) => {
    const b = AddNoteBody.parse(await json(c));
    return c.json(await c.var.service.addNote(c.var.userId, { threadId: b.thread_id, title: b.title, body: b.body, tenantId: b.tenant }));
  });

  api.post('/threads/:id/claim', async (c) => {
    const b = ClaimBody.parse(await json(c));
    const userId = b.user_id === undefined ? c.var.userId : b.user_id;
    return c.json(await c.var.service.claimThread(c.var.userId, { threadId: c.req.param('id'), userId, reason: b.reason }));
  });

  api.post('/threads/:id/links', async (c) => {
    const b = LinkBody.parse(await json(c));
    return c.json(await c.var.service.linkThreads(c.var.userId, { threadId: c.req.param('id'), otherThreadId: b.thread_id, reason: b.reason }));
  });

  api.post('/threads/:id/unlink', async (c) => {
    const b = LinkBody.parse(await json(c));
    return c.json(await c.var.service.unlinkThreads(c.var.userId, { threadId: c.req.param('id'), otherThreadId: b.thread_id, reason: b.reason }));
  });

  api.post('/sent', async (c) => {
    const b = RecordSentBody.parse(await json(c));
    const a = b.anchors;
    return c.json(
      await c.var.service.recordSent(c.var.userId, {
        dataSourceId: b.data_source,
        to: b.to,
        toPartyIds: b.to_party_ids,
        subject: b.subject,
        body: b.body,
        sentRef: b.sent_ref,
        anchors: {
          inReplyTo: a.in_reply_to,
          threadTs: a.thread_ts,
          quotedMessageId: a.quoted_message_id,
          threadKey: a.thread_key,
          jiraKeys: a.jira_keys,
          prRefs: a.pr_refs,
        },
        replyToThreadId: b.reply_to_thread_id,
        sourceThreadId: b.source_thread_id,
        replyExpectedBy: b.reply_expected_by,
      }),
    );
  });

  api.post('/threads/:id/attributes', async (c) => {
    const b = SetAttributeBody.parse(await json(c));
    return c.json(await c.var.service.setAttribute(c.var.userId, { threadId: c.req.param('id'), name: b.name, value: b.value ?? null }));
  });

  api.post('/threads/:id/dismiss', async (c) => {
    const b = DismissBody.parse(await json(c));
    return c.json(await c.var.service.dismissThread(c.var.userId, { threadId: c.req.param('id'), reason: b.reason }));
  });

  api.post('/threads/:id/reopen', async (c) => {
    const b = ReopenBody.parse(await json(c));
    return c.json(await c.var.service.reopenThread(c.var.userId, { threadId: c.req.param('id'), reason: b.reason }));
  });

  api.post('/signals/:id/move', async (c) => {
    const b = MoveSignalBody.parse(await json(c));
    const to = b.thread_id !== undefined ? { kind: 'existing' as const, threadId: b.thread_id } : { kind: 'new' as const, title: b.new_thread_title! };
    return c.json(
      await c.var.service.moveSignal(c.var.userId, { signalId: c.req.param('id'), to, needsResponse: b.needs_response, reason: b.reason }),
    );
  });

  api.get('/lists', async (c) => {
    const q = ListListsQuery.parse(c.req.query());
    return c.json(await c.var.service.listLists(c.var.userId, { tenantId: q.tenant }));
  });

  api.get('/lists/:id', async (c) => c.json(await c.var.service.getList(c.var.userId, c.req.param('id'))));

  app.route('/api', api);

  // ---- 公開ルート: Webhook と、TIMELINE_TOKEN で守る参照専用の画面（timeline.html・/admin）だけ ----

  app.post('/webhooks/dummy/:tenantId', async (c) => {
    const raw = await c.req.text();
    const sig = c.req.header('x-murmur-signature') ?? '';
    if (!(await opts.webhookVerify(raw, sig))) return c.json({ error: 'bad signature' }, 401);
    const parsed = InboundItemBody.array().parse(JSON.parse(raw));
    const results = [];
    for (const item of parsed) results.push(await c.var.service.ingestItem(c.req.param('tenantId'), item));
    return c.json(results);
  });

  // 参照専用の画面。全データソースが見えるので TIMELINE_TOKEN を知っている人だけ（知らなければ 404）
  const operatorOnly = (c: Context) => !!opts.timelineToken && c.req.query('token') === opts.timelineToken;

  app.get('/timeline.html', async (c) => {
    if (!operatorOnly(c)) return c.text('not found', 404);
    const tenantId = c.req.query('tenant') ?? '';
    const service = c.var.service;
    const [p, dir] = await Promise.all([service.state(tenantId), service.directory()]);
    return c.html(renderTimeline(dir, p));
  });

  app.get('/admin', async (c) => {
    if (!operatorOnly(c)) return c.text('not found', 404);
    const service = c.var.service;
    const dir = await service.directory();
    const states = await Promise.all(dir.tenantIds().map((id) => service.state(id)));
    return c.html(renderAdminIndex(dir, states, adminHref(opts.timelineToken!)));
  });

  app.get('/admin/lists/:id', async (c) => {
    if (!operatorOnly(c)) return c.text('not found', 404);
    const service = c.var.service;
    const dir = await service.directory();
    const list = dir.list(c.req.param('id'));
    const html = list ? renderAdminList(dir, await service.state(list.tenantId), list.id, adminHref(opts.timelineToken!)) : null;
    return html ? c.html(html) : c.text('not found', 404);
  });

  app.get('/admin/threads/:id', async (c) => {
    if (!operatorOnly(c)) return c.text('not found', 404);
    const service = c.var.service;
    const dir = await service.directory();
    for (const tenantId of dir.tenantIds()) {
      const html = renderAdminThread(dir, await service.state(tenantId), c.req.param('id'), adminHref(opts.timelineToken!));
      if (html) return c.html(html);
    }
    return c.text('not found', 404);
  });

  return app;
}
