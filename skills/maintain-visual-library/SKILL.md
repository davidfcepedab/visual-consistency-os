---
name: maintain-visual-library
description: "Auditar y consolidar periódicamente la biblioteca de Visual Identity OS, el Inbox, Drive, Prompt Generator y Automation Control. Usar para inventariar assets, detectar archivos no registrados, enlaces no disponibles, duplicados candidatos, metadata incompleta, huérfanos y conflictos de estado; categorizar candidatos y preparar planes dry-run de organización o actualización. No usar para verificar identidad, mover, renombrar, borrar, promover ni corregir automáticamente."
---

# Maintain Visual Library

Consolidar archivos y registros sobre las fuentes existentes sin crear otro spreadsheet ni otra taxonomía.

## Ejecución periódica

1. Comprobar autenticación con `visual_get_system_status`.
2. Consultar `visual_list_library_inventory` paginando hasta agotar `next_cursor`.
3. Ejecutar `visual_plan_library_reconciliation` exclusivamente con `dry_run=true`; paginar sin mezclar revisiones.
4. Consultar huérfanos si el plan señala trazabilidad incompleta.
5. Leer [source-map.md](references/source-map.md) para resolver qué registro gobierna cada campo.
6. Aplicar [classification-policy.md](references/classification-policy.md).
7. Validar el JSON completo con `scripts/validate_dry_run.py` cuando se haya exportado a archivo.
8. Entregar un único reporte; no crear documentos de auditoría duplicados.

## Reglas

- Tratar Drive file ID como identidad del archivo; el nombre no prueba duplicación.
- Mantener un cursor ligado a una sola revisión. Reiniciar si aparece conflicto de revisión.
- No recorrer batches individualmente cuando una lectura agregada sea suficiente.
- No inferir project, subjects, scene, prompt_context, request o session como verificados.
- No declarar `IDENTITY_MASTER`, rostro, tatuaje, anillo o asset generado como verificado.
- Toda propuesta exige revisión humana; `write_count` debe ser cero durante la ejecución periódica.
- No crear nuevas hojas, tablas, carpetas, documentos o taxonomías.

## Salida

Entregar revisión, cobertura, conteos por categoría, máximo tres bloqueos, acciones propuestas con ID exacto, una única decisión requerida y confirmación de cero escrituras.

Si una futura ejecución es autorizada para escribir, separar aprobación de cada lote de cambios, exigir revisión esperada e idempotencia y comprobar por lectura. Nunca realizar eliminación física.
