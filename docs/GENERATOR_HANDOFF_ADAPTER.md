# Generator Handoff Adapter — P0 Spec

## Why this lives outside the Cloud Run MCP

The MCP server (`visual_prepare_generation`) intentionally never renders an
image and never fetches image bytes itself — confirmed by its own tests
(`Test A — simple generation hands off to the host native renderer`) and by
design (`host_handoff.action = "INVOKE_NATIVE_IMAGE_GENERATOR"`). The MCP's
job stops at producing a `GenerationPacket`:

```ts
{
  ready_to_generate: boolean,
  request_id: string,
  identity_authority: VisualAnchor[],
  reference_files: VisualAnchor[],   // { file_id, drive_url, file_name, ... } — METADATA ONLY
  final_generation_prompt: string,
  blockers: Blocker[],
  host_handoff: { action, ... }
}
```

The **host** — the assistant runtime that called the MCP (ChatGPT, Claude,
etc.) — is the only actor with both (a) credentials to read Drive bytes and
(b) a connected image generator. This is correct separation of concerns: the
MCP is a governance/resolver service, not a rendering pipeline. What was
missing was a **documented, testable contract** for step (a)+(b), so "the
host does it" didn't silently mean "nothing verifies it happened."

## The adapter contract (P0, minimal)

```ts
interface GeneratorAdapter {
  name: string;                       // "gpt-image" | "krea" | "grok-imagine"
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

interface GenerateRequest {
  prompt: string;                     // GenerationPacket.final_generation_prompt
  references: ResolvedReference[];    // bytes/asset-refs already fetched, NOT bare URLs
  aspectRatio: string;                // e.g. "4:5"
  outputCount: 1;                     // Visual Identity OS always requests exactly 1
}

interface ResolvedReference {
  subject_or_scope: string;           // "David" | "Juan" | "Mambo" | "SalaTV"
  source_file_id: string;             // Drive file id, for traceability back to identity_authority
  bytes_delivered: boolean;           // true only if the adapter actually moved bytes to the generator
  generator_asset_ref: string;        // the generator-native handle (upload URL / attachment id)
}

interface GenerateResult {
  ok: boolean;
  generation_id: string;
  images: { url_or_path: string }[];
  references_used: ResolvedReference[];  // must echo back which refs were actually attached
}
```

**Hard rule enforced by the adapter, not by convention:** any
`GenerateRequest` where `references.length === 0` for an identity-dependent
request must throw `BLOCKED_REFERENCE_DELIVERY` before calling the
generator. A prompt string containing a Drive URL is **not** a reference and
does not satisfy this check — only an entry in `references[]` with
`bytes_delivered: true` does. If the chosen generator model rejects the
reference count/shape (e.g. more than its max `image_urls`), the adapter
returns `BLOCKED_GENERATOR_INCOMPATIBLE` instead of silently dropping refs.

## Reference implementation used for the P0 end-to-end test: `GPTImageAdapter` (via Krea gateway)

**Correction after inspecting the connected Krea MCP catalog**: the Krea
public API gateway itself exposes `openai/gpt-image` ("Original ChatGPT
image model") and `xai/grok-imagine-2` as callable models
(`get_model_schema("openai/gpt-image")` confirms `image_urls: string[]`,
up to 15 entries, each "external URL, base64 data URI, or uploaded asset
URL"). This means the P0-required generators (GPT Image primary, Grok
Imagine secondary) are reachable for real — not simulated — through the one
generator connector available in this orchestration session, using Krea only
as the physical gateway/upload layer, exactly as scoped ("Krea puede
mantenerse como integración externa/experimental" — here it is the transport,
not the creative model).

### GPTImageAdapter — actual steps executed (not simulated)

1. For every `reference_files[i].file_id` in the `GenerationPacket`:
   a. `drive.download_file_content(fileId)` → base64 bytes (real Drive API
      call, not a cached/assumed value).
   b. `krea.get_upload_url()` → presigned URL (shared across uploads within
      its 3h lifetime).
   c. `POST` the decoded bytes to that URL (multipart) → Krea asset URL.
   d. Record `{ source_file_id, generator_asset_ref: krea_asset_url,
      bytes_delivered: true }` for every reference — this is the
      traceability link back to `identity_authority`.
2. Call `krea.generate_image({ model: "openai/gpt-image", input: { prompt,
   image_urls: [...krea_asset_urls], width, height } })`.
3. Poll `krea.get_job(jobId)` until `completed`/`failed`.
4. Return `GenerateResult` with `references_used` echoing every asset that
   was actually uploaded — this is what `TRACEABILITY_REPORT.md` links to
   `capture_id`.

Secondary generator (`GrokImagineAdapter`) is the same steps with
`model: "xai/grok-imagine-2"` — same interface, swap the model id only.

### Why this satisfies "physical delivery" and not "URLs passed"

The `final_generation_prompt` text may still *mention* Drive URLs for human
readability, but the generator call itself never receives that text as its
only channel for the reference — `image_urls` in step 2 carries
Krea-hosted copies of the actual bytes downloaded in step 1c. If step 1a
fails (file inaccessible) or returns an unexpected MIME type, the adapter
throws `GENERATOR_HANDOFF_INCOMPLETE` before step 2, matching the Hard
Failure Rule.

## What this fixes

Before: `final_generation_prompt` contained a Drive URL as a text
substring; nothing verified the URL resolved, nothing fetched bytes, nothing
recorded what was actually shown to the generator. `GENERATOR_HANDOFF_REPORT.md`
(produced after the P0 verification run) will show, for the one real
generation executed, the exact `source_file_id → generator_asset_ref`
mapping — i.e. proof of physical delivery, not just "URLs passed."
