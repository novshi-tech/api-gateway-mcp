import { publicUrl, type ServiceConfig } from "./config";
import { IDENTITY_CREDENTIAL, signIdentity } from "./identity";
import { getUpstream } from "./services";
import { bearer, verifyToken, type GatewayClaims } from "./tokens";
import { vaultFor } from "./vault";

export const API_PREFIX = "/api/";

// Headers never forwarded upstream: hop-by-hop, the caller's own credentials,
// and anything Cloudflare or a client proxy adds about the caller.
const DROP_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "forwarded",
  "x-real-ip",
]);

const DROP_RESPONSE_HEADERS = new Set(["set-cookie", "connection", "keep-alive", "transfer-encoding", "trailer", "upgrade"]);

function denied(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

function forwardHeaders(incoming: Headers, injected: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [name, value] of incoming) {
    if (DROP_REQUEST_HEADERS.has(name) || name.startsWith("cf-") || name.startsWith("x-forwarded-")) continue;
    headers.set(name, value);
  }
  for (const [name, value] of Object.entries(injected)) headers.set(name, value);
  return headers;
}

export async function handleProxy(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const rest = url.pathname.slice(API_PREFIX.length);
  const slash = rest.indexOf("/");
  const service = slash === -1 ? rest : rest.slice(0, slash);
  const upstreamPath = slash === -1 ? "" : rest.slice(slash);

  const token = bearer(request);
  if (!token) return denied(401, "missing gateway token");
  const claims = await verifyToken<GatewayClaims>(env.SIGNING_KEY, publicUrl(env), "api", token);
  if (!claims) return denied(401, "invalid or expired gateway token");

  const target = await getUpstream(env, service);
  if (!target) return denied(404, `unknown service: ${service}`);
  const config = target.config;
  const credentialId = claims.creds?.[service];
  if (!credentialId) return denied(403, `token does not cover service: ${service}`);

  const result =
    config.auth.type === "identity"
      ? await identityHeaders(env, claims.sub, credentialId, config.auth.audience)
      : await vaultFor(env, claims.sub).headers(credentialId, target);
  if ("error" in result) {
    if (result.error === "forbidden") return denied(403, `token does not cover service: ${service}`);
    if (result.error === "unconfigured") return denied(502, "the gateway has no identity signing key");
    if (result.error === "missing") return denied(403, "credential no longer exists");
    if (result.error === "reconnect") {
      return denied(403, `credential must be reconnected by the user at ${publicUrl(env)}/`);
    }
    return denied(502, "could not refresh the upstream access token; try again later");
  }

  const upstreamUrl = `${config.base_url}${upstreamPath}${url.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await upstreamFetcher(env, config)(upstreamUrl, {
    method: request.method,
    headers: forwardHeaders(request.headers, result.headers),
    body: hasBody ? request.body : undefined,
    // Redirects go back to the caller; a signed download URL needs no credentials.
    redirect: "manual",
  });

  console.log(
    JSON.stringify({
      type: "audit",
      user: claims.sub,
      credential: credentialId,
      service,
      method: request.method,
      path: upstreamPath || "/",
      status: upstream.status,
    }),
  );

  const headers = new Headers();
  for (const [name, value] of upstream.headers) {
    if (!DROP_RESPONSE_HEADERS.has(name)) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

async function identityHeaders(
  env: Env,
  userId: string,
  credentialId: string,
  audience: string,
): Promise<{ headers: Record<string, string> } | { error: "forbidden" | "unconfigured" }> {
  if (credentialId !== IDENTITY_CREDENTIAL) return { error: "forbidden" };
  const token = await signIdentity(env, publicUrl(env), userId, audience);
  return token ? { headers: { authorization: `Bearer ${token}` } } : { error: "unconfigured" };
}

// A Service Binding reaches a Worker that has no public route.
function upstreamFetcher(env: Env, config: ServiceConfig): typeof fetch {
  if (!config.binding) return fetch;
  const binding = (env as unknown as Record<string, Fetcher | undefined>)[config.binding];
  if (!binding) throw new Error(`missing service binding: ${config.binding}`);
  return ((input: RequestInfo | URL, init?: RequestInit) => binding.fetch(input, init)) as typeof fetch;
}
