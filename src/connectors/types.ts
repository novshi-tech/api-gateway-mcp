import type { Channel, DataSource, InboundSignal } from '../domain';

export type Cursor = string | null;

/**
 * コネクタは取り込みだけを持つ（送信はスタンドがゲートウェイ経由で行い、コネクタを通らない。0012）。
 * 「どのデータソースとして取得したか」を必ず持つ。本番実装はゲートウェイ経由（プロトタイプはダミーのみ）。
 */
export interface Connector {
  channel: Channel;
  /** Cron から呼ばれる。データソースの資格情報で cursor 以降を取る */
  pull(source: DataSource, cursor: Cursor): Promise<{ signals: InboundSignal[]; cursor: Cursor }>;
}

export type Connectors = Partial<Record<Channel, Connector>>;
