import { DurableObject } from "cloudflare:workers";
import type { ServiceConfig } from "./config";
import { decryptJson, encryptJson, importAesKey } from "./crypto";
import type { OAuthClient } from "./upstream-oauth";

export interface RegistryEntry {
  config: ServiceConfig;
  updatedAt: number;
  updatedBy: string;
}

export interface RegistrySnapshot {
  services: Record<string, RegistryEntry>;
  // OAuth clients of admin-registered services, by service name.
  clients: Record<string, OAuthClient>;
}

// Services that admins register from the web UI, shared by everyone: one object
// for the whole deployment. Callers validate definitions before putting them.
export class Registry extends DurableObject<Env> {
  private keyPromise?: Promise<CryptoKey>;

  private key(): Promise<CryptoKey> {
    this.keyPromise ??= importAesKey(this.env.ENCRYPTION_KEY);
    return this.keyPromise;
  }

  async snapshot(): Promise<RegistrySnapshot> {
    const services: Record<string, RegistryEntry> = {};
    for (const [key, entry] of await this.ctx.storage.list<RegistryEntry>({ prefix: "svc:" })) services[key.slice(4)] = entry;
    const clients: Record<string, OAuthClient> = {};
    for (const [key, sealed] of await this.ctx.storage.list<string>({ prefix: "client:" })) {
      clients[key.slice(7)] = await decryptJson<OAuthClient>(await this.key(), sealed, key);
    }
    return { services, clients };
  }

  // `client` undefined keeps the stored one; null removes it.
  async put(name: string, config: ServiceConfig, client: OAuthClient | null | undefined, updatedBy: string): Promise<void> {
    await this.ctx.storage.put<RegistryEntry>(`svc:${name}`, { config, updatedAt: Date.now(), updatedBy });
    if (client === null) await this.ctx.storage.delete(`client:${name}`);
    else if (client) await this.ctx.storage.put(`client:${name}`, await encryptJson(await this.key(), client, `client:${name}`));
  }

  async remove(name: string): Promise<boolean> {
    await this.ctx.storage.delete(`client:${name}`);
    return this.ctx.storage.delete(`svc:${name}`);
  }
}

export function registryFor(env: Env): DurableObjectStub<Registry> {
  return env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
}
