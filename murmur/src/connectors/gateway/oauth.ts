import { GatewayAuthError, GatewayError, trimSlash, USER_AGENT, type Fetcher } from './http';

// 本体はゲートウェイの OAuth クライアント（0024 の決定 3）。Claude と同じく CIMD で、client_id は本体が公開するメタデータの URL。
// 公開クライアント（シークレットなし）で、PKCE を使う。

export const CLIENT_METADATA_PATH = '/oauth/client.json';
export const CALLBACK_PATH = '/oauth/callback';
export const GATEWAY_SCOPE = 'gateway';

export interface GatewayOAuthConfig {
  /** ゲートウェイの PUBLIC_URL */
  gatewayUrl: string;
  /** 本体の公開 URL */
  publicUrl: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** UTC の ISO 8601 */
  expiresAt: string;
}

export function clientId(cfg: Pick<GatewayOAuthConfig, 'publicUrl'>): string {
  return `${trimSlash(cfg.publicUrl)}${CLIENT_METADATA_PATH}`;
}

export function redirectUri(cfg: Pick<GatewayOAuthConfig, 'publicUrl'>): string {
  return `${trimSlash(cfg.publicUrl)}${CALLBACK_PATH}`;
}

/** CIMD のメタデータ。client_name はゲートウェイの同意の画面と「許可したアプリ」に出る */
export function clientMetadata(cfg: Pick<GatewayOAuthConfig, 'publicUrl'>) {
  return {
    client_id: clientId(cfg),
    client_name: 'Murmur',
    client_uri: trimSlash(cfg.publicUrl),
    redirect_uris: [redirectUri(cfg)],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: GATEWAY_SCOPE,
  };
}

function resource(cfg: GatewayOAuthConfig): string {
  return `${trimSlash(cfg.gatewayUrl)}/mcp`;
}

export function authorizeUrl(cfg: GatewayOAuthConfig, input: { state: string; codeChallenge: string }): string {
  const url = new URL(`${trimSlash(cfg.gatewayUrl)}/authorize`);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: clientId(cfg),
    redirect_uri: redirectUri(cfg),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    resource: resource(cfg),
    scope: GATEWAY_SCOPE,
  })) {
    url.searchParams.set(k, v);
  }
  return url.href;
}

export class GatewayOAuth {
  constructor(
    private readonly cfg: GatewayOAuthConfig,
    private readonly fetcher: Fetcher,
    private readonly now: () => string,
  ) {}

  exchange(code: string, verifier: string): Promise<TokenSet> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(this.cfg),
      client_id: clientId(this.cfg),
      code_verifier: verifier,
      resource: resource(this.cfg),
    });
  }

  refresh(refreshToken: string): Promise<TokenSet> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId(this.cfg), resource: resource(this.cfg) });
  }

  private async token(params: Record<string, string>): Promise<TokenSet> {
    const res = await this.fetcher(`${trimSlash(this.cfg.gatewayUrl)}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
      body: new URLSearchParams(params).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // invalid_grant = 同意の取り消し・リフレッシュトークンの失効。つなぎ直すまで通らない
      if (res.status === 400 || res.status === 401) throw new GatewayAuthError(`token endpoint: ${String(body.error ?? res.status)}`);
      throw new GatewayError(`token endpoint: ${res.status}`, res.status);
    }
    const accessToken = String(body.access_token ?? '');
    const refreshToken = String(body.refresh_token ?? params.refresh_token ?? '');
    if (!accessToken || !refreshToken) throw new GatewayError('token endpoint: no token in response', res.status);
    const ttl = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    return { accessToken, refreshToken, expiresAt: new Date(Date.parse(this.now()) + ttl * 1000).toISOString() };
  }
}
