import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Channel, InboundSignal, Principal } from '../../domain';
import type { Db } from '../../store/drizzle';
import { dummyQueue } from '../../store/schema';
import { samePrincipal, type DummyBackend, type SentLogEntry } from './connector';

/** Worker 上で動かすときのダミー上流（Neon のテーブルに置く） */
export class PgDummyBackend implements DummyBackend {
  constructor(private readonly db: Db) {}

  async enqueue(channel: Channel, signal: InboundSignal) {
    const tenantId = signal.acquiredAs.kind === 'organization' ? signal.acquiredAs.tenantId : '';
    await this.db.insert(dummyQueue).values({ tenantId, channel, kind: 'inbound', message: signal });
  }

  async take(channel: Channel, principal: Principal) {
    const rows = await this.db
      .select()
      .from(dummyQueue)
      .where(and(eq(dummyQueue.channel, channel), eq(dummyQueue.kind, 'inbound'), eq(dummyQueue.consumed, false)))
      .orderBy(asc(dummyQueue.id));
    const mine = rows.filter((r) => samePrincipal((r.message as InboundSignal).acquiredAs, principal));
    if (mine.length > 0) {
      await this.db.update(dummyQueue).set({ consumed: true }).where(inArray(dummyQueue.id, mine.map((r) => r.id)));
    }
    return mine.map((r) => r.message as InboundSignal);
  }

  async logSent(entry: SentLogEntry) {
    const [row] = await this.db
      .insert(dummyQueue)
      .values({ tenantId: '', channel: entry.channel, kind: 'sent', message: entry })
      .returning({ id: dummyQueue.id });
    return row!.id;
  }
}
