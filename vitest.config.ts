import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { defineConfig } from "vitest/config";

const IDP = "https://idp.test";
const OIDC_ISSUER = `${IDP}/tenant/v2.0`;
const OIDC_CLIENT_ID = "test-client";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };

// A fake OpenID provider. The authorization code is base64url JSON of the
// claims the test wants in the ID token, so tests choose who signs in.
async function idp(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/tenant/v2.0/.well-known/openid-configuration") {
    return Response.json({
      issuer: OIDC_ISSUER,
      authorization_endpoint: `${IDP}/authorize`,
      token_endpoint: `${IDP}/token`,
      jwks_uri: `${IDP}/jwks`,
    });
  }
  if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
  if (url.pathname === "/token" && request.method === "POST") {
    const form = new URLSearchParams(await request.text());
    if (form.get("client_id") !== OIDC_CLIENT_ID || !form.get("code_verifier")) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const claims = JSON.parse(Buffer.from(form.get("code")!, "base64url").toString());
    const idToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(OIDC_ISSUER)
      .setAudience(OIDC_CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return Response.json({ access_token: "idp-access", token_type: "Bearer", id_token: idToken });
  }
  return new Response("not found", { status: 404 });
}

// Stands in for every upstream API: echoes the request it received.
async function upstream(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin === IDP) return idp(request);
  if (url.pathname === "/redirect") {
    return new Response(null, { status: 302, headers: { location: "https://download.example.com/file" } });
  }
  if (url.pathname === "/binary") {
    return new Response(await request.arrayBuffer(), {
      headers: { "content-type": "application/octet-stream", "set-cookie": "upstream=1" },
    });
  }
  return Response.json(
    {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
    },
    { headers: { "set-cookie": "upstream=1", "x-upstream": "yes" } },
  );
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.example.jsonc" },
      miniflare: {
        bindings: {
          SIGNING_KEY: "test-signing-key-test-signing-key-0123456789",
          ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          OIDC_CLIENT_SECRET: "test",
          OIDC_ISSUER,
          OIDC_CLIENT_ID,
          ALLOWED_TENANTS: "tenant-1",
        },
        outboundService: upstream,
      },
    }),
  ],
});
