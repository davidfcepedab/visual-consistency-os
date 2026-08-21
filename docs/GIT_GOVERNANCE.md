# Git governance — Visual Identity OS MCP

## Source of truth

- Canonical repository: `/Users/davidcepeda/Developer/VISUAL-Consistency-OS/recovered-production-source`
- Stable branch: `main`
- Integration branches: `feat/*`; they must pass `npm test` and `npm run build` before fast-forwarding `main`.
- Release tags: annotated semantic tags (`vMAJOR.MINOR.PATCH`). A tag identifies source, not a successful deployment by itself.
- Cloud Run revision plus immutable image digest identifies the deployed runtime.
- Apps Script deployment ID plus version identifies the data adapter.

The historical folder `visual-identity-os-mcp` is not a second source of
truth. It is retained as an explicitly named legacy backup and the original
path resolves to the canonical repository.

## Release gate

1. Clean or explicitly reviewed working tree; preserve unrelated work.
2. Contract tests and TypeScript build pass.
3. Apps Script creates a new immutable deployment; no in-place production
   overwrite is treated as validation.
4. Cloud Run creates a no-traffic revision and passes health, tool discovery,
   full read-only inventory and dry-run reconciliation.
5. A real write, when authorized, uses a bounded batch, expected revision and
   unique idempotency key; replay must produce zero additional writes.
6. Promote traffic only after canary evidence. Keep the prior revision and
   Apps Script deployment as rollback targets.

## Protected decisions

Automatic maintenance cannot verify or promote identity, face, tattoo, ring,
Detail Lock, Identity Master or Publication Ready. It cannot overwrite human
decisions, original IDs or timestamps, and cannot physically delete, move or
rename Drive files.

## Remote policy

No Git remote is currently configured. `main` and tags are local governance
until an approved remote is added. A push, pull request or production traffic
change is a separate externally verifiable action.
