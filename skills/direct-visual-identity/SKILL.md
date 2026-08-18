---
name: direct-visual-identity
description: "Dirigir generación, edición y revisión visual con el canon Visual Identity OS V6. Usar cuando se solicite construir un prompt, generar o editar una imagen, comparar identidad o continuidad, diagnosticar drift, evaluar una captura o preparar una decisión humana sobre David, Juan, Mambo, pareja, familia, lifestyle, boda, hogar o contenido editorial. Integra prompting, auditoría y compuertas de aprobación sin promover assets ni verificar rasgos automáticamente."
---

# Direct Visual Identity

Operar una tarea visual completa sin mezclar identidad, escena y autoridad registral.

## Flujo

1. Consultar por lectura el estado y la referencia exacta necesaria. Si el MCP no está autenticado, detener cualquier afirmación sobre estado persistente.
2. Leer [authority-and-gates.md](references/authority-and-gates.md) y asignar a cada referencia una función limitada.
3. Elegir un modo: diseñar prompt, generar, editar, evaluar o preparar una decisión. Combinar modos solo en ese orden.
4. Leer [prompt-and-review.md](references/prompt-and-review.md) para redactar o evaluar.
5. Inspeccionar toda imagen objetivo antes de editarla o calificarla.
6. Presentar hechos, inferencias, riesgos y máximo tres acciones.

## Contrato

- Aplicar `REFERENCE DEFINES IDENTITY. TEXT DEFINES SCENE.`
- Generar una sola imagen salvo cantidad explícita. Prohibir collage, grid, split view y contact sheet.
- Tratar nombre, carpeta, prompt, score y salida generada como insuficientes para verificar identidad.
- No inventar ni espejar tatuajes, anillos, accesorios o anatomía.
- No convertir una salida generada en evidencia facial, corporal o de tono de piel.
- Marcar faltantes como `UNKNOWN` o `NEEDS_REVIEW`.
- No aprobar, rechazar, reintentar scoring, actualizar metadata, mover archivos ni promover assets sin autorización explícita de esa acción.

## Escrituras

Antes de una escritura persistente:

1. recuperar ID exacto y revisión vigente;
2. separar evaluación provisional de decisión humana;
3. mostrar acción, alcance, razón y restricciones;
4. exigir confirmación explícita;
5. usar dry-run, idempotencia y revisión esperada cuando existan;
6. verificar el resultado por lectura.

No combinar decisión y promoción en una sola escritura salvo autorización separada de ambas.

## Entrega

- Prompt: routing breve y un único bloque listo para usar.
- Generación/edición: imagen, verificación breve y desviaciones.
- Evaluación: máximo tres hallazgos, severidad y corrección mínima.
- Persistencia: estado anterior/nuevo, trace ID y elementos no modificados.
