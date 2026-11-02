import { builtinNames, listPlugins, MAX_PLUGIN_BYTES, readManifest, type Plugin } from "../plugins";
import { registryFor } from "../registry";
import { admin, audit } from "./admin";
import { masthead } from "./connections";
import { html, type Html } from "./html";
import { page } from "./layout";
import { redirect, sameOrigin, type Session } from "./session";

// Admins add plugins beyond the built-in ones (a company's own skills, say) for the
// "Claude につなぐ" page to hand out. Uploading the same name again replaces it.

const uploadedOn = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });

function row(plugin: Plugin): Html {
  const sub =
    plugin.source === "builtin"
      ? "ゲートウェイの版に入っているもの。デプロイのたびに更新されます"
      : `${uploadedOn.format(plugin.uploaded!.at)}に追加 · ${Math.ceil(plugin.uploaded!.size / 1024)} KB`;
  return html`<li>
<div class="row-main"><p class="row-title">${plugin.name} <span class="version">${plugin.version}</span></p><p class="row-sub">${sub}</p></div>
<div class="row-actions"><span class="badge">${plugin.source === "builtin" ? "組み込み" : "管理画面"}</span>${plugin.source === "uploaded" && html`<a class="button quiet" href="/admin/plugins/${plugin.name}/delete">削除</a>`}</div>
</li>`;
}

async function listing(env: Env, user: Session, message?: Html | false, error?: string, status = 200): Promise<Response> {
  const plugins = await listPlugins(env);
  return page(
    "プラグインの配布",
    html`${masthead(env, user)}
${message}
<h1>プラグインの配布</h1>
<p>ここにあるプラグインは、全員の「<a href="/setup">Claude につなぐ</a>」から zip でダウンロードできます。組み込みのものはデプロイに入っています。ほかのプラグイン(自社のサービスのスキルなど)は、zip をここに追加します。</p>
<ul class="list">${plugins.map(row)}</ul>
<h2>プラグインを追加する</h2>
${error && html`<p class="error" role="alert">${error}</p>`}
<form method="post" action="/admin/plugins" enctype="multipart/form-data" class="card">
<label>プラグインの zip(<code>.claude-plugin/plugin.json</code> を含むもの。2 MB まで)<input type="file" name="zip" accept=".zip,application/zip" required></label>
<p class="hint">名前と版は zip の中の plugin.json から読みます。同じ名前のプラグインがあれば置き換えます。組み込みと同じ名前は使えません。</p>
<div class="actions"><button>追加する</button></div>
</form>`,
    undefined,
    status,
  );
}

export async function listPluginsPage(request: Request, env: Env): Promise<Response> {
  const user = await admin(request, env);
  if (user instanceof Response) return user;
  const url = new URL(request.url);
  const done = url.searchParams.get("saved") ?? url.searchParams.get("deleted");
  return listing(env, user, done !== null && html`<p class="notice" role="status">「${done}」を${url.searchParams.has("saved") ? "追加" : "削除"}しました。</p>`);
}

export async function uploadPlugin(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request, env)) return new Response("forbidden", { status: 403 });
  const user = await admin(request, env);
  if (user instanceof Response) return user;
  const file = (await request.formData()).get("zip");
  if (!(file instanceof File) || file.size === 0) return listing(env, user, false, "zip を選んでください。", 400);
  if (file.size > MAX_PLUGIN_BYTES) return listing(env, user, false, "zip が大きすぎます(2 MB まで)。", 400);
  const zip = await file.arrayBuffer();
  const manifest = await readManifest(new Uint8Array(zip));
  if (typeof manifest === "string") return listing(env, user, false, manifest, 400);
  if (builtinNames().has(manifest.name)) {
    return listing(env, user, false, `「${manifest.name}」は組み込みのプラグインと同じ名前です。`, 400);
  }
  await registryFor(env).putPlugin({ ...manifest, size: zip.byteLength, updatedBy: user.sub }, zip);
  audit(user, "upload_plugin", manifest.name, [manifest.version]);
  return redirect(`/admin/plugins?saved=${encodeURIComponent(manifest.name)}`);
}

export async function confirmDeletePlugin(request: Request, env: Env, name: string): Promise<Response> {
  const user = await admin(request, env);
  if (user instanceof Response) return user;
  const stored = await registryFor(env).getPlugin(name);
  if (!stored) return new Response("not found", { status: 404 });
  return page(
    "プラグインの削除",
    html`${masthead(env, user)}
<a class="back" href="/admin/plugins">‹ プラグインの配布に戻る</a>
<h1>「${name}」(${stored.meta.version})を削除しますか?</h1>
<form method="post" action="/admin/plugins/${name}/delete" class="card">
<p>「Claude につなぐ」からダウンロードできなくなります。すでに Claude に入れた人のプラグインはそのまま残ります。</p>
<div class="actions"><button class="danger">削除する</button><a class="button quiet" href="/admin/plugins">やめる</a></div>
</form>`,
  );
}

export async function deletePlugin(request: Request, env: Env, name: string): Promise<Response> {
  if (!sameOrigin(request, env)) return new Response("forbidden", { status: 403 });
  const user = await admin(request, env);
  if (user instanceof Response) return user;
  if (!(await registryFor(env).removePlugin(name))) return new Response("not found", { status: 404 });
  audit(user, "delete_plugin", name);
  return redirect(`/admin/plugins?deleted=${encodeURIComponent(name)}`);
}
