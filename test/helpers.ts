import { env } from "cloudflare:test";
import { getUpstream } from "../src/services";

export async function upstream(service: string) {
  const found = await getUpstream(env, service);
  if (!found) throw new Error(`unknown service: ${service}`);
  return found;
}
