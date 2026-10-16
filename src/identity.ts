import { calculateJwkThumbprint, importJWK, SignJWT, type JWK } from "jose";

// Signs the signed-in user's ID for upstreams whose auth type is "identity".
// The key is an Ed25519 private JWK in the IDENTITY_SIGNING_KEY secret; the
// public half is published at /.well-known/jwks.json for upstreams to verify.

export const IDENTITY_TOKEN_TTL_SECONDS = 5 * 60;
export const JWKS_PATH = "/.well-known/jwks.json";

// The pseudo credential that stands for "the signed-in user" in list_credentials,
// issue_token and the gateway token's `creds`.
export const IDENTITY_CREDENTIAL = "identity";

export function identityCredentialId(service: string): string {
  return `${IDENTITY_CREDENTIAL}:${service}`;
}

export function serviceOfIdentityCredential(id: string): string | null {
  return id.startsWith(`${IDENTITY_CREDENTIAL}:`) ? id.slice(IDENTITY_CREDENTIAL.length + 1) : null;
}

function privateJwk(env: Env): JWK | null {
  const raw = (env as unknown as Record<string, unknown>).IDENTITY_SIGNING_KEY;
  if (typeof raw !== "string" || !raw) return null;
  const jwk = JSON.parse(raw) as JWK;
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d || !jwk.x) {
    throw new Error("IDENTITY_SIGNING_KEY must be an Ed25519 private JWK");
  }
  return jwk;
}

async function publicJwk(jwk: JWK): Promise<JWK> {
  const pub: JWK = { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
  return { ...pub, kid: await calculateJwkThumbprint(pub), alg: "EdDSA", use: "sig" };
}

export async function signIdentity(
  env: Env,
  issuer: string,
  subject: string,
  audience: string,
): Promise<string | null> {
  const jwk = privateJwk(env);
  if (!jwk) return null;
  const { kid } = await publicJwk(jwk);
  const key = await importJWK(jwk, "EdDSA");
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${IDENTITY_TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

export async function jwks(env: Env): Promise<Response> {
  const jwk = privateJwk(env);
  if (!jwk) return new Response("not found", { status: 404 });
  return Response.json({ keys: [await publicJwk(jwk)] }, { headers: { "cache-control": "public, max-age=300" } });
}
