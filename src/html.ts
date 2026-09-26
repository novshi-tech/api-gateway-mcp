export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function page(title: string, body: string, headers?: HeadersInit, status = 200): Response {
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .4rem; border-bottom: 1px solid #ddd; }
  fieldset { margin: 1rem 0; }
  label { display: block; margin: .4rem 0; }
  input[type=text], input[type=password] { width: 100%; box-sizing: border-box; }
  code { font-size: .9em; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  const h = new Headers(headers);
  h.set("content-type", "text/html; charset=utf-8");
  h.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'");
  h.set("x-frame-options", "DENY");
  h.set("cache-control", "no-store");
  return new Response(html, { status, headers: h });
}
