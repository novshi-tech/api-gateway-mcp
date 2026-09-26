import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Stands in for every upstream API: echoes the request it received.
async function upstream(request: Request): Promise<Response> {
  const url = new URL(request.url);
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
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          SIGNING_KEY: "test-signing-key-test-signing-key-0123456789",
          ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          OIDC_CLIENT_SECRET: "test",
        },
        outboundService: upstream,
      },
    }),
  ],
});
