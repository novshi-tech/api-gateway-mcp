import { z } from 'zod';

// Teams のチャネルのメッセージ（chatMessage）の部分スキーマ。取り込みに使う項目だけを読み、ほかは捨てる（0036）。

const Identity = z.object({ id: z.string(), displayName: z.string().nullable().optional(), tenantId: z.string().nullable().optional() });

const ItemBody = z.object({ contentType: z.string().optional(), content: z.string().nullable().optional() });

const Mention = z.object({
  id: z.number().optional(),
  mentionText: z.string().nullable().optional(),
  /** 個人（user）か、チャネル・チーム（conversation）か、タグ（tag）。個人だけを宛先にする */
  mentioned: z
    .object({ user: Identity.nullable().optional(), conversation: z.unknown().optional(), tag: z.unknown().optional() })
    .nullable()
    .optional(),
});

const Base = z.object({
  id: z.string(),
  replyToId: z.string().nullable().optional(),
  /** message のほかに、メンバーの出入りなどのシステムのメッセージがある */
  messageType: z.string().optional(),
  createdDateTime: z.string(),
  lastModifiedDateTime: z.string().nullable().optional(),
  deletedDateTime: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  body: ItemBody.nullable().optional(),
  /** user がなければアプリ（ボット・コネクタ）の投稿 */
  from: z.object({ user: Identity.nullable().optional() }).nullable().optional(),
  mentions: z.array(Mention).optional(),
});

export const ChannelMessage = Base.extend({ replies: z.array(Base).optional() });
export type ChannelMessage = z.infer<typeof ChannelMessage>;
export type ChannelReply = z.infer<typeof Base>;

export const MessagesPage = z.object({
  value: z.array(z.record(z.string(), z.unknown())),
  '@odata.nextLink': z.string().optional(),
});

export const ChannelMember = z.object({
  userId: z.string().nullable().optional(),
  tenantId: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  roles: z.array(z.string()).optional(),
});
export type ChannelMember = z.infer<typeof ChannelMember>;
