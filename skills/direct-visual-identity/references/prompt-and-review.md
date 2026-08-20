# Prompt y revisión

## Prompt compacto

Incluir solo lo necesario:

1. contrato de una salida;
2. objetivo;
3. sujetos y referencias autorizadas;
4. `PRESERVE` para elementos congelados;
5. `CHANGE` para la única dimensión modificada;
6. escena, cámara, luz y acabado;
7. `DO NOT` con fallos específicos;
8. criterio de aceptación.

Cambiar una dimensión principal por lote: identidad, pose/encuadre, wardrobe, location, iluminación o expresión.

## Handoff al host

`visual_prepare_generation` prepara el paquete; el HOST renderiza en el mismo turno. `ready_to_generate=true` es el disparador del generador nativo, no el resultado final. No detenerse en `request_id` ni `READY_TO_GENERATE`. `visual_create_request` no produce bitmap. No concluir que la generación es imposible porque el MCP no tenga una tool de render. `ready_to_generate=false` solo vale cuando falta autoridad visual obligatoria.

## Revisión

Separar evidencia observable de inferencia. Revisar, cuando estén respaldados:

- identidad y época;
- cuerpo, cabello y grooming;
- tatuajes, anillos y locks visibles;
- diferenciación entre sujetos;
- composición y elementos congelados;
- vestuario y entorno;
- naturalidad y artefactos.

Clasificar fallos como bloqueantes, mayores o menores. Una imagen atractiva puede fallar si rompe identidad o continuidad. Entregar corrección mínima, no un rediseño completo.
