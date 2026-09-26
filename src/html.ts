export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// Key tags on a steel key cabinet: quiet slate chrome, one colored tag per service.
const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #e9edf0;
  --panel: #f8fafb;
  --line: #cfd6dc;
  --ink: #1d2833;
  --muted: #5a6875;
  --action: #24425e;
  --action-ink: #ffffff;
  --alert: #a8232b;
  --alert-bg: #f9e3e4;
  --focus: #2f7fd1;
  --hole: var(--bg);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161c22;
    --panel: #1f272f;
    --line: #34404b;
    --ink: #e4e9ee;
    --muted: #9aa8b5;
    --action: #9cc3e8;
    --action-ink: #0f1a24;
    --alert: #f08a8f;
    --alert-bg: #3a1f22;
    --focus: #7db7f0;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", Meiryo, system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.7;
}
main { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
h1 { font-size: 1.75rem; line-height: 1.3; margin: 0 0 1rem; font-weight: 700; letter-spacing: .01em; }
h2 { font-size: 1.125rem; line-height: 1.4; margin: 2.75rem 0 1rem; font-weight: 700; }
p { margin: 0 0 1rem; max-width: 36em; }
a { color: var(--action); text-underline-offset: .2em; }
code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .85em; }
button {
  font: inherit;
  font-size: .9375rem;
  font-weight: 600;
  padding: .5rem 1.1rem;
  border-radius: .4rem;
  border: 1px solid var(--action);
  background: var(--action);
  color: var(--action-ink);
  cursor: pointer;
}
button.quiet { background: transparent; color: var(--action); }
button.danger { background: var(--alert); border-color: var(--alert); color: #fff; }
button:hover { filter: brightness(1.1); }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
label { display: block; font-size: .875rem; color: var(--muted); margin: 0 0 .9rem; }
input[type=text], input[type=password] {
  display: block;
  width: 100%;
  margin-top: .3rem;
  font: inherit;
  color: var(--ink);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: .35rem;
  padding: .5rem .65rem;
}
form { margin: 0; }

.masthead { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .5rem 1rem; margin-bottom: 2rem; }
.masthead h1 { margin: 0; }
.who { display: flex; align-items: center; gap: .75rem; color: var(--muted); font-size: .875rem; }
.who button { padding: .3rem .8rem; font-size: .8125rem; }

.tags { list-style: none; margin: 0; padding: 0; display: grid; align-items: start; grid-template-columns: repeat(auto-fill, minmax(13.5rem, 1fr)); gap: 1.25rem 1rem; }
.tag {
  position: relative;
  padding: 1rem 1rem 1rem 3rem;
  background: var(--tag, #d9b453);
  color: #1d2833;
  border-radius: 1.6rem .45rem .45rem 1.6rem;
  -webkit-mask: radial-gradient(circle at 1.5rem 1.6rem, transparent .42rem, #000 .47rem);
  mask: radial-gradient(circle at 1.5rem 1.6rem, transparent .42rem, #000 .47rem);
}
.tag::before {
  content: "";
  position: absolute;
  left: .95rem; top: 1.05rem;
  width: 1.1rem; height: 1.1rem;
  border-radius: 50%;
  border: 2px solid rgba(29, 40, 51, .35);
}
.tag .service { font-size: 1.0625rem; font-weight: 700; line-height: 1.35; margin: 0; }
.tag .label { margin: .1rem 0 .6rem; font-size: .9375rem; }
.tag .meta { margin: 0; font-size: .75rem; opacity: .75; word-break: break-all; }
.tag details { margin-top: .6rem; font-size: .8125rem; }
.tag summary { cursor: pointer; width: max-content; text-decoration: underline; text-underline-offset: .2em; }
.tag details[open] summary { margin-bottom: .4rem; }
.tag details p { margin: 0 0 .5rem; }
.tag details button { font-size: .8125rem; padding: .3rem .8rem; }
.tag.broken { background: repeating-linear-gradient(135deg, var(--tag, #d9b453) 0 .7rem, #d4d9de .7rem 1.4rem); }
.tag .alert { margin: 0 0 .6rem; padding: .45rem .6rem; border-radius: .3rem; background: rgba(255, 255, 255, .7); color: #8f1d24; font-size: .8125rem; font-weight: 600; }
.tag .alert button { margin-top: .35rem; display: block; background: #8f1d24; border-color: #8f1d24; color: #fff; font-size: .8125rem; padding: .3rem .8rem; }
.empty { padding: 1.25rem; border: 2px dashed var(--line); border-radius: .6rem; color: var(--muted); }

.services { border-top: 1px solid var(--line); }
.services > li { list-style: none; border-bottom: 1px solid var(--line); }
.services { margin: 0; padding: 0; }
.service-row summary { display: flex; align-items: center; gap: .75rem; padding: .9rem .25rem; cursor: pointer; list-style: none; }
.service-row summary::-webkit-details-marker { display: none; }
.swatch { flex: none; width: .85rem; height: .85rem; border-radius: 50%; background: var(--tag); }
.service-row .name { font-weight: 700; }
.service-row .how { color: var(--muted); font-size: .875rem; margin-left: auto; text-align: right; }
.service-row[open] summary { padding-bottom: .5rem; }
.service-row .body { padding: .25rem .25rem 1.25rem 1.6rem; }
.hint { color: var(--muted); font-size: .875rem; }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: .6rem; padding: 1.5rem; }
.actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1.25rem; }

@media (max-width: 30rem) {
  main { padding-top: 1.5rem; }
  .service-row .how { display: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .service-row[open] .body { animation: open .18s ease-out; }
  @keyframes open { from { opacity: 0; transform: translateY(-.25rem); } }
}
`;

export function page(title: string, body: string, headers?: HeadersInit, status = 200): Response {
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
  const h = new Headers(headers);
  h.set("content-type", "text/html; charset=utf-8");
  h.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'");
  h.set("x-frame-options", "DENY");
  h.set("cache-control", "no-store");
  return new Response(html, { status, headers: h });
}
