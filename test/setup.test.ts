import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { publicUrl } from "../src/config";
import { readManifest } from "../src/plugins";
import { signToken } from "../src/tokens";

const BASE = publicUrl(env);
const ORIGIN = new URL(BASE).origin;
const ADMIN = "admin-user";

async function cookie(userId: string) {
  const { token } = await signToken(env.SIGNING_KEY, BASE, "session", userId, { name: userId }, 60);
  return `__Host-gw-session=${token}`;
}

async function get(path: string, userId: string | null = "user-1") {
  const headers = userId ? { cookie: await cookie(userId) } : undefined;
  return SELF.fetch(`${BASE}${path}`, { headers, redirect: "manual" });
}

async function upload(zip: Uint8Array, userId = ADMIN, origin = ORIGIN) {
  const form = new FormData();
  form.set("zip", new File([zip], "plugin.zip", { type: "application/zip" }));
  return SELF.fetch(`${BASE}/admin/plugins`, { method: "POST", headers: { cookie: await cookie(userId), origin }, body: form, redirect: "manual" });
}

// A minimal zip (stored, or deflated with CompressionStream) of the given files.
async function makeZip(files: Record<string, string>, deflate = true): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = deflate
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer())
      : raw;
    const n = enc.encode(name);
    const head = new Uint8Array(30 + n.length);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(8, deflate ? 8 : 0, true);
    hv.setUint32(18, data.length, true);
    hv.setUint32(22, raw.length, true);
    hv.setUint16(26, n.length, true);
    head.set(n, 30);
    const dir = new Uint8Array(46 + n.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, deflate ? 8 : 0, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, raw.length, true);
    dv.setUint16(28, n.length, true);
    dv.setUint32(42, offset, true);
    dir.set(n, 46);
    local.push(head, data);
    central.push(dir);
    offset += head.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const unique = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function pluginZip(name: string, version = "1.0.0", extra: Record<string, unknown> = {}) {
  return makeZip({
    [`${name}/.claude-plugin/plugin.json`]: JSON.stringify({ name, version, description: `${name} のスキル`, ...extra }),
    [`${name}/skills/x/SKILL.md`]: "---\nname: x\n---\n",
  });
}

describe("Claude につなぐ", () => {
  it("shows the connector URL, a name with the organization, and a Claude Code command", async () => {
    expect((await get("/setup", null)).headers.get("location")).toBe("/login");
    const page = await (await get("/setup")).text();
    expect(page).toContain(`value="${BASE}/mcp"`);
    expect(page).toContain(`value="Acme Gateway"`);
    expect(page).toContain(`claude mcp add --transport http gateway-${new URL(BASE).hostname.replace(/[^a-z0-9]+/g, "-")} ${BASE}/mcp`);
  });

  it("is linked from the home page, prominently until Claude is connected", async () => {
    const home = await (await get("/")).text();
    expect(home).toContain(`href="/setup"`);
    expect(home).toContain("はじめに、Claude にこのゲートウェイをつなぎます");
  });

  it("offers the built-in plugins as zips, with the Claude Code marketplace", async () => {
    const page = await (await get("/setup")).text();
    expect(page).toContain(`href="/plugins/api-gateway.zip"`);
    expect(page).toContain(`href="/plugins/api-gateway-google.zip"`);
    expect(page).toContain("/plugin marketplace add novshi-tech/api-gateway-mcp");
    expect(page).toContain("/plugin install api-gateway@api-gateway-mcp");

    const res = await get("/plugins/api-gateway.zip");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="api-gateway-\d+\.\d+\.\d+\.zip"$/);
    const manifest = await readManifest(new Uint8Array(await res.arrayBuffer()));
    expect(manifest).toMatchObject({ name: "api-gateway" });
  });

  it("hands zips only to signed-in users", async () => {
    expect((await get("/plugins/api-gateway.zip", null)).headers.get("location")).toBe("/login");
    expect((await get("/plugins/no-such.zip")).status).toBe(404);
  });
});

describe("plugins admins upload", () => {
  it("are listed for everyone and downloadable, and replaced by a new version", async () => {
    const name = unique("acme-skills");
    const res = await upload(await pluginZip(name));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/admin/plugins?saved=${name}`);

    const page = await (await get("/setup")).text();
    expect(page).toContain(`href="/plugins/${name}.zip"`);
    expect(page).toContain(`${name} のスキル`);
    const zip = await get(`/plugins/${name}.zip`);
    expect(zip.headers.get("content-disposition")).toBe(`attachment; filename="${name}-1.0.0.zip"`);
    expect(await readManifest(new Uint8Array(await zip.arrayBuffer()))).toMatchObject({ name, version: "1.0.0" });

    expect((await upload(await pluginZip(name, "1.1.0"))).status).toBe(303);
    expect((await get(`/plugins/${name}.zip`)).headers.get("content-disposition")).toBe(`attachment; filename="${name}-1.1.0.zip"`);
    expect(await (await get("/admin/plugins", ADMIN)).text()).toContain("1.1.0");
  });

  it("can be deleted", async () => {
    const name = unique("gone");
    await upload(await pluginZip(name));
    expect((await get(`/admin/plugins/${name}/delete`, ADMIN)).status).toBe(200);
    const res = await SELF.fetch(`${BASE}/admin/plugins/${name}/delete`, { method: "POST", headers: { cookie: await cookie(ADMIN), origin: ORIGIN }, redirect: "manual" });
    expect(res.headers.get("location")).toBe(`/admin/plugins?deleted=${name}`);
    expect((await get(`/plugins/${name}.zip`)).status).toBe(404);
  });

  it("refuses non-admins, cross-site posts, built-in names and zips that are not plugins", async () => {
    expect((await get("/admin/plugins", "someone")).status).toBe(404);
    expect((await upload(await pluginZip(unique("x")), "someone")).status).toBe(404);
    expect((await upload(await pluginZip(unique("x")), ADMIN, "https://evil.example")).status).toBe(403);
    expect(await (await upload(await pluginZip("api-gateway"))).text()).toContain("組み込みのプラグインと同じ名前");
    expect(await (await upload(await makeZip({ "README.md": "hi" }))).text()).toContain("plugin.json がありません");
    expect(await (await upload(new TextEncoder().encode("not a zip"))).text()).toContain("zip として読めませんでした");
    expect(await (await upload(await pluginZip("Bad_Name"))).text()).toContain("英小文字・数字・ハイフン");
  });

  it("reads plugin.json at the top of the zip, stored or deflated", async () => {
    const top = await makeZip({ ".claude-plugin/plugin.json": JSON.stringify({ name: "top", version: "0.1.0", dependencies: ["api-gateway"] }) }, false);
    expect(await readManifest(top)).toEqual({ name: "top", version: "0.1.0", description: "", dependencies: ["api-gateway"] });
  });
});
