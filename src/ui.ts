import { oauthClient, parseServices, publicUrl, type Services } from "./config";
import { randomToken, s256 } from "./crypto";
import { escape, page } from "./html";
import { authorizationUrl, SignInError, signIn } from "./idp";
import { signToken, verifyToken } from "./tokens";
import { exchangeCode, upstreamAuthorizationUrl, UpstreamOAuthError } from "./upstream-oauth";
import { vaultFor, type CredentialInfo } from "./vault";

export const LOGIN_CALLBACK_PATH = "/login/callback";
export const CONNECT_CALLBACK_PATH = "/connect/callback";
const SESSION_COOKIE = "__Host-gw-session";
const LOGIN_COOKIE = "__Host-gw-login";
const CONNECT_COOKIE = "__Host-gw-connect";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_TTL_SECONDS = 10 * 60;

interface Session {
  sub: string;
  name: string;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function redirect(location: string, headers = new Headers()): Response {
  headers.set("location", location);
  return new Response(null, { status: 303, headers });
}

async function session(request: Request, env: Env): Promise<Session | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const claims = await verifyToken<{ name?: string }>(env.SIGNING_KEY, publicUrl(env), "session", token);
  return claims ? { sub: claims.sub, name: claims.name ?? claims.sub } : null;
}

// Forms post only to this origin; a cross-site post has another Origin.
function sameOrigin(request: Request, env: Env): boolean {
  return request.headers.get("origin") === new URL(publicUrl(env)).origin;
}

export async function login(request: Request, env: Env): Promise<Response> {
  const state = randomToken();
  const verifier = randomToken();
  const nonce = randomToken();
  const { token } = await signToken(env.SIGNING_KEY, publicUrl(env), "login", state, { verifier, nonce }, LOGIN_TTL_SECONDS);
  const location = await authorizationUrl(env, {
    redirectUri: `${publicUrl(env)}${LOGIN_CALLBACK_PATH}`,
    state,
    codeChallenge: await s256(verifier),
    nonce,
  });
  return redirect(location, new Headers({ "set-cookie": cookie(LOGIN_COOKIE, token, LOGIN_TTL_SECONDS) }));
}

export async function loginCallback(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const stored = readCookie(request, LOGIN_COOKIE);
  const pending = stored
    ? await verifyToken<{ verifier: string; nonce: string }>(env.SIGNING_KEY, publicUrl(env), "login", stored)
    : null;
  const code = params.get("code");
  if (!pending || pending.sub !== params.get("state") || !code) {
    return page("サインイン", `<div class="card"><h1>サインインできませんでした</h1><p>時間がたちすぎたか、別のタブで操作した可能性があります。</p><p><a href="/login">もう一度サインインする</a></p></div>`, undefined, 400);
  }
  try {
    const user = await signIn(env, {
      code,
      verifier: pending.verifier,
      nonce: pending.nonce,
      redirectUri: `${publicUrl(env)}${LOGIN_CALLBACK_PATH}`,
    });
    const { token } = await signToken(env.SIGNING_KEY, publicUrl(env), "session", user.id, { name: user.name }, SESSION_TTL_SECONDS);
    const headers = new Headers();
    headers.append("set-cookie", cookie(SESSION_COOKIE, token, SESSION_TTL_SECONDS));
    headers.append("set-cookie", cookie(LOGIN_COOKIE, "", 0));
    return redirect("/", headers);
  } catch (error) {
    if (error instanceof SignInError) {
      console.warn(JSON.stringify({ type: "signin_rejected", reason: error.message }));
      return page("サインイン", `<div class="card"><h1>このアカウントではサインインできません</h1><p>会社のアカウントでサインインしてください。</p></div>`, undefined, 403);
    }
    throw error;
  }
}

export function logout(request: Request, env: Env): Response {
  if (!sameOrigin(request, env)) return new Response("forbidden", { status: 403 });
  // Stop here: going straight to /login would sign the user back in through the IdP's own session.
  return page(
    "サインアウト",
    `<div class="card"><h1>サインアウトしました</h1><p><a href="/login">もう一度サインインする</a></p></div>`,
    new Headers({ "set-cookie": cookie(SESSION_COOKIE, "", 0) }),
  );
}

// Key tag colors, assigned to services in configuration order.
const TAG_COLORS = ["#dcb34f", "#8fb6dd", "#94c9a4", "#e79a8f", "#c1aee0", "#e3c29a"];

function tagColors(services: Services): Map<string, string> {
  return new Map(Object.keys(services).map((name, i) => [name, TAG_COLORS[i % TAG_COLORS.length]]));
}

const addedOn = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });

function credentialTags(credentials: CredentialInfo[], services: Services): string {
  if (credentials.length === 0) {
    return `<p class="empty">つながっているサービスはまだありません。下の一覧から追加してください。</p>`;
  }
  const colors = tagColors(services);
  const tags = credentials.map((c) => {
    const serviceName = services[c.service]?.display_name ?? c.service;
    const reconnect = c.needsReconnect
      ? `<form class="alert" method="post" action="/connect">接続が切れました。もう一度つなぐと使えるようになります。
<input type="hidden" name="service" value="${escape(c.service)}"><input type="hidden" name="credential" value="${escape(c.id)}">
<button>${escape(serviceName)} につなぎ直す</button></form>`
      : "";
    return `<li class="tag${c.needsReconnect ? " broken" : ""}" style="--tag: ${colors.get(c.service) ?? TAG_COLORS[0]}">
<p class="service">${escape(serviceName)}</p>
<p class="label">${escape(c.label)}</p>
${reconnect}
<p class="meta">${addedOn.format(c.createdAt)}に追加</p>
<details><summary>削除する</summary>
<form method="post" action="/credentials/${escape(c.id)}/delete">
<p>Claude からこの接続を使えなくなります。</p>
<button class="danger">「${escape(c.label)}」を削除</button>
</form></details>
</li>`;
  });
  return `<ul class="tags">${tags.join("\n")}</ul>`;
}

