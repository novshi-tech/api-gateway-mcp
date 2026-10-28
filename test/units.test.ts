import { describe, expect, it } from "vitest";
import { parseServices } from "../src/config";
import { decryptJson, encryptJson, importAesKey } from "../src/crypto";
import { admit, SignInError } from "../src/idp";
import { signToken, verifyToken } from "../src/tokens";
import { html, Html } from "../src/web/html";

const SECRET = "unit-test-signing-key-unit-test-signing-key";
const ISSUER = "https://gw.example.com";

describe("tokens", () => {
  it("verifies a token of the same kind", async () => {
    const { token } = await signToken(SECRET, ISSUER, "api", "user-1", { creds: { board: "c1" } }, 60);
    const claims = await verifyToken<{ creds: Record<string, string> }>(SECRET, ISSUER, "api", token);
    expect(claims?.sub).toBe("user-1");
    expect(claims?.creds).toEqual({ board: "c1" });
  });

  it("rejects a token of another kind", async () => {
    const { token } = await signToken(SECRET, ISSUER, "session", "user-1", {}, 60);
    expect(await verifyToken(SECRET, ISSUER, "api", token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { token } = await signToken(SECRET, ISSUER, "api", "user-1", {}, -1);
    expect(await verifyToken(SECRET, ISSUER, "api", token)).toBeNull();
  });

  it("rejects a token signed with another key", async () => {
    const { token } = await signToken(`${SECRET}-other`, ISSUER, "api", "user-1", {}, 60);
    expect(await verifyToken(SECRET, ISSUER, "api", token)).toBeNull();
  });

  it("rejects a short signing key", async () => {
    await expect(signToken("short", ISSUER, "api", "user-1", {}, 60)).rejects.toThrow();
  });
});

describe("crypto", () => {
  it("round-trips and binds to the additional data", async () => {
    const key = await importAesKey(btoa("k".repeat(32)));
    const sealed = await encryptJson(key, { a: "secret" }, "vault:1");
    expect(sealed).not.toContain("secret");
    expect(await decryptJson(key, sealed, "vault:1")).toEqual({ a: "secret" });
    await expect(decryptJson(key, sealed, "vault:2")).rejects.toThrow();
  });
});

describe("parseServices", () => {
  const auth = { type: "headers", headers: [{ name: "x-api-key", label: "key" }] };

  it("accepts a valid service and trims the trailing slash", () => {
    expect(parseServices({ board: { base_url: "https://api.example.com/", auth } }).board.base_url).toBe("https://api.example.com");
  });

  it("accepts a JSON string", () => {
    expect(Object.keys(parseServices(JSON.stringify({ board: { base_url: "https://a.example", auth } })))).toEqual(["board"]);
  });

  it("rejects non-https upstreams", () => {
    expect(() => parseServices({ board: { base_url: "http://api.example.com", auth } })).toThrow();
  });

  it("requires https OAuth endpoints", () => {
    const oauth = { type: "oauth2", authorization_url: "https://a.example/authorize", token_url: "http://a.example/token" };
    expect(() => parseServices({ freee: { base_url: "https://api.example.com", auth: oauth } })).toThrow(/token_url/);
    const ok = parseServices({ freee: { base_url: "https://api.example.com", auth: { ...oauth, token_url: "https://a.example/token" } } });
    expect(ok.freee.auth.type).toBe("oauth2");
  });

  it("rejects invalid names", () => {
    expect(() => parseServices({ "../x": { base_url: "https://api.example.com", auth } })).toThrow();
  });

  it("accepts identity upstreams with an audience and a Service Binding", () => {
    const parsed = parseServices({
      murmur: { base_url: "https://murmur.internal/api", binding: "MURMUR", auth: { type: "identity", audience: "murmur" } },
    });
    expect(parsed.murmur).toEqual({
      display_name: "murmur",
      base_url: "https://murmur.internal/api",
      binding: "MURMUR",
      auth: { type: "identity", audience: "murmur" },
    });
    expect(parseServices({ board: { base_url: "https://a.example", auth } }).board).not.toHaveProperty("binding");
  });

  it("rejects identity upstreams without an audience and invalid binding names", () => {
    expect(() => parseServices({ m: { base_url: "https://a.example", auth: { type: "identity" } } })).toThrow(/audience/);
    expect(() => parseServices({ m: { base_url: "https://a.example", binding: "lower", auth } })).toThrow(/binding/);
  });
});

describe("admit", () => {
  const entra = { IDP_TYPE: "entra", ALLOWED_TENANTS: "t1", ALLOWED_DOMAINS: "" } as unknown as Env;
  const google = { IDP_TYPE: "google", ALLOWED_TENANTS: "", ALLOWED_DOMAINS: "example.com" } as unknown as Env;

  it("uses tid and oid for Entra", () => {
    expect(admit(entra, { tid: "t1", oid: "o1", sub: "s", name: "Ada" })).toMatchObject({ id: "entra_t1_o1", name: "Ada" });
  });

  it("rejects other Entra tenants", () => {
    expect(() => admit(entra, { tid: "t2", oid: "o1" })).toThrow(SignInError);
  });

  it("requires a verified email in an allowed Google domain", () => {
    expect(admit(google, { sub: "g1", hd: "example.com", email_verified: true }).id).toBe("google_g1");
    expect(() => admit(google, { sub: "g1", hd: "other.com", email_verified: true })).toThrow(SignInError);
    expect(() => admit(google, { sub: "g1", email_verified: true })).toThrow(SignInError);
    expect(() => admit(google, { sub: "g1", hd: "example.com", email_verified: false })).toThrow(SignInError);
  });

  it("refuses Google without a domain allowlist", () => {
    expect(() => admit({ ...google, ALLOWED_DOMAINS: "" } as Env, { sub: "g1", hd: "x.com", email_verified: true })).toThrow(
      SignInError,
    );
  });
});

describe("html", () => {
  it("escapes interpolated strings but not nested html", () => {
    const inner = html`<b>${"<i>"}</b>`;
    expect(html`<p title="${`"q"`}">${inner}</p>`.value).toBe('<p title="&#34;q&#34;"><b>&#60;i&#62;</b></p>');
  });

  it("joins arrays and drops null, undefined and false", () => {
    expect(html`${["a", html`<br>`, "&"]}|${null}${undefined}${false}|${0}`.value).toBe("a\n<br>\n&#38;||0");
  });

  it("passes Html built on purpose through unchanged", () => {
    expect(html`${new Html("<style>a > b {}</style>")}`.value).toBe("<style>a > b {}</style>");
  });
});
