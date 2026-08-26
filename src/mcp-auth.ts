import { timingSafeEqual } from "node:crypto";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

export type OAuthConfiguration = {
  issuer: string;
  audience: string;
  resource: string;
  publicUrl: string;
  scopes: string[];
};

export type AuthenticationResult =
  | { method: "api_key" }
  | { method: "oauth"; payload: JWTPayload };

export class McpAuthenticationError extends Error {
  readonly status = 401;
  readonly reason: string;

  constructor(reason = "authentication_failed") {
    super("Unauthorized MCP request");
    this.name = "McpAuthenticationError";
    this.reason = reason;
  }
}

export function readOAuthConfiguration(
  env: NodeJS.ProcessEnv
): OAuthConfiguration | undefined {
  const issuer = env.OAUTH_ISSUER?.trim();
  const audience = env.OAUTH_AUDIENCE?.trim();
  const publicUrl = (
    env.MCP_PUBLIC_URL || env.MCP_RESOURCE_URL
  )?.trim();

  if (!issuer && !audience && !publicUrl) return undefined;
  if (!issuer || !audience || !publicUrl) {
    throw new Error(
      "OAUTH_ISSUER, OAUTH_AUDIENCE, and MCP_PUBLIC_URL must be configured together"
    );
  }

  return {
    issuer: normalizeIssuer(issuer),
    audience,
    resource: env.OAUTH_RESOURCE?.trim() || audience,
    publicUrl,
    scopes: parseScopes(env.OAUTH_SCOPES),
  };
}

export function createOAuthResourceMetadata(config: OAuthConfiguration) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: config.scopes,
    resource_name: "Visual Identity OS MCP",
    resource_documentation:
      "https://visual-identity-os-mcp-4cf7h52zxa-uc.a.run.app/health",
  };
}

/**
 * Compatibility metadata for MCP clients that probe the resource-server
 * origin for RFC 8414 metadata before following authorization_servers.
 *
 * Auth0 remains the authorization server and token issuer; this endpoint only
 * advertises its public OAuth endpoints from the MCP origin.
 */
export function createOAuthAuthorizationServerMetadata(
  config: OAuthConfiguration
) {
  return {
    issuer: config.issuer,
    // Route authorization through the MCP origin so Auth0-specific audience
    // normalization is applied before forwarding the request.
    authorization_endpoint: new URL("/authorize", config.publicUrl).href,
    token_endpoint: new URL("oauth/token", config.issuer).href,
    registration_endpoint: new URL("oidc/register", config.issuer).href,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    scopes_supported: config.scopes,
  };
}

export function createOAuthAuthorizationRedirectUrl(
  config: OAuthConfiguration,
  requestUrl: string
): string {
  const incoming = new URL(requestUrl, config.publicUrl);
  const target = new URL("authorize", config.issuer);

  for (const [key, value] of incoming.searchParams) {
    target.searchParams.append(key, value);
  }

  // Auth0 requires its custom API identifier in `audience`. Claude supplies
  // RFC 8707 `resource`, but Auth0 does not translate that value into the API
  // audience and otherwise issues a /userinfo token.
  if (!target.searchParams.has("audience")) {
    target.searchParams.set("audience", config.audience);
  }

  return target.href;
}

export function createBearerAuthenticator(input: {
  apiKey: string;
  oauth?: OAuthConfiguration;
  verificationKey?: JWTVerifyGetKey;
}) {
  const verificationKey =
    input.verificationKey ??
    (input.oauth
      ? createRemoteJWKSet(
          new URL(".well-known/jwks.json", input.oauth.issuer)
        )
      : undefined);

  return async (
    authorizationHeader: string | undefined,
    directApiKey?: string
  ): Promise<AuthenticationResult> => {
    const token = extractCredential(authorizationHeader, directApiKey);

    if (input.apiKey && safeEqual(token, input.apiKey)) {
      return { method: "api_key" };
    }

    if (!input.oauth || !verificationKey) {
      throw new McpAuthenticationError();
    }

    try {
      const verified = await jwtVerify(token, verificationKey, {
        issuer: input.oauth.issuer,
        audience: input.oauth.audience,
        algorithms: ["RS256"],
      });
      return { method: "oauth", payload: verified.payload };
    } catch (error) {
      throw new McpAuthenticationError(authenticationFailureReason(error));
    }
  };
}

function authenticationFailureReason(error: unknown): string {
  if (!error || typeof error !== "object") return "verification_failed";

  const candidate = error as {
    code?: unknown;
    claim?: unknown;
    reason?: unknown;
  };
  const code =
    typeof candidate.code === "string" ? candidate.code : "verification_failed";
  const claim = typeof candidate.claim === "string" ? candidate.claim : "";
  const reason = typeof candidate.reason === "string" ? candidate.reason : "";

  return [code, claim, reason].filter(Boolean).join(":");
}

export function oauthResourceMetadataUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  return `${url.origin}/.well-known/oauth-protected-resource`;
}

function extractCredential(
  authorizationHeader: string | undefined,
  directApiKey: string | undefined
): string {
  if (authorizationHeader?.startsWith("Bearer ")) {
    const token = authorizationHeader.slice("Bearer ".length).trim();
    if (token) return token;
  }
  if (directApiKey?.trim()) return directApiKey.trim();
  throw new McpAuthenticationError();
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function normalizeIssuer(issuer: string): string {
  return issuer.endsWith("/") ? issuer : `${issuer}/`;
}

function parseScopes(value: string | undefined): string[] {
  const scopes = (value || "openid profile email offline_access")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return [...new Set(scopes)];
}
