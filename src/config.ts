export interface HeaderField {
  name: string;
  label: string;
  prefix?: string;
}

export interface HeadersAuth {
  type: "headers";
  headers: HeaderField[];
}

// The client ID and secret come from OAUTH_<CLIENT>_CLIENT_ID / _CLIENT_SECRET, where
// <CLIENT> is `client` (one client can serve many services, e.g. "google"), or the
// service name when `client` is not set.
export interface OAuth2Auth {
  type: "oauth2";
  client?: string;
  authorization_url: string;
  token_url: string;
  scope?: string;
  authorize_params?: Record<string, string>;
}

// OAuth2 client credentials: the deployment, not a user, owns the access. The client
// comes from Registry (admin-registered) or OAUTH_<CLIENT>_CLIENT_ID / _CLIENT_SECRET as
// for oauth2. Only the Background entrypoint (Service Binding) can use such a service;
// users never see it.
export interface ClientCredentialsAuth {
  type: "client_credentials";
  client?: string;
  token_url: string;
  scope?: string;
}

// For an upstream that trusts the gateway's sign-in: no stored credential, the
// gateway signs the user's ID (EdDSA, IDENTITY_SIGNING_KEY) for this audience and
// sends it as `Authorization: Bearer`. Upstreams verify it with /.well-known/jwks.json.
export interface IdentityAuth {
  type: "identity";
  audience: string;
}

export interface ServiceConfig {
  // Shown in the web UI; defaults to the service name.
  display_name?: string;
  // Groups services in the web UI ("Google", "Microsoft", ...); others are listed last.
  provider?: string;
  base_url: string;
  // Name of a Service Binding to reach the upstream through instead of the public internet.
  binding?: string;
  auth: HeadersAuth | OAuth2Auth | ClientCredentialsAuth | IdentityAuth;
}

export type Services = Record<string, ServiceConfig>;

const SERVICE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const BINDING_NAME = /^[A-Z][A-Z0-9_]*$/;

export function parseServices(raw: unknown): Services {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || typeof value !== "object") throw new Error("SERVICES must be an object");
  const services: Services = {};
  for (const [name, config] of Object.entries(value as Record<string, ServiceConfig>)) {
    if (!SERVICE_NAME.test(name)) throw new Error(`invalid service name: ${name}`);
    requireHttps(name, "base_url", config.base_url);
    const auth = config.auth;
    if (auth?.type === "oauth2") {
      requireHttps(name, "authorization_url", auth.authorization_url);
      requireHttps(name, "token_url", auth.token_url);
      if (auth.client !== undefined && !SERVICE_NAME.test(auth.client)) throw new Error(`service ${name}: invalid client name`);
    } else if (auth?.type === "client_credentials") {
      requireHttps(name, "token_url", auth.token_url);
      if (auth.client !== undefined && !SERVICE_NAME.test(auth.client)) throw new Error(`service ${name}: invalid client name`);
    } else if (auth?.type === "identity") {
      if (typeof auth.audience !== "string" || !auth.audience) throw new Error(`service ${name}: identity needs an audience`);
    } else if (auth?.type !== "headers" || !Array.isArray(auth.headers) || auth.headers.length === 0) {
      throw new Error(`service ${name}: unsupported auth`);
    }
    if (config.binding !== undefined && !BINDING_NAME.test(config.binding)) throw new Error(`service ${name}: invalid binding name`);
    services[name] = {
      display_name: config.display_name || name,
      ...(config.provider ? { provider: config.provider } : {}),
      base_url: config.base_url.replace(/\/+$/, ""),
      ...(config.binding ? { binding: config.binding } : {}),
      auth: config.auth,
    };
  }
  return services;
}

function requireHttps(service: string, field: string, value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`service ${service}: ${field} must be https`);
  }
}

export function oauthClient(env: Env, service: string, client?: string): { id: string; secret: string } | null {
  const vars = env as unknown as Record<string, unknown>;
  const prefix = `OAUTH_${(client ?? service).toUpperCase().replace(/-/g, "_")}_CLIENT_`;
  // Trimmed: a value pasted into `wrangler secret put` can keep a trailing space or newline,
  // which the upstream then rejects as a wrong secret.
  const id = typeof vars[`${prefix}ID`] === "string" ? (vars[`${prefix}ID`] as string).trim() : "";
  const secret = typeof vars[`${prefix}SECRET`] === "string" ? (vars[`${prefix}SECRET`] as string).trim() : "";
  return id && secret ? { id, secret } : null;
}

export function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function publicUrl(env: Env): string {
  return env.PUBLIC_URL.replace(/\/+$/, "");
}

// The organization this deployment serves (ADR 0004: one deployment = one organization).
// Falls back to the host so that gateways connected side by side stay distinguishable.
export function organizationName(env: Env): string {
  return env.ORGANIZATION_NAME?.trim() || new URL(publicUrl(env)).host;
}
