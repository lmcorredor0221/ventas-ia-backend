# Continuidad de la canasta al aclarar o retirar productos

Fecha: 11 de noviembre de 2026 (Colombia). Estado: implementado y validado localmente; sin commit, push ni despliegue.

## Alcance y línea de comparación

Corrección aprobada después del diagnóstico de la simulación de huevos, Cifrut, brownie Mamai y Chocoramo. Se conservaron los cambios locales anteriores y la simulación detenida. La comparación de esta intervención utiliza una copia de los cuatro archivos antes de modificarlos, no únicamente `HEAD` (`563608f`), porque el árbol de trabajo ya tenía cambios pendientes.

No se modificaron el catálogo, la búsqueda semántica/grafo, las reglas comerciales, las integraciones ni la interfaz. Los cuatro archivos funcionales intervenidos son `agentRuntime.js`, `llmPlanner.js`, `catalogResolutionService.js` y `catalogSemanticGuide.js`. Se añadieron dos pruebas específicas.

## Hipótesis contrastadas y causas

| Hipótesis | Resultado observado y causa |
|---|---|
| Retirar un producto borra toda la canasta | No se confirmó un borrado total. Se conservaban líneas, pero volvían a enviarse a búsqueda/adjudicación y podían perder su estado seleccionado. Esto producía el efecto de reconstrucción del pedido. |
| Una aclaración se convierte en una nueva solicitud | El emparejamiento dependía de SKU/texto y no priorizaba `lineId`. Cambiar la redacción podía romper la asociación con la línea pendiente. Además, una respuesta parcial del modelo podía omitir otras líneas. |
| Se ignora lo que ya se había resuelto | `handleOrderClarification` derivaba a `handleDeliveryOrder` cuando quedaba cualquier pendiente; la búsqueda y adjudicación abarcaban también líneas ya seleccionadas. |
| Los pendientes desaparecen al retirar la línea | No siempre: quedaban claves `product:...` con la redacción anterior y revisiones manuales del producto retirado. |
| El ciclo de aclaración termina tras los intentos previstos | El contador dependía del texto de la consulta y del conjunto completo de pendientes. Reformular el mismo brownie podía reiniciarlo. |
| Basta con corregir el retiro para terminar el pedido | La primera prueba completa con DeepSeek descubrió otro fallo: `handleOrderConfirmation` consideraba la línea retirada, sin precio, como una cotización incompleta y volvía a buscar los cuatro productos activos. |

La prueba controlada reprodujo ese último fallo antes de corregirlo: confirmar produjo búsquedas de huevos, granadilla, naranja y Chocoramo, cuando debían ser cero. La repetición con DeepSeek perdió las selecciones en ese mismo punto. El informe previo quedó conservado en `test-results/basket-line-mutations-live-before-confirmation-fix.json`.

Las decisiones sin respuesta cruda del proveedor en la simulación antigua no se atribuyen retroactivamente al LLM. La causalidad se sustenta en el código, los estados guardados y las reproducciones locales; no se hizo una auditoría nueva de producción.

## Corrección aplicada

