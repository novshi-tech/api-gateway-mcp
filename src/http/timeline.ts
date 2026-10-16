import { sortTimeline, type Directory, type Projections, type TimelineEntry } from '../domain';

// 確認用の読み取り専用タイムライン。renderTimeline は純関数（投影 → HTML 文字列）。

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function renderTimeline(dir: Directory, p: Projections): string {
  const listName = (id: string) => dir.list(id)?.name ?? id;
  const partyName = (id: string) => dir.party(id)?.name ?? id;
  const ball = (b: Projections['tasks'][string]['ballAt']) =>
    b.kind === 'list' ? `リスト「${esc(listName(b.listId))}」` : `相手: ${b.partyIds.map((id) => esc(partyName(id))).join(', ')}`;

  const entry = (e: TimelineEntry) => {
    const s = e.signalId ? p.signals[e.signalId] : undefined;
    const d = e.derivationId ? p.derivations[e.derivationId] : undefined;
    let text = '';
    switch (e.kind) {
      case 'inbound':
      case 'outbound':
        text = `${e.kind === 'inbound' ? '受信' : '送信'} [${esc(s?.channel)}] ${esc(s?.from.value)}: ${esc(s?.subject ?? '')} — ${esc(s?.body.slice(0, 140))}`;
        break;
      case 'derivation_out':
        text = `派生を出した → 「${esc(listName(d?.targetListId ?? ''))}」(${esc(d?.status)}) ${esc(d?.body.slice(0, 140))}`;
        break;
      case 'derivation_in':
        text = `派生を受けた ← 「${esc(listName(d?.sourceListId ?? ''))}」 ${esc(d?.body.slice(0, 140))}`;
        break;
      case 'derivation_replied':
        text = `派生 ${esc(e.derivationId)} に返事`;
        break;
      case 'reply_overdue':
        text = `派生 ${esc(e.derivationId)} の返事期限超過`;
        break;
      case 'attribute_set':
        text = `属性 ${esc(e.attribute?.name)} = ${esc(JSON.stringify(e.attribute?.value))}`;
        break;
      default:
        text = e.kind;
    }
    return `<li><time>${esc(e.at)}</time> <span class="k ${esc(e.kind)}">${esc(e.kind)}</span> ${text}</li>`;
  };

  const tasks = Object.values(p.tasks).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const sections = tasks
    .map((t) => {
      const entries = sortTimeline(p.timeline.filter((e) => e.taskId === t.id));
      return `<section class="task ${t.status}">
  <h2>${esc(t.title)} <small>${esc(t.id)} · ${esc(listName(t.listId))} · ${t.status}</small></h2>
  <p class="comm">ボール: ${ball(t.ballAt)}${t.replyExpectedBy ? ` · 返事期限 ${esc(t.replyExpectedBy)}` : ''}${t.overdue ? ' · <b>期限超過</b>' : ''}${t.unansweredSince ? ` · 未応答 ${esc(t.unansweredSince)}〜` : ''}</p>
  <p class="attrs">${Object.entries(t.attributes).map(([k, v]) => `${esc(k)}=${esc(JSON.stringify(v))}`).join(' · ')}</p>
  <ol>${entries.map(entry).join('')}</ol>
</section>`;
    })
    .join('\n');
  const ignores = p.ignoreLog
    .map((i) => `<li><time>${esc(i.at)}</time> ${esc(i.from.value)}: ${esc(i.subject ?? i.bodyExcerpt.slice(0, 80))} — ${esc(i.reason)} (${i.confidence})${i.overriddenAtSeq ? ' [訂正済み]' : ''}</li>`)
    .join('');

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Murmur Timeline</title>
<style>
:root{--bg:#fff;--fg:#1b1b1b;--muted:#666;--line:#ddd;--accent:#2457c5}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#e8e8e8;--muted:#999;--line:#333;--accent:#7aa2ff}}
body{background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,sans-serif;margin:0 auto;max-width:960px;padding:16px}
h1{font-size:20px} h2{font-size:16px;margin:0} small,.comm,.attrs,time{color:var(--muted)}
section{border:1px solid var(--line);border-radius:8px;padding:12px;margin:12px 0}
section.closed{opacity:.6} ol{padding-left:18px} li{margin:4px 0;word-break:break-word}
.k{font-family:ui-monospace,monospace;font-size:12px;color:var(--accent)}
</style></head><body>
<h1>テナント ${esc(p.tenantId)} のタイムライン <small>seq ${p.lastSeq}</small></h1>
${sections || '<p>タスクはまだない</p>'}
<h2>無視の監査ログ</h2><ol>${ignores || '<li>なし</li>'}</ol>
</body></html>`;
}
