import { parseEvent, Seed, type DomainEvent, type DraftEvent, type Projections } from '../domain';
import { ConcurrencyError, type EventStore, type MasterStore, type ProjectionStore, type Repo } from './types';

/** テスト・CLI 用のインメモリ実装 */
export class MemoryEventStore implements EventStore {
  private events: DomainEvent[] = [];

  async append(expectedLastSeq: number, drafts: readonly DraftEvent[], at: string): Promise<DomainEvent[]> {
    const last = this.events.at(-1)?.seq ?? 0;
    if (last !== expectedLastSeq) throw new ConcurrencyError(expectedLastSeq);
    const stored = drafts.map((d, i) => parseEvent({ seq: last + i + 1, at, type: d.type, payload: structuredClone(d.payload) }));
    this.events = [...this.events, ...stored];
    return stored;
  }

  async read(afterSeq = 0): Promise<DomainEvent[]> {
    return this.events.filter((e) => e.seq > afterSeq).map((e) => structuredClone(e));
  }
}

export class MemoryProjectionStore implements ProjectionStore {
  private saved: Projections | null = null;
  async load() {
    return this.saved ? structuredClone(this.saved) : null;
  }
  async save(p: Projections) {
    this.saved = structuredClone(p);
  }
  async clear() {
    this.saved = null;
  }
}

export class MemoryMasterStore implements MasterStore {
  private seed: Seed = Seed.parse({
    users: [],
    parties: [],
    addresses: [],
    lists: [],
    listMembers: [],
    attributeDefs: [],
  });
  async loadSeed() {
    return structuredClone(this.seed);
  }
  async replaceSeed(seed: Seed) {
    this.seed = structuredClone(seed);
  }
}

export function memoryRepo(): Repo {
  return { events: new MemoryEventStore(), projections: new MemoryProjectionStore(), master: new MemoryMasterStore() };
}
