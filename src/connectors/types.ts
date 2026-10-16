import type { AddressRef, Channel, FileRef, InboundSignal, Principal } from '../domain';

export type Cursor = string | null;

export interface OutboundMessage {
  from: AddressRef;
  to: AddressRef[];
  subject: string;
  body: string;
  attachments: FileRef[];
  inReplyTo?: string;
}

/**
 * コネクタは「誰として取得・送信したか」を必ず持つ。
 * 本番実装はゲートウェイ経由で上流 API を叩く（プロトタイプはダミーのみ）。
 */
export interface Connector {
  channel: Channel;
  /** Cron から呼ばれる。principal の資格情報で since 以降を取る */
  pull(principal: Principal, since: Cursor): Promise<{ signals: InboundSignal[]; cursor: Cursor }>;
  /** 承認済み派生の送信。sentRef は重複排除キーになる */
  send(principal: Principal, msg: OutboundMessage): Promise<{ sentRef: string }>;
}

export type Connectors = Partial<Record<Channel, Connector>>;
