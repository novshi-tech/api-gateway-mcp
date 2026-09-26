import type { OAuth2Auth } from "./config";

export interface OAuthClient {
  id: string;
  secret: string;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  // Epoch milliseconds; absent when the upstream does not say.
  expires_at?: number;
}

export class UpstreamOAuthError extends Error {
  constructor(
    message: string,
    // The refresh token was rejected, so only reconnecting helps.
    readonly invalidGrant = false,
  ) {
    super(message);
  }
}

export function upstreamAuthorizationUrl(
  auth: OAuth2Auth,
  client: OAuthClient,
  params: { redirectUri: string; state: string; codeChallenge: string },
): string {
  const url = new URL(auth.authorization_url);
  for (const [k, v] of Object.entries(auth.authorize_params ?? {})) url.searchParams.set(k, v);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.id);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (auth.scope) url.searchParams.set("scope", auth.scope);
  return url.href;
}

async function tokenRequest(auth: OAuth2Auth, client: OAuthClient, grant: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(auth.token_url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ ...grant, client_id: client.id, client_secret: client.secret }),
  }).catch((error: unknown) => {
    throw new UpstreamOAuthError(`token request failed: ${error}`);
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== "string") {
    const code = typeof body.error === "string" ? body.error : `status ${res.status}`;
    throw new UpstreamOAuthError(`token request failed: ${code}`, body.error === "invalid_grant");
  }
  const expiresIn = Number(body.expires_in);
  return {
    access_token: body.access_token,
    refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expires_at: Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : undefined,
  };
}

export function exchangeCode(
  auth: OAuth2Auth,
  client: OAuthClient,
  params: { code: string; verifier: string; redirectUri: string },
): Promise<TokenSet> {
  return tokenRequest(auth, client, {
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.verifier,
    redirect_uri: params.redirectUri,
  });
}

// Upstreams that rotate refresh tokens return a new one; others keep the old one.
export async function refreshTokens(auth: OAuth2Auth, client: OAuthClient, current: TokenSet): Promise<TokenSet> {
  if (!current.refresh_token) throw new UpstreamOAuthError("no refresh token", true);
  const grant: Record<string, string> = { grant_type: "refresh_token", refresh_token: current.refresh_token };
  // Entra expects the scopes again on refresh.
  if (auth.scope) grant.scope = auth.scope;
  const next = await tokenRequest(auth, client, grant);
  return { ...next, refresh_token: next.refresh_token ?? current.refresh_token };
}
