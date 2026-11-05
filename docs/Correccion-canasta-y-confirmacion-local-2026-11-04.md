# Corrección local: canasta y confirmaciones pendientes

## Alcance

Continuación autorizada de la descomposición del planner. Se mantienen los cambios existentes y el intérprete, resolutor y compositor separados. Sin despliegue, cambios en Meta, WhatsApp real ni escritura en la base PostgreSQL de desarrollo: la campaña utiliza un clon local, un tenant sombra, DeepSeek real y captura de Graph.

## Causas reproducidas antes de corregir

1. El contrato enumeraba los atributos del ítem sin incluir `rawItemId` como obligatorio. Aunque otra instrucción pedía conservarlo, el proveedor podía omitirlo al aclarar una presentación. La normalización generaba entonces un ID nuevo y la fusión añadía una línea. En el caso 03 se cotizaron 4 y 6 paquetes cuando el cliente reiteraba 2.
2. `dedupeOrderMissingFields` comparaba los sujetos de los pendientes por semejanza textual. Dos IDs del mismo turno comparten prefijo: el pendiente de aceite podía desaparecer al deduplicarlo con arroz. Seleccionar arroz y pago dejaba `missingFields=[]`, aunque el aceite seguía sin resolver.
3. La confirmación confiaba en esa lista guardada; no contrastaba cada línea con su resolución, cantidad, precio y disponibilidad. Se reprodujo el intento de escritura de un borrador incompleto.

La prueba nueva `server/tests/cart-continuity-contract.mjs` reprodujo los tres fallos antes del cambio. Sus controles de adición y retirada también distinguen actualizaciones legítimas de duplicaciones.

## Cambios

| Componente | Corrección |
|---|---|
| `llmPlanner.js` | Identidad explícita por ítem: ID existente para actualizar, `null` para una necesidad nueva. Cantidad final, no incremento, al actualizar. Contexto conserva hipótesis, presupuesto y estado de resolución. Contrato inválido: una única reparación por el mismo LLM, registrada en telemetría; si persiste, fallback seguro. |
| `semanticContracts.js` | Un `rawItemId:null` explícito no pasa por el emparejamiento textual legado. No se fusionan productos por nombre o SKU. |
| `groundingContracts.js` | Valida referencias de identidad y comprueba impedimentos comerciales contra la canasta real. |
| `agentRuntime.js` | Pendientes de presentación se deduplican por igualdad exacta. Revalida antes de ofrecer o aceptar confirmación. Selecciones de variante y pago retoman el resolutor contextual con el borrador actualizado; el hecho validado se pasa separado del plan del proveedor. No reinterpreta el título abreviado del botón. |
| `conversationGroundingCoordinator.js`, `groundedDecisionAgent.js` | Durante una selección estructurada conservan los SKU resueltos y consultan su estado actual. El LLM decide cómo seguir y resuelve las referencias pendientes. Stock/precio/tenant inválidos impiden resolver la línea; una modificación posterior por texto vuelve al análisis normal. |
| `llmReplyComposer.js` | Recibe la autorización de confirmar y los pendientes; no debe presentar un subtotal parcial como pedido completo. |
| `cart-continuity-contract.mjs`, `package.json` | Regresiones reproducibles mediante `npm run test:cart-continuity`. |

La identidad de una solicitud la decide el LLM. La validación no determina qué quiso decir el comprador, no usa listas de productos ni umbrales de similitud para unir líneas. La prohibición de confirmar una canasta incompleta es una invariante comercial.

## Validación

