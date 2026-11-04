import { GatewayAuthError, GatewayError, inScope, type ReadScope, type UpstreamCall } from '../../ports/gateway';
import { CommentPage, SEARCH_FIELDS, SearchPage } from './issue';

// Jira の呼び出し（ゲートウェイの REST 経由。0034 の決定 5）。本体が Jira に対してするのは、読み取りと Webhook の管理だけ。
// 呼べる口は ALLOWED に固定する（起票・コメント・遷移などの書き込みは、スタンドがゲートウェイで行う）。

export interface JiraSite {
  id: string;
  url: string;
  name: string;
}

export interface JiraMe {
  accountId: string;
  displayName: string;
}

export interface JiraWebhookSpec {
  events: string[];
  jqlFilter: string;
}

/** 登録の結果。Webhook ごとに作れた ID か、エラー */
export type WebhookRegistration = { id: number } | { errors: string[] };

export interface JiraApi {
  sites(): Promise<JiraSite[]>;
  myself(cloudId: string): Promise<JiraMe>;
  search(cloudId: string, jql: string, nextPageToken?: string): Promise<SearchPage>;
  /** 新しい順。startAt で続きを読む */
  comments(cloudId: string, key: string, startAt?: number): Promise<CommentPage>;
  registerWebhooks(cloudId: string, url: string, webhooks: JiraWebhookSpec[]): Promise<WebhookRegistration[]>;
  /** 延長。新しい期限 */
  refreshWebhooks(cloudId: string, ids: number[]): Promise<string | null>;
  deleteWebhooks(cloudId: string, ids: number[]): Promise<void>;
}

export class JiraError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`jira ${status} ${message}`);
    this.name = 'JiraError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * 本体が呼べる口（メソッドとパス）。読み取りと、購読の管理（Webhook の登録・延長・削除。0024 の決定 1）だけ。
 * 組み立て時にゲートウェイの口の実装に渡し（0023 の決定 4）、ここにない呼び出しは送る前に断る
 */
export const JIRA_SCOPE: ReadScope = Object.freeze([
  ['GET', /^\/oauth\/token\/accessible-resources$/],
  ['GET', /^\/ex\/jira\/[\w-]+\/rest\/api\/3\/myself$/],
  ['GET', /^\/ex\/jira\/[\w-]+\/rest\/api\/3\/search\/jql$/],
  ['GET', /^\/ex\/jira\/[\w-]+\/rest\/api\/3\/issue\/[A-Z][A-Z0-9_]*-\d+\/comment$/],
  ['POST', /^\/ex\/jira\/[\w-]+\/rest\/api\/3\/webhook$/],
  ['PUT', /^\/ex\/jira\/[\w-]+\/rest\/api\/3\/webhook\/refresh$/],
  ['DELETE', /^\/ex\/jira\/[\w-]+\/rest\/api\/3\/webhook$/],
] as const);

export function isAllowed(method: Method, path: string): boolean {
  return inScope(JIRA_SCOPE, method, path);
}

/** ゲートウェイの口（本人の接続）で Jira を呼ぶ。呼べる口は JIRA_SCOPE で、口の実装も強制する */
export class GatewayJiraApi implements JiraApi {
  constructor(private readonly upstream: UpstreamCall) {}

  async sites(): Promise<JiraSite[]> {
    const r = (await this.call('GET', '/oauth/token/accessible-resources')) as Array<{ id: string; url: string; name: string }>;
    return r.map((s) => ({ id: s.id, url: s.url, name: s.name }));
  }

  async myself(cloudId: string): Promise<JiraMe> {
    const r = (await this.call('GET', `${site(cloudId)}/myself`)) as { accountId: string; displayName?: string };
    return { accountId: r.accountId, displayName: r.displayName ?? '' };
  }

  async search(cloudId: string, jql: string, nextPageToken?: string): Promise<SearchPage> {
    const q = new URLSearchParams({ jql, fields: SEARCH_FIELDS.join(','), maxResults: '50' });
    if (nextPageToken) q.set('nextPageToken', nextPageToken);
    return SearchPage.parse(await this.call('GET', `${site(cloudId)}/search/jql`, undefined, q));
  }

  async comments(cloudId: string, key: string, startAt = 0): Promise<CommentPage> {
    const q = new URLSearchParams({ orderBy: '-created', maxResults: '50', startAt: String(startAt) });
    return CommentPage.parse(await this.call('GET', `${site(cloudId)}/issue/${key}/comment`, undefined, q));
  }

  async registerWebhooks(cloudId: string, url: string, webhooks: JiraWebhookSpec[]): Promise<WebhookRegistration[]> {
    const r = (await this.call('POST', `${site(cloudId)}/webhook`, { url, webhooks })) as {
      webhookRegistrationResult?: Array<{ createdWebhookId?: number; errors?: string[] }>;
    };
    return (r.webhookRegistrationResult ?? []).map((x) => (x.createdWebhookId !== undefined ? { id: x.createdWebhookId } : { errors: x.errors ?? ['unknown'] }));
  }

  async refreshWebhooks(cloudId: string, ids: number[]): Promise<string | null> {
    const r = (await this.call('PUT', `${site(cloudId)}/webhook/refresh`, { webhookIds: ids })) as { expirationDate?: string };
    return r.expirationDate ? new Date(r.expirationDate).toISOString() : null;
  }

  async deleteWebhooks(cloudId: string, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.call('DELETE', `${site(cloudId)}/webhook`, { webhookIds: ids });
  }

  private async call(method: Method, path: string, body?: unknown, query?: URLSearchParams): Promise<unknown> {
    if (!isAllowed(method, path)) throw new JiraError(400, `not allowed: ${method} ${path}`);
    const res = await this.upstream(method, `${path}${query ? `?${query}` : ''}`, { body, headers: { accept: 'application/json' } });
    if (res.status === 202 || res.status === 204) return {};
    const json = (await res.json().catch(() => ({}))) as { error?: unknown; errorMessages?: string[]; message?: string };
    if (res.ok) return json;
    // ゲートウェイ自身のエラーは { error: "..." }、Jira のエラーは { errorMessages: [...] } か { message }
    if (typeof json.error === 'string') {
      if (res.status === 401 || res.status === 403) throw new GatewayAuthError(json.error);
      throw new GatewayError(json.error, res.status);
    }
    const message = json.errorMessages?.join('; ') || json.message || String(res.status);
    if (res.status === 401) throw new GatewayAuthError(`jira ${res.status} ${message}`);
    throw new JiraError(res.status, message);
  }
}

function site(cloudId: string): string {
  return `/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3`;
}
