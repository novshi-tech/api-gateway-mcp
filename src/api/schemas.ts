import { z } from 'zod';
import { AddressRef, FileRef } from '../domain';

// HTTP API（ゲートウェイの上流として公開する 11 本）の入力スキーマ。キーはツール定義に合わせて snake_case。

/** 時刻はオフセット付きで受けて UTC（Z）にそろえる。コアは ISO 文字列の大小で期限を比べるため */
const Instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString());

export const ListMyTasksQuery = z.object({
  filter: z.enum(['open', 'ball_at_me', 'overdue', 'all']).default('open'),
  tenant: z.string().optional(),
});

export const SetAttributeBody = z.object({ name: z.string().min(1), value: z.unknown() });

export const ProposeDerivationBody = z
  .object({
    task_id: z.string(),
    target_list: z.string(),
    title: z.string().optional(),
    body: z.string().optional(),
    /** body を省略したとき、Claude に要約・翻訳させる指示 */
    instruction: z.string().optional(),
    attachments: z.array(FileRef).default([]),
    to_parties: z.array(z.string()).default([]),
    reply_expected: z.object({ by: Instant }).nullable().optional(),
    reply_to: z.string().optional(),
  })
  .refine((b) => b.body !== undefined || b.instruction !== undefined, { message: 'body or instruction is required' });

export const ListProposalsQuery = z.object({ list_id: z.string().optional() });

export const ApproveBody = z.object({ from_address: AddressRef.optional() });
export const RejectBody = z.object({ reason: z.string().min(1) });
export const CloseBody = z.object({ reason: z.string().optional() }).default({});

export const CorrectIngestBody = z.object({
  decision: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('attach'), task_id: z.string() }),
    z.object({ kind: z.literal('new'), list_id: z.string(), title: z.string().min(1) }),
    z.object({ kind: z.literal('ignore') }),
  ]),
  reason: z.string().min(1),
});

export const ExplainIgnoreQuery = z.object({ since: z.string().optional() });

export const InboundSignalBody = z.object({
  channel: z.enum(['email', 'slack', 'line', 'jira', 'bitbucket', 'internal']),
  from: AddressRef,
  to: z.array(AddressRef).default([]),
  subject: z.string().optional(),
  body: z.string(),
  anchors: z
    .object({
      messageId: z.string().optional(),
      inReplyTo: z.string().optional(),
      threadTs: z.string().optional(),
      jiraKeys: z.array(z.string()).optional(),
      prRefs: z.array(z.string()).optional(),
    })
    .default({}),
  attachments: z.array(FileRef).default([]),
  sourceRef: z.string(),
  acquiredAs: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), userId: z.string() }),
    z.object({ kind: z.literal('organization'), tenantId: z.string() }),
  ]),
});
