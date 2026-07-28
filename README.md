# Visual Identity OS MCP

Remote MCP server for the existing Visual Identity OS structure.

## Exposed tools

- `visual_get_system_status`
- `visual_list_pending_batches`
- `visual_get_batch`
- `visual_list_recent_captures`
- `visual_create_session`
- `visual_create_request`
- `visual_submit_decision`
- `visual_promote_asset`

## Required environment variables

```text
VISUAL_OS_WEB_APP_URL=https://script.google.com/macros/s/AKfycbwYxC_J-3JLkrx97R5WIn3IbtTIT_z4mitSnS8ZL-7xiM9EINKHb6PYyyzx2kosId90/exec
VISUAL_OS_SHARED_SECRET=<your Apps Script secret>
MCP_API_KEY=<a second secret for MCP clients>
```

## Local test

```bash
npm install
npm run build
VISUAL_OS_WEB_APP_URL="..." \
VISUAL_OS_SHARED_SECRET="..." \
MCP_API_KEY="..." \
npm start
```

Health check:

```bash
curl http://localhost:8080/health
```

MCP endpoint:

```text
http://localhost:8080/mcp
```

## Cloud Run deployment from source

```bash
gcloud run deploy visual-identity-os-mcp \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars VISUAL_OS_WEB_APP_URL="https://script.google.com/macros/s/AKfycbwYxC_J-3JLkrx97R5WIn3IbtTIT_z4mitSnS8ZL-7xiM9EINKHb6PYyyzx2kosId90/exec" \
  --set-env-vars VISUAL_OS_SHARED_SECRET="YOUR_APPS_SCRIPT_SECRET" \
  --set-env-vars MCP_API_KEY="YOUR_SECOND_SECRET"
```

`--allow-unauthenticated` exposes the HTTP service, but tool access remains protected by `MCP_API_KEY`. For a later hardened revision, replace this with Cloud Run IAM/OAuth.
