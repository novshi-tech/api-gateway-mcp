import { describe, expect, it } from 'vitest';
import { canonicalJson, canReadDataSource, deriveViewer, Seed, seedProblems, type SeedInput } from '../../src/domain';
import { bearerToken, checkClaims, selectKey, splitCompactJws, base64UrlEncode, base64UrlDecode } from '../../src/auth/claims';
import { dir, seed } from '../helpers/world';

describe('Directory', () => {
  it('Address は期間付きで、大文字小文字を区別しない', () => {
    expect(dir.contactIdOfAddress({ channel: 'email', value: 'OLD@dave.example' }, '2025-06-01T00:00:00Z')).toBe('p_dave');
    expect(dir.contactIdOfAddress({ channel: 'email', value: 'old@dave.example' }, '2026-06-01T00:00:00Z')).toBeNull();
    expect(dir.contactIdOfAddress({ channel: 'line', value: 'info@dave.example' })).toBeNull();
  });

  it('direction の判定: データソースの送信元（こちら）のアドレスか', () => {
    const support = dir.dataSource('ds_support')!;
    expect(dir.isSelfAddress(support, { channel: 'email', value: 'Support@ubs.example' })).toBe(true);
    // 社員のアドレスでも、そのデータソースの送信元でなければ「こちら」ではない
    expect(dir.isSelfAddress(support, { channel: 'email', value: 'alice@ubs.example' })).toBe(false);
    expect(dir.isSelfAddress(dir.dataSource('ds_alice')!, { channel: 'email', value: 'alice@ubs.example' })).toBe(true);
    expect(dir.isSelfAddress(dir.dataSource('ds_notes_alice')!, { channel: 'email', value: 'alice@ubs.example' })).toBe(false);
  });

  it('H3 Viewer は User の Contact と、読者になっているリスト・データソースを束ねる', () => {
    const v = deriveViewer(dir, 'u_alice');
    expect(v).toEqual({
      userId: 'u_alice',
      contactId: 'p_alice',
      listIds: ['l_support', 'l_alice', 'l_notes_alice'],
      dataSourceIds: ['ds_support', 'ds_alice', 'ds_notes_alice'],
    });
    expect(canReadDataSource(v, 'ds_alice')).toBe(true);
    expect(canReadDataSource(v, 'ds_line')).toBe(false);
    // このデプロイに Contact のない User（チームの外）は何も読めない
    expect(deriveViewer(dir, 'u_mallory')).toEqual({ userId: 'u_mallory', contactId: null, listIds: [], dataSourceIds: [] });
    // ゴースト Contact は Viewer になれない
    expect(deriveViewer(dir, 'p_carol').contactId).toBeNull();
  });
});

describe('H3 マスタの整合性（seedProblems）', () => {
  it('テスト用の世界は整合している', () => {
    expect(seedProblems(seed)).toEqual([]);
  });

  const broken = (f: (s: SeedInput) => void) => {
    const s = structuredClone(seed) as SeedInput;
    f(s);
    return seedProblems(Seed.parse(s));
  };

  it('データソース 1 つにリスト 1 つ', () => {
    expect(broken((s) => s.lists!.push({ id: 'l_dup', dataSourceId: 'ds_support' })).join()).toMatch(/ds_support: リストが 2 個/);
    expect(broken((s) => (s.lists = s.lists!.filter((l) => l.id !== 'l_line'))).join()).toMatch(/ds_line: リストが 0 個/);
  });

  it('個人のメモの読者は本人だけ', () => {
    expect(broken((s) => s.listMembers!.push({ listId: 'l_notes_alice', contactId: 'p_bob' })).join()).toMatch(/個人のメモの読者は本人/);
  });

  it('個人の資格情報は読者 1 人（その本人）のデータソースにしか使わない', () => {
    expect(broken((s) => s.listMembers!.push({ listId: 'l_alice', contactId: 'p_bob' })).join()).toMatch(/個人の資格情報/);
    // 組織の資格情報なら読者が複数でよい
    expect(broken((s) => s.listMembers!.push({ listId: 'l_line', contactId: 'p_alice' }))).toEqual([]);
  });

  it('読者は User を持つ Contact だけ（ゴーストは読者になれない）', () => {
    expect(broken((s) => s.listMembers!.push({ listId: 'l_support', contactId: 'p_carol' })).join()).toMatch(/ゴースト/);
  });

  it('User の Contact は 1 つまで（1 デプロイ = 1 チーム）', () => {
    expect(broken((s) => s.contacts!.push({ id: 'p_alice2', name: 'Alice', userId: 'u_alice' })).join()).toMatch(/u_alice: Contact が 2 個/);
  });

  it('送信元のアドレスはデータソースのチャネルのもの', () => {
    const problems = broken((s) => {
      const ds = s.dataSources!.find((d) => d.id === 'ds_support')!;
      if (ds.kind === 'service') ds.selfAddressIds = ['a_oa'];
    });
    expect(problems.join()).toMatch(/送信元のアドレス a_oa が不正/);
  });
});

