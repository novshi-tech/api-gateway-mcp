import { registryFor, type PluginMeta } from "./registry";

// Claude plugins (skill bundles) the web UI hands out as zips: the built-in ones under
// plugins/, zipped into the Worker's static assets at deploy (tools/build-plugin-zip.py
// --assets), and the ones admins upload, kept in Registry. A built-in name wins.

export interface Plugin {
  name: string;
  version: string;
  description: string;
  dependencies: string[];
  source: "builtin" | "uploaded";
  // Claude Code marketplace of a built-in plugin: the repository and the marketplace's name.
  marketplace?: { repo: string; name: string };
  uploaded?: { at: number; by: string; size: number };
}

interface AssetIndex {
  marketplace: string;
  plugins: { name: string; version: string; description: string; dependencies: string[]; file: string; marketplace: string | null }[];
}

export const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]*$/;
// Durable Object storage takes values up to 2 MiB.
export const MAX_PLUGIN_BYTES = 2_000_000;

const ASSET_ORIGIN = "https://assets.invalid";

// A deployment whose config predates "assets" has no binding; it just offers no built-ins.
function assets(env: Env): Fetcher | undefined {
  return (env as { ASSETS?: Fetcher }).ASSETS;
}

async function assetIndex(env: Env): Promise<AssetIndex | null> {
  const binding = assets(env);
  if (!binding) return null;
  const res = await binding.fetch(`${ASSET_ORIGIN}/plugins/index.json`);
  if (!res.ok) return null;
  return res.json<AssetIndex>();
}

export async function listPlugins(env: Env): Promise<Plugin[]> {
  const [index, uploaded] = await Promise.all([assetIndex(env), registryFor(env).listPlugins()]);
  const builtin: Plugin[] = (index?.plugins ?? []).map((p) => ({
    name: p.name,
    version: p.version,
    description: p.description,
    dependencies: p.dependencies,
    source: "builtin",
    ...(p.marketplace ? { marketplace: { repo: p.marketplace, name: index!.marketplace } } : {}),
  }));
  const names = new Set(builtin.map((p) => p.name));
  const others: Plugin[] = uploaded
    .filter((m) => !names.has(m.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({
      name: m.name,
      version: m.version,
      description: m.description,
      dependencies: m.dependencies,
      source: "uploaded",
      uploaded: { at: m.updatedAt, by: m.updatedBy, size: m.size },
    }));
  return [...builtin, ...others];
}

export async function builtinNames(env: Env): Promise<Set<string>> {
  return new Set((await assetIndex(env))?.plugins.map((p) => p.name) ?? []);
}

export async function pluginZip(env: Env, name: string): Promise<{ version: string; body: ReadableStream | ArrayBuffer } | null> {
  const index = await assetIndex(env);
  const builtin = index?.plugins.find((p) => p.name === name);
  if (builtin) {
    const res = await assets(env)!.fetch(`${ASSET_ORIGIN}/plugins/${builtin.file}`);
    return res.ok && res.body ? { version: builtin.version, body: res.body } : null;
  }
  const stored = await registryFor(env).getPlugin(name);
  return stored ? { version: stored.meta.version, body: stored.zip } : null;
}

// What an uploaded zip says about itself, from its .claude-plugin/plugin.json
// (at the top, or under one directory as tools/build-plugin-zip.py lays it out).
export type PluginManifest = Pick<PluginMeta, "name" | "version" | "description" | "dependencies">;

export async function readManifest(zip: Uint8Array): Promise<PluginManifest | string> {
  let entries: ZipEntry[];
  try {
    entries = zipEntries(zip);
  } catch {
    return "zip として読めませんでした。";
  }
  const manifests = entries
    .filter((e) => /^(?:[^/]+\/)?\.claude-plugin\/plugin\.json$/.test(e.name))
    .sort((a, b) => a.name.length - b.name.length);
  if (manifests.length === 0) return "zip の中に .claude-plugin/plugin.json がありません。プラグインのディレクトリごと zip にしてください。";
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(await inflate(zip, manifests[0])));
  } catch {
    return ".claude-plugin/plugin.json を JSON として読めませんでした。";
  }
  const m = json as Record<string, unknown>;
  if (typeof m.name !== "string" || !PLUGIN_NAME.test(m.name)) return "plugin.json の name は英小文字・数字・ハイフンにしてください。";
  if (typeof m.version !== "string" || !m.version.trim() || m.version.length > 40) return "plugin.json に version を書いてください。";
  const dependencies = Array.isArray(m.dependencies) ? m.dependencies.filter((d): d is string => typeof d === "string") : [];
  return { name: m.name, version: m.version.trim(), description: typeof m.description === "string" ? m.description : "", dependencies };
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

// Reads the central directory: just enough of the zip format to find one small file.
function zipEntries(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no end of central directory");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad central directory");
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    entries.push({
      name: decoder.decode(zip.subarray(at + 46, at + 46 + nameLength)),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      localOffset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(zip: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const at = entry.localOffset;
  if (view.getUint32(at, true) !== 0x04034b50) throw new Error("bad local header");
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = zip.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new Error(`unsupported compression: ${entry.method}`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
