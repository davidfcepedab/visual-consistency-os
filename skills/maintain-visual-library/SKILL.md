---
name: maintain-visual-library
description: "Auditar y consolidar periódicamente la biblioteca de Visual Identity OS, el Inbox, Drive, Prompt Generator y Automation Control. Usar para inventariar assets, detectar archivos no registrados, enlaces no disponibles, duplicados candidatos, metadata incompleta, huérfanos y conflictos de estado; preparar dry-runs y, solo bajo autorización operativa explícita, registrar candidatos o anexar trazabilidad a decisiones humanas ya existentes mediante visual_apply_library_reconciliation. No usar para verificar identidad, mover, renombrar, borrar ni promover."
---

# Maintain Visual Library

Consolidar archivos y registros sobre las fuentes existentes sin crear otro spreadsheet ni otra taxonomía.

## Modo auditoría (predeterminado)

1. Comprobar autenticación con `visual_get_system_status`.
2. Consultar `visual_list_library_inventory` paginando hasta agotar `next_cursor`.
3. Ejecutar `visual_plan_library_reconciliation` exclusivamente con `dry_run=true`; paginar sin mezclar revisiones.
4. Consultar huérfanos si el plan señala trazabilidad incompleta.
5. Leer [source-map.md](references/source-map.md) para resolver qué registro gobierna cada campo.
6. Aplicar [classification-policy.md](references/classification-policy.md).
7. Validar el JSON completo con `scripts/validate_dry_run.py` cuando se haya exportado a archivo.
8. Entregar un único reporte; no crear documentos de auditoría duplicados.

## Modo aplicación automática

Usar únicamente cuando el usuario haya autorizado explícitamente una ejecución o programación recurrente. Mantener estas condiciones en cada lote:

1. Obtener una instantánea completa y exigir `coverage=COMPLETE`.
2. Seleccionar máximo 20 acciones exactas por lote.
3. Permitir `REGISTER_CANDIDATE` solo para archivos no registrados cuyo path actual esté en `02. Ready`, `04. Locations` o `05. Inspiration`. El registro queda como `CANDIDATE / NEEDS_REVIEW`; no prueba identidad ni autoridad.
4. Permitir `CONSOLIDATE_DECIDED_FILE` solo cuando el mismo `capture_id` y `file_id` tengan una decisión humana actual `APPROVED` o `REJECTED`. La acción solo anexa trazabilidad; no reescribe esa decisión.
5. Ejecutar primero con `dry_run=true`. Si no hay rechazos, repetir el mismo lote con `dry_run=false`, `expected_revision`, `idempotency_key`, `reason`, `updated_by`, `source_evidence` y `overwrite=false`.
6. Repetir la misma clave una vez para verificar replay idempotente con cero escrituras adicionales y releer el resultado.
7. Enviar a aprobación humana todo archivo en Inbox, Review, Identity Masters, Archive o Docs; duplicados; referencias rotas o no disponibles; metadata candidata; conflictos; y cualquier caso relacionado con rostro, identidad, tatuaje, anillo, Detail Lock, Identity Master o Publication Ready.
8. No mover ni renombrar archivos. La organización automática en esta versión es registral y de trazabilidad, no física.

## Reglas

- Tratar Drive file ID como identidad del archivo; el nombre no prueba duplicación.
- Mantener un cursor ligado a una sola revisión. Reiniciar si aparece conflicto de revisión.
- No recorrer batches individualmente cuando una lectura agregada sea suficiente.
- No inferir project, subjects, scene, prompt_context, request o session como verificados.
- No declarar `IDENTITY_MASTER`, rostro, tatuaje, anillo o asset generado como verificado.
- En modo auditoría, `write_count` debe ser cero. En modo aplicación, solo las dos acciones allowlisted pueden escribir y deben cumplir el contrato anterior.
- No crear nuevas hojas, tablas, carpetas, documentos o taxonomías.

## Salida

Entregar revisión, cobertura, conteos por categoría, máximo tres bloqueos, acciones propuestas con ID exacto, una única decisión requerida y confirmación de cero escrituras.

En modo aplicación, reportar además filas aplicadas, no-ops, replay idempotente, revisión final y pendientes humanos. Nunca realizar eliminación física.