function serviceRows(services: Services): string {
  const colors = tagColors(services);
  const rows = Object.entries(services).map(([name, config]) => {
    const displayName = config.display_name ?? name;
    const label = `<input type="hidden" name="service" value="${escape(name)}">
<label>名前(複数のアカウントを見分けるため)<input type="text" name="label" placeholder="${escape(displayName)}"></label>`;
    const auth = config.auth;
    const body = auth.type === "oauth2"
      ? `<form method="post" action="/connect">
<p class="hint">${escape(displayName)} のサインイン画面に移ります。許可すると、ここに戻ってきます。</p>
${label}
<button>${escape(displayName)} にサインインしてつなぐ</button>
</form>`
      : `<form method="post" action="/credentials">
<p class="hint">${escape(displayName)} の管理画面で発行した値を入力します。</p>
${label}
${auth.headers
  .map((h) => `<label>${escape(h.label)}<input type="password" name="h:${escape(h.name.toLowerCase())}" required autocomplete="off"></label>`)
  .join("\n")}
<button>保存してつなぐ</button>
</form>`;
    return `<li><details class="service-row" style="--tag: ${colors.get(name)}">
<summary><span class="swatch"></span><span class="name">${escape(displayName)}</span><span class="how">${auth.type === "oauth2" ? "アカウントでサインイン" : "API キーを入力"}</span></summary>
<div class="body">${body}</div>
</details></li>`;
  });
  return `<ul class="services">${rows.join("\n")}</ul>`;
}

export async function home(request: Request, env: Env): Promise<Response> {
  const user = await session(request, env);
  if (!user) return redirect("/login");
  const services = parseServices(env.SERVICES);
  const credentials = await vaultFor(env, user.sub).list();
  return page(
    "API ゲートウェイ",
    `<header class="masthead"><h1>API ゲートウェイ</h1>
<div class="who"><span>${escape(user.name)}</span><form method="post" action="/logout"><button class="quiet">サインアウト</button></form></div></header>
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
  const result = await vaultFor(env, user.sub).add(String(form.get("service") ?? ""), String(form.get("label") ?? ""), secrets);
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
  return page(title, `<div class="card"><h1>${escape(title)}</h1><p>${escape(message)}</p><p><a href="/">接続の一覧に戻る</a></p></div>`, undefined, status);
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
  const config = parseServices(env.SERVICES)[service];
  if (config?.auth.type !== "oauth2") return errorPage("つなげませんでした", `このサービスはサインインでつなぐ方式ではありません: ${service}`, 400);
  const client = oauthClient(env, service);
  if (!client) return errorPage("つなげませんでした", `${config.display_name} につなぐための設定がまだありません。管理者に連絡してください。`, 500);
  const credential = String(form.get("credential") ?? "") || undefined;
  if (credential && (await vaultFor(env, user.sub).get(credential))?.service !== service) {
    return errorPage("つなげませんでした", "つなぎ直そうとした接続が見つかりません。一覧から新しく追加してください。", 400);
  }

  const state = randomToken();
  const verifier = randomToken();
  const pending: PendingConnect = { verifier, user: user.sub, service, label: String(form.get("label") ?? ""), credential };
  const { token } = await signToken(env.SIGNING_KEY, publicUrl(env), "connect", state, { ...pending }, LOGIN_TTL_SECONDS);
  const location = upstreamAuthorizationUrl(config.auth, client, {
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
  const config = parseServices(env.SERVICES)[pending.service];
  const displayName = config?.display_name ?? pending.service;
  if (!code) return errorPage("つなげませんでした", `${displayName} で許可されませんでした。つなぐ場合は、もう一度やり直して許可してください。`, 400);
  const client = oauthClient(env, pending.service);
  if (config?.auth.type !== "oauth2" || !client) return errorPage("つなげませんでした", `${displayName} の設定が変わりました。管理者に連絡してください。`, 500);

  try {
    const tokens = await exchangeCode(config.auth, client, {
      code,
      verifier: pending.verifier,
      redirectUri: `${publicUrl(env)}${CONNECT_CALLBACK_PATH}`,
    });
    const result = await vaultFor(env, user.sub).addOAuth(pending.service, pending.label, tokens, pending.credential);
    if ("error" in result) return errorPage("つなげませんでした", result.error, 400);
  } catch (error) {
    if (!(error instanceof UpstreamOAuthError)) throw error;
    console.warn(JSON.stringify({ type: "connect_failed", service: pending.service, reason: error.message }));
    return errorPage("つなげませんでした", `${displayName} との接続を完了できませんでした。しばらくしてからやり直し、続くときは管理者に連絡してください。`, 502);
  }
  return redirect("/", new Headers({ "set-cookie": cookie(CONNECT_COOKIE, "", 0) }));
}
