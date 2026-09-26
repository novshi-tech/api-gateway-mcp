import { parseServices, publicUrl } from "./config";
import { randomToken, s256 } from "./crypto";
import { escape, page } from "./html";
import { authorizationUrl, SignInError, signIn } from "./idp";
import { signToken, verifyToken } from "./tokens";
import { vaultFor, type CredentialInfo } from "./vault";

export const LOGIN_CALLBACK_PATH = "/login/callback";
const SESSION_COOKIE = "__Host-gw-session";
const LOGIN_COOKIE = "__Host-gw-login";
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
    .map(
      (c) => `<tr><td>${escape(c.service)}</td><td>${escape(c.label)}</td><td><code>${escape(c.id)}</code></td>
<td><form method="post" action="/credentials/${escape(c.id)}/delete"><button>削除</button></form></td></tr>`,
    )
    .join("");
  return `<table><tr><th>サービス</th><th>名前</th><th>ID</th><th></th></tr>${rows}</table>`;
}

export async function home(request: Request, env: Env): Promise<Response> {
  const user = await session(request, env);
  if (!user) return redirect("/login");
  const credentials = await vaultFor(env, user.sub).list();
  const forms = Object.entries(parseServices(env.SERVICES))
    .map(
      ([name, config]) => `<form method="post" action="/credentials"><fieldset>
<legend>${escape(name)} を追加</legend>
<input type="hidden" name="service" value="${escape(name)}">
<label>名前(アカウントの区別用)<input type="text" name="label" placeholder="${escape(name)}"></label>
${config.auth.headers
  .map((h) => `<label>${escape(h.label)}<input type="password" name="h:${escape(h.name.toLowerCase())}" required autocomplete="off"></label>`)
  .join("\n")}
<button>登録</button>
</fieldset></form>`,
    )
    .join("\n");
  return page(
    "API ゲートウェイ",
    `<h1>API ゲートウェイ</h1>
<p>${escape(user.name)} としてサインイン中 <form method="post" action="/logout" style="display:inline"><button>サインアウト</button></form></p>
<h2>登録済みの認証情報</h2>
${credentialRows(credentials)}
<h2>認証情報を追加</h2>
${forms}`,
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
