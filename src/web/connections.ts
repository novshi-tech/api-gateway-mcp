import { publicUrl, type Services } from "../config";
import { randomToken, s256 } from "../crypto";
import { getServices, getUpstream } from "../services";
import { signToken, verifyToken } from "../tokens";
import { exchangeCode, upstreamAuthorizationUrl, UpstreamOAuthError } from "../upstream-oauth";
import { vaultFor, type CredentialInfo } from "../vault";
import { html, type Html } from "./html";
import { page } from "./layout";
import { cookie, LOGIN_TTL_SECONDS, readCookie, redirect, sameOrigin, session } from "./session";

export const CONNECT_CALLBACK_PATH = "/connect/callback";
const CONNECT_COOKIE = "__Host-gw-connect";

// Key tag colors, assigned to services in configuration order.
const TAG_COLORS = ["#dcb34f", "#8fb6dd", "#94c9a4", "#e79a8f", "#c1aee0", "#e3c29a"];

function tagColors(services: Services): Map<string, string> {
  return new Map(Object.keys(services).map((name, i) => [name, TAG_COLORS[i % TAG_COLORS.length]]));
}

const addedOn = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });

function credentialTags(credentials: CredentialInfo[], services: Services): Html {
  if (credentials.length === 0) {
    return html`<p class="empty">つながっているサービスはまだありません。下の一覧から追加してください。</p>`;
  }
  const colors = tagColors(services);
  const tags = credentials.map((c) => {
    const serviceName = services[c.service]?.display_name ?? c.service;
    const reconnect =
      c.needsReconnect &&
      html`<form class="alert" method="post" action="/connect">接続が切れました。もう一度つなぐと使えるようになります。
<input type="hidden" name="service" value="${c.service}"><input type="hidden" name="credential" value="${c.id}">
<button>${serviceName} につなぎ直す</button></form>`;
    return html`<li class="tag${c.needsReconnect ? " broken" : ""}" style="--tag: ${colors.get(c.service) ?? TAG_COLORS[0]}">
<p class="service">${serviceName}</p>
<p class="label">${c.label}</p>
${reconnect}
<p class="meta">${addedOn.format(c.createdAt)}に追加</p>
<details><summary>削除する</summary>
<form method="post" action="/credentials/${c.id}/delete">
<p>Claude からこの接続を使えなくなります。</p>
<button class="danger">「${c.label}」を削除</button>
</form></details>
</li>`;
  });
  return html`<ul class="tags">${tags}</ul>`;
}

function serviceRows(services: Services): Html {
  const colors = tagColors(services);
  const rows = Object.entries(services).map(([name, config]) => {
    const displayName = config.display_name ?? name;
    const label = html`<input type="hidden" name="service" value="${name}">
<label>名前(複数のアカウントを見分けるため)<input type="text" name="label" placeholder="${displayName}"></label>`;
    const auth = config.auth;
    if (auth.type === "identity") {
      return html`<li><div class="service-row" style="--tag: ${colors.get(name)}">
<p class="fixed"><span class="swatch"></span><span class="name">${displayName}</span><span class="how">登録不要(サインイン中のあなたとして接続)</span></p>
</div></li>`;
    }
    const body =
      auth.type === "oauth2"
        ? html`<form method="post" action="/connect">
<p class="hint">${displayName} のサインイン画面に移ります。許可すると、ここに戻ってきます。</p>
${label}
<button>${displayName} にサインインしてつなぐ</button>
</form>`
        : html`<form method="post" action="/credentials">
<p class="hint">${displayName} の管理画面で発行した値を入力します。</p>
${label}
${auth.headers.map((h) => html`<label>${h.label}<input type="password" name="h:${h.name.toLowerCase()}" required autocomplete="off"></label>`)}
<button>保存してつなぐ</button>
</form>`;
    return html`<li><details class="service-row" style="--tag: ${colors.get(name)}">
<summary><span class="swatch"></span><span class="name">${displayName}</span><span class="how">${auth.type === "oauth2" ? "アカウントでサインイン" : "API キーを入力"}</span></summary>
<div class="body">${body}</div>
</details></li>`;
  });
  return html`<ul class="services">${rows}</ul>`;
}

export async function home(request: Request, env: Env): Promise<Response> {
  const user = await session(request, env);
  if (!user) return redirect("/login");
  const services = await getServices(env);
  const credentials = await vaultFor(env, user.sub).list();
  return page(
    "API ゲートウェイ",
    html`<header class="masthead"><h1>API ゲートウェイ</h1>
<div class="who"><span>${user.name}</span><form method="post" action="/logout"><button class="quiet">サインアウト</button></form></div></header>
<p>Claude が仕事で使うサービスの接続を、ここで管理します。パスワードやキーは暗号化して保管され、Claude には渡りません。</p>
<h2>つながっているサービス</h2>
${credentialTags(credentials, services)}
<h2>サービスを追加する</h2>
${serviceRows(services)}`,
  );
}

