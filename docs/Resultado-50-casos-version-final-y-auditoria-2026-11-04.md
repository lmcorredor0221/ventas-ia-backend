# 50 casos E2E de la versión final: resultados y auditoría

Fecha: 4 de noviembre de 2026. Alcance autorizado: ejecución y análisis local, DeepSeek real, sin despliegue.

**Continuación y correcciones posteriores:** el diagnóstico causal, los cambios implementados y las nuevas verificaciones están en [Causas y correcciones de la auditoría E2E](Causas-y-correcciones-Pareto-2026-11-04.md). Este archivo conserva los resultados de su campaña original; no representa por sí solo la última versión local.

**Aclaración posterior del usuario sobre pagos:** VIA registra el medio elegido; el domiciliario realiza el cobro/verificación. Si llega una imagen de comprobante, VIA avisa al tendero y acusa recibo, sin acreditar dinero ni imponer aprobación financiera. Los casos 38/48 ejecutados contienen la declaración textual «Ya hice la transferencia y te mando comprobante», **no una imagen adjunta**; el caso 46 usa una foto de producto. Por tanto, la campaña no prueba todavía el nuevo criterio específico de imagen de comprobante. El silencio sigue siendo un fallo real; la expectativa de crear una aprobación de pago debe retirarse del alcance. Véase [plan, §14.12](Propuesta-descomposicion-planner-grounding-llm-2026-11-04.md#1412-aclaración-de-alcance-medio-de-pago-y-aviso-de-comprobante).

## Dictamen

Actualización posterior, sin reescribir esta campaña: se implementó el aviso informativo de comprobantes y se repitieron 38/48 con éxito (2/2). También se añadieron pruebas con imágenes simuladas, DeepSeek real y persistencia PostgreSQL. Detalle en [Implementación de avisos de comprobante](Implementacion-avisos-comprobante-local-2026-11-04.md). El dictamen siguiente describe la versión histórica de los 50, no el estado de esa corrección posterior.

**Se ejecutaron los 50 casos sobre la misma versión final. La campaña no está aprobada para operación autónoma general.** Hay mejoras verificadas en canasta, importes, pago y operación del tendero, pero también defectos conversacionales y del evaluador. No corresponde convertir todos los resultados negativos en errores de VIA, ni aceptar todos los `passed` como conversaciones correctas.

- Se crearon **15 pedidos** en la campaña principal. En los 15 coinciden cantidades, SKU, precios y suma de líneas con el catálogo del fixture; pasaron las comprobaciones de pedido y preferencia de pago.
- Los **15** pasaron tomar → alistar → en camino → aviso capturado al cliente → cierre → nuevo mensaje con nueva conversación. Esto se probó mediante las APIs locales, no mediante clics de navegador.
- No hubo aserciones objetivas P0 fallidas en los casos de la campaña principal. Esto no acredita ausencia absoluta de riesgos ni equivale al rótulo `contractP0Pass` del resumen, que tiene un defecto de agregación explicado abajo.
- Persisten silencios ante comprobantes, duplicación de tareas humanas, afirmaciones de catálogo sin respaldo, consultas convertidas en compra y pérdida de información al redactar/enviar.
- Se revisaron también los 13 casos que el runner aprobó. **Seis contienen defectos que ese resultado no muestra:** 12, 14, 15, 28, 40 y 46. El caso 24 además tiene fricción por reconfirmación; se conserva como observación de experiencia, no como fallo de importes.

## Versión, entorno y trazabilidad

Campaña principal: **16:45:20–16:55:51, Colombia**, duración aproximada 10 min 31 s, cuatro procesos independientes. Cada proceso utilizó una copia local distinta de PostgreSQL y un tenant de prueba. DeepSeek fue real; Meta/Graph y Google fueron simulados. Los webhooks HTTP llevaron firma; las salidas se capturaron en el transporte falso. No se enviaron mensajes reales ni se escribió en Drive productivo.

- Rama de trabajo: `codex/backend-plan-payload-20261020`; HEAD: `9db2c20`. **El HEAD no describe por sí solo la versión:** se incluyeron los cambios locales previos, incluidos archivos nuevos.
- SHA-256 de fuentes `server` registrado por los cuatro runners: `7c3695f2a378dbcf2ee210837f27f1d817c4b92bdd099aad8cb6f3632eaf3902`.
- SHA-256 del inventario ampliado de archivos `server`, `src` y `package.json`: `cf7c405f8cb809f509589358a83bee2962e9b8b786555686eea39c71537fc288`, idéntico antes y después.
- Las cuatro comparaciones de la base de origen antes/después resultaron sin cambios. No hubo migración ni modificación de tablas de desarrollo originales.
- Configuración: `deepseek-chat`, grounding y composer activos, máximo dos rondas de grounding; timeout general 30 s, presupuesto de grounding 15 s. No se habilitó `LLM_SIMULATOR`.
- Catálogo base: 300 referencias, con los productos adicionales definidos por cada escenario. Aceptación contextual `2.1.0`. Los escenarios base declaran tarifa y mínimo cero explícitos.
- En esta ejecución no se modificaron backend, frontend, prompts, fixtures ni evaluador. Se añadieron utilidades ignoradas bajo `test-results/` y esta documentación.

Evidencias:

- [Manifiesto de ejecución y huellas](../test-results/delivery-final50/execution.json).
- [Resumen automático y enlaces a las 50 conversaciones](../test-results/delivery-final50/consolidated.md).
- [Resultados completos en JSON](../test-results/delivery-final50/consolidated.json).
- [Métricas de auditoría: pedidos, tareas, fallbacks y latencias](../test-results/delivery-final50/audit-metrics.json).
- Orquestador local: `test-results/run-final50.mjs`. Reutiliza `server/tests/run-contextual-e2e.mjs`; se niega a sobrescribir una campaña existente. La credencial se carga localmente y no se incorpora al informe.

Los archivos de evidencia bajo `test-results/` son locales e ignorados por Git. Para compartir o versionar resultados habría que exportar una copia sanitizada; este documento no implica que esos artefactos estén en el remoto.

## Resultado automático sin reclasificar

| Estado del runner | Casos | Interpretación |
|---|---:|---|
| `passed` | 13 | Pasaron sus verificaciones automáticas; se auditaron igualmente. |
| `failed_functional` | 17 | Mezcla fallos reales, límites de turnos y latencia del acuse. |
| `needs_review` | 16 | Evidencia del juez inválida, discrepancias o defectos que requieren atribución. |
| `evaluator_error` | 2 | El comprador simulado impidió completar el flujo: 02 y 43. |
| `infra_error` | 1 | Error de conexión en 03. |
| `integration_fallback` | 1 | Error de conexión del planner en 17. |
| **Total** | **50** | **168 turnos registrados del comprador**. |

La campaña anterior tenía 8 aprobados, 21 fallos funcionales, 18 revisiones y 3 errores del evaluador. La actual sí ejecutó las últimas correcciones. El cambio de conteo **no es una mejora porcentual causal demostrada**: comprador, juez y VIA generan diálogos no idénticos; también influyen la conexión y la carga local. La evidencia de productos/importes y estados es más útil que comparar solamente el número de aprobados.

## Revisión uno a uno

La columna de atribución describe el hallazgo principal, no sustituye los resultados originales. Un mismo caso puede tener errores de VIA, del evaluador y rendimiento. Los recibos finales pierden presentación en los 15 pedidos: se explica como problema transversal, sin repetirlo en cada fila.

| Caso | Resultado original | Atribución y evidencia revisada |
|---:|---|---|
| 01 | Revisión | **Evaluador.** Pedido de 3 Chocoramos y 2 Cifrut por $12.000 correcto. Las citas del juez contienen puntos suspensivos que no existen literalmente en la respuesta. |
| 02 | Error evaluador | **Evaluador + rendimiento.** El actor elige una opción incompatible con su acto de confirmación y aborta. VIA había aclarado la cantidad de jugo y conservado el pedido. Acuse de un turno: 3.676 ms. No acredita compra completa. |
| 03 | Infraestructura | **Integración.** `fetch failed` en planner y comprador; no permite juzgar la compra. La repetición diagnóstica independiente pasó, detallada más adelante. |
| 04 | Fallo funcional | **Mixto.** Se guardan dos paquetes de cinco arepas por $13.000; el recibo omite “paquetes de cinco”. El juez además exige pago verificado para efectivo y confunde unidades del pedido con stock disponible. |
| 05 | Aprobado | Consulta de café premium 250 g, $24.500, resuelta sin crear pedido ni tarea. Sin fallo funcional observado. |
| 06 | Revisión | **VIA + evaluador.** Respuesta de café útil, pero se crea una tarea humana por candidato ajeno al conjunto de búsqueda actual. El juez también presenta citas no literales. La respuesta visible oculta el problema operativo. |
| 07 | Fallo funcional | **Evaluador.** Consulta de jugos respondida; el tercer turno resuelve la pregunta. Falla únicamente por agotar tres turnos, sin evaluar si la consulta ya terminó. |
| 08 | Aprobado | Opciones de agua/jugos y precios correctos; no genera pedido ni tarea. Sin fallo funcional observado. |
| 09 | Fallo funcional | **Rendimiento local.** Conversación de mecato resuelta; la única aserción fallida es el acuse de 4.833 ms. No es error de cálculo o interpretación demostrado. |
| 10 | Fallo funcional | **VIA + evaluador.** Respuesta interactiva cortada exactamente a 1.024 caracteres, termina en “$ ”; el cliente debe pedir el precio faltante. Declara aceite Premier “mezcla” sin atributo que lo respalde. El runner solo detecta agotamiento de turnos. |
| 11 | Fallo funcional | **VIA + evaluador.** Acepta la sugerencia del comprador de que Rey/Varela son de baño y afirma no tener jabón para ropa. El catálogo sí tiene categoría hogar y alias “jabón ropa” para Varela. El juez llama correcta esa afirmación; también falta información real de doble hoja, que no debe inventarse. |
| 12 | Aprobado | **VIA; falso negativo del evaluador.** Opciones de onces correctas, pero “solo consulta, no voy a pedir” dispara búsqueda y una tarea humana innecesaria. |
| 13 | Revisión | **VIA + evaluador + rendimiento.** Jamón/queso/pan: composer rechazado por longitud, fallback publica solo seis precios y omite pan; cliente debe reclamarlo. Despedida crea tarea. El juez cita un mensaje del comprador como evidencia de salida. Acuse 3.198 ms. |
| 14 | Aprobado | **VIA; falso negativo.** Atribuye composición de avellana a Nucita sin respaldo del catálogo y crea tarea al despedirse. El juez lo trata como observación P2 y aprueba. |
| 15 | Aprobado | **VIA; falso negativo.** Consulta de desayuno respondida, pero al cerrar la consulta crea tarea humana por búsqueda sin necesidad vigente. |
| 16 | Revisión | **Contrato de aceptación/experiencia.** Primero usa lenguaje que sugiere bebida fría; después aclara que no conoce refrigeración y crea tarea. El juez exige resolver un atributo no documentado y el runner agota turnos. No puede certificarse temperatura ni exigir inventarla; falta medir correctamente el cierre mediante handoff. |
| 17 | Fallback integración | **Integración + VIA.** `fetch failed` inicial y dos tareas humanas para la misma necesidad. Al repetir sin el fallo de conexión aparece otro defecto: afirma catálogo vacío ante presupuesto de $5.000 aunque hay productos adecuados. |
| 18 | Revisión | **VIA + evaluador.** Al comparar gaseosas pequeñas, grounding inválido y fallback contestan solo tarifa/mínimo, perdiendo la pregunta. Se duplican tareas. Parte de las objeciones del juez usa bebidas que no pertenecen a la categoría solicitada y citas no literales. |
| 19 | Revisión | **VIA + evaluador.** Leche entera en bolsa bien ofrecida; cierre genera tarea innecesaria. Las citas de precios del juez no son literales. |
| 20 | Fallo funcional | **Evaluador.** Papel y precio correctos; reconoce que no consta doble hoja. El comprador repite la pregunta y el runner falla por tres turnos. No existe evidencia para exigir ese atributo. |
| 21 | Fallo funcional | **Evaluador.** Ofrece Rey/Varela para ropa y no inventa composición desconocida. Repetición del comprador y límite de tres turnos; no se demuestra defecto funcional. |
| 22 | Fallo funcional | **Rendimiento local.** Arroz/aceite/leche por $16.500, selección, cantidades, efectivo y pedido correctos. Solo falla acuse de 4.028 ms. |
| 23 | Revisión | **Evaluador + rendimiento; experiencia menor.** Papel y dos jabones, $17.000 correctos. Citas reconstruidas, acuse de 4.134 ms y etiquetas verbosas “Importe de línea”. |
| 24 | Aprobado | Pedido yogurt/galletas $9.700 correcto. **Fricción VIA:** tras responder costo de envío solicita aceptación dos veces. El escenario se llama “sin domicilio”, pero el comprador pide domicilio; no sirve como prueba efectiva de retiro. |
| 25 | Aprobado | Distingue shampoo sachet 18 ml, acondicionador y botella; respeta consulta sin compra. Sin fallo funcional observado. |
| 26 | Revisión | **VIA.** Consulta Chocoramo bien resuelta inicialmente, pero “gracias, con eso es todo” se convierte en pedido vacío: “Cuéntame qué productos quieres pedir. Subtotal parcial… $0”. Dos fallbacks del composer. |
| 27 | Fallo funcional | **VIA.** Ante lácteo pequeño para lonchera afirma que no hay yogurt, aunque el catálogo tiene Alpina 150 g con stock. La consulta combinada y la evidencia incompleta no justifican afirmar ausencia. |
| 28 | Aprobado | **VIA; falso negativo.** Salmón ausente bien reconocido, pero pedir asesor después crea segunda tarea con otro título. La comprobación por título no detecta la duplicación semántica. |
| 29 | Fallo funcional | **Evaluador principalmente.** Actor confirma repetidamente sin aportar nombre/dirección/pago; VIA los solicita correctamente. Finalmente guarda Coca-Cola original 1,5 L por $7.200. El juez penaliza repetición y exige acreditación de efectivo improcedente. |
| 30 | Aprobado | “Dale, hágale” interpretado según pendientes; agua 600 ml, $2.200, pago y confirmación correctos. Sin fallo funcional observado en ese flujo. |
| 31 | Aprobado | Distingue tintico preparado de café empacado; cambia a comparación de café molido y precios. Sin inventar bebida preparada ni crear pedido. |
| 32 | Revisión | **Evaluador.** Pedido $23.500 correcto. Atribuye el aceite familiar 1 L de $15.200 a SKU inexistente `BOG-BAS-032`; el SKU real ofrecido es `COL-179`. No es precio inventado por VIA. |
| 33 | Revisión | **Evaluador + rendimiento.** “chocramos”, “cifru granadila” reconocidos; elige presentación y conserva 2 + 1, total $7.400. Citas no literales, actor confirma antes de elegir pago y acuse de 3.597 ms. |
| 34 | Revisión | **Evaluador + rendimiento.** Pide cantidades, conserva uno de cada producto y total $5.000. El juez critica preguntar pago antes de cerrar y repetirlo cuando el actor no lo contestó; no es un fallo de VIA. Acuse 1.856 ms y citas no literales. |
| 35 | Revisión | **Evaluador; revisar modo de entrega.** Cantidades, referencias y $23.500 correctos; citas reconstruidas. El borrador conserva `delivery=false` y el recibo genérico habla de entrega: no prueba un flujo de retiro coherente. |
| 36 | Fallo funcional | **Evaluador.** Consulta de leche/queso resuelta hasta la evidencia disponible; no inventa composición. El comprador repite y se agotan tres turnos. |
| 37 | Fallo funcional | **VIA.** Dos aprobaciones de descuento por la misma solicitud y contexto estructurado vacío; la segunda respuesta repite una plantilla sin informar progreso. No se concedió descuento sin autorización. |
| 38 | Fallo funcional | **VIA + formato de evidencia del evaluador.** “Ya hice la transferencia…” crea aprobación pero no envía respuesta. Snapshot vacío. El juez señala correctamente el silencio aunque cita la entrada como si fuese salida. |
| 39 | Fallo funcional | **VIA.** Solicitar humano y luego agradecer crea dos tareas idénticas. La petición inicial sí se reconoce. |
| 40 | Aprobado | Pedido Pan Bimbo $7.600, Bre-B y operación correctos. **VIA/evaluador:** hay fallback de composer por `confirmation_breakdown_missing`, invisible para el estado aprobado. No equivale a composición LLM aceptada en todos los turnos. |
| 41 | Aprobado | Saludo/apertura atendido por Rocío sin inventar productos ni compra. Sin fallo funcional observado. |
| 42 | Revisión | **VIA + evaluador.** Tres Chocoramos, $8.400 y preferencia tarjeta correctos; promete que el domiciliario lleva datáfono sin configuración operativa que lo acredite. Juez exige pago recibido y usa citas inválidas. |
| 43 | Error evaluador | **Evaluador.** Retira agua, conserva dos Chocoramos por $5.600. El comprador termina antes de confirmar el pedido, sin handoff; no corresponde culpar a VIA por no registrar una compra no aceptada. |
| 44 | Revisión | **Evaluador.** Conserva pan y agrega queso; total $17.400 correcto, sin duplicación. La objeción son citas con puntos suspensivos. |
| 45 | Fallo funcional | **Contrato comercial + VIA.** Interpreta $5.000 como presupuesto, no como 5.000 unidades, pero acepta una porción cuyo contrato de venta por peso/valor no está acreditado. Fixture agrega “porcion al peso” a $5.000 y exige humano, sin explicitar regla de venta. No se debe dar aprobado ni atribuirlo solo al juez. |
| 46 | Aprobado | Adjunto conservado y escalamiento inicial correcto. **VIA; falso negativo:** agradecer después crea otra tarea con distinto título; el evaluador no lo detecta. |
| 47 | Fallo funcional | **VIA.** Reclamo por faltante correctamente distinguido de compra, pero dos tareas para la misma necesidad. |
| 48 | Fallo funcional | **VIA + formato del evaluador.** Comprobante genera aprobación con snapshot vacío y ninguna respuesta al comprador. No se acredita pago falsamente, pero el cliente queda sin atención. |
| 49 | Revisión | **Mixto.** Conserva tres Chocoramos y mora pendiente, sin sustitución ni pedido prematuro; sí hay dos tareas. Subtotal $0 inicial induce confusión y luego $8.400 es solo parcial. El juez dice que no hubo handoff aunque hay dos y contradice la tarifa cero del fixture. |
| 50 | Revisión | **VIA + evaluador.** La misma frase “Sí veci, solo eso” termina la recolección y luego acepta la cotización según contexto; pedido $2.900 correcto. VIA asume datáfono; juez exige innecesariamente frase literal “Confirmar pedido” y cita entrada como salida. |

Cada ID se corresponde con el enlace individual del [índice de 50 casos](../test-results/delivery-final50/consolidated.md). Se conservaron conversaciones, decisiones, eventos, tareas y snapshots; la auditoría no reescribió sus resultados.

## Fallos de VIA y causa contrastada con el repositorio

### 1. Silencio ante pago y duplicación de atención humana — prioridad alta

Casos 38/48: [agentRuntime.js](../server/services/agentRuntime.js), rama `payment_confirmation` alrededor de línea 326, invoca `approval_gate` y retorna sin `sendCustomerMessage`. Es una causa directa del silencio, no lentitud ni expiración de un token de Meta.

Casos 17/18/28/37/39/46/47/49: [toolRegistry.js](../server/services/toolRegistry.js), `approvalGate` y `humanHandoff`, crean UUID e insertan una tarea nueva sin comprobar una solicitud abierta equivalente. `approvalGate` tampoco conserva el contexto estructurado que sí guarda `humanHandoff`. La deduplicación de revisión comercial de domicilio implementada anteriormente no cubre estas tareas genéricas.

Propuesta: el LLM sigue identificando la necesidad y si se actualiza, cambia o resuelve. La ejecución debe actualizar una tarea vigente por identidad estable de la necesidad y conservar contexto/adjuntos; crear una segunda tarea requiere una necesidad nueva. Idempotencia y persistencia son garantías técnicas, no un sustituto por palabras clave de la decisión conversacional. Conforme al alcance aclarado, una declaración de pago recibe respuesta contextual; una imagen de comprobante genera aviso informativo al tendero y acuse de recepción. No se debe acreditar dinero, abrir una aprobación financiera ni bloquear automáticamente el pedido.

### 2. Despedidas y consultas enviadas a búsqueda sin necesidad vigente — prioridad alta

Casos 12/13/14/15/19 y 26. [agentRuntime.js](../server/services/agentRuntime.js), `handleGroundedCatalogQuery` alrededor de 573, fabrica un elemento de búsqueda con todo el mensaje si el plan no trae productos. Una despedida puede convertirse así en búsqueda de catálogo; el rechazo acaba creando una tarea aunque el mensaje al cliente diga adiós. En 26 se interpreta `order_clarification` con canasta vacía, y el fallback pide productos y muestra $0.

Propuesta: conservar el acto contextual de respuesta/despedida/consulta como salida del intérprete y la necesidad pendiente. No generar una búsqueda artificial solo por no encontrar líneas de pedido; el LLM debe indicar si hay una pregunta que requiere catálogo, una continuación sin búsqueda o un cierre. El composer debe conocer esa decisión y la evidencia relevante del turno anterior.

### 3. Recuperación parcial y afirmaciones no respaldadas — prioridad alta

Casos 11/27 y repetición 17: se afirma ausencia de productos existentes. En 10/14/42/50 se agregan atributos o promesas operativas no documentados.

- [conversationGroundingCoordinator.js](../server/services/conversationGroundingCoordinator.js) toma hasta ocho filas por consulta, dieciséis en la unión y dos rondas. El agente recibe nombre, descripción, presentación, aliases, atributos, precio, stock y score. **No se perdió por completo el contrato de atributos.**
- [groundingContracts.js](../server/domain/groundingContracts.js), `groundingQueries`, prioriza hipótesis y texto original antes de variantes propuestas y corta a dos consultas. Una consulta amplia puede devolver evidencia insuficiente o ninguna fila; eso no prueba inexistencia en todo el catálogo.
- La búsqueda en [toolRegistry.js](../server/services/toolRegistry.js), `rankRowsByQuery`, sigue siendo recuperación textual ponderada. La selección contextual la hace el LLM, pero necesita observaciones útiles y capacidad de reformular.
- `unknown_or_foreign_candidate` agrupa un SKU que no está entre los candidatos actuales con uno de otro tenant. **Estos eventos no prueban una fuga multitenant.** Hay ejemplos de productos recordados desde turnos previos, pero ausentes de la nueva observación.
- En 11 el catálogo contiene `COL-248`, alias `jabon ropa`, y `BOG-ASE-083`, familia `aseo_hogar`. En 27 contiene `BOG-LAC-004`, yogurt 150 g con stock. En 14 no acredita avellanas para Nucita. En 10 no acredita “mezcla” para `COL-179`.

Propuesta: mejorar la consulta y la evidencia de cobertura, dejar que el resolutor reformule dentro de su presupuesto y distinguir “no apareció en esta búsqueda” de “no disponible”. Ante atributos ausentes, el LLM debe expresar incertidumbre o solicitar validación humana contextual; no asentir a una premisa falsa del comprador. Medio de pago tarjeta no acredita disponer de datáfono en el domicilio. No corregir esto con listas rígidas de modismos o marcas.

### 4. Redacción validada que se deteriora después — prioridad alta/media

Caso 10: el composer acepta hasta 1.200 caracteres, pero los mensajes interactivos de [agentRuntime.js](../server/services/agentRuntime.js), alrededor de 1692/1733/1764, hacen `slice(0, 1_024)`. La respuesta observada tiene exactamente 1.024 y termina en un precio incompleto. La validación previa no garantiza integridad del mensaje finalmente enviado.

Caso 13: [llmReplyComposer.js](../server/services/llmReplyComposer.js) rechaza por longitud y su fallback limita precios a seis; pierde pan de una consulta por jamón, queso y pan. Casos 18/26: fallback seguro en importes, pero no contesta la pregunta. Caso 40: rechazo del desglose genera fallback aun cuando el pedido posteriormente es correcto.

Hubo **cinco eventos de fallback del composer en cuatro casos: 13, 18, 26 y 40**. No confundirlos con el evento `fallback.activated`, que se usa para registrar handoff. Hubo además dos fallbacks del planner por conexión, 03/17.

Propuesta: adaptar la composición al límite real del transporte, validar también el payload final y preservar todas las necesidades al dividir una respuesta. Revisión/recomposición LLM acotada cuando se rechaza el borrador; si se usa fallback por indisponibilidad, debe registrarse como degradación y mantener preguntas pendientes. No relajar validaciones de importes para ocultarlo.

### 5. Recibo final y modalidad de entrega — prioridad media

[agentRuntime.js](../server/services/agentRuntime.js), línea 1044 y `formatOrderItems` alrededor de 3195, usa una plantilla y nombres sin presentación. Los 15 pedidos correctos pierden peso/volumen/empaque en ese recibo; en arepas puede leerse como dos unidades en vez de dos paquetes de cinco. Los SKU y las cantidades en el pedido siguen correctos. La plantilla también habla siempre de entrega, incluso con `delivery=false` en 35.

Propuesta: conservar la presentación y modalidad aprobadas en el snapshot y entregarlas al componente de composición. La respuesta de registro debe estar respaldada por el commit y mantener importe, pago y referencia. La variante de retiro necesita una prueba que el comprador no convierta después a domicilio. Caso 24 también muestra una reconfirmación adicional tras consulta de envío: revisar la alineación entre aceptación contextual y oferta vigente, sin eliminar el control de consentimiento.

### 6. Venta por presupuesto — contrato pendiente

Caso 45: el cálculo permite `budgetAmount` como importe de línea resuelta, pero el fixture no acredita cómo se vende la porción. El objetivo pide escalar y el catálogo adicional parece ofrecer una porción exacta de $5.000. Hay que definir unidad de venta, posibilidad de venta por valor y precio base confiable. Con ese contrato, el LLM decide si encontró una opción válida o necesita consultar a la tienda; el backend impide confirmar una línea sin respaldo comercial. No debe fijarse que toda mención de pesos escale ni aceptar automáticamente cualquier presupuesto.

## Defectos del evaluador y correcciones propuestas

No se implementaron en esta ejecución.

| Problema | Evidencia | Corrección que necesita el evaluador |
|---|---|---|
| Citas reconstruidas con “…” | 01/06/19/23/33/34/35/44, entre otros | Extraer fragmentos literales contiguos e identificar mensaje/rol. Una cita inválida es error del juez, no prueba de respuesta incorrecta. |
| SKU equivocado | 32 | Validar identidad contra el catálogo antes de atribuir discrepancia monetaria; `COL-179` no es `BOG-BAS-032`. |
| Confundir preferencia con pago acreditado | 04/29/42 | VIA no verifica pagos ni exige acreditación para confirmar/despachar. Debe distinguir medio elegido y comprobante recibido; avisar al tendero no equivale a afirmar dinero recibido. |
| Fin por presupuesto de turnos | 07/20/21/36; también afecta otros casos | Evaluar éxito informativo o handoff antes de declarar fallo; usar límite como protección de ejecución, no como prueba suficiente de incapacidad. |
| Comprador inconsistente | 02/29/33/34/43 | Responder preguntas pendientes; validar opción/acto; distinguir término de consulta de abandono prematuro de compra. Preservar errores del actor aparte. |
| Unicidad por título | 28/46 | Evaluar misma necesidad e identidad de tarea, aunque el título cambie; exigir cero tareas en despedidas sin pendiente. |
| Composer degradado no cambia estado | 40 | Medir comprensión, composición aceptada, fallback y transacción por separado. Hoy el clasificador reconoce `llm.plan.fallback`, pero no `llm.reply.fallback`. |
| `contractP0Pass` agrupa todos los fallos | Todos los grupos | En `e2e-local-deepseek-40.mjs` alrededor de 913–929 se usa toda aserción fallida, no solo P0. Separar integridad, función, revisión, infraestructura y rendimiento. |
| Aprobaciones semánticas falsas | 11/14/28/46 | Confrontar atributos, tareas y evidencia, además del juicio sobre el texto. El juez no constituye verdad absoluta. |
| Fixture poco explícito | 16/20/21/36/45 | Declarar atributos desconocidos y contrato de venta. Desconocido no debe evaluarse como una respuesta que obliga al agente a inventar. |

Además, `functionalThreshold` espera 50 aprobados dentro de cada ejecución, aunque se seleccionó un subconjunto de 12/13. Ese indicador por batch no permite calcular aceptación de la campaña dividida. Y el runner fija `readyForPilot=false` mientras no haya repeticiones y variantes de concurrencia. Se conservan estos indicadores; no se utilizan para inventar fallos de seguridad ni para afirmar que el piloto está certificado.

## Repetición diagnóstica de conexión, separada de los 50

Se repitieron **solo 03 y 17**, una vez, secuencialmente en una nueva copia local, sin cambios de código ni del evaluador. No reemplazan los resultados originales ni se suman como 52 escenarios diferentes.

- **03 pasó** en cinco turnos: dos paquetes de cinco arepas, $13.000, nombre/dirección/pago, aceptación y operación del tendero. Sin fallback. Conserva la observación transversal del recibo sin presentación.
- **17 volvió a fallar, esta vez por VIA y sin error de conexión:** respondió “no tengo productos disponibles” ante $5.000, aunque existen múltiples referencias dentro del presupuesto. Así se separa la incidencia de red original de un defecto semántico reproducido bajo conexión funcional.
- Ambas ejecuciones conservaron fuentes y base original sin cambios. No se afirma que la causa de `fetch failed` sea DeepSeek, DNS, TLS o el sistema local: la traza disponible no permite distinguirlo.

[Evidencia diagnóstica](../test-results/delivery-final50-network-diagnostic/batch-3-17/20261104215620_6fd82685/summary.md), [manifiesto](../test-results/delivery-final50-network-diagnostic/execution.json).

## Rendimiento y consumo de la campaña principal

| Medida | Valor |
|---|---:|
| Turnos de comprador registrados | 168 |
| Acuse webhook p50 / p95 | 14 / 41 ms |
| Recepción → primera salida capturada p50 / p95 | 6.586 / 10.354 ms |
| Máximo recepción → primera salida capturada | 12.582 ms |
| Procesamiento observado por runner p50 / p95 | 6.627 / 10.396 ms |
| Duración p95 por llamada planner / grounding / composer | 3.095 / 2.661 / 2.286 ms |
| Acuses superiores a 1 segundo | 7 de 168; máximo 4.833 ms |

Los siete acuses son 02-T4, 09-T2, 13-T2, 22-T2, 23-T4, 33-T6 y 34-T6. El p95 agregado oculta estos eventos poco frecuentes; el primer batch sí falla su p95 individual. No se descartan como errores del evaluador. Falta aislar contención de PostgreSQL, proceso local y carga del harness para determinar la causa. Cuatro campañas concurrentes no equivalen a una prueba de carga controlada de cuatro usuarios en producción.

La métrica de respuesta excluye los dos turnos sin salida, 38/48; **el silencio no tiene latencia cero**. La medición no prueba el tiempo real de entrega de WhatsApp ni explica por sí sola la demora histórica de tres minutos en producción. El p95 de procesamiento supera ligeramente el objetivo local de 10 s.

| Rol consumidor de DeepSeek | Solicitudes | Entrada | Salida | Tokens reportados |
|---|---:|---:|---:|---:|
| VIA | 466 | 1.715.416 | 109.727 | 1.825.143 |
| Comprador simulado | 118 | 213.097 | 19.947 | 233.044 |
| Juez | 48 | 2.830.693 | 57.968 | 2.888.661 |

Dos llamadas de VIA y una del comprador no reportan uso por fallos. No se cuentan como consumo cero confirmado. El uso de comprador/juez corresponde a evaluación, no al costo operativo de atender clientes. La repetición diagnóstica tiene su resumen separado y no está incluida en esta tabla.

## Cobertura, siguientes pasos y seguimiento

Esta campaña confirma la ejecución con la versión final y complementa las **15 conversaciones focalizadas** y **36 comprobaciones PostgreSQL** anteriores. Los 50 escenarios generales usan tarifa/mínimo cero: no sustituyen las pruebas específicas de tarifa positiva, mínimo insuficiente, excepción humana y aislamiento de políticas descritas en el [informe de implementación](Implementacion-domicilio-precios-pago-local-2026-11-04.md).

Orden recomendado de corrección, pendiente de implementación:

1. Acuse de comprobante y aviso informativo único al tendero con contexto/adjunto, sin circuito de aprobación financiera; verificar también continuidad después de “gracias”.
2. Conservar actos de consulta/despedida y preguntas pendientes; no fabricar búsqueda o canasta sin necesidad interpretada por el LLM.
3. Reparar evidencia de búsqueda y atributos: 11/17/27, negativa de catálogo, composición y promesas operativas; refinamiento contextual acotado.
4. Alinear límite de composición/transporte, fallback completo, presentación del recibo y modo de entrega.
5. Corregir el evaluador con las evidencias ya congeladas: citas, SKU, pago, tareas, terminalidad y agregación. Mantener controles de integridad y consentimiento.
6. Repetir focalizados afectados y después los 50, en una versión congelada, con tres variantes críticas y concurrencia conversacional específica. Comparar estados e importes además del porcentaje automático.

Se mantiene la separación intérprete → búsqueda/resolutor → composición. El LLM interpreta intención y siguiente acción; identidad, precios, stock, consentimiento, idempotencia y restricciones comerciales se validan como límites técnicos. **No se añadieron heurísticas por palabras clave ni se cambió la interpretación contextual para conseguir aprobados.** Tampoco se afirma que todas las respuestas actuales sean generadas por LLM: siguen existiendo recibos/avisos plantillados y los fallbacks documentados.

Estado al cierre: **ejecución y auditoría completadas; correcciones identificadas pendientes; sin commit, push ni despliegue en esta tarea.**

## Seguimiento posterior

Este informe conserva el resultado histórico. El [análisis de Pareto y las correcciones locales](Pareto-y-correccion-incidencias-50-casos-2026-11-04.md) documentan la priorización, la nueva campaña de 50 casos y las repeticiones focalizadas. El [detalle comparativo de los 50](Detalle-repeticion-Pareto-50-casos-2026-11-04.md) distingue fallos de VIA, rendimiento, comprador y juez; no reemplaza retrospectivamente los resultados de esta campaña.
