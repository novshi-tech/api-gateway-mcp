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
    expect((await call('GET', `/api/threads/${threadId}`, 'u_alice')).body.log).toHaveLength(2);
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
    expect((await call('GET', '/api/lists/l_alice', 'u_bob')).status).toBe(404);
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
});
