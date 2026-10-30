import { DurableObject } from "cloudflare:workers";
import { decryptJson, encryptJson, importAesKey } from "./crypto";
import { upstreamTarget, type Upstream } from "./services";
import { refreshTokens, UpstreamOAuthError, type TokenSet } from "./upstream-oauth";

export interface CredentialInfo {
  id: string;
  service: string;
  // The service's display name when connected. Credentials from before one-per-service
  // (docs/adr/0004) may carry a name the user typed.
  label: string;
  createdAt: number;
  // Set when the upstream rejected the refresh token.
  needsReconnect?: boolean;
}

interface StoredCredential extends CredentialInfo {
  sealed: string;
  // upstreamTarget() when stored. Older credentials lack it until first used.
  target?: string;
}

// Header values keyed by lower-case header name, as entered by the user.
export type HeaderSecrets = Record<string, string>;

export type HeadersResult =
  | { headers: Record<string, string> }
  | { error: "missing" | "reconnect" | "unavailable" }
  // The definition asks for a header this credential has no value for: it was renamed or added.
  | { error: "no_value"; header: string };

export const ALREADY_CONNECTED = "already connected";

// Refresh this long before the upstream says the access token expires.
const REFRESH_MARGIN_MS = 60 * 1000;

function info({ id, service, label, createdAt, needsReconnect }: StoredCredential): CredentialInfo {
  return needsReconnect ? { id, service, label, createdAt, needsReconnect } : { id, service, label, createdAt };
}

// One vault per user. A Durable Object runs one request at a time, but another
// can start while one awaits a fetch, so refreshes are shared per credential.
// The caller resolves the service and passes it in; the vault reads no service definitions.
export class UserVault extends DurableObject<Env> {
  private keyPromise?: Promise<CryptoKey>;
  private refreshing = new Map<string, Promise<HeadersResult>>();

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
      .map(info)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(id: string): Promise<CredentialInfo | null> {
    const stored = await this.ctx.storage.get<StoredCredential>(`cred:${id}`);
    return stored ? info(stored) : null;
  }

  // One credential per service and user (docs/adr/0004): accounts of another organization
  // belong in that organization's gateway. Checked right before writing, with no await
  // other than storage in between, so two concurrent connects cannot both pass.
  private async alreadyConnected(service: string): Promise<boolean> {
    return (await this.list()).some((c) => c.service === service);
  }

  async add(upstream: Upstream, secrets: HeaderSecrets): Promise<CredentialInfo | { error: string }> {
    const { service, config } = upstream;
    if (config.auth.type === "identity") return { error: `${service} needs no credential` };
    if (config.auth.type === "client_credentials") return { error: `${service} is not connected by users` };
    if (config.auth.type !== "headers") return { error: `${service} is connected with OAuth` };
    const values: HeaderSecrets = {};
    for (const field of config.auth.headers) {
      const value = secrets[field.name.toLowerCase()]?.trim();
      if (!value) return { error: `missing value for ${field.name}` };
      values[field.name.toLowerCase()] = value;
    }
    const id = crypto.randomUUID();
    const info: CredentialInfo = { id, service, label: config.display_name ?? service, createdAt: Date.now() };
    const sealed = await encryptJson(await this.key(), values, this.aad(id));
    if (await this.alreadyConnected(service)) return { error: ALREADY_CONNECTED };
    await this.ctx.storage.put<StoredCredential>(`cred:${id}`, { ...info, sealed, target: upstreamTarget(upstream) });
    return info;
  }

  // Stores tokens from an OAuth connection; with `replaceId`, reconnects that credential.
  async addOAuth(
    upstream: Upstream,
    tokens: TokenSet,
    replaceId?: string,
  ): Promise<CredentialInfo | { error: string }> {
    const { service, config } = upstream;
    if (config.auth.type !== "oauth2") return { error: `${service} is not an OAuth service` };
    let record: CredentialInfo;
    if (replaceId) {
      const existing = await this.ctx.storage.get<StoredCredential>(`cred:${replaceId}`);
      if (!existing || existing.service !== service) return { error: "credential not found" };
      record = { id: replaceId, service, label: existing.label, createdAt: existing.createdAt };
    } else {
      record = { id: crypto.randomUUID(), service, label: config.display_name ?? service, createdAt: Date.now() };
    }
    const sealed = await encryptJson(await this.key(), tokens, this.aad(record.id));
    if (!replaceId && (await this.alreadyConnected(service))) return { error: ALREADY_CONNECTED };
    await this.ctx.storage.put<StoredCredential>(`cred:${record.id}`, { ...record, sealed, target: upstreamTarget(upstream) });
    return record;
  }

