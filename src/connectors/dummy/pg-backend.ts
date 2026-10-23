import { and, asc, eq, inArray } from 'drizzle-orm';
import type { InboundItem } from '../../domain';
import type { Db } from '../../store/drizzle';
import { dummyQueue } from '../../store/schema';
import type { DummyBackend } from './connector';

/** Worker 上で動かすときのダミー上流（Neon のテーブルに置く） */
export class PgDummyBackend implements DummyBackend {
  constructor(private readonly db: Db) {}

  async enqueue(item: InboundItem) {
    await this.db.insert(dummyQueue).values({ dataSourceId: item.dataSourceId, message: item });
  }

  async take(dataSourceId: string) {
    const rows = await this.db
      .select()
      .from(dummyQueue)
      .where(and(eq(dummyQueue.dataSourceId, dataSourceId), eq(dummyQueue.consumed, false)))
      .orderBy(asc(dummyQueue.id));
    if (rows.length > 0) {
      await this.db.update(dummyQueue).set({ consumed: true }).where(inArray(dummyQueue.id, rows.map((r) => r.id)));
    }
    return rows.map((r) => r.message as InboundItem);
  }
}
