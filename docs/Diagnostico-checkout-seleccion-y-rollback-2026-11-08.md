# Diagnóstico: selección de catálogo y continuidad del checkout

Fecha: 8 de noviembre de 2026  
Alcance: evidencia de producción y reproducción local. No contiene datos personales ni identificadores de clientes.

## Hecho observado

En una conversación de domicilio, el sistema logró:

1. identificar los productos;
2. presentar las alternativas de catálogo;
3. recibir la selección del último producto; y
4. calcular correctamente el subtotal.

Sin embargo, después de esa última selección, el mensaje saliente contenía solo el resumen. No incluía la pregunta de continuidad ni los botones para continuar, agregar productos o hablar con la tienda. Como consecuencia, el cliente escribió una confirmación libre y recibió el mismo resumen nuevamente.

## Evidencia correlacionada

La traza persistida de la conversación mostró que, tras la selección final:

- los dos renglones tenían producto, precio, cantidad y total válidos;
- el mensaje del agente tenía `interactive: null`;
- el borrador quedó con `checkout.phase: "collecting"` en vez de `"review"`;
- `missingFields` incluía `payment_method`, junto con explicaciones narrativas libres, por ejemplo, confirmaciones descritas en lenguaje natural;
- la señal estructurada de domicilio se podía sobrescribir con un `false` por defecto emitido por el intérprete en un turno posterior.

`checkoutProgress` trata cualquier faltante distinto de `payment_method` como una condición que impide salir de `collecting`. Por tanto, esas explicaciones libres no podían resolverse como campos de estado y bloqueaban la creación automática de la oferta `cart_review`.

## Causa raíz confirmada

El contrato de `missingFields` estaba mezclando dos tipos de información:

- **estado operativo estructurado**, como `payment_method`, `presentation:<línea>` o `selection:<línea>`;
- **explicaciones narrativas del LLM**, adecuadas para comunicar contexto, pero no para gobernar el estado de checkout.

La segunda categoría se persistía como si fuera la primera. No se trató de que el cliente debiera enviar un mensaje nuevo para activar DeepSeek: el estado inválido evitó que el backend construyera proactivamente el siguiente mensaje interactivo.

## Corrección preparada y verificada localmente

El commit `8abfa5a` añadió una validación en el límite de estado:

- conserva solamente claves operativas reconocidas en `missingFields`;
- mantiene `missingInfo` y el texto conversacional como canales narrativos separados;
- preserva un domicilio ya confirmado frente a valores predeterminados incompletos del intérprete;
- reproduce localmente el callback de selección final y exige que se envíen la pregunta de revisión y los botones `Continuar pedido`, `Agregar productos` y `Hablar con la tienda`.

Pruebas locales aprobadas:

- `node server/tests/catalog-selection-reconciliation.mjs`
- `node server/tests/checkout-sequence.mjs`
- `node server/tests/agent-runtime-quote-continuity.mjs`

## Decisión operativa

Por solicitud del usuario, la producción se revierte al commit estable `00329e4`. Este rollback solo cambia la versión ejecutada por Render; no purga ni modifica datos de producción.

La corrección documentada queda disponible en Git para revisión y reproducción local, pero no debe considerarse activa mientras Render ejecute `00329e4`.
