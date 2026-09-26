import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { parseServices, publicUrl } from "./config";
import { GATEWAY_TOKEN_TTL_SECONDS, signToken } from "./tokens";
import { vaultFor } from "./vault";

export interface McpProps {
  userId: string;
  name: string;
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function error(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function buildServer(env: Env, props: McpProps): McpServer {
  const server = new McpServer({ name: "api-gateway-mcp", version: "0.0.0" });
  const base = publicUrl(env);
  const vault = vaultFor(env, props.userId);

  server.registerTool(
    "list_credentials",
    {
      title: "List credentials",
      description:
        "Lists the upstream services this gateway can reach and the credentials the current user has registered for them. " +
        `Credentials are registered by the user at ${base}/.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const services = Object.keys(parseServices(env.SERVICES));
      return json({ services, credentials: await vault.list(), register_url: `${base}/` });
    },
  );

  server.registerTool(
    "issue_token",
    {
      title: "Issue gateway token",
      description:
        `Issues a short-lived (${GATEWAY_TOKEN_TTL_SECONDS / 60} min) token for calling upstream APIs through the gateway's REST endpoint. ` +
        "Pass at most one credential per service. Send requests to `<base_url>/<service>/<upstream path>` " +
        "with `Authorization: Bearer <token>`; the gateway replaces that header with the upstream credentials. " +
        "Request a new token when it expires. " +
        "Always set an explicit User-Agent header (for example `api-gateway-client`): Cloudflare rejects some default client user agents such as Python-urllib with error 1010.",
      inputSchema: {
        credential_ids: z.array(z.string()).min(1).describe("Credential IDs from list_credentials"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ credential_ids }) => {
      const creds: Record<string, string> = {};
      for (const id of new Set(credential_ids)) {
        const info = await vault.get(id);
        if (!info) return error(`unknown credential: ${id}`);
        if (creds[info.service]) return error(`more than one credential for service: ${info.service}`);
        creds[info.service] = id;
      }
      const { token, expiresAt } = await signToken(
        env.SIGNING_KEY,
        base,
        "api",
        props.userId,
        { creds },
        GATEWAY_TOKEN_TTL_SECONDS,
      );
      return json({
        token,
        base_url: `${base}/api`,
        services: Object.fromEntries(Object.keys(creds).map((s) => [s, `${base}/api/${s}`])),
        expires_at: new Date(expiresAt * 1000).toISOString(),
      });
    },
  );

  return server;
}

export const mcpHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const props = (ctx as ExecutionContext & { props: McpProps }).props;
    const server = buildServer(env, props);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
