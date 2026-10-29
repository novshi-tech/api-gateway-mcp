import { catalog } from "./catalog";
import { oauthClient, parseServices, type ServiceConfig, type Services } from "./config";
import { registryFor, type RegistrySnapshot } from "./registry";
import type { OAuthClient } from "./upstream-oauth";

// A service as the vault needs it: its definition and, for OAuth, its client.
export interface Upstream {
  service: string;
  config: ServiceConfig;
  client: OAuthClient | null;
}

export type ServiceSource = "catalog" | "admin" | "config";

// Every service this deployment knows, where each definition comes from, and the
// OAuth clients. Built-in catalog first, then services admins registered, then
// SERVICES, which wins on a shared name. Admins cannot reuse a catalog name.
export interface Directory {
  services: Services;
  sources: Record<string, ServiceSource>;
  registry: RegistrySnapshot;
  client(service: string): OAuthClient | null;
  // A service users can see: an OAuth service only once the gateway has its client, and
  // never a client_credentials one, which only the Background entrypoint uses.
  available(service: string): boolean;
}

// The registry is read on most requests, so each isolate keeps it briefly.
// Admin edits elsewhere show up within this time.
const REGISTRY_TTL_MS = 30_000;
let cachedRegistry: { at: number; snapshot: Promise<RegistrySnapshot> } | undefined;

export function forgetRegistry(): void {
  cachedRegistry = undefined;
}

function registrySnapshot(env: Env): Promise<RegistrySnapshot> {
  if (!cachedRegistry || Date.now() - cachedRegistry.at > REGISTRY_TTL_MS) {
    const snapshot = registryFor(env).snapshot();
    cachedRegistry = { at: Date.now(), snapshot };
    snapshot.catch(() => forgetRegistry());
  }
  return cachedRegistry.snapshot;
}

export async function getDirectory(env: Env): Promise<Directory> {
  const registry = await registrySnapshot(env);
  const layers: [ServiceSource, Services][] = [
    ["catalog", parseServices(catalog(env))],
    ["admin", parseServices(Object.fromEntries(Object.entries(registry.services).map(([name, e]) => [name, e.config])))],
    ["config", parseServices(env.SERVICES ?? {})],
  ];
  const services: Services = {};
  const sources: Record<string, ServiceSource> = {};
  for (const [source, layer] of layers) {
    for (const [name, config] of Object.entries(layer)) {
      if (source === "admin" && sources[name] === "catalog") continue;
      services[name] = config;
      sources[name] = source;
    }
  }
  const client = (service: string): OAuthClient | null => {
    if (!Object.hasOwn(services, service)) return null;
    const auth = services[service].auth;
    if (auth.type !== "oauth2" && auth.type !== "client_credentials") return null;
    if (sources[service] === "admin") return registry.clients[service] ?? null;
    return oauthClient(env, service, auth.client);
  };
  const available = (service: string) => {
    if (!Object.hasOwn(services, service)) return false;
    const type = services[service].auth.type;
    return type !== "client_credentials" && (type !== "oauth2" || client(service) !== null);
  };
  return { services, sources, registry, client, available };
}

export async function getServices(env: Env): Promise<Services> {
  return (await getDirectory(env)).services;
}

export async function getUpstream(env: Env, service: string): Promise<Upstream | null> {
  const directory = await getDirectory(env);
  if (!Object.hasOwn(directory.services, service)) return null;
  return { service, config: directory.services[service], client: directory.client(service) };
}

// Where a credential's secrets are sent: the upstream origin (or Service Binding) and,
// for OAuth, the token endpoint and client. The vault records it when a credential is
// stored and refuses to send the secrets anywhere else, so changing a definition later
// cannot redirect credentials people already entered.
export function upstreamTarget({ config, client }: Upstream): string {
  const parts = [config.binding ? `binding:${config.binding}` : new URL(config.base_url).origin];
  if (config.auth.type === "oauth2") parts.push(config.auth.token_url, client?.id ?? "");
  return parts.join(" ");
}
