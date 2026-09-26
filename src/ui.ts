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
    return page("サインイン", `<h1>サインインできませんでした</h1><p><a href="/login">もう一度サインイン</a></p>`, undefined, 400);
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
      return page("サインイン", "<h1>このアカウントではサインインできません</h1>", undefined, 403);
    }
    throw error;
  }
}

export function logout(request: Request, env: Env): Response {
  if (!sameOrigin(request, env)) return new Response("forbidden", { status: 403 });
  // Stop here: going straight to /login would sign the user back in through the IdP's own session.
  return page(
    "サインアウト",
    `<h1>サインアウトしました</h1><p><a href="/login">もう一度サインイン</a></p>`,
    new Headers({ "set-cookie": cookie(SESSION_COOKIE, "", 0) }),
  );
}

function credentialRows(credentials: CredentialInfo[]): string {
  if (credentials.length === 0) return "<p>まだ登録されていません。</p>";
  const rows = credentials
    .map((c) => {
      const reconnect = c.needsReconnect
        ? `<form method="post" action="/connect"><input type="hidden" name="service" value="${escape(c.service)}">
<input type="hidden" name="credential" value="${escape(c.id)}"><strong>接続が切れています</strong> <button>再接続</button></form>`
        : "";
      return `<tr><td>${escape(c.service)}</td><td>${escape(c.label)}${reconnect}</td><td><code>${escape(c.id)}</code></td>
<td><form method="post" action="/credentials/${escape(c.id)}/delete"><button>削除</button></form></td></tr>`;
    })
    .join("");
  return `<table><tr><th>サービス</th><th>名前</th><th>ID</th><th></th></tr>${rows}</table>`;
}

function credentialForms(services: Services): string {
  return Object.entries(services)
    .map(([name, config]) => {
      const label = `<input type="hidden" name="service" value="${escape(name)}">
<label>名前(アカウントの区別用)<input type="text" name="label" placeholder="${escape(name)}"></label>`;
      if (config.auth.type === "oauth2") {
        return `<form method="post" action="/connect"><fieldset>
<legend>${escape(name)} を追加</legend>
${label}
<button>${escape(name)} に接続</button>
</fieldset></form>`;
      }
      return `<form method="post" action="/credentials"><fieldset>
<legend>${escape(name)} を追加</legend>
${label}
${config.auth.headers
  .map((h) => `<label>${escape(h.label)}<input type="password" name="h:${escape(h.name.toLowerCase())}" required autocomplete="off"></label>`)
  .join("\n")}
<button>登録</button>
</fieldset></form>`;
    })
    .join("\n");
}

function connectorSection(env: Env): string {
  const mcpUrl = `${publicUrl(env)}/mcp`;
  const params = `modal=add-custom-connector&connectorName=${encodeURIComponent("API Gateway")}&connectorUrl=${encodeURIComponent(mcpUrl)}`;
  return `<h2>Claude に接続する</h2>
<p>MCP の URL: <code>${escape(mcpUrl)}</code></p>
<ul>
<li><a href="https://claude.ai/customize/connectors?${params}" target="_blank" rel="noopener">個人のアカウントにコネクタを追加</a>(Pro / Max)</li>
<li><a href="https://claude.ai/admin-settings/connectors?${params}" target="_blank" rel="noopener">組織にコネクタを追加</a>(Team / Enterprise の Owner)</li>
</ul>
<p>スキルは、プラグイン <code>api-gateway</code> として配布しています。</p>`;
}

export async function home(request: Request, env: Env): Promise<Response> {
  const user = await session(request, env);
  if (!user) return redirect("/login");
  const credentials = await vaultFor(env, user.sub).list();
  return page(
    "API ゲートウェイ",
    `<h1>API ゲートウェイ</h1>
<p>${escape(user.name)} としてサインイン中 <form method="post" action="/logout" style="display:inline"><button>サインアウト</button></form></p>
${connectorSection(env)}
<h2>登録済みの認証情報</h2>
${credentialRows(credentials)}
<h2>認証情報を追加</h2>
${credentialForms(parseServices(env.SERVICES))}`,
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
    return page("エラー", `<h1>登録できませんでした</h1><p>${escape(result.error)}</p><p><a href="/">戻る</a></p>`, undefined, 400);
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
  return page("エラー", `<h1>${escape(title)}</h1><p>${escape(message)}</p><p><a href="/">戻る</a></p>`, undefined, status);
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
  if (config?.auth.type !== "oauth2") return errorPage("接続できませんでした", `OAuth の連携先ではありません: ${service}`, 400);
  const client = oauthClient(env, service);
  if (!client) return errorPage("接続できませんでした", `${service} の OAuth クライアントが設定されていません。`, 500);
  const credential = String(form.get("credential") ?? "") || undefined;
  if (credential && (await vaultFor(env, user.sub).get(credential))?.service !== service) {
    return errorPage("接続できませんでした", "認証情報が見つかりません。", 400);
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
    return errorPage("接続できませんでした", "画面からもう一度接続してください。", 400);
  }
  const code = params.get("code");
  if (!code) return errorPage("接続できませんでした", `${pending.service} での許可が得られませんでした。`, 400);
  const config = parseServices(env.SERVICES)[pending.service];
  const client = oauthClient(env, pending.service);
  if (config?.auth.type !== "oauth2" || !client) return errorPage("接続できませんでした", "連携先の設定が変わりました。", 500);

  try {
    const tokens = await exchangeCode(config.auth, client, {
      code,
      verifier: pending.verifier,
      redirectUri: `${publicUrl(env)}${CONNECT_CALLBACK_PATH}`,
    });
    const result = await vaultFor(env, user.sub).addOAuth(pending.service, pending.label, tokens, pending.credential);
    if ("error" in result) return errorPage("接続できませんでした", result.error, 400);
  } catch (error) {
    if (!(error instanceof UpstreamOAuthError)) throw error;
    console.warn(JSON.stringify({ type: "connect_failed", service: pending.service, reason: error.message }));
    return errorPage("接続できませんでした", `${pending.service} からトークンを受け取れませんでした。`, 502);
  }
  return redirect("/", new Headers({ "set-cookie": cookie(CONNECT_COOKIE, "", 0) }));
}
