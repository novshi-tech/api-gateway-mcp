import { beforeAll, describe, expect, it } from 'vitest';
import { base64UrlEncode, IDENTITY_HEADER } from '../../src/auth/claims';
import { signWebhook, verifyIdentity, verifyWebhookSignature } from '../../src/auth/identity';
import { createApp } from '../../src/http/app';
import type { AiDecision } from '../../src/domain';
import { makeService } from '../helpers/service';
import { email, seed } from '../helpers/world';

// ゲートウェイ役: Ed25519 で sub に署名する
let keys: CryptoKeyPair;
let publicJwk: JsonWebKey;
const NOW = 1_800_000_000;

async function sign(claims: Record<string, unknown>, key = keys.privateKey, alg = 'EdDSA'): Promise<string> {
  const enc = (o: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg, typ: 'JWT' })}.${enc(claims)}`;
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(input)));
  return `${input}.${base64UrlEncode(sig)}`;
}
const claims = (sub: string) => ({ sub, aud: 'murmur', iat: NOW, exp: NOW + 300 });

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
});

describe('verifyIdentity', () => {
  it('ゲートウェイの署名だけを受け入れる', async () => {
    expect(await verifyIdentity(await sign(claims('u_alice')), publicJwk, 'murmur', NOW)).toEqual({ ok: true, sub: 'u_alice' });
    const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    expect(await verifyIdentity(await sign(claims('u_alice'), other.privateKey), publicJwk, 'murmur', NOW)).toEqual({ ok: false, reason: 'bad signature' });
    expect(await verifyIdentity(await sign(claims('u_alice'), keys.privateKey, 'none'), publicJwk, 'murmur', NOW)).toEqual({ ok: false, reason: 'unsupported alg' });
    expect(await verifyIdentity('garbage', publicJwk, 'murmur', NOW)).toEqual({ ok: false, reason: 'malformed token' });
    // 署名部分の改ざん
    const t = await sign(claims('u_alice'));
    const [h, , s] = t.split('.');
    const forged = `${h}.${base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims('u_bob'))))}.${s}`;
    expect((await verifyIdentity(forged, publicJwk, 'murmur', NOW)).ok).toBe(false);
  });

  it('Webhook の HMAC 署名', async () => {
    const sig = await signWebhook('body', 'secret');
    expect(await verifyWebhookSignature('body', sig, 'secret')).toBe(true);
    expect(await verifyWebhookSignature('body2', sig, 'secret')).toBe(false);
    expect(await verifyWebhookSignature('body', 'zz', 'secret')).toBe(false);
  });
});

describe('HTTP API', () => {
  const newIn: AiDecision = { decision: 'new', task_id: null, list_id: 'l_cust', title: '雨漏り', reason: 'r', confidence: 0.9 };

  async function app() {
    const ctx = await makeService(seed, { decide: () => newIn });
    const http = createApp({
      service: () => ctx.service,
      authenticate: async (token) => {
        const r = await verifyIdentity(token, publicJwk, 'murmur', NOW);
        return r.ok ? r.sub : null;
      },
      webhookVerify: (body, sig) => verifyWebhookSignature(body, sig, 'whsec'),
      timelineToken: 'tok',
    });
    const call = async (method: string, path: string, user?: string, body?: unknown) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (user) headers[IDENTITY_HEADER] = await sign(claims(user));
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
    const res = await http.request('/api/me', { headers: { [IDENTITY_HEADER]: 'x.y.z' } });
    expect(res.status).toBe(401);
  });

  it('/me・タスク・属性・派生・承認・訂正・無視・リストの一通り', async () => {
    const { call, service } = await app();
    expect((await call('GET', '/api/me', 'u_alice')).body.parties).toHaveLength(2);

    await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1' }));
    const tasks = (await call('GET', '/api/tasks?filter=open', 'u_alice')).body as { id: string }[];
    expect(tasks).toHaveLength(1);
    const taskId = tasks[0]!.id;
    expect((await call('GET', `/api/tasks/${taskId}`, 'u_alice')).body.access).toBe('full');
    expect((await call('GET', `/api/tasks/${taskId}`, 'u_eve')).status).toBe(404);

    // 内部リストへ派生 → 承認 → 内部タスクに属性
    const proposed = await call('POST', '/api/derivations', 'u_alice', { task_id: taskId, target_list: 'l_int', body: '手配して' });
    expect(proposed.status).toBe(201);
    expect((await call('GET', '/api/proposals', 'u_alice')).body).toHaveLength(1);
    const approved = await call('POST', `/api/derivations/${proposed.body.id}/approve`, 'u_alice', {});
    expect(approved.body.status).toBe('completed');
    const internal = approved.body.targetTaskId as string;
    const set = await call('POST', `/api/tasks/${internal}/attributes`, 'u_alice', { name: 'status', value: 'doing' });
    expect(set.body.task.attributes).toEqual({ status: 'doing' });
    expect((await call('POST', `/api/tasks/${internal}/attributes`, 'u_alice', { name: 'status', value: 'x' })).status).toBe(400);

    expect((await call('POST', `/api/tasks/${internal}/close`, 'u_alice')).body.task.status).toBe('closed');
    expect((await call('POST', `/api/tasks/${internal}/reopen`, 'u_alice')).body.task.status).toBe('open');

    // 却下は提案中にだけ
    const p2 = await call('POST', '/api/derivations', 'u_alice', { task_id: taskId, target_list: 'l_int', body: 'もう一件' });
    expect((await call('POST', `/api/derivations/${p2.body.id}/reject`, 'u_alice', { reason: '重複' })).body.status).toBe('rejected');
    expect((await call('POST', `/api/derivations/${p2.body.id}/approve`, 'u_alice', {})).status).toBe(409);

    // 訂正と無視の監査
    const signalId = Object.keys((await service.state('ubs')).signals)[0]!;
    const corrected = await call('POST', `/api/signals/${signalId}/correct`, 'u_alice', { decision: { kind: 'ignore' }, reason: '誤検知' });
    expect(corrected.body.decision).toBe('ignore');
    const ignores = (await call('GET', '/api/ignores', 'u_alice')).body as { reason: string }[];
    expect(ignores.map((i) => i.reason)).toEqual(['誤検知']);

    expect((await call('GET', '/api/lists/l_cust', 'u_alice')).body.name).toBe('顧客窓口');
    expect((await call('GET', '/api/lists/l_cust', 'u_bob')).status).toBe(404);
  });

  it('入力の検証エラーは 400', async () => {
    const { call } = await app();
    expect((await call('POST', '/api/derivations', 'u_alice', { task_id: 't' })).status).toBe(400);
    expect((await call('GET', '/api/tasks?filter=weird', 'u_alice')).status).toBe(400);
  });

  it('Webhook は署名が合うときだけ取り込む', async () => {
    const { http, service } = await app();
    const body = JSON.stringify([email({ from: 'carol@example.com', sourceRef: 'w1' })]);
    const bad = await http.request('/webhooks/dummy/ubs', { method: 'POST', body, headers: { 'x-murmur-signature': '00' } });
    expect(bad.status).toBe(401);
    const ok = await http.request('/webhooks/dummy/ubs', { method: 'POST', body, headers: { 'x-murmur-signature': await signWebhook(body, 'whsec') } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject([{ status: 'created' }]);
    expect(Object.keys((await service.state('ubs')).tasks)).toHaveLength(1);
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
});
