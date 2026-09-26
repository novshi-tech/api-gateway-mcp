import { AuthorizationError, CimdFetchError, type AuthRequest, type ClientInfo, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { publicUrl } from "./config";
import { randomToken, s256 } from "./crypto";
import { escape, page } from "./html";
import { authorizationUrl, SignInError, signIn } from "./idp";
import type { McpProps } from "./mcp";

export const MCP_SCOPE = "gateway";
export const MCP_CALLBACK_PATH = "/oauth/callback";

type EnvWithOAuth = Env & { OAUTH_PROVIDER: OAuthHelpers };

interface UpstreamData {
  verifier: string;
  nonce: string;
}

function consentPage(client: ClientInfo, request: AuthRequest, handle: string, headers: Headers): Response {
  const name = escape(client.clientName ?? client.clientId);
  const redirectHost = new URL(request.redirectUri).hostname;
  const local = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/.test(redirectHost);
  const origin = client.clientId.startsWith("https://")
    ? `発行元: <strong>${escape(new URL(client.clientId).hostname)}</strong>`
    : "このアプリは自己登録されたもので、名前は検証されていません。";
  return page(
    `${client.clientName ?? "アプリ"} の接続`,
    `<div class="card">
<h1>${name} に API ゲートウェイへのアクセスを許可しますか?</h1>
<p>${origin}</p>
<p>アクセス権は <strong>${escape(redirectHost)}</strong> に送られます。</p>
${local ? "<p><strong>このコンピューター上のアプリにアクセス権を渡します。</strong>自分でサインインを始めた場合だけ続けてください。</p>" : ""}
<p>許可すると、このアプリはあなたがつないだサービスの API を呼び出せるようになります。</p>
<form method="post" class="actions">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <button name="decision" value="approve">許可して会社のアカウントでサインイン</button>
  <button name="decision" value="deny" class="quiet">許可しない</button>
</form>
</div>`,
    headers,
  );
}

function renderError(message: string, status = 400): Response {
  return page("エラー", `<div class="card"><h1>続けられませんでした</h1><p>${escape(message)}</p></div>`, undefined, status);
}

function redirectToClient(redirectUri: string, params: Record<string, string | undefined>, headers = new Headers()): Response {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  headers.set("location", url.href);
  return new Response(null, { status: 302, headers });
}

async function handle(request: Request, env: EnvWithOAuth, run: (oauth: OAuthHelpers) => Promise<Response>): Promise<Response> {
  try {
    return await run(env.OAUTH_PROVIDER);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectUri) {
      return redirectToClient(error.redirectUri, {
        error: error.code,
        error_description: error.description,
        state: error.state,
        iss: error.issuer,
      });
    }
    if (error instanceof AuthorizationError) return renderError(error.description);
    if (error instanceof CimdFetchError) return renderError("このアプリを検証できませんでした。");
    throw error;
  }
}

export function authorizeGet(request: Request, env: EnvWithOAuth): Promise<Response> {
  return handle(request, env, async (oauth) => {
    const authRequest = await oauth.parseAuthRequest(request);
    const client = await oauth.lookupClient(authRequest.clientId);
    if (!client) return renderError("不明なクライアントです。");
    const consent = await oauth.beginConsent(authRequest);
    return consentPage(client, authRequest, consent.handle, consent.headers);
  });
}

export function authorizePost(request: Request, env: EnvWithOAuth): Promise<Response> {
  return handle(request, env, async (oauth) => {
    const form = await request.formData();
    const handleValue = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handleValue);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(request, handleValue, { scope: [MCP_SCOPE] });
    const data: UpstreamData = { verifier: randomToken(), nonce: randomToken() };
    const { state, headers } = await oauth.beginUpstream(approved.request, { data, headers: approved.headers });
    headers.set(
      "location",
      await authorizationUrl(env, {
        redirectUri: `${publicUrl(env)}${MCP_CALLBACK_PATH}`,
        state,
        codeChallenge: await s256(data.verifier),
        nonce: data.nonce,
      }),
    );
    return new Response(null, { status: 302, headers });
  });
}

export function authorizeCallback(request: Request, env: EnvWithOAuth): Promise<Response> {
  return handle(request, env, async (oauth) => {
    const { request: original, data, headers } = await oauth.finishUpstream<UpstreamData>(request);
    const params = new URL(request.url).searchParams;
    const code = params.get("code");
    const deny = () =>
      redirectToClient(original.redirectUri, { error: "access_denied", state: original.state, iss: original.issuer }, headers);
    if (params.get("error") || !code) return deny();

    let user;
    try {
      user = await signIn(env, {
        code,
        verifier: data.verifier,
        nonce: data.nonce,
        redirectUri: `${publicUrl(env)}${MCP_CALLBACK_PATH}`,
      });
    } catch (error) {
      if (error instanceof SignInError) {
        console.warn(JSON.stringify({ type: "signin_rejected", reason: error.message }));
        return deny();
      }
      throw error;
    }

    const props: McpProps = { userId: user.id, name: user.name };
    const { redirectTo } = await oauth.completeAuthorization({
      request: original,
      userId: user.id,
      metadata: { name: user.name },
      scope: original.scope,
      props,
    });
    headers.set("location", redirectTo);
    return new Response(null, { status: 302, headers });
  });
}
