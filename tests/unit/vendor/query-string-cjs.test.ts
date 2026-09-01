import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const queryString = require("query-string") as {
  parse: (query: string) => Record<string, string>;
  stringify: (object: Record<string, unknown>) => string;
};

describe("query-string CJS shim (intuit-oauth override)", () => {
  it("is the local CommonJS shim, not registry query-string@6", () => {
    expect(queryString.parse).toEqual(expect.any(Function));
    expect(queryString.stringify).toEqual(expect.any(Function));
    expect(require.resolve("query-string")).toContain("vendor/query-string-cjs");
  });

  it("stringifies the authorize-uri fields intuit-oauth sends", () => {
    const qs = queryString.stringify({
      response_type: "code",
      redirect_uri: "http://localhost:8000/callback",
      client_id: "test-client",
      scope: "com.intuit.quickbooks.accounting",
      state: "abc123def456",
    });

    const params = new URLSearchParams(qs);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("redirect_uri")).toBe("http://localhost:8000/callback");
    expect(params.get("client_id")).toBe("test-client");
    expect(params.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(params.get("state")).toBe("abc123def456");
  });

  it("parses a callback-shaped query the way createToken does", () => {
    const uri =
      "/callback?code=abc&state=deadbeef&realmId=9341452719904444";
    const params = queryString.parse(uri.split("?").reverse()[0]);

    expect(params.code).toBe("abc");
    expect(params.state).toBe("deadbeef");
    expect(params.realmId).toBe("9341452719904444");
  });
});

describe("intuit-oauth against the query-string shim", () => {
  it("authorizeUri loads via require and produces a usable authorize URL", () => {
    const OAuthClient = require("intuit-oauth");
    const client = new OAuthClient({
      clientId: "test-client",
      clientSecret: "test-secret",
      environment: "sandbox",
      redirectUri: "http://localhost:8000/callback",
    });

    const authUri = client.authorizeUri({
      scope: [OAuthClient.scopes.Accounting],
      state: "0123456789abcdef0123456789abcdef0123456789abcdef",
    });

    const url = new URL(authUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("state")).toBe(
      "0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8000/callback",
    );
  });
});
