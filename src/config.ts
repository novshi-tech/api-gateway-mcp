export interface HeaderField {
  name: string;
  label: string;
  prefix?: string;
}

export interface HeadersAuth {
  type: "headers";
  headers: HeaderField[];
}

// The client ID and secret come from OAUTH_<SERVICE>_CLIENT_ID / _CLIENT_SECRET.
export interface OAuth2Auth {
  type: "oauth2";
  authorization_url: string;
  token_url: string;
  scope?: string;
  authorize_params?: Record<string, string>;
}

export interface ServiceConfig {
  // Shown in the web UI; defaults to the service name.
  display_name?: string;
  base_url: string;
  auth: HeadersAuth | OAuth2Auth;
}

export type Services = Record<string, ServiceConfig>;

const SERVICE_NAME = /^[a-z0-9][a-z0-9-]*$/;

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
    } else if (auth?.type !== "headers" || !Array.isArray(auth.headers) || auth.headers.length === 0) {
      throw new Error(`service ${name}: unsupported auth`);
    }
    services[name] = { display_name: config.display_name || name, base_url: config.base_url.replace(/\/+$/, ""), auth: config.auth };
  }
  return services;
}

function requireHttps(service: string, field: string, value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`service ${service}: ${field} must be https`);
  }
}

export function oauthClient(env: Env, service: string): { id: string; secret: string } | null {
  const prefix = `OAUTH_${service.toUpperCase().replace(/-/g, "_")}_CLIENT_`;
  const vars = env as unknown as Record<string, unknown>;
  const id = vars[`${prefix}ID`];
  const secret = vars[`${prefix}SECRET`];
  return typeof id === "string" && id && typeof secret === "string" && secret ? { id, secret } : null;
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
