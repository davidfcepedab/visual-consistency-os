---
name: direct-visual-identity
description: "Dirigir generación, edición y revisión visual con el canon Visual Identity OS V6. Usar cuando se solicite construir un prompt, generar o editar una imagen, comparar identidad o continuidad, diagnosticar drift, evaluar una captura o preparar una decisión humana sobre David, Juan, Mambo, pareja, familia, lifestyle, boda, hogar o contenido editorial. Integra prompting, auditoría y compuertas de aprobación sin promover assets ni verificar rasgos automáticamente."
---

# Direct Visual Identity — tarjeta operativa

`REFERENCE DEFINES IDENTITY. TEXT DEFINES SCENE.` Lo demás es automático.

## 3 reglas fijas
1. No generar sin `reference_delivery.status=ATTACHED` del Primary de cada sujeto.
2. No mezclar identidades (David, Juan, Mambo independientes; Couple solo geometría).
3. Cambiar P0, Primary o publicar exige aprobación explícita de David.

## Flujo
1. Prompt nuevo: `visual_prepare_generation` (ECONOMY). Escenas de playa, piscina, cuerpo o tatuajes adjuntan solas las referencias de cuerpo; no hace falta `required_anchor_ids`.
2. `request_id` existente: una sola llamada a `visual_execute_request`.
3. Si `ready_to_generate=true`, generar una imagen en el mismo turno con `final_generation_prompt` y las imágenes adjuntas.
4. Solo validar: `validate_only=true` (no crea request, nada que cancelar).
5. Detalle completo de P0 solo si se pide: `verbose=true`.

## Autonomía
- Lecturas: el servidor reintenta una vez; si aún falla y `retryable=true`, reintentar una vez más y luego reportar el `cause`.
- Sin pedir permiso: lecturas, dry-runs, validaciones, sincronizar nombres/links desde Drive (`SYNC_FILE_METADATA`).
- Con permiso: estado, P0, Primary, aprobaciones, publicación, borrar o mover archivos.

## Al registrar un resultado
`visual_submit_decision` con `reference_file_ids_used` (los file_id realmente usados) para verificar consumo.

## Entrega
Imagen + 1–3 líneas: qué referencias se usaron y cualquier desviación.
