// 取り込みの運用の状態（0024 の決定 2）。台帳（スレッドの事実）ではないのでイベントにせず、D1 のテーブルに置く。
// リプレイ（H1）の対象外。

export type SourceStatus = 'setup' | 'ok' | 'broken' | 'disconnected';

/** フォルダごとの delta の位置。link は次に読む nextLink か deltaLink（どちらもなければ最初から） */
export interface FolderCursor {
  link: string | null;
  /** 取り込んだ最後のメールの受信時刻（deltaLink が無効になったときの取り直しの起点） */
  lastReceivedAt: string | null;
}

/** 実行時に作ったデータソースの取り込みの状態 */
export interface SourceState {
  dataSourceId: string;
  /** 個人の箱の本人（ゲートウェイの User） */
  userId: string;
  gatewayCredentialId: string;
  status: SourceStatus;
  /** broken・disconnected の理由 */
  reason: string | null;
  folders: Record<string, FolderCursor>;
  connectedAt: string;
  /** 最後に全フォルダの delta を終えた時刻 */
  lastSyncAt: string | null;
  /** 最後に broken から試し直した時刻 */
  lastRetryAt: string | null;
}

export interface SubscriptionRecord {
  /** Graph のサブスクリプションの ID */
  id: string;
  dataSourceId: string;
  folder: string;
  /** clientState の SHA-256（平文は持たない） */
  clientStateHash: string;
  expiresAt: string;
}
