import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { authorizeCallback, authorizeGet, authorizePost, MCP_CALLBACK_PATH, MCP_SCOPE } from "./authorize";
import { publicUrl } from "./config";
import { mcpHandler } from "./mcp";
import { API_PREFIX, handleProxy } from "./proxy";
import {
  addCredential,
  CONNECT_CALLBACK_PATH,
  connectCallback,
  connectStart,
  deleteCredential,
  home,
  login,
  LOGIN_CALLBACK_PATH,
  loginCallback,
  logout,
} from "./ui";

export { UserVault } from "./vault";

const DAY = 24 * 60 * 60;

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const e = env as Env & { OAUTH_PROVIDER: OAuthHelpers };
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (pathname.startsWith(API_PREFIX)) return handleProxy(request, env);
    if (pathname === "/authorize" && method === "GET") return authorizeGet(request, e);
    if (pathname === "/authorize" && method === "POST") return authorizePost(request, e);
    if (pathname === MCP_CALLBACK_PATH && method === "GET") return authorizeCallback(request, e);
    if (pathname === "/" && method === "GET") return home(request, env);
    if (pathname === "/login" && method === "GET") return login(request, env);
    if (pathname === LOGIN_CALLBACK_PATH && method === "GET") return loginCallback(request, env);
    if (pathname === "/logout" && method === "POST") return logout(request, env);
    if (pathname === "/credentials" && method === "POST") return addCredential(request, env);
    if (pathname === "/connect" && method === "POST") return connectStart(request, env);
    if (pathname === CONNECT_CALLBACK_PATH && method === "GET") return connectCallback(request, env);
    const del = pathname.match(/^\/credentials\/([0-9a-f-]+)\/delete$/);
    if (del && method === "POST") return deleteCredential(request, env, del[1]);
    return new Response("not found", { status: 404 });
  },
};

// The provider's options depend on PUBLIC_URL, which is only known per request.
let cached: { url: string; provider: OAuthProvider<Env> } | undefined;

function provider(env: Env): OAuthProvider<Env> {
  const url = publicUrl(env);
  if (cached?.url !== url) {
    cached = {
      url,
      provider: new OAuthProvider<Env>({
        apiRoute: "/mcp",
        apiHandler: mcpHandler as never,
        defaultHandler,
        authorizeEndpoint: "/authorize",
        tokenEndpoint: "/oauth/token",
        clientRegistrationEndpoint: "/oauth/register",
        clientIdMetadataDocumentEnabled: true,
        scopesSupported: [MCP_SCOPE],
        accessTokenTTL: 60 * 60,
        refreshTokenIdleTTL: 30 * DAY,
        resourceMetadata: {
          resource: `${url}/mcp`,
          authorization_servers: [url],
          scopes_supported: [MCP_SCOPE],
          resource_name: "API Gateway MCP",
        },
      }),
    };
  }
  return cached.provider;
}

export default {
  fetch(request, env, ctx) {
    return provider(env).fetch(request, env, ctx);
  },
  async scheduled(_event, env) {
    await provider(env).purgeExpiredData(env);
  },
} satisfies ExportedHandler<Env>;
