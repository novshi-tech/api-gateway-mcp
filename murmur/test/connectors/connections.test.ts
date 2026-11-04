import { beforeEach, describe, expect, it } from 'vitest';
import { Connections } from '../../src/app/connections';
import { GatewayUser } from '../../src/connectors/gateway/client';
import type { Fetcher } from '../../src/connectors/gateway/http';
import { clientMetadata, GatewayOAuth } from '../../src/connectors/gateway/oauth';
import { RemoteGateway } from '../../src/connectors/gateway/remote';
import { UpstreamRefused } from '../../src/ports/gateway';
import { GRAPH_SCOPE } from '../../src/connectors/graph/scope';
import { JIRA_SCOPE } from '../../src/connectors/jira/api';
import type { SyncJob } from '../../src/connectors/graph/jobs';
import { base64Url, SecretBox } from '../../src/connectors/secrets';
import { connectorOwner, deriveViewer } from '../../src/domain';
import { MemoryConnectorState } from '../../src/store/connector-state';
import { counterIds, makeService } from '../helpers/service';
import { FakeGraph } from '../helpers/fake-graph';
import { FakeJira } from '../helpers/fake-jira';
import { seed } from '../helpers/world';

// 個人の箱をつなぐ（0024 の決定 3）。ゲートウェイは偽物（OAuth のトークンの入れ替わりと MCP の 2 つのツールだけ）

const GATEWAY = 'https://gateway.test';
const MURMUR = 'https://murmur.test';

