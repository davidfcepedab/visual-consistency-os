# Native generator handoff contract

The MCP resolves authority and physically delivers image content blocks. The host renders. The former statement that the MCP returns metadata only is obsolete.

## Gates and evidence

1. Invoke `visual_prepare_generation` once for a new scene, or `visual_execute_request` once for an exact existing request.
2. Preserve the complete response before inspection. Prefer `structuredContent`; use JSON text only as a documented fallback. Check `Array.isArray(content)` before iterating. Non-JSON error text must block; it must not trigger an automatic retry or a second request.
3. Require `ready_to_generate=true`, `reference_delivery.status=ATTACHED`, one physical image block for every attached ID, and each subject's Primary among those IDs.
4. `src/generator-handoff.ts` implements these checks. It preserves each original image block and records its source file ID, content position, byte size and SHA-256. If the delivery includes a manifest, any mismatch blocks the handoff.
5. Forward the actual image blocks to the host renderer. Bare filenames, Drive URLs, IDs and metadata never satisfy delivery.
6. Record the renderer invocation separately. ATTACHED proves delivery from the MCP; it does not prove a renderer invocation or the model's internal use of an image.

## Native host example

In a functions host, expose each returned MCP image block using `image(block)` before invoking imagegen. When these images have no local file paths, select the smallest `num_last_images_to_include` that includes every reference. Do not display other images between delivery and selection. If the renderer cannot include all images, stop. Do not replace references with textual descriptions.

Use the returned `final_generation_prompt` and produce one image. A local-reference path is valid only when it points to the actual delivered bytes and the tool supports that path. Never fetch another file merely to substitute for an unavailable MCP bitmap.

The manifest remains `generator_consumption=NOT_VERIFIED`. A host can independently document REFERENCE_PASSED from the actual invocation, but must not rewrite this as proof of internal model consumption. Evaluate the visible output against the visible reference and keep human approval pending.

## Scope isolation

Primary governs facial identity. Other P0 entries are catalog metadata until selected for the scene. Body-only prohibitions apply to the body reference, not globally to the Primary face. Required references have individually labeled allowed and prohibited uses. No generated output is promoted automatically.

## Retention

Do not write Canon, P0, Locks, Result Memory or approval decisions as part of a transport test. Keep technical transport evidence and human approval separate.
