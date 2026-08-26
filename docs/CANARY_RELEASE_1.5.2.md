# Visual Identity OS MCP 1.5.2 Canary

Release date: 2026-08-21 (America/Bogota)

## Objective

Complete Claude OAuth interoperability by ensuring Auth0 issues an access
token for the Visual Identity OS API rather than its `/userinfo` endpoint.

## Confirmed root cause

Claude supplied RFC 8707 `resource` during authorization. Auth0 preserved the
flow but did not translate `resource` into its custom API `audience`, so the
issued and refreshed access tokens targeted the Auth0 `/userinfo` audience.
The MCP server correctly rejected those tokens with HTTP 401.

## Change

- Preserve Claude's `resource`, callback, state and PKCE parameters.
- Add the configured Auth0 API `audience` whenever the incoming authorization
  request does not already include one.
- Keep safe authentication diagnostics limited to JOSE error categories; do
  not log tokens or identity claims.

## Verification

- 93/93 tests pass.
- TypeScript production build passes.
- Auth0 logs confirm the previous token audience was its `/userinfo` endpoint.
- Cloud Run revision `visual-identity-os-mcp-00040-wab` is deployed behind the
  `claude-oauth-v151` tag with 0% traffic.
- Production remains on its existing revision.

## Acceptance gate

Disconnect and reconnect the Claude canary connector to force a new
authorization-code exchange. Confirm the new access token is accepted, list
the MCP tools, and run one read-only tool before any production promotion.

