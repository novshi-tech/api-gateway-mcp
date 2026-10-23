import type { DomainEvent, DraftEvent, ProjectionChanges, Projections, Seed } from '../domain';

export class ConcurrencyError extends Error {
  constructor(expected: number) {
    super(`concurrent append (expected last seq ${expected})`);
    this.name = 'ConcurrencyError';
  }
}

/** append-only のイベントストア。単調な seq（1 デプロイ = 1 チームで 1 本、0021） */
export interface EventStore {
  /**
   * expectedLastSeq の直後に追記する。他の書き込みが先にあれば ConcurrencyError（楽観ロック）。
   * at は全イベント共通の記録時刻。
   */
  append(expectedLastSeq: number, drafts: readonly DraftEvent[], at: string): Promise<DomainEvent[]>;
  read(afterSeq?: number): Promise<DomainEvent[]>;
}

/** 投影の保存先。fold の結果をそのまま置き、いつでも消して作り直せる */
export interface ProjectionStore {
  load(): Promise<Projections | null>;
  /**
   * changes を渡せば、保存済みの投影に変わったスレッド・シグナル（と索引）だけを書く（0021）。
   * 渡さなければ丸ごと入れ替える（作り直しのとき）
   */
  save(p: Projections, changes?: ProjectionChanges): Promise<void>;
  clear(): Promise<void>;
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
