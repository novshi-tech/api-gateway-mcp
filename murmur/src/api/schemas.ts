import { z } from 'zod';
import { AddressRef, Anchors, Author, Channel, FileRef, MirrorFields } from '../domain';

// HTTP API の入力スキーマ。キーはツール定義に合わせて snake_case。
// ツールの一覧は計画 v2 の「スタンド接続」の表（ステップ 5）。スキルの API の表と合わせる

/** オフセット付きの時刻を受け、UTC の ISO 8601 にそろえる（文字列で比べるため。v1 の H7 のバグ） */
export const Instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString());

export const ListThreadsQuery = z.object({
  filter: z.enum(['my_turn', 'mine', 'open', 'overdue', 'triage', 'all']).default('open'),
  data_source: z.string().optional(),
  /** 前回見た時刻。それより後に動いたスレッドだけ */
  since: Instant.optional(),
});

export const GetThreadQuery = z.object({ since: Instant.optional() });

export const AddNoteBody = z.object({
  /** 足す先の自分のメモのスレッド。省略すれば新しいスレッド（「この件」） */
  thread_id: z.string().optional(),
  /** 新しいスレッドの件名。省略すれば本文の最初の行 */
  title: z.string().min(1).optional(),
  body: z.string().min(1),
  /** 書き手。省略すれば本人（user）。エージェント自身が書いたものは {kind:'agent', name}（0031 の 3） */
  author: Author.optional(),
});

export const ClaimBody = z
  .object({
    /** 持たせる User。省略すれば自分、null なら手放す */
    user_id: z.string().nullable().optional(),
    reason: z.string().optional(),
  })
  .default({});

export const LinkBody = z.object({ thread_id: z.string(), reason: z.string().optional() });

export const RecordSentBody = z
  .object({
    data_source: z.string(),
    /** 宛先のアドレス（チャネルはデータソースのもの） */
    to: z.array(z.string()).default([]),
    to_contact_ids: z.array(z.string()).default([]),
    /** 送ったアドレス（Jira・Slack の自分のアカウントなど）。省けばデータソースの窓口、窓口がなければ自分の Contact のアドレス */
    from: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().min(1),
    sent_ref: z.string().min(1),
    anchors: z
      .object({
        in_reply_to: z.string().optional(),
        thread_ts: z.string().optional(),
        quoted_message_id: z.string().optional(),
        thread_key: z.string().optional(),
        jira_keys: z.array(z.string()).optional(),
        pr_refs: z.array(z.string()).optional(),
      })
      .default({}),
    reply_to_thread_id: z.string().optional(),
    source_thread_id: z.string().optional(),
    reply_expected_by: Instant.optional(),
  })
  .refine((b) => b.to.length + b.to_contact_ids.length > 0, { message: 'to か to_contact_ids のどちらかが要る' });

export const SetAttributeBody = z.object({ name: z.string(), value: z.unknown() });

// ---- User と Contact（0030 の 6〜9） ----

export const RenameBody = z.object({ name: z.string().min(1) });

/** 個人のリスト。スタンドはゲートウェイで目的のサービスがつながっているかを確かめてから作る */
export const CreateDataSourceBody = z.object({
  channel: Channel.exclude(['note']),
  name: z.string().min(1),
  description: z.string().optional(),
  /** そのリストでの自分のアイデンティティ（つないだアカウントのアドレス） */
  identity: z.string().min(1),
  /** ゲートウェイの自分の接続の識別子 */
  gateway_credential_id: z.string().min(1),
  group: z.boolean().optional(),
});

export const IdentityBody = z.object({ identity: z.string().min(1) });

export const ContactsQuery = z.object({ q: z.string().optional() });

export const CreateContactBody = z.object({ name: z.string().min(1), address: AddressRef.optional() });

export const AddAddressBody = z.object({
  channel: Channel,
  value: z.string().min(1),
  valid_from: Instant.optional(),
  reason: z.string().optional(),
});

export const EndAddressBody = z.object({ valid_to: Instant.optional(), reason: z.string().optional() }).default({});

export const MergeContactBody = z.object({ from: z.string().min(1), reason: z.string().optional() });

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

/** 状態の写し（ダミーの Jira など）。holders はそのチャネルのアカウント（0031 の 6） */
export const InboundMirrorBody = z.object({
  kind: z.literal('mirror'),
  dataSourceId: z.string(),
  channel: Channel,
  threadKey: z.string(),
  fields: MirrorFields,
  sourceRef: z.string(),
});

/** Webhook・ダミー上流に積む 1 件（シグナルか状態の写し） */
export const InboundItemBody = z.union([InboundMirrorBody, InboundSignalBody]);

/** POST /api/connections/outlook。credential_id はゲートウェイの Graph の接続（複数あるときに選ぶ） */
export const ConnectOutlookBody = z.object({ credential_id: z.string().min(1).optional() });

/** Jira をつなぐ（0034）。site はサイトの cloudId（choose_site で返したもの）、jql は範囲（省けば担当・起票・ウォッチ） */
/** Jira のプロジェクトを共有リストとしてつなぐ（0037）。project を省くと一覧（choose_project）を返す */
export const ConnectJiraBody = z.object({
  credential_id: z.string().min(1).optional(),
  site: z.string().min(1).optional(),
  project: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
});
