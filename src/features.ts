// Features: apps that run inside this Worker (Murmur, docs/adr/0005) instead of behind a
// Service Binding. The gateway core knows only this interface; the Worker's entry registers
// the features, and nothing else imports their code. A feature is off unless the
// deployment configures it, and each user turns it on for themselves (consent).
//
// What a feature gets from the gateway is decided by the entry: the gateway never hands it
// credentials or keys, only functions (see feature-port.ts).

export interface Feature {
  // Also the pseudo service name: the stand calls `/api/<name>/...` with a gateway token
  // that covers `identity:<name>`, and public routes live under `/<name>/...`.
  name: string;
  displayName: string;
  // What turning the feature on lets it do, shown on the consent page.
  consentText: string;
  // Where the consent page sends the user back to, under `/<name>`.
  consentCallbackPath: string;
  // Requests under `/api/<name>` arrive as `/api/...`, public ones under `/<name>` with the prefix removed.
  fetch(request: Request, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, ctx: ExecutionContext): Promise<void>;
  queue?(batch: MessageBatch<unknown>, ctx: ExecutionContext): Promise<void>;
}

type Factory = (env: Env) => Feature[];

let factory: Factory = () => [];

// Called once by the Worker's entry.
export function registerFeatures(f: Factory): void {
  factory = f;
}

export function features(env: Env): Feature[] {
  return factory(env);
}

export function feature(env: Env, name: string): Feature | undefined {
  return features(env).find((f) => f.name === name);
}

// Rewrites the request's path, keeping method, headers and body.
export function withPath(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}
