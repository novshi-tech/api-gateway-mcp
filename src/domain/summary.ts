import type { Projections } from './projections';
import type { List } from './entities';

// 境界越えの要約（別リスト・外部へ出す派生の本文）のプロンプト。呼び出しはシェル。

export const BOUNDARY_SUMMARY_SYSTEM_PROMPT = `あなたはタスク管理ツールの補助です。
あるリスト（チーム）のタスクの経緯から、別のリスト（または外部の相手）に渡す依頼文・連絡文を書きます。
渡し先が知る必要のない内部事情、個人情報、元のメッセージの引用は含めないでください。
必要なら渡し先の言語に翻訳してください。本文だけを出力します。`;

export function buildBoundarySummaryPrompt(
  p: Projections,
  taskId: string,
  target: Pick<List, 'name' | 'description'>,
  instruction: string,
): string {
  const task = p.tasks[taskId];
  const signals = Object.values(p.signals)
    .filter((s) => s.taskId === taskId)
    .sort((a, b) => a.seq - b.seq)
    .map((s) => ({ at: s.at, direction: s.direction, subject: s.subject ?? null, body: s.body }));
  return JSON.stringify(
    { task: { title: task?.title, attributes: task?.attributes ?? {} }, history: signals, target, instruction },
    null,
    2,
  );
}
