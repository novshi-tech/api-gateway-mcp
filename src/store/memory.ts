import { parseEvent, Seed, type DomainEvent, type DraftEvent, type Projections } from '../domain';
import { ConcurrencyError, type EventStore, type MasterStore, type ProjectionStore, type Repo } from './types';

/** テスト・CLI 用のインメモリ実装 */
export class MemoryEventStore implements EventStore {
  private readonly byTenant = new Map<string, DomainEvent[]>();

  async append(tenantId: string, expectedLastSeq: number, drafts: readonly DraftEvent[], at: string): Promise<DomainEvent[]> {
    const list = this.byTenant.get(tenantId) ?? [];
    const last = list.at(-1)?.seq ?? 0;
    if (last !== expectedLastSeq) throw new ConcurrencyError(tenantId, expectedLastSeq);
    const stored = drafts.map((d, i) =>
      parseEvent({ tenantId, seq: last + i + 1, at, type: d.type, payload: structuredClone(d.payload) }),
    );
    this.byTenant.set(tenantId, [...list, ...stored]);
    return stored;
  }

  async read(tenantId: string, afterSeq = 0): Promise<DomainEvent[]> {
    return (this.byTenant.get(tenantId) ?? []).filter((e) => e.seq > afterSeq).map((e) => structuredClone(e));
  }
}

export class MemoryProjectionStore implements ProjectionStore {
  private readonly byTenant = new Map<string, Projections>();
  async load(tenantId: string) {
    const p = this.byTenant.get(tenantId);
    return p ? structuredClone(p) : null;
  }
  async save(p: Projections) {
    this.byTenant.set(p.tenantId, structuredClone(p));
  }
  async clear(tenantId: string) {
    this.byTenant.delete(tenantId);
  }
}

export class MemoryMasterStore implements MasterStore {
  private seed: Seed = Seed.parse({
    tenants: [],
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
