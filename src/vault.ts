import { DurableObject } from "cloudflare:workers";
import { parseServices } from "./config";
import { decryptJson, encryptJson, importAesKey } from "./crypto";

export interface CredentialInfo {
  id: string;
  service: string;
  label: string;
  createdAt: number;
}

interface StoredCredential extends CredentialInfo {
  sealed: string;
}

// Header values keyed by lower-case header name, as entered by the user.
export type HeaderSecrets = Record<string, string>;

// One vault per user. A Durable Object handles its requests one at a time, so
// credential updates (and, later, upstream token refreshes) never race.
export class UserVault extends DurableObject<Env> {
  private keyPromise?: Promise<CryptoKey>;

  private key(): Promise<CryptoKey> {
    this.keyPromise ??= importAesKey(this.env.ENCRYPTION_KEY);
    return this.keyPromise;
  }

  private aad(id: string): string {
    return `${this.ctx.id.toString()}:${id}`;
  }

  async list(): Promise<CredentialInfo[]> {
    const stored = await this.ctx.storage.list<StoredCredential>({ prefix: "cred:" });
    return [...stored.values()]
      .map(({ id, service, label, createdAt }) => ({ id, service, label, createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(id: string): Promise<CredentialInfo | null> {
    const stored = await this.ctx.storage.get<StoredCredential>(`cred:${id}`);
    if (!stored) return null;
    const { service, label, createdAt } = stored;
    return { id, service, label, createdAt };
  }

  async add(service: string, label: string, secrets: HeaderSecrets): Promise<CredentialInfo | { error: string }> {
    const config = parseServices(this.env.SERVICES)[service];
    if (!config) return { error: `unknown service: ${service}` };
    const values: HeaderSecrets = {};
    for (const field of config.auth.headers) {
      const value = secrets[field.name.toLowerCase()]?.trim();
      if (!value) return { error: `missing value for ${field.name}` };
      values[field.name.toLowerCase()] = value;
    }
    const id = crypto.randomUUID();
    const info: CredentialInfo = { id, service, label: label.trim() || service, createdAt: Date.now() };
    const sealed = await encryptJson(await this.key(), values, this.aad(id));
    await this.ctx.storage.put<StoredCredential>(`cred:${id}`, { ...info, sealed });
    return info;
  }

  async remove(id: string): Promise<boolean> {
    return this.ctx.storage.delete(`cred:${id}`);
  }

  // Returns the headers to inject into an upstream request.
  async headers(id: string): Promise<Record<string, string> | null> {
    const stored = await this.ctx.storage.get<StoredCredential>(`cred:${id}`);
    if (!stored) return null;
    const config = parseServices(this.env.SERVICES)[stored.service];
    if (!config) return null;
    const values = await decryptJson<HeaderSecrets>(await this.key(), stored.sealed, this.aad(id));
    const headers: Record<string, string> = {};
    for (const field of config.auth.headers) {
      const name = field.name.toLowerCase();
      if (values[name] !== undefined) headers[name] = `${field.prefix ?? ""}${values[name]}`;
    }
    return headers;
  }
}

export function vaultFor(env: Env, userId: string): DurableObjectStub<UserVault> {
  return env.VAULT.get(env.VAULT.idFromName(userId));
}
