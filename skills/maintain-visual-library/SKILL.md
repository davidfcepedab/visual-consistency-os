---
name: maintain-visual-library
description: "Auditar y consolidar periódicamente la biblioteca de Visual Identity OS, el Inbox, Drive, Prompt Generator y Automation Control. Usar para inventariar assets, detectar archivos no registrados, enlaces no disponibles, duplicados candidatos, metadata incompleta, huérfanos y conflictos de estado; preparar dry-runs y, solo bajo autorización operativa explícita, registrar candidatos o anexar trazabilidad a decisiones humanas ya existentes mediante visual_apply_library_reconciliation. No usar para verificar identidad, mover, renombrar, borrar ni promover."
---

# Maintain Visual Library — tarjeta operativa

El registro (ASSET_REGISTRY) es la única fuente de verdad. `visual_get_canon_summary` es la página de estado; no mantener punteros a mano.

## Auditoría (sin permiso)
1. `visual_plan_library_reconciliation` con `dry_run=true`. Por defecto muestra solo `bucket=ACTION`; `include_historical=true` para ver lo histórico.
2. Si aparece `CONFLICT` de cursor, reiniciar sin cursor (la biblioteca cambió).
3. Reportar `counts` (action / historical / auto_applicable) y máximo tres decisiones.

## Aplicación automática (sin permiso)
- `SYNC_FILE_METADATA` para todo hallazgo `METADATA_DRIFT` (`auto_applicable=true`): copia nombre y link de Drive al registro. Lote ≤ 20, primero `dry_run=true`, luego real con `idempotency_key` y `expected_revision`.

## Con permiso explícito
- `REGISTER_CANDIDATE` (archivos nuevos en Ready/Locations/Inspiration).
- `CONSOLIDATE_DECIDED_FILE` (solo con decisión humana APPROVED/REJECTED existente).
- Cualquier cambio de estado, P0, Primary, aprobación o publicación; mover, renombrar o borrar archivos.

## Límites
- File ID es la identidad del archivo; el nombre no prueba duplicado.
- Nunca verificar rostro, tatuaje, anillo, Identity Master ni Publication Ready.
- No crear hojas, carpetas ni documentos de auditoría nuevos.