  async remove(id: string): Promise<boolean> {
    return this.ctx.storage.delete(`cred:${id}`);
  }

  // Returns the headers to inject into an upstream request for `upstream`.
  async headers(id: string, upstream: Upstream): Promise<HeadersResult> {
    const stored = await this.ctx.storage.get<StoredCredential>(`cred:${id}`);
    if (!stored || stored.service !== upstream.service) return { error: "missing" };
    if (stored.needsReconnect) return { error: "reconnect" };
    const target = upstreamTarget(upstream);
    if (stored.target === undefined) {
      await this.ctx.storage.put<StoredCredential>(`cred:${id}`, { ...stored, target });
    } else if (stored.target !== target) {
      console.warn(JSON.stringify({ type: "upstream_changed", credential: id, service: stored.service }));
      await this.ctx.storage.put<StoredCredential>(`cred:${id}`, { ...stored, needsReconnect: true });
      return { error: "reconnect" };
    }
    const config = upstream.config;
    if (config.auth.type === "oauth2") return this.oauthHeaders(id, stored, upstream);
    if (config.auth.type !== "headers") return { error: "missing" };
    const values = await decryptJson<HeaderSecrets>(await this.key(), stored.sealed, this.aad(id));
    const headers: Record<string, string> = {};
    for (const field of config.auth.headers) {
      const name = field.name.toLowerCase();
      if (values[name] === undefined) return { error: "no_value", header: field.name };
      headers[name] = `${field.prefix ?? ""}${values[name]}`;
    }
    return { headers };
  }

  private async oauthHeaders(id: string, stored: StoredCredential, upstream: Upstream): Promise<HeadersResult> {
    const tokens = await decryptJson<TokenSet>(await this.key(), stored.sealed, this.aad(id));
    if (tokens.expires_at === undefined || tokens.expires_at - REFRESH_MARGIN_MS > Date.now()) {
      return { headers: { authorization: `Bearer ${tokens.access_token}` } };
    }
    let pending = this.refreshing.get(id);
    if (!pending) {
      pending = this.refresh(id, stored, tokens, upstream).finally(() => this.refreshing.delete(id));
      this.refreshing.set(id, pending);
    }
    return pending;
  }

  private async refresh(id: string, stored: StoredCredential, tokens: TokenSet, { config, client }: Upstream): Promise<HeadersResult> {
    if (config.auth.type !== "oauth2" || !client) return { error: "unavailable" };
    let next: TokenSet;
    try {
      next = await refreshTokens(config.auth, client, tokens);
    } catch (error) {
      if (!(error instanceof UpstreamOAuthError)) throw error;
      console.warn(JSON.stringify({ type: "refresh_failed", credential: id, reason: error.message }));
      if (!error.invalidGrant) return { error: "unavailable" };
      const current = await this.ctx.storage.get<StoredCredential>(`cred:${id}`);
      if (current?.sealed === stored.sealed) await this.ctx.storage.put(`cred:${id}`, { ...current, needsReconnect: true });
      return { error: "reconnect" };
    }
    // Skip the write if the credential was reconnected or deleted meanwhile.
    const current = await this.ctx.storage.get<StoredCredential>(`cred:${id}`);
    if (current?.sealed === stored.sealed) {
      const sealed = await encryptJson(await this.key(), next, this.aad(id));
      await this.ctx.storage.put<StoredCredential>(`cred:${id}`, { ...current, sealed });
    }
    return { headers: { authorization: `Bearer ${next.access_token}` } };
  }
}

export function vaultFor(env: Env, userId: string): DurableObjectStub<UserVault> {
  return env.VAULT.get(env.VAULT.idFromName(userId));
}
