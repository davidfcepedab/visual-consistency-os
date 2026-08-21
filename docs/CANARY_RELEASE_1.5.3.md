# Visual Identity OS MCP 1.5.3 Canary

Release date: 2026-08-21 (America/Bogota)

## Objective

Ensure Claude's authorization request passes through the MCP compatibility
bridge before reaching Auth0.

## Confirmed behavior

Claude used the authorization endpoint advertised in authorization-server
metadata. Version 1.5.2 advertised Auth0 directly, so the MCP `/authorize`
bridge never received the request and could not add the custom API audience.
The resulting credential was not a valid JWS for the MCP API and was correctly
rejected with `ERR_JWS_INVALID`.

## Change

- Advertise the MCP origin `/authorize` compatibility endpoint.
- Preserve callback, state, PKCE and resource parameters.
- Add the Auth0 API audience before redirecting to Auth0.
- Keep the canary public URL endpoint-specific so discovery and authorization
  remain on the same canary revision.

## Acceptance gate

Reauthorize the Claude canary connector, confirm Auth0 issues the custom API
audience, list MCP tools, and run one read-only tool. Keep production traffic
unchanged until all three checks pass.

## Acceptance result

- OAuth requests pass through the canary `/authorize` bridge.
- Claude-authenticated MCP requests are accepted without 401 responses.
- MCP initialization returned 200 and the initialized notification returned
  202.
- Tool discovery returned 17 tools.
- `visual_get_system_status` completed as a read-only call with HTTP 200 and
  no tool error.
- MCP server and health metadata both report version 1.5.3.
