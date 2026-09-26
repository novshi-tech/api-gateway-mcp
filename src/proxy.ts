import { parseServices, publicUrl } from "./config";
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

  const config = parseServices(env.SERVICES)[service];
  if (!config) return denied(404, `unknown service: ${service}`);
  const credentialId = claims.creds?.[service];
  if (!credentialId) return denied(403, `token does not cover service: ${service}`);

  const result = await vaultFor(env, claims.sub).headers(credentialId);
  if ("error" in result) {
    if (result.error === "missing") return denied(403, "credential no longer exists");
    if (result.error === "reconnect") {
      return denied(403, `credential must be reconnected by the user at ${publicUrl(env)}/`);
    }
    return denied(502, "could not refresh the upstream access token; try again later");
  }

  const upstreamUrl = `${config.base_url}${upstreamPath}${url.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(upstreamUrl, {
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
