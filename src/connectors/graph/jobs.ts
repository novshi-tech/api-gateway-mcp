import { z } from 'zod';

// 取り込みのキュー（Cloudflare Queues、同時実行 1）に積む仕事。ゲートウェイを呼ぶのは全部ここを通すので、
// リフレッシュトークンの入れ替わりも delta の cursor も直列になる（0024 の決定 2）。

export const SyncJob = z.discriminatedUnion('kind', [
  /** Cron: 全データソースのサブスクリプションの手入れと、保険の delta */
  z.object({ kind: z.literal('maintain') }),
  /** つないだ直後・broken からの戻り: サブスクリプションを作り、delta の初回を読み流す */
  z.object({ kind: z.literal('setup'), dataSourceId: z.string() }),
  /** 変更の通知: そのフォルダの delta */
  z.object({ kind: z.literal('sync'), dataSourceId: z.string(), folder: z.string() }),
  z.object({ kind: z.literal('lifecycle'), subscriptionId: z.string(), event: z.string() }),
  /** 本人が外した: サブスクリプションを消す */
  z.object({ kind: z.literal('disconnect'), dataSourceId: z.string() }),
]);
export type SyncJob = z.infer<typeof SyncJob>;

export interface SyncQueue {
  send(job: SyncJob): Promise<void>;
}
