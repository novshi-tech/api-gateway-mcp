import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { organizationName, publicUrl } from "./config";
import { IDENTITY_CREDENTIAL, identityCredentialId, serviceOfIdentityCredential } from "./identity";
import { getDirectory, getServices } from "./services";
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

const IDP_NAMES: Record<string, string> = { entra: "Microsoft Entra ID", google: "Google Workspace" };

// One deployment serves one organization, and gateways of several organizations may be
// connected side by side with the same tools (docs/adr/0004). The server names its
// organization so that Claude can pick the right connector.
function instructions(organization: string, idp: string, base: string): string {
  return (
    `This connector is the API gateway of the organization "${organization}" (sign-in: ${idp}, ${base}). ` +
    `Its credentials and the data reached through it belong to "${organization}" only. ` +
    "Gateways of other organizations may be connected as other connectors with the same tools. " +
    "Use the connector of the organization the task is about; if that is unclear and more than one connector offers the service, ask the user. " +
    "Do not carry data read through one organization's gateway into another organization's (sending, filing, uploading) without the user's confirmation."
  );
}

export function buildServer(env: Env, props: McpProps): McpServer {
  const base = publicUrl(env);
  const organization = organizationName(env);
  const idp = IDP_NAMES[env.IDP_TYPE as string] ?? (env.IDP_TYPE as string);
  const gateway = { organization, idp, url: base };
  const server = new McpServer(
    { name: "api-gateway-mcp", title: `API Gateway (${organization})`, version: "0.0.0" },
    { instructions: instructions(organization, idp, base) },
  );
  const vault = vaultFor(env, props.userId);

  server.registerTool(
    "list_credentials",
    {
      title: "List credentials",
      description:
        `Lists the upstream services the API gateway of "${organization}" can reach and the credentials the current user has registered for them. ` +
        `Credentials are registered by the user at ${base}/. ` +
        `Services that trust the gateway's sign-in need no registration: they appear with the credential ID "${IDENTITY_CREDENTIAL}:<service>".`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const directory = await getDirectory(env);
      const config = directory.services;
      const identity = Object.entries(config)
        .filter(([, c]) => c.auth.type === "identity")
        .map(([service, c]) => ({ id: identityCredentialId(service), service, label: `${c.display_name}(サインイン中のユーザー)` }));
      const services = Object.keys(config).filter((name) => directory.available(name));
      return json({ gateway, services, credentials: [...(await vault.list()), ...identity], register_url: `${base}/` });
    },
  );

  server.registerTool(
    "issue_token",
    {
      title: "Issue gateway token",
      description:
        `Issues a short-lived (${GATEWAY_TOKEN_TTL_SECONDS / 60} min) token for calling upstream APIs through the REST endpoint of the API gateway of "${organization}". ` +
        "Pass at most one credential per service. Send requests to `<base_url>/<service>/<upstream path>` " +
        "with `Authorization: Bearer <token>`; the gateway replaces that header with the upstream credentials. " +
        "Request a new token when it expires. " +
        "Always set an explicit User-Agent header (for example `api-gateway-client`): Cloudflare rejects some default client user agents such as Python-urllib with error 1010.",
      inputSchema: {
        credential_ids: z.array(z.string()).min(1).describe("Credential IDs from list_credentials"),
      },
      // Issuing a token changes nothing upstream, so it is marked read-only: claude.ai
      // otherwise asks for approval every time a token is issued.
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ credential_ids }) => {
      const creds: Record<string, string> = {};
      const services = await getServices(env);
      for (const id of new Set(credential_ids)) {
        const identityService = serviceOfIdentityCredential(id);
        if (identityService !== null) {
          if (!Object.hasOwn(services, identityService) || services[identityService].auth.type !== "identity") return error(`unknown credential: ${id}`);
          if (creds[identityService]) return error(`more than one credential for service: ${identityService}`);
          creds[identityService] = IDENTITY_CREDENTIAL;
          continue;
        }
        const info = await vault.get(id);
        if (!info) return error(`unknown credential: ${id}`);
        if (info.needsReconnect) return error(`credential ${id} must be reconnected by the user at ${base}/`);
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
        gateway,
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
