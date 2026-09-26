export interface HeaderField {
  name: string;
  label: string;
  prefix?: string;
}

export interface HeadersAuth {
  type: "headers";
  headers: HeaderField[];
}

export interface ServiceConfig {
  base_url: string;
  auth: HeadersAuth;
}

export type Services = Record<string, ServiceConfig>;

const SERVICE_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function parseServices(raw: unknown): Services {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || typeof value !== "object") throw new Error("SERVICES must be an object");
  const services: Services = {};
  for (const [name, config] of Object.entries(value as Record<string, ServiceConfig>)) {
    if (!SERVICE_NAME.test(name)) throw new Error(`invalid service name: ${name}`);
    const base = new URL(config.base_url);
    if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
      throw new Error(`service ${name}: base_url must be https`);
    }
    if (config.auth?.type !== "headers" || !Array.isArray(config.auth.headers) || config.auth.headers.length === 0) {
      throw new Error(`service ${name}: unsupported auth`);
    }
    services[name] = { base_url: config.base_url.replace(/\/+$/, ""), auth: config.auth };
  }
  return services;
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