export async function addCredential(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request, env)) return new Response("forbidden", { status: 403 });
  const user = await session(request, env);
  if (!user) return redirect("/login");
  const form = await request.formData();
  const secrets: Record<string, string> = {};
  for (const [key, value] of form) {
    if (key.startsWith("h:") && typeof value === "string") secrets[key.slice(2)] = value;
  }
  const service = String(form.get("service") ?? "");
  const upstream = await getUpstream(env, service);
  if (!upstream) return errorPage("保存できませんでした", `unknown service: ${service}`, 400);
  const result = await vaultFor(env, user.sub).add(upstream, String(form.get("label") ?? ""), secrets);
  if ("error" in result) {
    return errorPage("保存できませんでした", result.error, 400);
  }
  return redirect("/");
}

export async function deleteCredential(request: Request, env: Env, id: string): Promise<Response> {
  if (!sameOrigin(request, env)) return new Response("forbidden", { status: 403 });
  const user = await session(request, env);
  if (!user) return redirect("/login");
  await vaultFor(env, user.sub).remove(id);
  return redirect("/");
}

function errorPage(title: string, message: string, status: number): Response {
  return page(title, html`<div class="card"><h1>${title}</h1><p>${message}</p><p><a href="/">接続の一覧に戻る</a></p></div>`, undefined, status);
}

type PendingConnect = {
  verifier: string;
  user: string;
  service: string;
  label: string;
  credential?: string;
};

export async function connectStart(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request, env)) return new Response("forbidden", { status: 403 });
  const user = await session(request, env);
  if (!user) return redirect("/login");
  const form = await request.formData();
  const service = String(form.get("service") ?? "");
  const upstream = await getUpstream(env, service);
  const auth = upstream?.config.auth;
  if (!upstream || auth?.type !== "oauth2") return errorPage("つなげませんでした", `このサービスはサインインでつなぐ方式ではありません: ${service}`, 400);
  const { config, client } = upstream;
  if (!client) return errorPage("つなげませんでした", `${config.display_name} につなぐための設定がまだありません。管理者に連絡してください。`, 500);
  const credential = String(form.get("credential") ?? "") || undefined;
  if (credential && (await vaultFor(env, user.sub).get(credential))?.service !== service) {
    return errorPage("つなげませんでした", "つなぎ直そうとした接続が見つかりません。一覧から新しく追加してください。", 400);
  }

  const state = randomToken();
  const verifier = randomToken();
  const pending: PendingConnect = { verifier, user: user.sub, service, label: String(form.get("label") ?? ""), credential };
  const { token } = await signToken(env.SIGNING_KEY, publicUrl(env), "connect", state, { ...pending }, LOGIN_TTL_SECONDS);
  const location = upstreamAuthorizationUrl(auth, client, {
    redirectUri: `${publicUrl(env)}${CONNECT_CALLBACK_PATH}`,
    state,
    codeChallenge: await s256(verifier),
  });
  return redirect(location, new Headers({ "set-cookie": cookie(CONNECT_COOKIE, token, LOGIN_TTL_SECONDS) }));
}

export async function connectCallback(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const user = await session(request, env);
  const stored = readCookie(request, CONNECT_COOKIE);
  const pending = stored
    ? await verifyToken<PendingConnect>(env.SIGNING_KEY, publicUrl(env), "connect", stored)
    : null;
  if (!user || !pending || pending.sub !== params.get("state") || pending.user !== user.sub) {
    return errorPage("つなげませんでした", "時間がたちすぎたか、別のタブで操作した可能性があります。一覧からもう一度つないでください。", 400);
  }
  const code = params.get("code");
  const upstream = await getUpstream(env, pending.service);
  const config = upstream?.config;
  const displayName = config?.display_name ?? pending.service;
  if (!code) return errorPage("つなげませんでした", `${displayName} で許可されませんでした。つなぐ場合は、もう一度やり直して許可してください。`, 400);
  const client = upstream?.client;
  if (!upstream || config?.auth.type !== "oauth2" || !client) return errorPage("つなげませんでした", `${displayName} の設定が変わりました。管理者に連絡してください。`, 500);

  try {
    const tokens = await exchangeCode(config.auth, client, {
      code,
      verifier: pending.verifier,
      redirectUri: `${publicUrl(env)}${CONNECT_CALLBACK_PATH}`,
    });
    const result = await vaultFor(env, user.sub).addOAuth(upstream, pending.label, tokens, pending.credential);
    if ("error" in result) return errorPage("つなげませんでした", result.error, 400);
  } catch (error) {
    if (!(error instanceof UpstreamOAuthError)) throw error;
    console.warn(JSON.stringify({ type: "connect_failed", service: pending.service, reason: error.message }));
    return errorPage("つなげませんでした", `${displayName} との接続を完了できませんでした。しばらくしてからやり直し、続くときは管理者に連絡してください。`, 502);
  }
  return redirect("/", new Headers({ "set-cookie": cookie(CONNECT_COOKIE, "", 0) }));
}
