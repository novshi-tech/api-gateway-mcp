import { describe, expect, it } from 'vitest';
import { commView, Directory, recordSent, resolveBall, Seed, turnOf } from '../../src/domain';
import { alice, answer, dir, email, EventLog, ingestPure, makeCtx, seed } from '../helpers/world';

// クエリ層の「どちら側か」（0030）。fold はアドレスだけを畳み、こちらか・どの Contact か・誰の番かは、読むときのマスタで決まる

const T = (h: number, m = 0) => `2026-10-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

describe('どちら側か（sides）', () => {
  it('H8 相手が求めた → こちら（持ち主がいればその人）、こちらが求めた → 相手（保持者の Contact）', () => {
    const log = new EventLog();
    const ctx = makeCtx(T(9));
    const r = ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1' }), () => answer({ title: '雨漏り' }));
    const id = r.outcome!.threadId;
    expect(resolveBall(dir, log.state(), log.state().threads[id]!)).toEqual({ kind: 'us' });
    expect(commView(dir, log.state(), log.state().threads[id]!)).toMatchObject({ unansweredSince: T(9), lastInboundAt: T(9), counterpartContactIds: ['p_carol'] });

    ctx.setNow(T(10));
    ingestPure(log, ctx, email({ from: 'support@ubs.example', to: ['carol@example.com'], sourceRef: 'o1', anchors: { inReplyTo: undefined } }), () =>
      answer({ thread: 'existing', thread_id: id }),
    );
    const t = log.state().threads[id]!;
    expect(resolveBall(dir, log.state(), t)).toEqual({ kind: 'contact', contactIds: ['p_carol'] });
    expect(commView(dir, log.state(), t)).toMatchObject({ unansweredSince: null, lastOutboundAt: T(10) });
  });

  it('H8 宛先による「自分の番」は、相手が求めたシグナルの保持者に読者のアドレスが入っているか（受信の CC）', () => {
    const log = new EventLog();
    const ctx = makeCtx(T(9));
    const r = ingestPure(log, ctx, email({ from: 'carol@example.com', to: ['support@ubs.example', 'alice@ubs.example'], sourceRef: 'r1' }), () => answer());
    expect(turnOf(dir, log.state(), log.state().threads[r.outcome!.threadId]!)).toEqual({ kind: 'user', userIds: ['u_alice'], by: 'addressed' });
    const other = ingestPure(log, ctx, email({ from: 'info@dave.example', sourceRef: 'r2' }), () => answer());
    expect(turnOf(dir, log.state(), log.state().threads[other.outcome!.threadId]!)).toEqual({ kind: 'triage' });
  });

  it('H3 H8 名寄せを後から直すと、イベントはそのままで過去のスレッドの相手と誰の番が直る', () => {
    const log = new EventLog();
    const ctx = makeCtx(T(9));
    // 知らないアドレスからの依頼
    const r = ingestPure(log, ctx, email({ from: 'frank@example.com', to: ['support@ubs.example', 'bob@ubs.example'], sourceRef: 'r1' }), () => answer());
    const id = r.outcome!.threadId;
    const p = log.state();
    expect(commView(dir, p, p.threads[id]!).counterpartContactIds).toEqual([]);
    expect(turnOf(dir, p, p.threads[id]!)).toEqual({ kind: 'triage' });

    // あとから Frank を Contact にし、Bob の個人アドレスを Bob に付ける（イベントも投影も変えない）
    const fixed = new Directory(
      Seed.parse({
        ...seed,
        contacts: [...seed.contacts, { id: 'p_frank', name: 'Frank' }],
        addresses: [
          ...seed.addresses,
          { id: 'a_frank', channel: 'email', value: 'frank@example.com', contactId: 'p_frank' },
          { id: 'a_bob', channel: 'email', value: 'bob@ubs.example', contactId: 'p_bob' },
        ],
      }),
    );
    expect(commView(fixed, p, p.threads[id]!).counterpartContactIds).toEqual(['p_frank']);
    expect(turnOf(fixed, p, p.threads[id]!)).toEqual({ kind: 'user', userIds: ['u_bob'], by: 'addressed' });
  });

  it('H4 record_sent の from: 省けば窓口。指定するならそのデータソースでこちらのアドレス', () => {
    const log = new EventLog();
    const ctx = makeCtx(T(9));
    const base = { dataSourceId: 'ds_support', to: ['carol@example.com'], toContactIds: [], body: '調査します', sentRef: '<u1@x>' };
    const a = recordSent(log.state(), alice, ctx, base);
    expect(a.events[0]).toMatchObject({ type: 'OutboundRecorded', payload: { from: { value: 'support@ubs.example' } } });
    const b = recordSent(log.state(), alice, ctx, { ...base, from: 'alice@ubs.example' });
    expect(b.events[0]).toMatchObject({ type: 'OutboundRecorded', payload: { from: { value: 'alice@ubs.example' } } });
    expect(() => recordSent(log.state(), alice, ctx, { ...base, from: 'carol@example.com' })).toThrow(/not an address of this data source/);
    // 窓口のない個人の箱は本人のアドレス
    const c = recordSent(log.state(), alice, ctx, { ...base, dataSourceId: 'ds_alice', sentRef: '<u2@x>' });
    expect(c.events[0]).toMatchObject({ type: 'OutboundRecorded', payload: { from: { value: 'alice@ubs.example' } } });
  });
});
