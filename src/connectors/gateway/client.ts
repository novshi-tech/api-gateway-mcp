import type { SecretBox } from '../secrets';
import type { ConnectorStateStore } from '../../store/connector-state';
import { GatewayAuthError, GatewayError, trimSlash, USER_AGENT, type Fetcher } from './http';
import type { GatewayOAuth, TokenSet } from './oauth';

// 本人の同意で使うゲートウェイ（MCP の list_credentials・issue_token と REST）。
// 本体は上流のトークンを持たない。持つのはゲートウェイのリフレッシュトークンだけ（暗号化して D1 に置く）。

export interface GatewayCredential {
  id: string;
  service: string;
  label?: string;
}

export interface IssuedToken {
  token: string;
  /** <gateway>/api */
  baseUrl: string;
  expiresAt: string;
  /** トークンの sub（ゲートウェイの User）。本人の確かめに使う */
  userId: string;
}

/** アクセストークンが切れるこれだけ前にリフレッシュする */
const REFRESH_MARGIN_MS = 2 * 60_000;

/** MCP のツールを 1 回呼ぶ（ゲートウェイの MCP はステートレスなので initialize は要らない） */
export async function callTool(fetcher: Fetcher, gatewayUrl: string, accessToken: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetcher(`${trimSlash(gatewayUrl)}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (res.status === 401) throw new UnauthorizedAccessToken();
  if (!res.ok) throw new GatewayError(`mcp ${name}: ${res.status}`, res.status);
  const body = (await res.json()) as { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } };
  const text = body.result?.content?.[0]?.text ?? '';
  if (body.error) throw new GatewayError(`mcp ${name}: ${body.error.message ?? 'error'}`, 500);
  if (body.result?.isError) {
    // つなぎ直しが要る接続・消えた接続は、本人が手を動かすまで通らない
    if (/reconnect|unknown credential/i.test(text)) throw new GatewayAuthError(text);
    throw new GatewayError(`mcp ${name}: ${text}`, 500);
  }
  return JSON.parse(text);
}

export async function listCredentials(fetcher: Fetcher, gatewayUrl: string, accessToken: string): Promise<GatewayCredential[]> {
  const r = (await callTool(fetcher, gatewayUrl, accessToken, 'list_credentials', {})) as { credentials?: GatewayCredential[] };
  return r.credentials ?? [];
}

export async function issueToken(fetcher: Fetcher, gatewayUrl: string, accessToken: string, credentialIds: string[]): Promise<IssuedToken> {
  const r = (await callTool(fetcher, gatewayUrl, accessToken, 'issue_token', { credential_ids: credentialIds })) as {
    token: string;
    base_url: string;
    expires_at: string;
  };
  return { token: r.token, baseUrl: r.base_url, expiresAt: r.expires_at, userId: jwtSubject(r.token) };
}

/** ゲートウェイから直接受け取ったトークンの sub を読む（署名はゲートウェイが確かめるので、ここでは検証しない） */
export function jwtSubject(token: string): string {
  const part = token.split('.')[1];
  if (!part) throw new GatewayError('malformed gateway token', 500);
  const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown };
  if (typeof json.sub !== 'string') throw new GatewayError('gateway token has no sub', 500);
  return json.sub;
}

class UnauthorizedAccessToken extends Error {}

export interface GatewayUserDeps {
  fetcher: Fetcher;
  gatewayUrl: string;
  oauth: GatewayOAuth;
  state: ConnectorStateStore;
  box: SecretBox;
  now: () => string;
}

/** 保管した同意でゲートウェイを呼ぶ。リフレッシュトークンは使うたびに入れ替わるので、版の比較で直列にする */
export class GatewayUser {
  constructor(
    private readonly deps: GatewayUserDeps,
    readonly userId: string,
  ) {}

  /** 同意を保管する（つなぎ直しは前のものを置き換える） */
  static async save(deps: Pick<GatewayUserDeps, 'state' | 'box'>, userId: string, tokens: TokenSet): Promise<void> {
    await deps.state.putGrant(
      {
        userId,
        refreshToken: await deps.box.seal(tokens.refreshToken),
        accessToken: await deps.box.seal(tokens.accessToken),
        accessExpiresAt: tokens.expiresAt,
      },
      'any',
    );
  }

  async listCredentials(): Promise<GatewayCredential[]> {
    return this.withToken((t) => listCredentials(this.deps.fetcher, this.deps.gatewayUrl, t));
  }

  async issueToken(credentialIds: string[]): Promise<IssuedToken> {
    const issued = await this.withToken((t) => issueToken(this.deps.fetcher, this.deps.gatewayUrl, t, credentialIds));
    if (issued.userId !== this.userId) throw new GatewayAuthError(`gateway token is for ${issued.userId}, not ${this.userId}`);
    return issued;
  }

  private async withToken<T>(run: (accessToken: string) => Promise<T>): Promise<T> {
    try {
      return await run(await this.accessToken(false));
    } catch (err) {
      if (!(err instanceof UnauthorizedAccessToken)) throw err;
      try {
        return await run(await this.accessToken(true));
      } catch (again) {
        if (again instanceof UnauthorizedAccessToken) throw new GatewayAuthError('gateway rejected a fresh access token');
        throw again;
      }
    }
  }

  private async accessToken(force: boolean): Promise<string> {
    const { state, box, oauth, now } = this.deps;
    for (let attempt = 0; attempt < 3; attempt++) {
      const grant = await state.grant(this.userId);
      if (!grant) throw new GatewayAuthError('no consent from the user');
      if (!force && Date.parse(grant.accessExpiresAt) - Date.parse(now()) > REFRESH_MARGIN_MS) return box.open(grant.accessToken);
      let tokens: TokenSet;
      try {
        tokens = await refreshOnce(this.userId, grant.version, () => box.open(grant.refreshToken).then((rt) => oauth.refresh(rt)));
      } catch (err) {
        // 別の isolate が同じリフレッシュトークンで先に入れ替えていれば、こちらは invalid_grant になる。
        // その書き込みを少し待って、版が進んでいればそれを使う
        if (err instanceof GatewayAuthError && (await this.versionMoved(grant.version))) {
          force = false;
          continue;
        }
        throw err;
      }
      const saved = await state.putGrant(
        { userId: this.userId, refreshToken: await box.seal(tokens.refreshToken), accessToken: await box.seal(tokens.accessToken), accessExpiresAt: tokens.expiresAt },
        grant.version,
      );
      if (saved) return tokens.accessToken;
      // 他が先に入れ替えた。読み直して、その新しいトークンを使う
      force = false;
    }
    throw new GatewayError('could not settle the refresh token', 500);
  }

  private async versionMoved(version: number): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      if ((await this.deps.state.grant(this.userId))?.version !== version) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }
}

/** 同じ isolate の中で同じ版のリフレッシュが重なったら 1 回にまとめる */
const inflight = new Map<string, Promise<TokenSet>>();

function refreshOnce(userId: string, version: number, run: () => Promise<TokenSet>): Promise<TokenSet> {
  const key = `${userId}#${version}`;
  let p = inflight.get(key);
  if (!p) {
    p = run().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