| Archivo / componente | Cambio focalizado |
|---|---|
| `server/prompts/catalogSemanticGuide.js` | El LLM contextual identifica operaciones `update`, `clarify`, `replace`, `remove` sobre un `lineId` existente. La inferencia de productos emite las líneas afectadas y nuevas. No equipara aceptar un pedido parcial con retirar su faltante. |
| `server/services/llmPlanner.js` — normalización y combinación de `lineUpdates` | Conserva las operaciones sin cantidad, combina los resultados de contexto e inferencia y evita perder una retirada identificada por el intérprete. Cuando el contexto identifica únicamente retiros y ninguna nueva solicitud de productos, no solicita inferencia de productos. |
| `server/services/agentRuntime.js` — `restoreClarificationDraft` / `applyStructuredLineUpdates` | Prioriza el identificador de línea; conserva las líneas omitidas en un delta del modelo; diferencia aclarar, reemplazar, actualizar y retirar. Las acciones interactivas con una canasta completa mantienen su contrato existente. |
| `agentRuntime.js` — `handleDeliveryOrder` | Busca únicamente las líneas afectadas o pendientes del turno. Las selecciones ya guardadas que no cambiaron conservan sus productos, cantidades y precios. Las líneas retiradas no se consultan. |
| `server/services/catalogResolutionService.js` | La adjudicación recibe como tareas únicamente líneas sin resolver. Puede ver el borrador como contexto, pero no reabre una selección ya resuelta ni una retirada. |
| `agentRuntime.js` — `reconcileLineResolutionGaps` | Reconcilia los pendientes por identidad de línea, incluso cuando cambia la consulta. Elimina pendientes de líneas retiradas o ya seleccionadas, sin eliminar requisitos globales de checkout. |
| `agentRuntime.js` — `deriveClarificationState` | Conserva intentos por línea (`attemptsByLineId`). Reformular una consulta no reinicia el ciclo; aclarar una línea no consume intentos de otra; sustituir realmente el producto inicia su nuevo ciclo. Sigue leyendo el estado anterior de versión 1. |
| `agentRuntime.js` — cierre de aclaración / revisión manual | Cierra el estado de aclaración cuando no quedan pendientes. Una retirada explícita elimina su revisión manual residual; aceptar un pedido parcial conserva la revisión manual del faltante. |
| `agentRuntime.js` — `handleOrderConfirmation` | Valida cotización, registra pedido y cuenta líneas utilizando solo productos activos. El retirado sigue en el borrador para trazabilidad, pero no se cotiza ni se escribe en el pedido. |

La interpretación sigue a cargo de DeepSeek. No se añadieron palabras clave para decidir que “deja así” significa eliminar, confirmar o cancelar. Tampoco se añadió un botón obligatorio de aclaración: la identidad del producto pendiente y el contexto permiten asociar la respuesta con su línea. Los controles determinísticos aplicados son de integridad del estado, no de interpretación del lenguaje.

## Pruebas y resultados

### Regresión controlada

`server/tests/basket-line-mutations.mjs` utiliza almacenamiento temporal, catálogo controlado y entrega WhatsApp simulada. Verifica:

- Retirar L4 conserva los cuatro SKU, cantidades 1/3/2/3 y subtotal de $50.400.
- Una aclaración con nueva redacción busca solamente L4 y no lo duplica.
- Los intentos de L4 continúan; los de otro pendiente L6 permanecen intactos.
- Reemplazar L2 no recupera su SKU anterior ni modifica L1.
- La retirada posterior al agotamiento de aclaraciones limpia la revisión manual y cierra el estado.
- La canasta avanza por revisión, pago y confirmación; se registra un pedido de cuatro líneas, sin volver a buscar las selecciones.

Resultado: aprobado.

### DeepSeek real, aplicación local

`server/tests/basket-line-mutations-live.mjs` ejecuta `runtime.processInbound` y las ofertas interactivas reales de VIA. Utiliza `deepseek-chat`, catálogo local de 2.000 productos, almacenamiento JSON temporal y adaptadores Google/WhatsApp en modo mock. No envía WhatsApp ni escribe en producción o Drive.

Se reconstruyó un punto de control anonimizado con cuatro referencias previamente seleccionadas y el brownie pendiente; no se certificó nuevamente la elección inicial de esas cuatro referencias. En particular, el SKU de huevos guardado en la simulación corresponde a AA aunque el mensaje original pedía AAA: esta intervención preserva esa selección histórica y no valida su adecuación comercial.

| Entrada | Resultado real capturado | Búsquedas de catálogo | Duración local |
|---|---|---:|---:|
| “brownie de arequipe de marca Mamai” | DeepSeek emite `clarify` para L4; pregunta por el brownie; conserva las cuatro selecciones | 1 (brownie) | 7,907 s |
| “entonces el brownie ya no” | DeepSeek emite `remove` para L4; canasta de $50.400; ofrece continuar/agregar/hablar | 0 | 4,244 s |
| Continuar pedido | Solicita nombre | 0 | 0,639 s |
| Nombre sintético del cliente | Solicita dirección | 0 | 2,768 s |
| Dirección sintética | Ofrece Efectivo / Tarjeta / Bre-B | 0 | 3,558 s |
| Efectivo | Resumen y Confirmar / Ajustar / Hablar con la tienda | 0 | 2,269 s |
| Confirmar pedido | Pedido registrado con cuatro líneas y $50.400; tarea de preparación | 0 | 2,547 s |

