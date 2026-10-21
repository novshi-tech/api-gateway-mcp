import { z } from 'zod';
import { AddressRef, Anchors, Channel, FileRef } from '../domain';

// HTTP API の入力スキーマ。キーはツール定義に合わせて snake_case。
// ステップ 3 までの分（スレッドの一覧・詳細・片付け・開き直し・シグナルの移し替え・メモ・持ち主・リンク・属性）。
// ツール一覧の作り直しはステップ 5

export const ListThreadsQuery = z.object({
  filter: z.enum(['my_turn', 'mine', 'open', 'triage', 'all']).default('open'),
  tenant: z.string().optional(),
  data_source: z.string().optional(),
});

export const GetThreadQuery = z.object({ since: z.string().optional() });

export const AddNoteBody = z.object({
  /** 足す先の自分のメモのスレッド。省略すれば新しいスレッド（「この件」） */
  thread_id: z.string().optional(),
  /** 新しいスレッドの件名。省略すれば本文の最初の行 */
  title: z.string().min(1).optional(),
  body: z.string().min(1),
  tenant: z.string().optional(),
});

export const ClaimBody = z
  .object({
    /** 持たせる User。省略すれば自分、null なら手放す */
    user_id: z.string().nullable().optional(),
    reason: z.string().optional(),
  })
  .default({});

export const LinkBody = z.object({ thread_id: z.string(), reason: z.string().optional() });

export const SetAttributeBody = z.object({ name: z.string(), value: z.unknown() });

export const DismissBody = z.object({ reason: z.string().min(1) });
export const ReopenBody = z.object({ reason: z.string().optional() }).default({});

export const MoveSignalBody = z
  .object({
    /** 移し先の既存のスレッド。省略して new_thread_title を渡せば新しいスレッド */
    thread_id: z.string().optional(),
    new_thread_title: z.string().min(1).optional(),
    needs_response: z.boolean().optional(),
    reason: z.string().min(1),
  })
  .refine((b) => (b.thread_id === undefined) !== (b.new_thread_title === undefined), {
    message: 'thread_id か new_thread_title のどちらか一方',
  });

export const InboundSignalBody = z.object({
  dataSourceId: z.string(),
  channel: Channel,
  from: AddressRef,
  to: z.array(AddressRef).default([]),
  subject: z.string().optional(),
  body: z.string(),
  anchors: Anchors.default({}),
  attachments: z.array(FileRef).default([]),
  sourceRef: z.string(),
});
