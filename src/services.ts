import { catalog } from "./catalog";
import { oauthClient, parseServices, type ServiceConfig, type Services } from "./config";
import type { OAuthClient } from "./upstream-oauth";

// A service as the vault needs it: its definition and, for OAuth, its client.
export interface Upstream {
  service: string;
  config: ServiceConfig;
  client: OAuthClient | null;
}

// The one place service definitions are read from: the built-in catalog, then
// SERVICES, which adds services and overrides catalog ones of the same name.
// Admin-registered services join here later (docs/redesign.md).
export async function getServices(env: Env): Promise<Services> {
  return { ...parseServices(catalog(env)), ...parseServices(env.SERVICES ?? {}) };
}

export async function getService(env: Env, name: string): Promise<ServiceConfig | null> {
  const services = await getServices(env);
  return Object.hasOwn(services, name) ? services[name] : null;
}

export function clientFor(env: Env, service: string, config: ServiceConfig): OAuthClient | null {
  return config.auth.type === "oauth2" ? oauthClient(env, service, config.auth.client) : null;
}

// An OAuth service is usable only once the gateway has its client.
export function isAvailable(env: Env, service: string, config: ServiceConfig): boolean {
  return config.auth.type !== "oauth2" || clientFor(env, service, config) !== null;
}

export async function getUpstream(env: Env, service: string): Promise<Upstream | null> {
  const config = await getService(env, service);
  return config ? { service, config, client: clientFor(env, service, config) } : null;
}
