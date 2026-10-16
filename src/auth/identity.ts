import { checkClaims, splitCompactJws, type ClaimsCheck } from './claims';

/**
 * ゲートウェイが Ed25519 で署名した compact JWS（alg=EdDSA）を検証する。
 * 本体が持つのは公開鍵だけで、API キーや共有秘密は持たない。
 */
export async function verifyIdentity(
  token: string,
  publicKeyJwk: JsonWebKey,
  audience: string,
  nowSec: number,
): Promise<ClaimsCheck> {
  const jws = splitCompactJws(token);
  if (!jws) return { ok: false, reason: 'malformed token' };
  const header = jws.header as { alg?: string };
  if (header.alg !== 'EdDSA') return { ok: false, reason: 'unsupported alg' };
  const key = await crypto.subtle.importKey('jwk', publicKeyJwk, { name: 'Ed25519' }, false, ['verify']);
  const valid = await crypto.subtle.verify('Ed25519', key, jws.signature, new TextEncoder().encode(jws.signingInput));
  if (!valid) return { ok: false, reason: 'bad signature' };
  return checkClaims(jws.claims, audience, nowSec);
}

/** Webhook の署名（HMAC-SHA256、hex）。鍵は本体の Workers secret に置く */
export async function verifyWebhookSignature(body: string, signatureHex: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = hexToBytes(signatureHex);
  if (!sig) return false;
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(body));
}

export async function signWebhook(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