describe('canonicalJson', () => {
  it('キー順に依存せず、undefined を落とす', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: undefined }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe('ユーザー識別のクレーム検証', () => {
  const now = 1_800_000_000;
  const ok = { sub: 'u_alice', aud: 'murmur', iat: now - 10, exp: now + 290 };

  it('aud・期限・発行時刻・寿命を確かめる', () => {
    expect(checkClaims(ok, { audience: 'murmur' }, now)).toEqual({ ok: true, sub: 'u_alice' });
    expect(checkClaims({ ...ok, aud: ['x', 'murmur'] }, { audience: 'murmur' }, now).ok).toBe(true);
    expect(checkClaims({ ...ok, aud: 'other' }, { audience: 'murmur' }, now)).toEqual({ ok: false, reason: 'audience mismatch' });
    expect(checkClaims({ ...ok, exp: now - 31 }, { audience: 'murmur' }, now)).toEqual({ ok: false, reason: 'expired' });
    expect(checkClaims({ ...ok, exp: now - 29 }, { audience: 'murmur' }, now).ok).toBe(true);
    expect(checkClaims({ ...ok, iat: now + 60 }, { audience: 'murmur' }, now)).toEqual({ ok: false, reason: 'issued in the future' });
    expect(checkClaims({ ...ok, exp: now + 7200 }, { audience: 'murmur' }, now)).toEqual({ ok: false, reason: 'lifetime too long' });
    expect(checkClaims({ ...ok, sub: '' }, { audience: 'murmur' }, now)).toEqual({ ok: false, reason: 'malformed claims' });
  });

  it('iss を期待するときはゲートウェイの URL と一致すること', () => {
    const withIss = { ...ok, iss: 'https://gw.example' };
    expect(checkClaims(withIss, { audience: 'murmur', issuer: 'https://gw.example' }, now).ok).toBe(true);
    expect(checkClaims(withIss, { audience: 'murmur', issuer: 'https://other.example' }, now)).toEqual({ ok: false, reason: 'issuer mismatch' });
    expect(checkClaims(ok, { audience: 'murmur', issuer: 'https://gw.example' }, now)).toEqual({ ok: false, reason: 'issuer mismatch' });
  });

  it('Authorization ヘッダから Bearer トークンを取り出す', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer   x')).toBe('x');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it('JWKS から kid に合う Ed25519 の鍵を選ぶ', () => {
    const a = { kty: 'OKP', crv: 'Ed25519', x: 'AAA', kid: 'a' };
    const b = { kty: 'OKP', crv: 'Ed25519', x: 'BBB', kid: 'b' };
    const rsa = { kty: 'RSA', n: 'x', e: 'AQAB', kid: 'r' };
    expect(selectKey({ keys: [a, b, rsa] }, 'b')).toBe(b);
    expect(selectKey({ keys: [a, b] }, 'zzz')).toBeNull();
    expect(selectKey({ keys: [rsa] }, 'r')).toBeNull();
    // kid がなければ、鍵が 1 つのときだけ使う
    expect(selectKey({ keys: [a] }, undefined)).toBe(a);
    expect(selectKey({ keys: [a, b] }, undefined)).toBeNull();
    // 単体の JWK でもよい
    expect(selectKey(a, 'a')).toBe(a);
    expect(selectKey(null, undefined)).toBeNull();
  });

  it('compact JWS を分解でき、壊れたものは null', () => {
    const enc = (o: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
    const token = `${enc({ alg: 'EdDSA' })}.${enc(ok)}.${base64UrlEncode(new Uint8Array([1, 2, 255]))}`;
    const jws = splitCompactJws(token);
    expect(jws?.header).toEqual({ alg: 'EdDSA' });
    expect(jws?.claims).toEqual(ok);
    expect([...jws!.signature]).toEqual([1, 2, 255]);
    expect(splitCompactJws('a.b')).toBeNull();
    expect(splitCompactJws('!!!.@@@.###')).toBeNull();
    expect([...base64UrlDecode(base64UrlEncode(new Uint8Array([251, 252, 253, 254])))]).toEqual([251, 252, 253, 254]);
  });
});
