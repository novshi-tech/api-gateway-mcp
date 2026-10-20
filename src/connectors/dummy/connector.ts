import type { Channel, DataSource, InboundSignal } from '../../domain';
import type { Connector, Cursor } from '../types';

/** ダミー上流の受信キュー。メモリ版と DB 版がある */
export interface DummyBackend {
  enqueue(tenantId: string, signal: InboundSignal): Promise<void>;
  /** データソースの未取得のシグナルを取り出す */
  take(dataSourceId: string): Promise<InboundSignal[]>;
}

/** ダミーコネクタ。pull はキューから返すだけ */
export class DummyConnector implements Connector {
  constructor(
    readonly channel: Channel,
    private readonly backend: DummyBackend,
  ) {}

  async pull(source: DataSource, _cursor: Cursor) {
    const signals = await this.backend.take(source.id);
    return { signals, cursor: null };
  }
}

export class MemoryDummyBackend implements DummyBackend {
  readonly queue: { tenantId: string; signal: InboundSignal }[] = [];

  async enqueue(tenantId: string, signal: InboundSignal) {
    this.queue.push({ tenantId, signal });
  }

  async take(dataSourceId: string) {
    const taken: InboundSignal[] = [];
    for (let i = 0; i < this.queue.length; ) {
      const item = this.queue[i]!;
      if (item.signal.dataSourceId === dataSourceId) {
        taken.push(item.signal);
        this.queue.splice(i, 1);
      } else i++;
    }
    return taken;
  }
}
