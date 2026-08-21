# Visual Identity OS MCP 1.5.1

Release date: 2026-08-21 (America/Bogota)

## Objective

Restore OAuth interoperability with Claude custom connectors without changing
the Auth0 tenant, the MCP tool surface, identity authority, or Drive data.

## Root cause

Claude correctly requested OAuth protected-resource metadata, then probed
`/.well-known/oauth-authorization-server` on the MCP origin. Version 1.5.0 did
not expose that compatibility endpoint, so Claude derived `/authorize` on the
MCP origin and received `404 Cannot GET /authorize`.

The observed Claude request also used the Auth0 application name as
`client_id`. The connector must use the application's actual Auth0 Client ID;
the Native/public client has no secret.

## Changes

- Expose RFC 8414-compatible authorization-server metadata at the root and
  `/mcp` well-known paths.
- Advertise Auth0's authorization, token, registration, PKCE, grant and token
  authentication capabilities.
- Add a backward-compatible `/authorize` redirect to Auth0 that preserves
  OAuth state, callback and PKCE parameters.
- Add the Auth0 API audience only when the client supplies neither `audience`
  nor `resource`.
- Add the required scopes to the `WWW-Authenticate` challenge.
- Normalize `MCP_PUBLIC_URL` to the canonical production MCP URL.

## Verification

- 93/93 tests pass.
- TypeScript production build passes.
- Canary health reports version 1.5.1.
- Protected-resource and authorization-server metadata return 200.
- The fallback `/authorize` returns 302 to the Auth0 `/authorize` endpoint and
  preserves PKCE and callback parameters.
- Auth0 accepts the known Native Client ID and begins Universal Login.
- Unauthenticated `/mcp` remains 401 and advertises canonical metadata plus
  the required scopes.

## Deployment state

- Cloud Run revision: `visual-identity-os-mcp-00038-doh`.
- Canary tag: `claude-oauth-v151`.
- Traffic: 0% canary; production remains 100% on
  `visual-identity-os-mcp-00035-pas`.

## Human acceptance gate

Before promotion, configure the Claude connector with the canary `/mcp` URL,
the actual Auth0 Client ID, an empty client secret, and HTTP streamable
transport. Complete the interactive Auth0 login and verify a read-only MCP
call. Do not promote based only on endpoint smoke tests.

## Rollback

No rollback is required while the revision remains at 0% traffic. Remove or
retarget the `claude-oauth-v151` tag if the interactive acceptance test fails.
Production traffic remains pinned to `visual-identity-os-mcp-00035-pas`.
