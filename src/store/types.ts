import type { DomainEvent, DraftEvent, Projections, Seed } from '../domain';

export class ConcurrencyError extends Error {
  constructor(tenantId: string, expected: number) {
    super(`concurrent append on tenant ${tenantId} (expected last seq ${expected})`);
    this.name = 'ConcurrencyError';
  }
}

/** append-only のイベントストア。tenant ごとに単調な seq */
export interface EventStore {
  /**
   * expectedLastSeq の直後に追記する。他の書き込みが先にあれば ConcurrencyError（楽観ロック）。
   * at は全イベント共通の記録時刻。
   */
  append(tenantId: string, expectedLastSeq: number, drafts: readonly DraftEvent[], at: string): Promise<DomainEvent[]>;
  read(tenantId: string, afterSeq?: number): Promise<DomainEvent[]>;
}

/** 投影の保存先。fold の結果をそのまま置き、いつでも消して作り直せる */
export interface ProjectionStore {
  load(tenantId: string): Promise<Projections | null>;
  save(p: Projections): Promise<void>;
  clear(tenantId: string): Promise<void>;
}

export interface MasterStore {
  loadSeed(): Promise<Seed>;
  /** マスタを丸ごと入れ替える（プロトタイプの seed 投入用） */
  replaceSeed(seed: Seed): Promise<void>;
}

export interface Repo {
  events: EventStore;
  projections: ProjectionStore;
  master: MasterStore;
}
