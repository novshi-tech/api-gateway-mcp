import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { splitList } from "./config";

export interface IdentityUser {
  id: string;
  name: string;
  email?: string;
}

interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const metadataCache = new Map<string, Promise<OidcMetadata>>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function discover(issuer: string): Promise<OidcMetadata> {
  let cached = metadataCache.get(issuer);
  if (!cached) {
    cached = fetch(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`).then(async (res) => {
      if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
      return (await res.json()) as OidcMetadata;
    });
    cached.catch(() => metadataCache.delete(issuer));
    metadataCache.set(issuer, cached);
  }
  return cached;
}

function jwks(uri: string) {
  let set = jwksCache.get(uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, set);
  }
  return set;
}

export async function authorizationUrl(
  env: Env,
  params: { redirectUri: string; state: string; codeChallenge: string; nonce: string },
): Promise<string> {
  const metadata = await discover(env.OIDC_ISSUER);
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.OIDC_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  const domains = splitList(env.ALLOWED_DOMAINS);
  if ((env.IDP_TYPE as string) === "google" && domains.length === 1) url.searchParams.set("hd", domains[0]);
  return url.href;
}

export async function signIn(
  env: Env,
  params: { code: string; verifier: string; nonce: string; redirectUri: string },
): Promise<IdentityUser> {
  const metadata = await discover(env.OIDC_ISSUER);
  const res = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.verifier,
      client_id: env.OIDC_CLIENT_ID,
      client_secret: env.OIDC_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new SignInError(`token exchange failed: ${res.status}`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new SignInError("no id_token in token response");

  const { payload } = await jwtVerify(id_token, jwks(metadata.jwks_uri), {
    issuer: metadata.issuer,
    audience: env.OIDC_CLIENT_ID,
  });
  if (payload.nonce !== params.nonce) throw new SignInError("nonce mismatch");
  return admit(env, payload);
}

export class SignInError extends Error {}

// Decides who may sign in and derives a stable user ID. IDs must not contain
// ":", which the OAuth provider uses as a separator inside its tokens.
export function admit(env: Env, claims: JWTPayload): IdentityUser {
  const name = String(claims.name ?? claims.email ?? claims.preferred_username ?? claims.sub);
  const email = typeof claims.email === "string" ? claims.email : undefined;

  if ((env.IDP_TYPE as string) === "entra") {
    const tid = String(claims.tid ?? "");
    const oid = String(claims.oid ?? "");
    if (!tid || !oid) throw new SignInError("missing tid/oid claim");
    const tenants = splitList(env.ALLOWED_TENANTS);
    if (tenants.length > 0 && !tenants.includes(tid)) throw new SignInError("tenant not allowed");
    return { id: `entra_${tid}_${oid}`, name, email: email ?? (claims.preferred_username as string | undefined) };
  }

  if ((env.IDP_TYPE as string) === "google") {
    const domains = splitList(env.ALLOWED_DOMAINS);
    if (domains.length === 0) throw new SignInError("ALLOWED_DOMAINS is required for google");
    if (claims.email_verified !== true) throw new SignInError("email not verified");
    if (typeof claims.hd !== "string" || !domains.includes(claims.hd)) throw new SignInError("domain not allowed");
    return { id: `google_${claims.sub}`, name, email };
  }

  throw new SignInError(`unsupported IDP_TYPE: ${env.IDP_TYPE}`);
}
