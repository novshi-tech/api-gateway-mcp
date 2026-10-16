import { z } from 'zod';

// ゲートウェイから伝搬されるユーザー識別（署名付き sub）の中身。検証ロジックは純関数。

export const IDENTITY_HEADER = 'x-murmur-identity';

export const IdentityClaims = z.object({
  /** ゲートウェイの User ID（IdP の subject ではなく、束ねた User の ID） */
  sub: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  iat: z.number(),
  exp: z.number(),
  iss: z.string().optional(),
});
export type IdentityClaims = z.infer<typeof IdentityClaims>;

export type ClaimsCheck = { ok: true; sub: string } | { ok: false; reason: string };

/** 署名検証のあとに呼ぶ。aud・期限・発行時刻を確かめる（時計のずれは leewaySec まで許す） */
export function checkClaims(raw: unknown, audience: string, nowSec: number, leewaySec = 30): ClaimsCheck {
  const parsed = IdentityClaims.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'malformed claims' };
  const c = parsed.data;
  const auds = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!auds.includes(audience)) return { ok: false, reason: 'audience mismatch' };
  if (c.exp + leewaySec < nowSec) return { ok: false, reason: 'expired' };
  if (c.iat - leewaySec > nowSec) return { ok: false, reason: 'issued in the future' };
  if (c.exp - c.iat > 3600) return { ok: false, reason: 'lifetime too long' };
  return { ok: true, sub: c.sub };
}

export function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function splitCompactJws(token: string): { header: unknown; claims: unknown; signingInput: string; signature: Uint8Array<ArrayBuffer> } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const dec = new TextDecoder();
    return {
      header: JSON.parse(dec.decode(base64UrlDecode(parts[0]!))),
      claims: JSON.parse(dec.decode(base64UrlDecode(parts[1]!))),
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: base64UrlDecode(parts[2]!),
    };
  } catch {
    return null;
  }
}
