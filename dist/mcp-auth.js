import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, } from "jose";
export class McpAuthenticationError extends Error {
    status = 401;
    constructor() {
        super("Unauthorized MCP request");
        this.name = "McpAuthenticationError";
    }
}
export function readOAuthConfiguration(env) {
    const issuer = env.OAUTH_ISSUER?.trim();
    const audience = env.OAUTH_AUDIENCE?.trim();
    const resourceUrl = env.MCP_RESOURCE_URL?.trim();
    if (!issuer && !audience && !resourceUrl)
        return undefined;
    if (!issuer || !audience || !resourceUrl) {
        throw new Error("OAUTH_ISSUER, OAUTH_AUDIENCE, and MCP_RESOURCE_URL must be configured together");
    }
    return {
        issuer: normalizeIssuer(issuer),
        audience,
        resourceUrl,
        scopes: parseScopes(env.OAUTH_SCOPES),
    };
}
export function createOAuthResourceMetadata(config) {
    return {
        resource: config.resourceUrl,
        authorization_servers: [config.issuer],
        bearer_methods_supported: ["header"],
        scopes_supported: config.scopes,
        resource_name: "Visual Identity OS MCP",
        resource_documentation: "https://visual-identity-os-mcp-4cf7h52zxa-uc.a.run.app/health",
    };
}
export function createBearerAuthenticator(input) {
    const verificationKey = input.verificationKey ??
        (input.oauth
            ? createRemoteJWKSet(new URL(".well-known/jwks.json", input.oauth.issuer))
            : undefined);
    return async (authorizationHeader, directApiKey) => {
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
        }
        catch {
            throw new McpAuthenticationError();
        }
    };
}
export function oauthResourceMetadataUrl(resourceUrl) {
    const url = new URL(resourceUrl);
    return `${url.origin}/.well-known/oauth-protected-resource`;
}
function extractCredential(authorizationHeader, directApiKey) {
    if (authorizationHeader?.startsWith("Bearer ")) {
        const token = authorizationHeader.slice("Bearer ".length).trim();
        if (token)
            return token;
    }
    if (directApiKey?.trim())
        return directApiKey.trim();
    throw new McpAuthenticationError();
}
function safeEqual(left, right) {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return (leftBytes.length === rightBytes.length &&
        timingSafeEqual(leftBytes, rightBytes));
}
function normalizeIssuer(issuer) {
    return issuer.endsWith("/") ? issuer : `${issuer}/`;
}
function parseScopes(value) {
    const scopes = (value || "openid profile email offline_access")
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter(Boolean);
    return [...new Set(scopes)];
}
