import assert from "node:assert/strict";
import test from "node:test";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import {
  McpAuthenticationError,
  createBearerAuthenticator,
  createOAuthAuthorizationRedirectUrl,
  createOAuthAuthorizationServerMetadata,
  createOAuthResourceMetadata,
  oauthResourceMetadataUrl,
  readOAuthConfiguration,
} from "../src/mcp-auth.js";

const oauth = {
  issuer: "https://issuer.example/",
  audience: "https://visual-identity-os-mcp",
  resource: "https://visual-identity-os-mcp",
  publicUrl: "https://visual.example/mcp",
  scopes: ["openid", "profile", "email", "offline_access"],
};

test("OAuth configuration is absent only when every OAuth variable is absent", () => {
  assert.equal(readOAuthConfiguration({}), undefined);
  assert.throws(
    () =>
      readOAuthConfiguration({
        OAUTH_ISSUER: "https://issuer.example/",
      }),
    /must be configured together/
  );
});

test("OAuth configuration normalizes issuer and scopes", () => {
  assert.deepEqual(
    readOAuthConfiguration({
      OAUTH_ISSUER: "https://issuer.example",
      OAUTH_AUDIENCE: "https://visual-identity-os-mcp",
      MCP_PUBLIC_URL: "https://visual.example/mcp",
      OAUTH_SCOPES: "openid profile profile email",
    }),
    {
      issuer: "https://issuer.example/",
      audience: "https://visual-identity-os-mcp",
      resource: "https://visual-identity-os-mcp",
      publicUrl: "https://visual.example/mcp",
      scopes: ["openid", "profile", "email"],
    }
  );
});

test("protected resource metadata advertises Auth0-compatible OAuth", () => {
  assert.deepEqual(createOAuthResourceMetadata(oauth), {
    resource: "https://visual-identity-os-mcp",
    authorization_servers: ["https://issuer.example/"],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    resource_name: "Visual Identity OS MCP",
    resource_documentation:
      "https://visual-identity-os-mcp-4cf7h52zxa-uc.a.run.app/health",
  });
  assert.equal(
    oauthResourceMetadataUrl(oauth.publicUrl),
    "https://visual.example/.well-known/oauth-protected-resource"
  );
});

test("authorization server compatibility metadata points to Auth0", () => {
  assert.deepEqual(createOAuthAuthorizationServerMetadata(oauth), {
    issuer: "https://issuer.example/",
    authorization_endpoint: "https://visual.example/authorize",
    token_endpoint: "https://issuer.example/oauth/token",
    registration_endpoint: "https://issuer.example/oidc/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
  });
});

test("authorization fallback preserves PKCE and adds the Auth0 API audience", () => {
  const redirect = new URL(
    createOAuthAuthorizationRedirectUrl(
      oauth,
      "/authorize?response_type=code&client_id=client-123&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=challenge&code_challenge_method=S256&state=state-123"
    )
  );

  assert.equal(redirect.origin, "https://issuer.example");
  assert.equal(redirect.pathname, "/authorize");
  assert.equal(redirect.searchParams.get("response_type"), "code");
  assert.equal(redirect.searchParams.get("client_id"), "client-123");
  assert.equal(
    redirect.searchParams.get("redirect_uri"),
    "https://claude.ai/api/mcp/auth_callback"
  );
  assert.equal(redirect.searchParams.get("code_challenge"), "challenge");
  assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
  assert.equal(redirect.searchParams.get("state"), "state-123");
  assert.equal(redirect.searchParams.get("audience"), oauth.audience);
});

test("authorization fallback preserves resource and still adds Auth0 audience", () => {
  const redirect = new URL(
    createOAuthAuthorizationRedirectUrl(
      oauth,
      "/authorize?client_id=client-123&resource=https%3A%2F%2Fvisual.example%2Fmcp"
    )
  );

  assert.equal(
    redirect.searchParams.get("resource"),
    "https://visual.example/mcp"
  );
  assert.equal(redirect.searchParams.get("audience"), oauth.audience);
});

test("static API key remains available for controlled smoke and rollback", async () => {
  const authenticate = createBearerAuthenticator({
    apiKey: "synthetic-api-key",
  });
  assert.deepEqual(await authenticate("Bearer synthetic-api-key"), {
    method: "api_key",
  });
  assert.deepEqual(await authenticate(undefined, "synthetic-api-key"), {
    method: "api_key",
  });
  await assert.rejects(
    authenticate("Bearer wrong-key"),
    McpAuthenticationError
  );
});

test("valid RS256 OAuth token is accepted and wrong audience is rejected", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const verificationKey = createLocalJWKSet({
    keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }],
  });
  const authenticate = createBearerAuthenticator({
    apiKey: "synthetic-api-key",
    oauth,
    verificationKey,
  });

  const validToken = await new SignJWT({ scope: "openid profile" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(oauth.issuer)
    .setAudience(oauth.audience)
    .setSubject("auth0|synthetic-user")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const accepted = await authenticate(`Bearer ${validToken}`);
  assert.equal(accepted.method, "oauth");
  if (accepted.method === "oauth") {
    assert.equal(accepted.payload.sub, "auth0|synthetic-user");
  }

  const wrongAudience = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(oauth.issuer)
    .setAudience("https://wrong.example")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  await assert.rejects(
    authenticate(`Bearer ${wrongAudience}`),
    McpAuthenticationError
  );
  await assert.rejects(authenticate(undefined), McpAuthenticationError);
});
