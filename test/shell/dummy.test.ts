import { describe, expect, it } from 'vitest';
import { DummyConnector, MemoryDummyBackend } from '../../src/connectors/dummy/connector';
import { PgDummyBackend } from '../../src/connectors/dummy/pg-backend';
import type { InboundSignal } from '../../src/domain';
import { pgliteDb } from '../../scripts/lib/pglite';
import { dir } from '../helpers/world';

const sig = (sourceRef: string, dataSourceId = 'ds_support'): InboundSignal => ({
  dataSourceId,
  channel: 'email',
  from: { channel: 'email', value: 'a@x' },
  to: [],
  body: 'b',
  sourceRef,
});

describe.each([
  ['memory', async () => new MemoryDummyBackend()],
  ['postgres', async () => new PgDummyBackend((await pgliteDb()).db)],
])('DummyConnector（%s）', (_n, make) => {
  it('pull はデータソースごとに、キューから一度だけ返す', async () => {
    const backend = await make();
    const c = new DummyConnector('email', backend);
    await backend.enqueue('ubs', sig('1'));
    await backend.enqueue('ubs', sig('2', 'ds_alice'));
    await backend.enqueue('ubs', sig('3'));
    expect((await c.pull(dir.dataSource('ds_support')!, null)).signals.map((s) => s.sourceRef)).toEqual(['1', '3']);
    expect((await c.pull(dir.dataSource('ds_support')!, null)).signals).toEqual([]);
    expect((await c.pull(dir.dataSource('ds_alice')!, null)).signals.map((s) => s.sourceRef)).toEqual(['2']);
  });
});
