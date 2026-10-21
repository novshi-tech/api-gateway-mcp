import { beforeAll, describe, expect, it } from 'vitest';
import { base64UrlEncode } from '../../src/auth/claims';
import { signWebhook, verifyIdentity, verifyWebhookSignature } from '../../src/auth/identity';
import { MoveSignalBody } from '../../src/api/schemas';
import { createApp } from '../../src/http/app';
import { makeService } from '../helpers/service';
import { answer, email, seed } from '../helpers/world';

// ゲートウェイ役: Ed25519 で sub に署名する
let keys: CryptoKeyPair;
let jwks: { keys: JsonWebKey[] };
const ISS = 'https://gw.example';
const expect_ = { audience: 'murmur', issuer: ISS };
const NOW = 1_800_000_000;

async function sign(claims: Record<string, unknown>, key = keys.privateKey, alg = 'EdDSA', kid = 'gw-1'): Promise<string> {
  const enc = (o: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg, typ: 'JWT', kid })}.${enc(claims)}`;
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(input)));
  return `${input}.${base64UrlEncode(sig)}`;
}
// api-gateway-mcp の identity と同じ形（iss = ゲートウェイの URL、寿命 5 分）
const claims = (sub: string) => ({ sub, iss: ISS, aud: 'murmur', iat: NOW, exp: NOW + 300 });

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('jwk', keys.publicKey);
  jwks = { keys: [{ kty: pub.kty, crv: pub.crv, x: pub.x, kid: 'gw-1', alg: 'EdDSA', use: 'sig' } as JsonWebKey] };
});

describe('verifyIdentity', () => {
  it('ゲートウェイの署名だけを受け入れる', async () => {
    expect(await verifyIdentity(await sign(claims('u_alice')), jwks, expect_, NOW)).toEqual({ ok: true, sub: 'u_alice' });
    const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    expect(await verifyIdentity(await sign(claims('u_alice'), other.privateKey), jwks, expect_, NOW)).toEqual({ ok: false, reason: 'bad signature' });
    expect(await verifyIdentity(await sign(claims('u_alice'), keys.privateKey, 'none'), jwks, expect_, NOW)).toEqual({ ok: false, reason: 'unsupported alg' });
    expect(await verifyIdentity('garbage', jwks, expect_, NOW)).toEqual({ ok: false, reason: 'malformed token' });
    expect(await verifyIdentity(await sign(claims('u_alice'), keys.privateKey, 'EdDSA', 'rotated'), jwks, expect_, NOW)).toEqual({
      ok: false,
      reason: 'unknown key',
    });
    expect((await verifyIdentity(await sign({ ...claims('u_alice'), iss: 'https://evil.example' }), jwks, expect_, NOW)).ok).toBe(false);
    // 署名部分の改ざん
    const t = await sign(claims('u_alice'));
    const [h, , s] = t.split('.');
    const forged = `${h}.${base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims('u_bob'))))}.${s}`;
    expect((await verifyIdentity(forged, jwks, expect_, NOW)).ok).toBe(false);
  });

  it('Webhook の HMAC 署名', async () => {
    const sig = await signWebhook('body', 'secret');
    expect(await verifyWebhookSignature('body', sig, 'secret')).toBe(true);
    expect(await verifyWebhookSignature('body2', sig, 'secret')).toBe(false);
    expect(await verifyWebhookSignature('body', 'zz', 'secret')).toBe(false);
  });
});

describe('HTTP API', () => {
  async function app() {
    const ctx = await makeService(seed, { decide: () => answer({ title: '雨漏り' }) });
    const http = createApp({
      service: () => ctx.service,
      authenticate: async (token) => {
        const r = await verifyIdentity(token, jwks, expect_, NOW);
        return r.ok ? r.sub : null;
      },
      webhookVerify: (body, sig) => verifyWebhookSignature(body, sig, 'whsec'),
      timelineToken: 'tok',
    });
    const call = async (method: string, path: string, user?: string, body?: unknown) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (user) headers.authorization = `Bearer ${await sign(claims(user))}`;
      const res = await http.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
      return { status: res.status, body: out };
    };
    return { ...ctx, call, http };
  }

  it('伝搬されたユーザー識別がなければ 401', async () => {
    const { call, http } = await app();
    expect((await call('GET', '/api/me')).status).toBe(401);
    const res = await http.request('/api/me', { headers: { authorization: 'Bearer x.y.z' } });
    expect(res.status).toBe(401);
    // 仮決めだった旧ヘッダは受け付けない
    const legacy = await http.request('/api/me', { headers: { 'x-murmur-identity': await sign(claims('u_alice')) } });
    expect(legacy.status).toBe(401);
  });

  it('/me・スレッドの一覧と詳細・片付け・開き直し・移し替え・リストの一通り', async () => {
    const { call, service } = await app();
    expect((await call('GET', '/api/me', 'u_alice')).body.parties).toHaveLength(2);

    await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>' } }));
    const r2 = await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r2', anchors: { inReplyTo: '<m1>' } }));
    const threads = (await call('GET', '/api/threads?filter=triage', 'u_alice')).body as { id: string }[];
    expect(threads).toHaveLength(1);
    const threadId = threads[0]!.id;
    expect((await call('GET', `/api/threads/${threadId}`, 'u_alice')).body.timeline).toHaveLength(2);
    expect((await call('GET', `/api/threads/${threadId}`, 'u_eve')).status).toBe(404);
    expect((await call('GET', '/api/threads?data_source=ds_alice', 'u_alice')).body).toEqual([]);

    const dismissed = await call('POST', `/api/threads/${threadId}/dismiss`, 'u_bob', { reason: '対応不要' });
    expect(dismissed.body.thread).toMatchObject({ dismissed: true, dismissReason: '対応不要' });
    expect((await call('POST', `/api/threads/${threadId}/dismiss`, 'u_bob', {})).status).toBe(400);
    expect((await call('GET', '/api/threads', 'u_alice')).body).toEqual([]);
    expect((await call('POST', `/api/threads/${threadId}/reopen`, 'u_alice')).body.thread.dismissed).toBe(false);

    const moved = await call('POST', `/api/signals/${r2.signalId}/move`, 'u_alice', { new_thread_title: '別件', reason: '別の話題' });
    expect(moved.body.thread).toMatchObject({ title: '別件', signalCount: 1 });
    const back = await call('POST', `/api/signals/${r2.signalId}/move`, 'u_alice', { thread_id: threadId, needs_response: false, reason: '戻す' });
    expect(back.body.thread.signalCount).toBe(2);
    expect((await call('POST', `/api/signals/${r2.signalId}/move`, 'u_eve', { thread_id: threadId, reason: 'x' })).status).toBe(404);

    expect((await call('GET', '/api/lists/l_support', 'u_alice')).body.dataSource.name).toBe('support@');
    const lists = (await call('GET', '/api/lists', 'u_alice')).body as { id: string }[];
    expect(lists.map((l) => l.id)).toEqual(expect.arrayContaining(['l_support', 'l_alice', 'l_notes_alice']));
    expect(((await call('GET', '/api/lists', 'u_bob')).body as { id: string }[]).map((l) => l.id)).not.toContain('l_alice');
    expect((await call('GET', '/api/lists/l_alice', 'u_bob')).status).toBe(404);
  });

  it('H8 メモ・持ち主・リンク・属性・自分の番・タイムラインの since の一通り', async () => {
    const { call, service, clock } = await app();
    const r1 = await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>' } }));
    const threadId = r1.status === 'threaded' ? r1.threadId : '';
    expect((await call('GET', '/api/threads?filter=triage', 'u_bob')).body).toHaveLength(1);

    const claimed = await call('POST', `/api/threads/${threadId}/claim`, 'u_alice', { reason: '自分で持つ' });
    expect(claimed.body.thread).toMatchObject({ ownerUserId: 'u_alice', ball: { kind: 'user', userId: 'u_alice' }, turn: { kind: 'user', userIds: ['u_alice'], by: 'owner' } });
    expect((await call('GET', '/api/threads?filter=triage', 'u_bob')).body).toEqual([]);
    expect((await call('GET', '/api/threads?filter=my_turn', 'u_alice')).body.map((t: { id: string }) => t.id)).toEqual([threadId]);
    expect((await call('POST', `/api/threads/${threadId}/claim`, 'u_alice', { user_id: 'u_eve' })).status).toBe(400);
    const handed = await call('POST', `/api/threads/${threadId}/claim`, 'u_alice', { user_id: 'u_bob', reason: '引き継ぎ' });
    expect(handed.body.thread.ownerUserId).toBe('u_bob');

    clock.set('2026-10-16T10:00:00.000Z');
    const note = await call('POST', '/api/notes', 'u_alice', { body: 'Carol さんの雨漏りの件\n電話で状況を聞いた' });
    expect(note.body.thread).toMatchObject({ title: 'Carol さんの雨漏りの件', dataSourceId: 'ds_notes_alice', signalCount: 1 });
    const noteId = note.body.thread.id as string;
    expect((await call('POST', '/api/notes', 'u_bob', { thread_id: noteId, body: 'x' })).status).toBe(404);
    const more = await call('POST', '/api/notes', 'u_alice', { thread_id: noteId, body: '見積を依頼する' });
    expect(more.body.thread.signalCount).toBe(2);
    expect((await call('GET', '/api/threads?filter=mine', 'u_alice')).body.map((t: { id: string }) => t.id)).toEqual([noteId]);

    const linked = await call('POST', `/api/threads/${noteId}/links`, 'u_alice', { thread_id: threadId, reason: 'この件の問い合わせ' });
    expect(linked.body.thread.links).toMatchObject([{ threadId, route: 'manual' }]);
    expect(linked.body.timeline.map((e: { threadId: string }) => e.threadId)).toContain(threadId);
    // Bob には辺は見えるが、メモのスレッドの中身は見えない
    const bobView = await call('GET', `/api/threads/${threadId}`, 'u_bob');
    expect(bobView.body.linked).toEqual([expect.objectContaining({ threadId: noteId, visible: false })]);
    expect(JSON.stringify(bobView.body)).not.toContain('電話で状況');

    const attr = await call('POST', `/api/threads/${noteId}/attributes`, 'u_alice', { name: 'status', value: 'todo' });
    expect(attr.body.thread.attributes).toEqual({ status: 'todo' });
    expect((await call('POST', `/api/threads/${noteId}/attributes`, 'u_alice', { name: 'status', value: 'later' })).status).toBe(400);
    const since = await call('GET', `/api/threads/${noteId}?since=2026-10-16T09:30:00.000Z`, 'u_alice');
    expect(since.body.timeline.every((e: { at: string }) => e.at > '2026-10-16T09:30:00.000Z')).toBe(true);

    // list_threads の since: メモのスレッドは、結んだ先が動けば差分に入る（オフセット付きの時刻も受ける）
    clock.set('2026-10-16T11:00:00.000Z');
    await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r2', anchors: { inReplyTo: '<m1>' } }));
    const changed = await call('GET', '/api/threads?filter=mine&since=2026-10-16T19:30:00%2B09:00', 'u_alice');
    expect(changed.body.map((t: { id: string }) => t.id)).toEqual([noteId]);
    expect((await call('GET', '/api/threads?filter=mine&since=2026-10-16T12:00:00Z', 'u_alice')).body).toEqual([]);
    expect((await call('GET', '/api/threads?since=yesterday', 'u_alice')).status).toBe(400);

    const unlinked = await call('POST', `/api/threads/${noteId}/unlink`, 'u_alice', { thread_id: threadId });
    expect(unlinked.body.thread.links).toEqual([]);
  });

  it('H4 record_sent: 送ったスレッドを返し、返事期待はオフセット付きでも UTC にそろえる。期限を過ぎると overdue に出る', async () => {
    const { call, service, clock } = await app();
    const r1 = await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>' } }));
    const threadId = r1.status === 'threaded' ? r1.threadId : '';
    const res = await call('POST', '/api/sent', 'u_alice', {
      data_source: 'ds_support',
      to: ['carol@example.com'],
      body: '調査します',
      sent_ref: '<u1@ubs.example>',
      reply_to_thread_id: threadId,
      reply_expected_by: '2026-10-16T21:00:00+09:00',
    });
    expect(res.status).toBe(200);
    expect(res.body.thread).toMatchObject({ id: threadId, replyExpectedBy: '2026-10-16T12:00:00.000Z', ball: { kind: 'party', partyIds: ['p_carol'] } });
    expect((await call('POST', '/api/sent', 'u_eve', { data_source: 'ds_support', to: ['x'], body: 'b', sent_ref: 's' })).status).toBe(404);
    expect((await call('POST', '/api/sent', 'u_alice', { data_source: 'ds_support', body: 'b', sent_ref: 's' })).status).toBe(400);
    expect((await call('POST', '/api/sent', 'u_alice', { data_source: 'ds_support', to: ['x'], body: 'b', sent_ref: 's', reply_expected_by: '明日' })).status).toBe(400);
    clock.set('2026-10-16T13:00:00.000Z');
    expect(await service.tick()).toEqual({ ingested: 0, overdue: 1 });
    expect((await call('GET', '/api/threads?filter=overdue', 'u_alice')).body.map((t: { id: string }) => t.id)).toEqual([threadId]);
  });

  it('入力の検証エラーは 400', async () => {
    const { call } = await app();
    expect((await call('GET', '/api/threads?filter=weird', 'u_alice')).status).toBe(400);
    expect((await call('POST', '/api/signals/s/move', 'u_alice', { reason: 'x' })).status).toBe(400);
    expect(MoveSignalBody.safeParse({ thread_id: 't', new_thread_title: 'n', reason: 'x' }).success).toBe(false);
  });

  it('Webhook は署名が合うときだけ取り込む', async () => {
    const { http, service } = await app();
    const body = JSON.stringify([email({ from: 'carol@example.com', sourceRef: 'w1' })]);
    const bad = await http.request('/webhooks/dummy/ubs', { method: 'POST', body, headers: { 'x-murmur-signature': '00' } });
    expect(bad.status).toBe(401);
    const ok = await http.request('/webhooks/dummy/ubs', { method: 'POST', body, headers: { 'x-murmur-signature': await signWebhook(body, 'whsec') } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject([{ status: 'threaded', newThread: true }]);
    expect(Object.keys((await service.state('ubs')).threads)).toHaveLength(1);
  });

  it('timeline.html はトークンを知っている人にだけ、エスケープして返す', async () => {
    const { http, service } = await app();
    await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1', body: '<script>alert(1)</script>' }));
    expect((await http.request('/timeline.html?tenant=ubs')).status).toBe(404);
    const res = await http.request('/timeline.html?tenant=ubs&token=tok');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('雨漏り');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('管理画面はトークンを知っている人にだけ、リスト一覧 → スレッドの一覧とリンク → 詳細を返す', async () => {
    const { http, service, call } = await app();
    const r1 = await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1', body: '<img src=x onerror=alert(1)>', anchors: { messageId: '<m1>' } }));
    const threadId = r1.status === 'threaded' ? r1.threadId : '';
    const note = await call('POST', '/api/notes', 'u_alice', { body: 'Carol さんの件' });
    await call('POST', `/api/threads/${note.body.thread.id}/links`, 'u_alice', { thread_id: threadId });

    for (const path of ['/admin', '/admin/lists/l_support', `/admin/threads/${threadId}`]) {
      expect((await http.request(path)).status).toBe(404);
      expect((await http.request(`${path}?token=bad`)).status).toBe(404);
    }
    const index = await (await http.request('/admin?token=tok')).text();
    expect(index).toContain('support@');
    expect(index).toContain('/admin/lists/l_support?token=tok');

    const list = await (await http.request('/admin/lists/l_support?token=tok')).text();
    expect(list).toContain('雨漏り');
    expect(list).toContain('Carol さんの件');
    expect(list).toContain(`/admin/threads/${threadId}?token=tok`);
    expect((await http.request('/admin/lists/l_nope?token=tok')).status).toBe(404);

    const detail = await (await http.request(`/admin/threads/${threadId}?token=tok`)).text();
    expect(detail).toContain('&lt;img');
    expect(detail).not.toContain('<img src=x');
    expect(detail).toContain('Carol さんの件');
    const noteDetail = await (await http.request(`/admin/threads/${note.body.thread.id}?token=tok`)).text();
    // メモのスレッドのタイムラインに、結んだ先の受信が並ぶ
    expect(noteDetail).toContain('&lt;img');
    expect((await http.request('/admin/threads/thr_nope?token=tok')).status).toBe(404);
  });
});
