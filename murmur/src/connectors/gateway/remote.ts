import { verifyIdentity } from '../../auth/identity';
import {
  ConsentRequired,
  GatewayAuthError,
  inScope,
  UpstreamRefused,
  type ConsentPort,
  type GatewayCredential,
  type GatewayPort,
  type ReadScope,
  type UpstreamCall,
  type UpstreamKind,
} from '../../ports/gateway';
import type { ConnectorStateStore } from '../../store/connector-state';
import { randomHex, s256, type SecretBox } from '../secrets';
import { GatewayUser, issueToken, listCredentials } from './client';
import { trimSlash, USER_AGENT, type Fetcher } from './http';
import { authorizeUrl, type GatewayOAuth, type GatewayOAuthConfig } from './oauth';

// ゲートウェイの口の今の実装（0023 の段取り 2）: 別の Worker のゲートウェイを、
// 認証は identity の JWT（JWKS）、同意は CIMD の OAuth、上流は MCP の issue_token と REST で使う。
// 段取り 3 で、ゲートウェイの中核が同じ口を直に実装し、このファイルは消える。

export interface RemoteGatewayConfig {
  fetcher: Fetcher;
  oauth: GatewayOAuth;
  oauthConfig: GatewayOAuthConfig;
  state: ConnectorStateStore;
  box: SecretBox;
  now: () => string;
  /** 種類ごとの、ゲートウェイの接続先の名前と読める口（組み立て時に固定する） */
  kinds: Record<UpstreamKind, { service: string; scope: ReadScope }>;
  /** 本体の API のトークンの確かめ方。なければ API は使えない */
  identity?: { jwks: unknown; audience: string; issuer?: string };
}

/**
 * 本体の API のトークン（ゲートウェイが identity で署名した JWT）を JWKS で確かめる。
 * 外部コネクタの設定がなくても API は使うので、口の実装とは別に組み立てられるようにしておく
 */
export function identityAuthenticator(identity: RemoteGatewayConfig['identity'], now: () => string): GatewayPort['authenticate'] {
  return async (token) => {
    if (!identity) return null;
    const r = await verifyIdentity(token, identity.jwks, { audience: identity.audience, issuer: identity.issuer }, Math.floor(Date.parse(now()) / 1000));
    return r.ok ? r.sub : null;
  };
}

export class RemoteGateway implements GatewayPort {
  readonly consent: ConsentPort;
  readonly homeUrl: string;

  constructor(private readonly cfg: RemoteGatewayConfig) {
    this.homeUrl = `${trimSlash(cfg.oauthConfig.gatewayUrl)}/`;
    this.consent = {
      begin: async (_userId) => {
        const state = randomHex(24);
        const verifier = randomHex(32);
        return { url: authorizeUrl(cfg.oauthConfig, { state, codeChallenge: await s256(verifier) }), state, secret: verifier };
      },
      complete: async ({ userId, code, secret, kind }) => {
        const tokens = await cfg.oauth.exchange(code, secret);
        const gatewayUrl = cfg.oauthConfig.gatewayUrl;
        // 本人の確かめ: ゲートウェイの短命トークンの sub がゲートウェイの User。つなぐサービスの接続で確かめる
        const probe = (await listCredentials(cfg.fetcher, gatewayUrl, tokens.accessToken)).find((c) => c.service === cfg.kinds[kind].service)?.id;
        if (!probe) return 'no_credential';
        const issued = await issueToken(cfg.fetcher, gatewayUrl, tokens.accessToken, [probe]);
        if (issued.userId !== userId) return 'wrong_user';
        await GatewayUser.save(cfg, userId, tokens);
        return 'ok';
      },
    };
  }

  authenticate(token: string): Promise<string | null> {
    return identityAuthenticator(this.cfg.identity, this.cfg.now)(token);
  }

  async credentials(userId: string, kind: UpstreamKind): Promise<GatewayCredential[]> {
    if (!(await this.cfg.state.grant(userId))) throw new ConsentRequired();
    try {
      const all = await this.user(userId).listCredentials();
      return all.filter((c) => c.service === this.cfg.kinds[kind].service);
    } catch (err) {
      // 同意が取り消された・失効した: 保管した同意を捨て、もう一度許可してもらう
      if (!(err instanceof GatewayAuthError)) throw err;
      await this.cfg.state.deleteGrant(userId);
      throw new ConsentRequired(err.message);
    }
  }

  async upstream(userId: string, credentialId: string, kind: UpstreamKind): Promise<UpstreamCall> {
    const { service, scope } = this.cfg.kinds[kind];
    const issued = await this.user(userId).issueToken([credentialId]);
    const base = `${trimSlash(issued.baseUrl)}/${service}`;
    return async (method, path, init = {}) => {
      if (!inScope(scope, method, path)) throw new UpstreamRefused(method, path);
      return this.cfg.fetcher(`${base}${path}`, {
        method,
        headers: {
          ...init.headers,
          authorization: `Bearer ${issued.token}`,
          'user-agent': USER_AGENT,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    };
  }

  private user(userId: string): GatewayUser {
    const { fetcher, oauthConfig, oauth, state, box, now } = this.cfg;
    return new GatewayUser({ fetcher, gatewayUrl: oauthConfig.gatewayUrl, oauth, state, box, now }, userId);
  }
}