- PASS: regresiones de continuidad, actualización con cantidad final, línea nueva explícita, retirada, dos variantes pendientes, selección sucesiva y confirmación bloqueada aun con lista de pendientes vacía.
- PASS: `test:grounding`, `test:acceptance:contract`, `test:architecture`, `test:backend`.
- Campaña focalizada real: `test-results/cart-continuity-targeted/20261104192929_f137cae2`, casos 03, 32 y 40: 18 turnos; no se reprodujeron excesos de canasta. Caso 32 aprobado de extremo a extremo, con $23.500 y flujo del tendero. Caso 03 mantiene dos paquetes/$13.000, pero no aclara satisfactoriamente unidades frente a paquetes. Caso 40 mantiene un pan/$7.600, pero no resuelve la pregunta sobre costo del domicilio y acaba escalando. Veredicto global automático: 1 aprobado, 2 por revisar; no equivale a 3 diálogos exitosos.
- Campaña completa: `test-results/cart-continuity-full50/20261104193454_396f8b87`: **50 casos, 196 turnos**, excesos de canasta **11 → 0**, botones de confirmación con productos pendientes **1 → 0** frente a la referencia anterior. Nueve pedidos persistidos y nueve flujos del tendero comprobados. Incluye una aserción independiente nueva sobre botones de confirmación frente al borrador. No se cambió código bajo prueba mientras se ejecutaba. Es anterior a la corrección final del botón.
- Resultado global de esa campaña: 9 aprobados, 20 por revisar, 15 fallos funcionales, 4 fallback de integración, 1 error de infraestructura y 1 fallo de integridad de pago. **No equivale a 50 casos aprobados.** [Comparación y evidencia por caso](Resultado-canasta-confirmacion-local-2026-11-04.md).
- Corrección posterior del botón: el contrato ampliado reprodujo dos fallos antes del arreglo y pasó sus siete grupos después. Pasaron nuevamente `test:grounding`, `test:architecture` y `test:acceptance:contract`.
- Cierre sobre la versión final: `test:backend` pasó nuevamente (smoke, 50 escenarios/60 pasos de Colombia y contratos de proveedor, auth, Google, WhatsApp y Embedded Signup). `git diff --check` sin errores. El build frontend ya había pasado y esta última corrección no modificó frontend.
- Repetición final con DeepSeek real: casos 02, 03, 24, 32, 35 y 50, en `test-results/cart-continuity-final/20261104201327_8e570e13`: **33 turnos, cero excesos de canasta y cero botones de confirmación incompleta**. Cinco pedidos guardados; cuatro flujos del tendero aprobados. El caso 35 guardó correctamente su pedido, pero un JSON inválido del juez impidió ejecutar su comprobación de tendero. Resultado global: cinco `needs_review` y un `evaluator_error`, no seis éxitos. No se alteraron actores ni expectativas comerciales para forzar aprobaciones.
- PASS: compilación frontend (`npm run build`). La repetición de `test:architecture` tras los guardas finales también pasó.

### Hallazgos secundarios observados durante la campaña completa

- Casos 01 y 22: preguntas sobre precio unitario no se contestan; el mensaje de canasta/pago se repite. Las cantidades se conservan, pero la venta no concluye. Corregir identidad no resuelve esta brecha de respuesta contextual.
- Caso 07: el diálogo responde sobre Cifrut granadilla de 250 ml a $1.800; la clasificación global falla por agotar tres turnos de consulta. No es evidencia de producto o precio equivocado.
- Caso 11: error `fetch failed`; evaluación incompleta. Caso 22 también registra un fallo inicial del proveedor, además del problema funcional posterior. Se conservan ambos tipos de evidencia.
- Caso 24: regresión detectada y corregida en esta intervención. El botón de yogurt conservaba internamente el SKU, pero su título abreviado se volvía a interpretar como texto y el resolutor reabría la presentación durante ocho turnos. Se conserva ahora la elección validada, se consulta la referencia exacta y se deja al resolutor LLM la decisión de continuación. Su repetición real se registra por separado.
- Caso 29: no es el mismo fallo de botones; la selección de Coca-Cola se conserva. El bloqueo posterior es la pregunta de costo de domicilio sin responder. Caso 33: productos y subtotal de $7.400 se conservan, pero la consulta de precios unitarios tampoco se resuelve.
- Caso 50: el pedido guardó `tarjeta_debito` en vez del identificador configurado `card_terminal`; el oráculo lo detectó como fallo de integridad. Es una brecha de normalización de pago, no duplicación ni confirmación con producto pendiente. No se oculta ni se cambia la expectativa para aceptarla.
- Caso 48: un silencio. Casos 37 y 49: tareas humanas repetidas. Siguen pendientes fuera de estas dos prioridades.

