import { oauthClient, parseServices, type ServiceConfig, type Services } from "./config";
import type { OAuthClient } from "./upstream-oauth";

// A service as the vault needs it: its definition and, for OAuth, its client.
export interface Upstream {
  service: string;
  config: ServiceConfig;
  client: OAuthClient | null;
}

// The one place service definitions are read from. Today that is SERVICES;
// the built-in catalog and admin-registered services join here (docs/redesign.md).
export async function getServices(env: Env): Promise<Services> {
  return parseServices(env.SERVICES);
}

export async function getService(env: Env, name: string): Promise<ServiceConfig | null> {
  const services = await getServices(env);
  return Object.hasOwn(services, name) ? services[name] : null;
}

export async function getUpstream(env: Env, service: string): Promise<Upstream | null> {
  const config = await getService(env, service);
  if (!config) return null;
  return { service, config, client: config.auth.type === "oauth2" ? oauthClient(env, service) : null };
}