function jwt(sub: string) {
  const enc = (o: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: 'HS256' })}.${enc({ sub })}.sig`;
}

/** ゲートウェイの偽物。リフレッシュトークンは使うたびに入れ替わり、古いものは invalid_grant */
class FakeGateway {
  /** 認可コード → 許可したユーザー */
  readonly codes = new Map<string, string>();
  readonly refreshTokens = new Map<string, string>();
  readonly accessTokens = new Map<string, string>();
  readonly credentials = new Map<string, { id: string; service: string; label: string }[]>();
  refreshes = 0;
  /** ゲートウェイでつなぎ直しが要る接続（issue_token がエラーになる） */
  readonly reconnect = new Set<string>();
  private n = 0;

  private tokens(user: string) {
    const access = `at${++this.n}`;
    const refresh = `rt${this.n}`;
    this.accessTokens.set(access, user);
    this.refreshTokens.set(refresh, user);
    return { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'bearer' };
  }

  fetch: Fetcher = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/oauth/token') {
      const p = new URLSearchParams(String(init?.body));
      if (p.get('client_id') !== `${MURMUR}/oauth/client.json` || p.get('resource') !== `${GATEWAY}/mcp`) return Response.json({ error: 'invalid_client' }, { status: 401 });
      if (p.get('grant_type') === 'authorization_code') {
        const user = this.codes.get(p.get('code')!);
        if (!user || !p.get('code_verifier')) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        this.codes.delete(p.get('code')!);
        return Response.json(this.tokens(user));
      }
      const user = this.refreshTokens.get(p.get('refresh_token')!);
      if (!user) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      this.refreshTokens.delete(p.get('refresh_token')!);
      this.refreshes++;
      return Response.json(this.tokens(user));
    }
    if (u.pathname === '/mcp') {
      const user = this.accessTokens.get(String((init?.headers as Record<string, string>).authorization).replace('Bearer ', ''));
      if (!user) return new Response('unauthorized', { status: 401 });
      const { params } = JSON.parse(String(init?.body)) as { params: { name: string; arguments: { credential_ids?: string[] } } };
      if (params.name === 'issue_token' && params.arguments.credential_ids?.some((id) => this.reconnect.has(id))) {
        return Response.json({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'credential needs reconnect' }] } });
      }
      const text =
        params.name === 'list_credentials'
          ? JSON.stringify({ credentials: this.credentials.get(user) ?? [] })
          : JSON.stringify({ token: jwt(user), base_url: `${GATEWAY}/api`, expires_at: '2026-10-30T00:15:00.000Z' });
      return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } });
    }
    return new Response('not found', { status: 404 });
  };

  /** 本人がゲートウェイの同意の画面で許可して、コールバックに戻ってきたときのコード */
  approve(user: string) {
    const code = `code${++this.n}`;
    this.codes.set(code, user);
    return code;
  }
}

describe('H3 ゲートウェイの OAuth クライアント', () => {
  it('CIMD のメタデータ: client_id はメタデータの URL、公開クライアント', () => {
    expect(clientMetadata({ publicUrl: `${MURMUR}/` })).toMatchObject({
      client_id: `${MURMUR}/oauth/client.json`,
      redirect_uris: [`${MURMUR}/oauth/callback`],
      token_endpoint_auth_method: 'none',
      client_name: 'Murmur',
    });
  });
});

describe('H3 個人の箱をつなぐ', () => {
  let gw: FakeGateway;
  let state: MemoryConnectorState;
  let queued: SyncJob[];
  let now: string;
  let ctx: Awaited<ReturnType<typeof setup>>;
  let jira: FakeJira;

  async function setup() {
    const made = await makeService(seed);
    const box = await SecretBox.fromBase64(btoa(String.fromCharCode(...new Uint8Array(32).fill(7))));
    const clock = () => now;
    const oauthConfig = { gatewayUrl: GATEWAY, publicUrl: MURMUR };
    const oauth = new GatewayOAuth(oauthConfig, gw.fetch, clock);
    const deps = { fetcher: gw.fetch, gatewayUrl: GATEWAY, oauth, state, box, now: clock };
    const gateway = new RemoteGateway({
      ...deps,
      oauthConfig,
      kinds: { graph: { service: 'graph', scope: GRAPH_SCOPE }, jira: { service: 'jira', scope: JIRA_SCOPE } },
    });
    const connections = new Connections({
      gateway,
      state,
      now: clock,
      service: made.service,
      queue: { send: async (j) => void queued.push(j) },
      newId: counterIds(),
      graphFor: () => new FakeGraph({ id: 'oid', displayName: 'Bob', addresses: ['bob@ubs.example', 'bob.alias@ubs.example'] }),
      jiraFor: () => jira,
    });
    return { ...made, connections, deps, gateway };
  }

  /** つなぐを頼み、本人が許可して戻ってくる */
  async function consent(asUser: string, credentialId?: string) {
    const r = await ctx.connections.connectOutlook('u_bob', credentialId);
    if (r.status !== 'authorize') throw new Error(`expected authorize, got ${r.status}`);
    const url = new URL(r.authorize_url);
    expect(url.origin + url.pathname).toBe(`${GATEWAY}/authorize`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    return ctx.connections.callback({ state: url.searchParams.get('state'), code: gw.approve(asUser), error: null });
  }

  beforeEach(async () => {
    gw = new FakeGateway();
    gw.credentials.set('u_bob', [{ id: 'gw_bob', service: 'graph', label: 'ubs' }, { id: 'gw_freee', service: 'freee', label: 'ubs' }]);
    gw.credentials.set('u_alice', [{ id: 'gw_alice', service: 'graph', label: 'ubs' }]);
    state = new MemoryConnectorState();
    queued = [];
    now = '2026-10-30T00:00:00.000Z';
    jira = new FakeJira(() => now);
    ctx = await setup();
  });

  it('同意がなければ認可の URL → 許可 → データソースを作り（読者は本人だけ）、キューに setup を積む', async () => {
    expect(await consent('u_bob')).toMatchObject({ ok: true });
    const dir = await ctx.service.directory();
    const ds = dir.seed.dataSources.find((d) => d.kind === 'service' && d.connector)!;
    expect(ds.name).toBe('Bob の Outlook');
    expect(connectorOwner(dir.seed, ds)).toBe('u_bob');
    expect(deriveViewer(dir, 'u_alice').dataSourceIds).not.toContain(ds.id);
    expect(queued).toEqual([{ kind: 'setup', dataSourceId: ds.id }]);
    expect(await state.source(ds.id)).toMatchObject({ userId: 'u_bob', gatewayCredentialId: 'gw_bob', status: 'setup', connectedAt: now });
    // リフレッシュトークンは平文で置かない
    expect(JSON.stringify([...state.grants.values()])).not.toMatch(/rt\d/);
    expect(await ctx.connections.list('u_bob')).toEqual([expect.objectContaining({ data_source: ds.id, status: 'setup' })]);
  });

  it('同意があれば認可を飛ばし、何度呼んでも同じデータソース', async () => {
    await consent('u_bob');
    const again = await ctx.connections.connectOutlook('u_bob');
    expect(again).toMatchObject({ status: 'connected', created: false });
    expect((await ctx.service.directory()).seed.dataSources.filter((d) => d.kind === 'service' && d.connector)).toHaveLength(1);
  });

  it('許可したのが頼んだ本人でなければ保管もしないし作りもしない', async () => {
    expect(await consent('u_alice')).toMatchObject({ ok: false });
    expect(state.grants.size).toBe(0);
    expect((await ctx.service.directory()).seed.dataSources.some((d) => d.kind === 'service' && d.connector)).toBe(false);
  });

  it('state は 1 回きりで、15 分で切れる', async () => {
    const r = await ctx.connections.connectOutlook('u_bob');
    const stateParam = new URL((r as { authorize_url: string }).authorize_url).searchParams.get('state');
    now = '2026-10-30T00:16:00.000Z';
    expect(await ctx.connections.callback({ state: stateParam, code: gw.approve('u_bob'), error: null })).toMatchObject({ ok: false });
    expect(await ctx.connections.callback({ state: stateParam, code: gw.approve('u_bob'), error: null })).toMatchObject({ ok: false });
  });

  it('Graph の接続が複数なら選んでもらう', async () => {
    gw.credentials.set('u_bob', [{ id: 'gw_a', service: 'graph', label: 'a' }, { id: 'gw_b', service: 'graph', label: 'b' }]);
    await consent('u_bob');
    expect(await ctx.connections.connectOutlook('u_bob')).toMatchObject({ status: 'choose', credentials: [{ id: 'gw_a' }, { id: 'gw_b' }] });
    expect(await ctx.connections.connectOutlook('u_bob', 'gw_b')).toMatchObject({ status: 'connected', created: true });
  });

  it('サインインしていない User はつなげない（0030: Contact のない User でも個人のリストは作れる）', async () => {
    await expect(ctx.connections.connectOutlook('u_nobody')).rejects.toThrow(/サインイン/);
  });

  it('リフレッシュトークンの入れ替わり: 同時に 2 つ呼んでも、負けた方は勝った方のトークンを使い直して両方通る', async () => {
    await consent('u_bob');
    now = '2026-10-30T01:00:00.000Z';
    const a = new GatewayUser(ctx.deps, 'u_bob');
    const b = new GatewayUser(ctx.deps, 'u_bob');
    const [x, y] = await Promise.all([a.issueToken(['gw_bob']), b.issueToken(['gw_bob'])]);
    expect([x.userId, y.userId]).toEqual(['u_bob', 'u_bob']);
    // 片方の版の書き込みが負け、勝った方のトークンを使い直す（負けた方の refresh は捨てられる）
    expect(gw.refreshes).toBe(1);
    expect((await state.grant('u_bob'))!.version).toBe(2);
    expect(await new GatewayUser(ctx.deps, 'u_bob').listCredentials()).toHaveLength(2);
  });

  it('H3 ゲートウェイの口は読める口だけを通す（メールの送信は送る前に断る。0023 の決定 4）', async () => {
    await consent('u_bob');
    const graph = await ctx.gateway.upstream('u_bob', 'gw_bob', 'graph');
    await expect(graph('POST', '/v1.0/me/sendMail', { body: {} })).rejects.toBeInstanceOf(UpstreamRefused);
    await expect(graph('PATCH', '/v1.0/me/messages/m1', { body: {} })).rejects.toBeInstanceOf(UpstreamRefused);
    await expect(graph('DELETE', '/v1.0/me/messages/m1')).rejects.toBeInstanceOf(UpstreamRefused);
    expect((await graph('GET', '/v1.0/me?$select=id')).status).toBe(404); // 偽物のゲートウェイは REST を持たないが、送れてはいる
    const jira = await ctx.gateway.upstream('u_bob', 'gw_bob', 'jira');
    await expect(jira('POST', '/ex/jira/c1/rest/api/3/issue', { body: {} })).rejects.toBeInstanceOf(UpstreamRefused);
    await expect(jira('POST', '/ex/jira/c1/rest/api/3/issue/A-1/comment', { body: {} })).rejects.toBeInstanceOf(UpstreamRefused);
  });

  it('同意は有効で、選んだ接続がゲートウェイでつなぎ直しを要るときは 409（同意は捨てない。0023 の段取り 2）', async () => {
    await consent('u_bob');
    gw.reconnect.add('gw_bob');
    await expect(ctx.connections.connectOutlook('u_bob')).rejects.toMatchObject({ code: 'conflict' });
    expect(state.grants.size).toBe(1);
  });

  it('同意が取り消されていたら、もう一度認可の URL を返す', async () => {
    await consent('u_bob');
    gw.refreshTokens.clear();
    gw.accessTokens.clear();
    now = '2026-10-30T02:00:00.000Z';
    expect((await ctx.connections.connectOutlook('u_bob')).status).toBe('authorize');
    expect(state.grants.size).toBe(0);
  });

  it('外す: disconnected にしてキューに積む。本人以外は外せない', async () => {
    await consent('u_bob');
    const [view] = await ctx.connections.list('u_bob');
    await expect(ctx.connections.disconnect('u_alice', view!.data_source)).rejects.toThrow(/not found/);
    expect(await ctx.connections.disconnect('u_bob', view!.data_source)).toEqual([expect.objectContaining({ status: 'disconnected' })]);
    expect(queued.at(-1)).toEqual({ kind: 'disconnect', dataSourceId: view!.data_source });
    // つなぎ直すと、その時点から取る
    now = '2026-10-31T00:00:00.000Z';
    expect(await ctx.connections.connectOutlook('u_bob')).toMatchObject({ status: 'connected', created: false });
    expect(await state.source(view!.data_source)).toMatchObject({ status: 'setup', connectedAt: now, folders: {} });
  });

  describe('Jira（0034 の決定 1・2）', () => {
    async function consentJira(asUser: string, input: { jql?: string } = {}) {
      const r = await ctx.connections.connectJira('u_bob', input);
      if (r.status !== 'authorize') throw new Error(`expected authorize, got ${r.status}`);
      const url = new URL(r.authorize_url);
      return ctx.connections.callback({ state: url.searchParams.get('state'), code: gw.approve(asUser), error: null });
    }

    beforeEach(() => {
      gw.credentials.set('u_bob', [{ id: 'gw_bob', service: 'graph', label: 'ubs' }, { id: 'gw_jira', service: 'jira', label: 'Jira' }]);
    });

    it('同意 → サイトが 1 つならそのまま、本人の accountId をアイデンティティにして個人リストを作る', async () => {
      expect(await consentJira('u_bob')).toMatchObject({ ok: true, message: expect.stringMatching(/Jira/) });
      const dir = await ctx.service.directory();
      const ds = dir.seed.dataSources.find((d) => d.kind === 'service' && d.connector?.kind === 'jira')!;
      expect(ds).toMatchObject({
        channel: 'jira',
        name: 'Bob の Jira（acme）',
        connector: { kind: 'jira', cloudId: 'cloud-1', site: 'https://acme.atlassian.net', jql: 'assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()' },
      });
      expect(connectorOwner(dir.seed, ds)).toBe('u_bob');
      expect(deriveViewer(dir, 'u_alice').dataSourceIds).not.toContain(ds.id);
      expect(dir.contactIdOfAddress({ channel: 'jira', value: 'acct-bob' })).toBe('p_bob');
      expect(queued).toEqual([{ kind: 'setup', dataSourceId: ds.id }]);
      expect(await state.source(ds.id)).toMatchObject({ kind: 'jira', gatewayCredentialId: 'gw_jira', status: 'setup', jira: { syncedUntil: now, webhookIds: [] } });
      expect(await ctx.connections.list('u_bob')).toEqual([expect.objectContaining({ kind: 'jira', site: 'https://acme.atlassian.net', status: 'setup' })]);
    });

    it('同意は Outlook と共有。Outlook をつないだあとは認可を飛ばす。サイトが複数なら選んでもらう', async () => {
      await consent('u_bob');
      jira.siteList.push({ id: 'cloud-2', url: 'https://other.atlassian.net', name: 'other' });
      expect(await ctx.connections.connectJira('u_bob')).toMatchObject({ status: 'choose_site', sites: [{ id: 'cloud-1' }, { id: 'cloud-2' }] });
      expect(await ctx.connections.connectJira('u_bob', { cloudId: 'cloud-2', jql: 'project = OPS ORDER BY created DESC' })).toMatchObject({ status: 'connected', created: true });
      const ds = (await ctx.service.directory()).seed.dataSources.find((d) => d.kind === 'service' && d.connector?.kind === 'jira')!;
      // 並びは取り込みが付けるので落とす
      expect(ds.kind === 'service' && ds.connector).toMatchObject({ cloudId: 'cloud-2', jql: 'project = OPS' });
      expect(await ctx.connections.connectJira('u_bob', { cloudId: 'cloud-2' })).toMatchObject({ status: 'connected', created: false });
    });

    it('ゲートウェイに Jira の接続がなければ、つなげない', async () => {
      gw.credentials.set('u_bob', [{ id: 'gw_bob', service: 'graph', label: 'ubs' }]);
      expect(await consentJira('u_bob')).toMatchObject({ ok: false, message: expect.stringMatching(/Jira/) });
      await consent('u_bob');
      expect(await ctx.connections.connectJira('u_bob')).toMatchObject({ status: 'no_credential' });
    });

    it('範囲の JQL を変える: マスタを書き換え、ok なら setup をやり直す。本人以外は変えられない', async () => {
      await consentJira('u_bob');
      const [view] = await ctx.connections.list('u_bob');
      const s = (await state.source(view!.data_source))!;
      await state.putSource({ ...s, status: 'ok' });
      queued = [];
      await expect(ctx.connections.setJiraScope('u_alice', view!.data_source, 'project = X')).rejects.toThrow(/not found/);
      expect(await ctx.connections.setJiraScope('u_bob', view!.data_source, 'project = SPW')).toEqual([expect.objectContaining({ jql: 'project = SPW', status: 'setup' })]);
      expect(queued).toEqual([{ kind: 'setup', dataSourceId: view!.data_source }]);
    });
  });
});
