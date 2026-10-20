import type { Directory, Projections, Thread } from '../domain';

// 確認用の読み取り専用タイムライン。renderTimeline は純関数（投影 → HTML 文字列）。

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function renderTimeline(dir: Directory, p: Projections): string {
  const dsName = (id: string) => dir.dataSource(id)?.name ?? id;
  const partyName = (id: string) => dir.party(id)?.name ?? id;
  const ball = (b: Thread['ball']) =>
    b.kind === 'us' ? 'こちら' : b.kind === 'party' ? `相手: ${b.partyIds.map((id) => esc(partyName(id))).join(', ') || '(不明)'}` : 'なし';

  const entry = (l: Thread['log'][number]) => {
    if (l.kind !== 'signal') {
      return `<li><time>${esc(l.at)}</time> <span class="k ${l.kind}">${l.kind === 'dismissed' ? '片付け' : '開き直し'}</span> ${esc(l.reason ?? '')}</li>`;
    }
    const s = p.signals[l.signalId!];
    const nr = s?.needsResponse === true ? ' · 求めている' : s?.needsResponse === false ? ' · 求めていない' : '';
    return `<li><time>${esc(l.at)}</time> <span class="k ${esc(s?.direction)}">${s?.direction === 'inbound' ? '受信' : '送信'}</span> ${esc(s?.from.value)}: ${esc(s?.subject ?? '')} — ${esc(s?.body.slice(0, 140))} <small>[${esc(s?.threadedBy)}${nr}]</small></li>`;
  };

  const threads = Object.values(p.threads).sort((a, b) =>
    a.dataSourceId !== b.dataSourceId ? (a.dataSourceId < b.dataSourceId ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
  const sections = threads
    .map(
      (t) => `<section class="thread${t.dismissed ? ' dismissed' : ''}">
  <h2>${esc(t.title)} <small>${esc(t.id)} · ${esc(dsName(t.dataSourceId))}${t.dismissed ? ` · 片付け済み（${esc(t.dismissReason)}）` : ''}</small></h2>
  <p class="comm">ボール: ${ball(t.ball)}${t.unansweredSince ? ` · 未応答 ${esc(t.unansweredSince)}〜` : ''}${t.activeSinceDismissed ? ' · <b>片付けたあとに動きあり</b>' : ''}</p>
  <ol>${t.log.map(entry).join('')}</ol>
</section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Murmur Timeline</title>
<style>
:root{--bg:#fff;--fg:#1b1b1b;--muted:#666;--line:#ddd;--accent:#2457c5}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#e8e8e8;--muted:#999;--line:#333;--accent:#7aa2ff}}
body{background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,sans-serif;margin:0 auto;max-width:960px;padding:16px}
h1{font-size:20px} h2{font-size:16px;margin:0} small,.comm,.attrs,time{color:var(--muted)}
section{border:1px solid var(--line);border-radius:8px;padding:12px;margin:12px 0}
section.dismissed{opacity:.6} ol{padding-left:18px} li{margin:4px 0;word-break:break-word}
.k{font-family:ui-monospace,monospace;font-size:12px;color:var(--accent)}
</style></head><body>
<h1>テナント ${esc(p.tenantId)} のタイムライン <small>seq ${p.lastSeq}</small></h1>
${sections || '<p>スレッドはまだない</p>'}
</body></html>`;
}
