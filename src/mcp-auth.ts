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

  constructor() {
    super("Unauthorized MCP request");
    this.name = "McpAuthenticationError";
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
    } catch {
      throw new McpAuthenticationError();
    }
  };
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