Resultado: aprobado. Evidencia capturada, sin reescribir las respuestas: `test-results/basket-line-mutations-live.json`.

Consumo observado del recorrido aprobado: **23.513 tokens de entrada y 1.709 de salida**. La corrida anterior, que detectó el fallo de confirmación, consumió 25.756 de entrada y 1.591 de salida. Total de ambas corridas de esta intervención: **49.269 de entrada y 3.300 de salida**. Se suman los eventos agregados del planner y las respuestas; no se duplican sus métricas por etapa. Las duraciones son de esta ejecución local, no una garantía de latencia en producción.

Las ofertas interactivas pasan por el manejador de VIA; no implican una nueva interpretación del LLM en cada clic. El campo `plan` del informe refleja el último `reasoningPlan` persistido y puede corresponder al turno textual anterior cuando la entrada es interactiva. El consumo efectivo está en `providerCalls`.

### Regresiones existentes

Aprobadas después del ajuste: **30 scripts de regresión bajo Node 24.22.1**, incluyendo la nueva prueba y los siguientes grupos:

- `npm run test:catalog` (17 scripts): búsqueda, ambigüedades, importación, enriquecimiento, grafos, fuente PostgreSQL mediante contratos de prueba, sincronización, cantidades, modalidades de venta, paginación y vocabulario.
- `npm run test:checkout` (5 scripts): revisión, pago, captura de datos, confirmación, interpretación, aclaraciones y precios variables.
- `removed-catalog-line-continuity`, `clarification-selected-basket-continuity`, `handoff-product-gap-continuity`, `partial-order-manual-review`, `manual-product-review-order`.
- `llm-provider` y `llm-json-recovery`.
- `git diff --check` sin errores de espacios.

**Limitación conocida:** `npm run test:backend` se detiene en `backend-smoke.mjs:371`, que exige `payment_method` dentro de `missingFields` durante la fase de revisión de canasta. Se reprodujo exactamente la misma aserción en una copia aislada restaurando los cuatro archivos previos a esta intervención, tanto bajo Node 25.7.0 como bajo Node 24.22.1. Evidencia comparativa: `test-results/basket-baseline-smoke-comparison.json`. Por tanto, no se atribuye a esta corrección ni se cambia esa expectativa fuera de alcance. La suite global no queda certificada.

La prueba con DeepSeek real corrió con Node 25.7.0 local. Como `package.json` declara `>=24.22.1 <25`, se repitieron los 30 scripts de regresión con Node 24.22.1 mediante `npm exec --package=node@24.22.1`, sin cambiar la instalación de Node del equipo ni las dependencias del proyecto. No se ejecutaron migraciones ni una prueba de persistencia sobre PostgreSQL real en esta intervención.

## Seguimiento

- [x] Conservar copia anterior y modificaciones preexistentes.
- [x] Reproducir fallos de retiro, aclaración y confirmación.
- [x] Aplicar operaciones sobre una línea e impedir la reapertura de selecciones ajenas.
- [x] Limpiar pendientes y revisión manual de líneas retiradas.
- [x] Probar pedido parcial con revisión manual independiente del retiro explícito.
- [x] Ejecutar recorrido local con DeepSeek real hasta pedido confirmado.
- [x] Ejecutar regresiones y documentar el fallo global preexistente.
- [x] Repetir las regresiones bajo Node 24.22.1, conforme a la versión declarada.
- [ ] Commit, push y despliegue: no realizados en esta intervención.

Comandos reproducibles:

```powershell
node server/tests/basket-line-mutations.mjs
node server/tests/partial-order-manual-review.mjs
npm run test:checkout
npm run test:catalog
# Solo con DEEPSEEK_API_KEY suministrada de forma segura en el entorno local:
node server/tests/basket-line-mutations-live.mjs
```

No debe importarse el archivo completo de estado del simulador antiguo: contiene datos y configuración que no son necesarios para esta regresión. La prueba real reconstruye únicamente los mensajes relevantes, los SKU, cantidades y estados, con datos de cliente sintéticos.
