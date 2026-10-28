#!/usr/bin/env node
// Runs wrangler against one deployment's config, deployments/<name>.jsonc.
//
//   npm run deploy -- <name> [wrangler deploy options]
//   npm run secret -- <name> put <KEY>        (also list, delete)
//   npm run tail -- <name> [--format json]
//   node tools/wrangler.mjs <wrangler command> <name> [options]
//
// There is no wrangler.jsonc at the root, so a bare `wrangler deploy` fails
// instead of picking a deployment by accident.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, "deployments");
const [command, name, ...rest] = process.argv.slice(2);
const names = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith(".jsonc"))
      .map((f) => f.slice(0, -".jsonc".length))
  : [];

if (!command || !name) {
  console.error(`usage: npm run ${command ?? "<deploy|secret|tail>"} -- <deployment> [options]`);
  console.error(names.length ? `deployments: ${names.join(", ")}` : "no deployments yet: create deployments/<name>.jsonc (see the deploy skill)");
  process.exit(2);
}
const config = join(dir, `${name}.jsonc`);
if (!existsSync(config)) {
  console.error(`no such deployment: ${relative(root, config)}`);
  if (names.length) console.error(`deployments: ${names.join(", ")}`);
  process.exit(2);
}

const result = spawnSync("npx", ["wrangler", command, ...rest, "--config", relative(root, config)], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
