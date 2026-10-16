import { describe, expect, it } from 'vitest';
import { DummyConnector, MemoryDummyBackend } from '../../src/connectors/dummy/connector';
import { PgDummyBackend } from '../../src/connectors/dummy/pg-backend';
import type { InboundSignal } from '../../src/domain';
import { pgliteDb } from '../helpers/pglite';

const org = { kind: 'organization' as const, tenantId: 'ubs' };
const user = { kind: 'user' as const, userId: 'u_alice' };
const sig = (sourceRef: string, acquiredAs: InboundSignal['acquiredAs'] = org): InboundSignal => ({
  channel: 'email',
  from: { channel: 'email', value: 'a@x' },
  to: [],
  body: 'b',
  sourceRef,
  acquiredAs,
});
const msg = { from: { channel: 'email' as const, value: 'support@ubs.example' }, to: [{ channel: 'email' as const, value: 'c@x' }], subject: 's', body: 'b', attachments: [], inReplyTo: '<m0>' };

describe.each([
  ['memory', async () => new MemoryDummyBackend()],
  ['postgres', async () => new PgDummyBackend((await pgliteDb()).db)],
])('DummyConnector（%s）', (_n, make) => {
  it('pull は取得主体ごとに、キューから一度だけ返す', async () => {
    const backend = await make();
    const c = new DummyConnector('email', backend);
    await backend.enqueue('email', sig('1'));
    await backend.enqueue('email', sig('2', user));
    await backend.enqueue('slack', { ...sig('3'), channel: 'slack' });
    expect((await c.pull(org, null)).signals.map((s) => s.sourceRef)).toEqual(['1']);
    expect((await c.pull(org, null)).signals).toEqual([]);
    expect((await c.pull(user, null)).signals.map((s) => s.sourceRef)).toEqual(['2']);
  });

  it('send は送信ログに書くだけ。echoObserved なら次の pull で observed-sent として返す', async () => {
    const backend = await make();
    const quiet = new DummyConnector('email', backend);
    const r1 = await quiet.send(org, msg);
    expect(r1.sentRef).toMatch(/^<dummy-email-\d+@murmur\.invalid>$/);
    expect((await quiet.pull(org, null)).signals).toEqual([]);

    const echo = new DummyConnector('email', backend, { echoObserved: true });
    const r2 = await echo.send(org, msg);
    expect(r2.sentRef).not.toBe(r1.sentRef);
    const [observed] = (await echo.pull(org, null)).signals;
    expect(observed).toMatchObject({
      from: msg.from,
      anchors: { messageId: r2.sentRef, inReplyTo: '<m0>' },
      sourceRef: `observed:${r2.sentRef}`,
      acquiredAs: org,
    });
  });
});