### Revisión manual de la versión final

| Caso | Evidencia de las dos correcciones | Límite del resultado |
|---|---|---|
| 02 | Una selección de Chocoramo y una aclaración de cantidad conservan 3 Chocoramos + 2 Cifrut, $12.000. Pedido y tendero comprobados. | Juez/experiencia requieren revisión. |
| 03 | Reiterar dos paquetes de cinco arepas no añade líneas: se mantiene cantidad 2 y $13.000. Pedido y tendero comprobados. | El agente todavía no explica bien la unidad de venta. |
| 24 | El título abreviado del botón resuelve yogurt vaso de 150 g en un turno; conserva Festival y subtotal $9.700. No reabre variantes. | La consulta de costo de domicilio no se contesta y termina en escalamiento; no hay pedido. |
| 32 | Al elegir arroz conserva aceite pendiente; al elegir aceite reúne las tres líneas por $23.500. No confirma antes de resolverlas. Pedido y tendero comprobados. | Errores de citas del juez y calidad conversacional siguen visibles. |
| 35 | Conserva tres líneas sin cantidad, pide cantidades y después pago. Registra $23.500 con una unidad de cada referencia. | JSON inválido del juez; tendero no ejecutado en esta repetición. |
| 50 | Yogurt seleccionado una vez. Primer «Sí veci, solo eso» cierra colección; pide pago. Segundo, tras cotización, confirma $2.900. Pedido y tendero comprobados. | El botón Tarjeta guardó `card_terminal`; esto no demuestra corregida la variante de pago por texto que falló en la campaña completa. |

Esta repetición usó 92 solicitudes reales de VIA y 282.846 tokens; actores/juez se cuentan por separado en el informe. Procesamiento p95: 8.339 ms; ACK p95: 3.138 ms, fuera del objetivo. No se extrapola capacidad de producción ni se afirma resuelta la latencia. La huella de la base fuente permaneció igual y hubo cero salidas de red no autorizadas. Hash de fuentes final probado: `6e772cfe9d25fea888c291499c4e38a8cb3f8eb61d504c0075e3688411316494`.

## Límites

No se corrigen silencios de otras rutas, tareas humanas duplicadas, interpretación de unidad frente a paquete ni respuestas a consultas sobre flete en esta intervención. El juez semántico puede fallar o producir citas inválidas: se preserva su resultado, pero la revisión comercial se contrasta con diálogos, canasta, pedidos y ofertas. Un caso con total correcto al final no se declara exitoso si antes duplicó productos.

Una reparación de contrato añade como máximo una llamada de interpretación al turno inválido (12 observadas en la campaña completa). La selección interactiva pasa por razonamiento contextual del resolutor, sin otra interpretación lingüística del botón. La campaña completa registró 575 solicitudes de VIA y 1.721.848 tokens reportados (6 solicitudes sin uso reportado), además de los actores/juez separados. ACK p95: 45 ms; procesamiento p95: 10.768 ms. Estos valores corresponden a la versión de esa campaña, no a la corrección posterior ni a capacidad de producción. La base PostgreSQL fuente quedó sin cambios y no hubo salidas de red no autorizadas.

## Continuación pendiente: consultas comerciales y política de domicilio

Se inició localmente la siguiente corrección de consultas de precio/domicilio y pago por texto. Antes de completarla, el usuario solicitó ampliar el diseño con tarifa y mínimo por tenant y revisar primero el plan. Los cambios parciales de pagos y su prueba de contrato permanecen sin validación final; no constituyen una corrección terminada ni desplegada.

La especificación vigente y su seguimiento están en la [sección 14 del plan](Propuesta-descomposicion-planner-grounding-llm-2026-11-04.md#14-ampliación-revisada-precios-domicilio-mínimo-y-pago-por-texto). Las pruebas anteriores de canasta permanecen como evidencia histórica; la nueva aceptación deberá incluir tarifa, total, mínimo, aislamiento y resolución humana comercial sin perder esas regresiones.
