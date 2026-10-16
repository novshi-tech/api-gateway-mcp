import { describe, expect, it } from 'vitest';
import { canonicalJson, deriveViewer, isMemberOfList } from '../../src/domain';
import { checkClaims, splitCompactJws, base64UrlEncode, base64UrlDecode } from '../../src/auth/claims';
import { dir } from '../helpers/world';

describe('Directory', () => {
  it('取得主体ルール: Organization はチャネルの許可リスト、User は自分の所属リスト', () => {
    expect(dir.allowedListIds('ubs', { kind: 'organization', tenantId: 'ubs' }, 'email')).toEqual(['l_cust', 'l_partner']);
    expect(dir.allowedListIds('ubs', { kind: 'organization', tenantId: 'ubs' }, 'line')).toEqual([]);
    expect(dir.allowedListIds('ubs', { kind: 'organization', tenantId: 'nvt' }, 'email')).toEqual([]);
    expect(dir.allowedListIds('ubs', { kind: 'user', userId: 'u_alice' }, 'email')).toEqual(['l_cust', 'l_int']);
    // 別テナントの所属は混ざらない
    expect(dir.allowedListIds('nvt', { kind: 'user', userId: 'u_alice' }, 'slack')).toEqual([]);
    expect(dir.allowedListIds('ubs', { kind: 'user', userId: 'u_nobody' }, 'email')).toEqual([]);
  });

  it('Address は期間付きで、大文字小文字を区別しない', () => {
    expect(dir.partyIdOfAddress('ubs', { channel: 'email', value: 'OLD@dave.example' }, '2025-06-01T00:00:00Z')).toBe('p_dave');
    expect(dir.partyIdOfAddress('ubs', { channel: 'email', value: 'old@dave.example' }, '2026-06-01T00:00:00Z')).toBeNull();
    expect(dir.partyIdOfAddress('nvt', { channel: 'email', value: 'info@dave.example' })).toBeNull();
    expect(dir.isInternalAddress('ubs', { channel: 'email', value: 'support@ubs.example' })).toBe(true);
    expect(dir.isInternalAddress('ubs', { channel: 'email', value: 'carol@example.com' })).toBe(false);
  });

  it('Viewer は User の各テナントの Party と所属リストを束ねる', () => {
    const v = deriveViewer(dir, 'u_alice');
    expect(v.memberships).toEqual([
      { tenantId: 'ubs', partyId: 'p_alice', listIds: ['l_cust', 'l_int'] },
      { tenantId: 'nvt', partyId: 'p_alice_nvt', listIds: [] },
    ]);
    expect(isMemberOfList(v, 'ubs', 'l_int')).toBe(true);
    expect(isMemberOfList(v, 'nvt', 'l_int')).toBe(false);
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
    expect(checkClaims(ok, 'murmur', now)).toEqual({ ok: true, sub: 'u_alice' });
    expect(checkClaims({ ...ok, aud: ['x', 'murmur'] }, 'murmur', now).ok).toBe(true);
    expect(checkClaims({ ...ok, aud: 'other' }, 'murmur', now)).toEqual({ ok: false, reason: 'audience mismatch' });
    expect(checkClaims({ ...ok, exp: now - 31 }, 'murmur', now)).toEqual({ ok: false, reason: 'expired' });
    expect(checkClaims({ ...ok, exp: now - 29 }, 'murmur', now).ok).toBe(true);
    expect(checkClaims({ ...ok, iat: now + 60 }, 'murmur', now)).toEqual({ ok: false, reason: 'issued in the future' });
    expect(checkClaims({ ...ok, exp: now + 7200 }, 'murmur', now)).toEqual({ ok: false, reason: 'lifetime too long' });
    expect(checkClaims({ ...ok, sub: '' }, 'murmur', now)).toEqual({ ok: false, reason: 'malformed claims' });
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
