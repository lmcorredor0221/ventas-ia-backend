# Causas y correcciones de la auditoría E2E

Fecha local: 4 de noviembre de 2026. Continuación de [la auditoría Pareto](Pareto-y-correccion-incidencias-50-casos-2026-11-04.md).

## Estado consolidado de esta intervención

Se corrigieron causas reproducidas de duplicación de productos, pérdida de modalidad de entrega y de solicitudes tras un timeout, uso incompleto de la evidencia recuperada, presupuestos tratados como precios y preguntas de pago con condiciones comerciales pendientes. También se corrigieron defectos independientes del comprador sintético, del juez y de la preparación de datos. La interpretación y la elección conversacional permanecen en el LLM; los controles externos verifican identidad, procedencia, aritmética y condiciones para guardar pedidos.

La última campaña **completa de 50 casos fue L: 41 aprobados automáticamente y nueve resultados no aprobados**. Después se corrigieron y repitieron los afectados en M/N/O/P, con huellas distintas. No se suman aprobaciones entre versiones ni se declara 50/50 en la versión actual. La auditoría manual también detectó pérdida de modalidad de entrega en un caso que el juez había aprobado; se añadió una comprobación independiente para evitar ese falso positivo.

| Evidencia focalizada más reciente | Resultado y alcance |
|---|---|
| 02, duplicación de líneas / N | Aprobado; se devuelve la inconsistencia al LLM, sin fusionar productos automáticamente. |
| 05, 13, 19 y 29 / M | Aprobados: extracción del juez, preparación del catálogo local, continuidad de consulta y desglose de cotización. |
| 23 y 27 / N | Aprobados: operación de pedido y consulta informativa con cierre acreditado. |
| 43 / O y 44 / N | Aprobados; canasta y modalidad domicilio conservadas, con flujo del tendero completado. |
| 50 / O | Aprobado; confirmación textual interpretada en contexto. La rúbrica también rechazó un control negativo de cierre prematuro. |
| 45 / P | Todas las aserciones funcionales y de integridad pasan; una sola tarea humana, dos productos conservados y ningún pedido incompleto. Sigue como `integration_fallback`: el compositor intentó un importe sin respaldo en el acuse final; se bloqueó y se envió una respuesta segura. |

La campaña P verificó la eliminación de la pregunta de pago prematura, con DeepSeek real. Se mantienen visibles la degradación del caso 45 y la variabilidad/latencia del proveedor. Antes de considerar una versión lista para producción falta ejecutar nuevamente los 50 casos sobre esa versión congelada y medir carga; esta intervención fue exclusivamente local, sin alterar la base de desarrollo de origen ni desplegar.

## Alcance y método

Trabajo local; no commit, push, despliegue ni mensajes reales. Se preservaron los cambios anteriores. Las campañas usan DeepSeek real, clones temporales de PostgreSQL local y transportes simulados de Meta/Google. El comportamiento conversacional sigue a cargo del intérprete y resolutor LLM; las validaciones limitan escrituras, importes y evidencia, sin clasificar intenciones por palabras clave.

La auditoría anterior agrupaba 44 incidencias caso×familia en 34 casos distintos. No equivalen a 44 casos fallidos. Esta continuación distingue fallos reproducidos de VIA, del proveedor y del evaluador. Los resultados históricos no se sobrescriben ni se recategorizan como aprobados.

## Causas comprobadas

| Causa | Evidencia | Corrección y límite |
|---|---|---|
| Presupuesto interpretado como importe vendido | `evaluateDeliveryPolicy` aceptaba `budgetAmount` sin cantidad; el runtime borraba pendientes de cantidad/presentación; el escritor también aceptaba esa línea. Caso 45 cotizaba $8.200 sin acreditar unidad vendible del salchichón. | Un presupuesto permanece como intención del comprador; no acredita cantidad ni fraccionamiento. El cálculo exige unidades enteras de la presentación catalogada. El LLM decide aclarar una presentación o pedir intervención. No se implementa una tarifa de venta por peso inexistente. |
| Relevancia convertida en cualidad certificada | Casos 12/16: inferencias sobre dulzor, composición o refrigeración se convertían en afirmaciones. Los importes tenían validación estructurada, la prosa no tenía contraste semántico posterior. | Revisión contextual acotada de las respuestas de catálogo con el mismo proveedor, antes de enviarlas. Conserva opciones fundamentadas y distingue atributos documentados de condiciones desconocidas. Es una segunda evaluación LLM, no una garantía matemática de veracidad. Se mide su costo y latencia. |
| Evidencia disponible rechazada por aislamiento excesivo entre búsquedas | Reproducción: el LLM selecciona para una necesidad un SKU devuelto por otra búsqueda del mismo turno/tenant; se rechaza como `unknown_or_foreign_candidate`. | Validar contra evidencia efectivamente recuperada en el turno, manteniendo aislamiento por tenant y controles de SKU, precio, stock y medida. Nunca aceptar SKU inventados ni de otro tenant. |
| Consulta informativa enviada al flujo de pedido vacío | Caso 17: pregunta por tarifa tras una consulta de catálogo produce `order_clarification` sin pedido y una respuesta con subtotal parcial cero. | Contrastar precondiciones de la acción propuesta con el estado y pedir al intérprete una reparación acotada; el LLM vuelve a decidir el intent. No convertir consultas en una compra vacía ni cotizar precios recordados sin recuperarlos. |
| Evaluador y comprador fuera de contrato | Casos 29/34: comprador abandona al recibir una cotización o usa botón de pago como confirmación. Juez exige verificar efectivo o inventa prefijos de SKU. | Validar citas, identificadores y criterios del evaluador; una reparación acotada del propio LLM. Persistir evidencia de la reparación; si sigue inválida, error de evaluación, nunca aprobación automática. |

## Archivos y responsabilidad

- `server/domain/deliveryPolicy.js`: cálculo reutilizable de línea; presupuesto no es precio de una venta.
- `server/domain/groundingContracts.js`: completitud comercial y precondiciones verificables del contrato semántico.
- `server/services/agentRuntime.js`: conservación de cantidad/presentación pendientes y aplicación del cálculo común.
- `server/services/toolRegistry.js`: rechazo independiente al escribir un pedido no cotizable.
- `server/services/groundedDecisionAgent.js`: restricciones comerciales entregadas al resolutor contextual.
- `server/services/conversationGroundingCoordinator.js`: procedencia de candidatos de las búsquedas del turno.
- `server/services/llmPlanner.js`: reparación contextual de frames que incumplen precondiciones.
- `server/services/llmReplyComposer.js`: revisión semántica de prosa de catálogo; validación monetaria posterior independiente.
- `server/tests/helpers/contextualCustomerActor.js`: protocolo del comprador y del juez; sin acceder a decisiones internas de VIA.
- `server/tests/helpers/contextualScenarioRunner.js`: evaluar si el comprador ya terminó también en el último turno disponible.
- `server/tests/helpers/businessOutcomeAssertions.js`: un límite privado de presupuesto no demuestra una unidad vendida.

## Validación

La campaña exploratoria F conserva la versión y resultados propios en `test-results/pareto-rootcauses-f`. Sus hallazgos adicionales motivan la siguiente versión; no se deben sumar ambas como repeticiones de un mismo código. Los resultados de la versión final, métricas y pendientes se registran al completar la ejecución.

Se comprobaron regresiones de aritmética, persistencia, consentimiento, duplicados, pago, aislamiento, composición, recepción durable y concurrencia. Los ensayos PostgreSQL usan recursos temporales; los errores de conflicto deliberados de política y versión son pruebas de rechazo, no fallos de la ejecución.

### Campaña completa conservada: 50 casos

Evidencia: `test-results/pareto-rootcauses-final50`, SHA-256 del conjunto de fuentes `d81c9ab4fd47a27d1cc00511ef1824fe2645451b28045428157b594bff07df57`. No hubo cambios de fuentes durante la ejecución ni cambios de la base local de origen. Meta y Google fueron simulados; DeepSeek fue real.

| Indicador | Resultado |
|---|---:|
| Casos aprobados automáticamente | 33/50 |
| Casos para revisión | 13 |
| Casos con respuesta de contingencia | 2 |
| Casos con error de evaluador | 2 |
| Turnos recibidos | 170 |
| Pedidos creados / flujo del tendero aprobado | 17/17 |
| Recibos con presentación de los productos | 17/17 |
| Tareas humanas duplicadas | 0 |
| ACK del webhook p50 / p95 / máximo | 10 / 21 / 47 ms |
| Respuesta al comprador p50 / p95 / máximo | 6,17 / 13,80 / 16,42 s |
| Solicitudes de VIA a DeepSeek | 530 |
| Tokens de VIA: entrada / salida | 2.448.084 / 126.997 |
| Revisiones de prosa de catálogo completadas | 50 |
| Latencia de revisión p50 / p95 | 1,97 / 3,09 s |
| Tokens de revisiones completadas | 233.577 |

Las cifras de proveedor excluyen comprador y juez simulados. Los tokens de revisión son parte de los tokens de VIA, no un consumo adicional que deba sumarse otra vez. Una revisión fallida puede consumir tokens sin emitir el evento de revisión completada. La etiqueta agregada `needs_review` no demuestra ausencia de fallos funcionales: casos 27, 45, 46 y 49 tienen aserciones funcionales pendientes además del límite del simulador. Se deben leer ambos ejes.

### Ajustes posteriores derivados de esta campaña

1. `groundingQueries` usa `retrievalText` y variantes del intérprete antes de la hipótesis larga. El prompt separa consulta breve de intención original; el resolutor decide cuándo reformular. No se cambian precios, catálogo, scores ni se agrega clasificación de productos por palabras clave.
2. El revisor recibe política comercial explícita y distingue la acción humana ya decidida de una mera oferta. Se eliminó la instrucción contradictoria que le impedía comunicar una gestión humana incluso con `nextAction=human_review`.
3. Si el revisor aprueba el borrador, devuelve un dictamen breve y se conserva el borrador ya validado. Solo una corrección necesita volver a redactarse. Esto reduce regeneración, riesgo de truncamiento y modificaciones gratuitas de una respuesta correcta.
4. El resolutor distingue elección del medio al terminar la colección de una consulta aislada sobre cómo pagar. La elección puede permitir cotizar y pedir confirmación, sin acreditar dinero.
5. El comprador pide continuar una compra inconclusa; el juez repara un mapeo nombre→SKU únicamente cuando otra identidad exacta del catálogo lo contradice. Una diferencia de precio **no** habilita cambiar el SKU para hacer pasar el caso.
6. El corredor conserva una despedida no enviada al alcanzar el límite y distingue objetivo satisfecho de recorrido agotado. Los escenarios de atención humana permiten hasta cuatro mensajes para aclarar y escalar; se mantienen las aserciones de tarea, adjunto y canasta. El caso de apertura no exige completar una compra que aún no comenzó.

Estos cambios forman otra versión. Se ejecutan los 17 casos afectados en `test-results/pareto-rootcauses-g`; no se sumarán sus aprobaciones a las 33 anteriores para afirmar que los 50 pasaron sobre una misma versión.

## Riesgos que deben medirse

La revisión añade como máximo una llamada, sin bucle de refinamiento adicional, y comparte el presupuesto de tiempo del compositor. Desde la iteración H cubre también las líneas con presupuesto y cantidad comercial aún desconocida: la campaña G demostró que una respuesta podía prometer venta por peso sin escribir un pedido incorrecto. No se agrega a saludos, cotizaciones ordinarias con unidades resueltas ni recibos finales. Un fallo de la revisión no libera el borrador sin verificar: deja una respuesta limitada a evidencia tipada y registra el fallback. La evidencia semántica sigue siendo probabilística; no se declara listo para producción por pasar pruebas de contrato.

## Hallazgos que motivaron la campaña G

- Caso 05: el resolutor sí solicitó atención humana y la herramienta creó la tarea. La revisión del texto sustituyó el aviso por otra pregunta de permiso. El problema observado está en conservar la acción operativa al revisar la redacción, no en que falte escalar. Esa misma revisión ignoró condiciones comerciales explícitas al exigir que constaran en el catálogo. Debe distinguir fuentes de evidencia: atributos del producto, política de entrega y acción autorizada.
- Casos 09/16/18: el comprador de prueba declaró una consulta resuelta o un handoff, con cita válida, en el último turno permitido. Su despedida no enviada hizo que el corredor anotara `turn_budget_exhausted`. Se conserva ese resultado automático histórico; la corrección del protocolo deberá acreditar el cierre sin simular que se envió un mensaje adicional.
- Caso 21: el juez asignó a Jabón Varela un SKU real de otra referencia. La existencia del identificador no prueba que el mapeo nombre→SKU sea correcto. El precio público coincide con Varela; esta discrepancia exige revisar la extracción, sin atribuir automáticamente el error a VIA ni aprobar por una comparación de precios aislada.
- Caso 27: las consultas largas (`productos para lonchera escolar infantil`) diluyen la coincidencia con etiquetas del catálogo y priorizan otras palabras. `groundingQueries` no usaba `retrievalText`, aunque el contrato semántico lo conservaba. La corrección propuesta prioriza el texto de recuperación y las variantes producidas por el LLM, conservando el mensaje literal como evidencia; no agrega un diccionario de loncheras ni selecciona productos por score.
- Caso 11: la llamada de revisión devolvió HTTP 200 y consumió exactamente el límite de 700 tokens de salida, seguida de `catalog_review_unavailable`. Esto apunta a truncamiento del JSON, no a falta de credenciales. La telemetría actual no guardaba `finish_reason`, por lo que no se debe presentar esa inferencia como confirmación independiente del motivo del proveedor. No conviene exigir copiar íntegra una respuesta larga cuando el revisor la considera correcta.
- Casos 45/46/49: el límite de dos mensajes impide recorrer selección de variante, aclaración de la imagen o rechazo de sustitución y luego solicitud de ayuda. Debe permitirse un recorrido acotado mayor y conservar las exigencias de tarea humana, adjunto y canasta parcial; ampliar el recorrido no equivale a aprobarlos.
- Caso 40: el intérprete conservó canasta, cierre de colección y elección de Bre-B correctamente. La redacción respondió sobre pago sin retomar claramente el pedido, y el comprador simulado intentó terminar una compra inconclusa. Hay una mejora de continuidad de VIA y un error de protocolo del comprador; no deben reducirse a una sola etiqueta.

## Resultado dirigido G y última corrección H

G ejecutó los 17 escenarios afectados sobre fuentes congeladas (`86e660d6798bbac30c133d3abe8414d49dc488cc1c2a305cf93068a0579f07b4`): **13 aprobados, 3 con contingencia y 1 con error del evaluador**. No se modificó la base local original. Dos pedidos creados, ambos con operación completa del tendero y presentación en el recibo; cero tareas duplicadas. ACK p95 24 ms; respuesta p95 14,91 s, máximo 16,63 s.

Pasaron 05, 09, 16, 18, 21, 25, 26, 27, 28, 40, 41, 46 y 49. Esto incluye recuperación por ocasión/lonchera, foto conservada al escalar, canasta parcial preservada al faltar un producto y avance de pago a confirmación.

| Caso restante G | Causa comprobada | Tratamiento H |
|---|---|---|
| 10 | El juez concatenó un nombre a una cita de precio que ya contenía ese nombre; la cita no existía literalmente. | Aclaración del contrato de extracción. Se conserva la validación literal y el límite de una reparación; no se cambian precios ni se aprueba automáticamente. |
| 11 | El intérprete devolvió dos productos concretos pero `catalogSearchReady=false` porque el comprador no quería comprar. Se saltó la búsqueda y el compositor intentó citar precios históricos sin evidencia actual. | Separar expresamente capacidad de buscar y consentimiento de compra. Un frame contradictorio vuelve al LLM para una reparación; no se fuerza `true` ni se reconoce intención con palabras clave. |
| 32 | Metadata comercial incluía un hecho sin su marcador en el texto; la validación activó la respuesta segura. | El pedido se completó correctamente por $23.500, con consentimiento y flujo del tendero. Se conserva el rechazo y se repite el escenario, sin relajar controles para eliminar una etiqueta de contingencia. |
| 45 | El cálculo ya protegía el pedido, pero la prosa prometió despachar una porción por el presupuesto solicitado. También el juez rechazó indebidamente tarifa/mínimo cero definidos en el fixture. | Extender la revisión contextual a presupuestos sin cantidad acreditada, entregándole las líneas del pedido. Reforzar al juez la diferencia entre configuración comercial válida y preferencias futuras privadas. |

Las nuevas regresiones reprodujeron el vacío de revisión semántica y el frame contradictorio. Pasaron después de corregir: 35 contratos de composición, 9 de continuidad, grounding y aceptación; se repitieron también las 12 suites de arquitectura, todas aprobadas. H repite 10/11/32/45 con DeepSeek real. No altera los resultados históricos ni equivale a una repetición completa de los 50.

### Hallazgo adicional H: pérdida de canasta ante respuesta mal formada

H aprobó 11 y confirmó que ya puede consultar uso/precio sin comprar. El 10 quedó en revisión por una consulta de composición que requiere respuesta del tendero y alcanzó el límite de turnos. El 32 completó el pedido correcto sin fallback; su rótulo automático de fallo provino de un juez que convirtió su propio error de extracción de SKU en una acusación contra VIA y además ignoró una elección mediante botón. Se conserva ese rótulo y su evidencia, sin certificarlo como fallo real de precios.

El 45 sí reprodujo un fallo nuevo de VIA: `frame.items=[]` indicaba que el comprador no modificaba productos. El resolutor omitió decisiones para las líneas acumuladas, el coordinador generó `invalid_grounding_decision` para ambas, y el runtime perdió su resolución y recalculó el parcial en cero. No fue un error de multiplicación ni ausencia de Coca-Cola en catálogo.

Corrección I:

- Validar cobertura y acciones del resultado del resolutor; pedirle una reparación dentro de las **mismas dos rondas y presupuesto de tiempo**, reutilizando las lecturas ya hechas.
- Si falla el contrato otra vez, conservar únicamente identidades anteriores **no modificadas** que se recuperaron y validaron en el turno actual. No conservar automáticamente líneas cambiadas, ajenas o sin stock. La acción global pasa a revisión humana, nunca a confirmar.
- El prompt recuerda que `frame.items` es el cambio del turno y `observations` la canasta completa. Una consulta de total no elimina productos ni exime de devolver sus decisiones.
- El simulador conserva el tipo/id/título público del botón seleccionado. El juez distingue esa selección de texto libre truncado y sus errores de extracción de lo realmente enviado por VIA.

La regresión del coordinador falló antes y pasó después: reparación sin repetir búsquedas, conservación de línea sin cambios y con evidencia fresca, rechazo al modificar la intención y rechazo sin stock. I vuelve a ejecutar 10/11/32/45 sin alterar fuentes durante la campaña.

### Resultado I y separación de identidad / condición comercial

I terminó con **10, 11 y 32 aprobados**. El 32 completó pedido y alistamiento/despacho. El 45 quedó `evaluator_error`, pero también contiene un fallo real de VIA: no creó gestión humana y volvió a pedir cantidad después de que el comprador aclarara repetidamente que quería comprar por valor. El error del juez (precio atribuido a una cita sin importe) no oculta ese fallo funcional. La conservación de canasta sí funcionó: se mantuvo la Coca-Cola de $3.200 y no se creó un pedido con importe inventado. Fuentes `3248079c95e591b856dd583572e6294c6540e3e1fa19000635201e7190f0d1c8`, sin modificaciones durante la ejecución; ACK sin casos de un segundo o más, respuesta p95 14,09 s.

El resolutor confundía **identidad resuelta** con **condición comercial resuelta**: su razón afirmaba que presupuesto y precio de catálogo coincidían, aunque `quantity=null` impide calcular la línea. La evidencia anterior exponía una canasta incompleta de forma agregada, sin un contrato explícito por línea que distinguiera unidad vendible de presupuesto. Las instrucciones de prosa por sí solas no evitaron la repetición.

J incorpora `catalogSaleUnitEvidence` en cada observación del resolutor: base del precio, cantidad establecida o desconocida, presupuesto solicitado y ausencia de conversión autorizada presupuesto→cantidad. No agrega una regla de intención ni envía automáticamente al humano por mencionar un presupuesto. El LLM recibe esa limitación junto con el historial y decide aclarar una presentación fija o pedir gestión del tendero. Un SKU puede permanecer resuelto con `nextAction=human_review`.

La regresión reprodujo la ausencia de esa evidencia y pasó después, incluyendo el contraste con una unidad expresamente solicitada que sigue siendo cotizable. J repite el caso 45 con DeepSeek real; no aumenta rondas ni llamadas de VIA.

J sí creó una tarea humana y dejó el total sin confirmar. No se da por aprobado: la redacción repitió una selección de presentación ya hecha y una respuesta usó contingencia por un importe fuera del contrato. Además, el resolutor devolvió `human_review` con SKU conocido, pero el contrato solo conservaba `product` para `resolved`: la tarea perdía esa identidad, aunque su razón decía conservarla.

K corrige esos dos límites de información, con regresiones que fallaron antes y pasaron después:

- `validateGroundingDecision` permite conservar un SKU **explícito y observado** en `human_review`, con las mismas comprobaciones de tenant, precio, stock y medida. No lo adivina ni transforma la revisión en una línea lista para vender.
- `agentRuntime` conserva ese producto en la tarea y borrador, deja importe pendiente y respeta la revisión humana por línea aunque la acción global sea contradictoria. La confirmación sigue bloqueada. El título de la tarea describe también condiciones comerciales, no solo producto ausente.
- La elección validada del botón llega al composer y al revisor semántico. Antes solo llegaban título abreviado y pregunta anterior; ahora pueden reconocer la decisión exacta sin volver a preguntar por esa presentación.
- El juez recibe el alcance comercial real: no existe tarifa de fraccionamiento. Esto no aprueba el caso automáticamente; se mantienen las aserciones independientes de tarea real, conservación de la necesidad, ausencia de repetición y validez de importes.

Pasaron las 12 suites de arquitectura y las regresiones de grounding, continuidad de canasta, gestión humana y composición. K repite el caso 45 sobre otra huella de fuentes, conservando J como evidencia del fallo.

### K: el fallback contradecía la decisión correcta del resolutor

En K el LLM eligió `human_review` desde el primer turno, conservó ambas identidades y creó **una sola tarea** con presupuesto y cantidad desconocida. La repetición de preguntas ya no provenía de esa decisión: tres respuestas rechazadas por `commercial_claim_text_missing` / `ungrounded_money` activaban un fallback que anteponía «¿Me indicas la cantidad?» aunque `nextAction=human_review`. Esta traza distingue un fallo del intérprete de uno en la salida de contingencia.

Corrección L:

- El fallback respeta la acción humana **ya decidida** y comunica el pendiente, conservando nombres/presentaciones acreditados. No vuelve a pedir cantidad o pago ni inventa cotización.
- La revisión LLM que ya se realiza para catálogo y presupuestos sin unidad también recibe `validationIssue` cuando el borrador incumple el contrato monetario. Puede corregirlo dentro de esa única revisión y del mismo presupuesto temporal. Antes, el primer error formal impedía usar esa revisión y enviaba contingencia inmediatamente.
- Después de la reparación se ejecuta el mismo validador monetario completo. Tanto un `supported` incorrecto como un `revised` con importe falso siguen rechazados; no se eliminan checks para aprobar casos.
- Telemetría conserva el borrador rechazado, la llamada de revisión y el resultado final. Las cotizaciones ordinarias, saludos y recibos no reciben esta llamada adicional. Un borrador inválido de catálogo puede consumir ahora la llamada de revisión antes de caer en contingencia; se mide ese costo.

Los nuevos ensayos fallaron antes y pasaron después. El contrato de composición tiene **38 pruebas aprobadas**, incluyendo que el fallback no cambie la acción y que una reparación no autorice dinero inválido. Se inicia `pareto-rootcauses-l50`: **los mismos 50 escenarios**, nueva huella de fuentes, sin cambios de código durante la campaña. El resultado de K permanece `integration_fallback` con fallo funcional por repetición; no se reescribe como aprobación.

## Relación con el Pareto y evidencia

Las cuatro primeras familias del Pareto original concentraban **37 de 44 incidencias (84,1%)**: recibos, duplicación humana, afirmaciones sin respaldo y cierres mal interpretados. Las dos primeras tienen ahora evidencia objetiva favorable en la campaña completa: 17/17 recibos con presentación y cero duplicados. Las otras dos requieren las correcciones contextuales y repetición descritas aquí; no se declara eliminado el 84,1% por haber modificado archivos.

La integridad de importes tiene prioridad adicional aunque el presupuesto sin unidad afecte un solo escenario. La selección y redacción siguen en el LLM; aritmética, identidad, consentimiento y límites de herramientas permanecen verificables fuera del modelo.

Resumen exportado con resultados, conversaciones, incidencias y huellas por versión: [evidencia consolidada](evidencias/correcciones-causas-50-2026-11-04.json). Los detalles y manifiestos originales permanecen en `test-results/pareto-rootcauses-{f,final50,g,h}`. Las campañas son distintas y sus aprobaciones no se suman.

### Hallazgos L: identidad de líneas y aislamiento del evaluador

- **02, VIA / integridad:** el primer frame contiene dos entradas idénticas de Cifrut para una sola mención del comprador. La normalización asigna IDs distintos; no agrega entradas. En el siguiente turno ambas reciben cantidad 2 y el subtotal cuenta cuatro jugos. El control anterior rechazaba IDs repetidos, pero no hipótesis nuevas idénticas con IDs nulos. Se necesita devolver la inconsistencia al intérprete para una única reparación contextual; nunca fusionar automáticamente por SKU o nombre. El oráculo impidió enviar una confirmación del importe incorrecto.
- **13, preparación local:** `resetScenarioCatalog` inicia `mutate` (guardado diferido) antes del DELETE SQL del catálogo. Ambas transacciones compiten y PostgreSQL detectó deadlock antes del primer mensaje. Debe drenar el guardado previo, borrar y recién entonces programar/persistir el fixture nuevo. No requiere modificar el esquema ni la persistencia productiva.
- **45, evaluador:** la tarea humana sí existe, conserva la identidad y no se duplica; ya no hay fallback del compositor en esta ejecución. El cliente sintético cita una respuesta anterior como evidencia final y falla el protocolo. Su excepción sale del bucle antes de recoger snapshot/tareas/juicio, dejando el diagnóstico incompleto. Se requiere mantener ese error visible y continuar la auditoría del estado, sin convertirlo en éxito ni aceptar citas obsoletas.
- **05, evaluador:** el texto publica café molido tradicional 500 g a $16.500 (COL-300), pero el juez lo asigna a BOG-BAS-038, café de 250 g a $13.500. El precio publicado sí existe; la discrepancia es de asociación de SKU por el juez. Se conserva para revisión y no se cambia el precio de VIA para satisfacer esa extracción.

L terminó con 41/50 aprobados, 1 fallo de integridad, 2 revisiones, 1 error de preparación, 2 contingencias y 3 errores del evaluador. Hubo 156 turnos y 484 llamadas de VIA (2.465.796 tokens). ACK p50/p95/máximo: 11/29/34 ms; respuesta p50/p95/máximo: 7.597/14.165/30.286 ms. El máximo corresponde al timeout del proveedor del caso 44. Base local de origen y fuentes sin cambios; ninguna conexión real con Meta o Google. Los contratos P0 de la campaña NO pasan por la duplicación del caso 02.

Los 15 pedidos que llegaron a crearse pasaron su flujo del tendero y recibos con presentación. En 35 hay dos tareas pendientes de **operaciones distintas** (revisión comercial y preparación); el conteo bruto de tareas >1 no demuestra duplicación. El check de unicidad por operación no falló. No se debe reportar ese conteo bruto como duplicación ni asumir que ambas tareas son equivalentes.

### Corrección M: causas adicionales reproducidas y verificadas

| Caso / componente | Causa | Cambio y comprobación |
|---|---|---|
| 02 / intérprete | IDs nulos diferentes se convertían en líneas independientes aunque fueran hipótesis idénticas de una sola mención. | Validador devuelve `duplicate_new_need` al LLM para una reparación. No fusiona líneas ni calcula cantidades. Variantes/atributos distintos y menciones literales independientes se conservan. Si falla la reparación, revisión humana sin cotizar la duplicación. |
| 19 / continuidad de consultas | El prompt exponía IDs de `catalogObservations`, pero el validador solo aceptaba IDs de `existingOrder`. | En `catalog_query`, se aceptan identidades ya observadas de ESA conversación; no se convierten en compra ni se aceptan IDs ajenos. |
| 29 / compositor | Respuesta solicitaba confirmar sin todos los campos de desglose. El fallback seguro sí era correcto, pero se perdía redacción LLM. | Una reparación acotada solo cuando falta el desglose y el pedido es confirmable. Se validan de nuevo campos/importes; un revisor que diga incorrectamente `supported` sigue rechazado. Cotizaciones válidas conservan una llamada. |
| 44 / recuperación de timeout | El primer mensaje no pudo interpretarse. Al llegar “agrega queso”, no existía canasta y se perdió el pan original. | El plan de contingencia conserva `pendingInterpretation` con texto/ID y hasta siete mensajes previos pendientes; el siguiente LLM recibe explícitamente esa deuda de interpretación. Decide recuperar, modificar o cancelar según el contexto; no hay inserción automática de productos. |
| 13 / preparación del fixture | DELETE competía con el upsert diferido iniciado por mutate. | `scenarioCatalog.js` drena guardados, ejecuta DELETE y recién después muta/persiste. Solo aplica al clon local del E2E. Regresión verifica el orden de operaciones. |
| 43/45 / comprador sintético | Elegía un botón de pago como confirmación, o citaba un turno anterior al detenerse. | Error de reparación más específico y `latestPublicReply` público. Se conserva límite de una reparación y no se fabrica consentimiento. |
| 05 / juez | SKU de 250 g asociado a cita literal de otra referencia de 500 g. | Contrastar nombre+presentación inequívocos de la cita y pedir reparar extracción. No se usa precio para elegir SKU ni se repara una discrepancia de precio real. |
| Auditoría / runner | Error del actor omitía snapshot, tareas, juez y deduplicación. | Capturar el error dentro del bucle, detener al comprador y continuar las comprobaciones independientes. El error sigue visible, no se convierte en aprobado. |

Regresiones: 12 contratos de continuidad, 39 de composición, 13 de Pareto, grounding, aceptación, dos controles del harness y 12 suites de arquitectura aprobados. Cada regresión nueva reprodujo su fallo antes del cambio.

Además, `scripts/e2e/verify-interpreter-recovery.mjs` inyectó una caída de transporte y utilizó **DeepSeek real** en el siguiente turno: (1) agregar queso recuperó pan+queso; (2) “olvida el pan, mejor solo queso” conservó únicamente queso. Ambos aprobados, dos llamadas reales; es evidencia de interpretación, no un E2E completo de entrega. Archivo: `test-results/interpreter-recovery/2026-11-05T01-30-43-906Z/report.json`.

M repite los nueve casos no aprobados de L con la versión corregida. Sus resultados no se suman a L para afirmar 50/50 sobre una única versión.

### Resultado M y corrección N: modalidad de entrega y límites del evaluador

M completó nueve casos sobre fuentes congeladas: 05, 13, 19, 29 y 43 aprobaron automáticamente; 02 tuvo timeout del comprador sintético antes del segundo mensaje; 27 agotó tres turnos; 44 y 45 activaron contingencia. En 45 quedó la tarea de revisión comercial, ambas necesidades y ningún pedido incompleto; el texto revisado incumplió el contrato monetario y fue rechazado. No se relaja esa protección ni se atribuye a una falta de catálogo.

La auditoría del estado descubrió una brecha que el rótulo automático ocultaba: **43 y 44 perdieron la modalidad domicilio al cerrar la lista**, aunque el comprador no pidió recogida. Ambos tenían productos e importes correctos y tarifa cero, por lo que las aserciones anteriores no lo detectaban. Se conservan los resultados automáticos históricos, pero **43 no constituye una aprobación funcional completa**. En 44 hubo además un timeout de 30 s del compositor: son dos causas distintas.

Cambios N:

- `semanticContracts.js`: una modalidad omitida/null conserva la del pedido existente; no convierte omisión en recogida. Se mantiene `false` cuando el LLM interpreta una elección explícita de recogida.
- `groundingContracts.js` y `llmPlanner.js`: cambiar una modalidad vigente exige `deliveryChange` con cita literal del mensaje actual y explicación contextual. Si falta, la misma reparación acotada devuelve el problema al intérprete; no se decide por palabras clave. La cita acredita procedencia, no garantiza por sí sola que la interpretación del LLM sea correcta.
- `businessOutcomeAssertions.js`: comprobar modalidad almacenada independientemente del importe, incluso con domicilio gratuito. Las expectativas se asignan a los fixtures que solicitan domicilio explícitamente; no a cualquier compra.
- `contextualScenarioRunner.js`: identificar los errores del actor/juez por su etapa, incluso si el proveedor devuelve un mensaje genérico de timeout. Se mantienen snapshot y auditoría posterior al fallo del comprador.
- `contextualAcceptanceScenarios.js`: aceptación 2.5.0; hasta cinco turnos para consultas informativas en vez de tres. La evidencia del 27 mostraba preguntas pertinentes sobre sabores tras respuestas útiles. El aumento no concede aprobación: siguen exigidos cierre acreditado, respuestas fundamentadas y ausencia de compra.

Las tres nuevas regresiones fallaron antes de corregir: pérdida por omisión de modalidad, oráculo que aceptaba recogida no solicitada y timeout del actor etiquetado como infraestructura de VIA. Tras corregir pasaron 13 contratos de continuidad, aceptación/harness y las 12 suites de arquitectura.

### Resultados N/O y comprobación del propio evaluador

N (`12a759c95f9b6289760a0e614977ac69bd062df3bda221f501892360399c5ae9`) ejecutó 02/23/27/44/45/50: **4 aprobados**, un error de comprador (45) y un fallo semántico del juez (50). Los cuatro pedidos creados conservaron modalidad domicilio y pasaron la operación del tendero. 27 completó su consulta en cuatro turnos. ACK p95 30 ms, respuesta p95 14,28 s; 78 llamadas de VIA y 419.089 tokens. Fuentes y base de origen sin cambios.

En N50 el juez exigió botón o palabra literal «confirmo» pese a una cotización completa seguida de una aceptación textual. También denunció repetir la pregunta de tamaño cuando «solo eso» todavía no elegía entre dos tamaños. Se corrigió la rúbrica contextual, **no VIA para satisfacer al juez**. Se reevaluó la misma conversación inmutable con DeepSeek: aprobada. Como control negativo, se sustituyó la cotización previa por una pregunta de agregar productos, manteniendo la aceptación y el recibo: rechazado por cierre prematuro. Dos llamadas; no son dos nuevos E2E. Evidencia y hash de origen: [auditoría de contexto](evidencias/auditoria-contexto-confirmacion-50-2026-11-04.json).

N45: el comprador sintético transformó su presupuesto en «una porción» y luego intentó comprar pese al objetivo de aclaración/handoff. Se reforzó su conservación de preferencias y alcance; no se envió la confirmación inválida a VIA. En O45 el comprador mantuvo su solicitud y VIA conservó presupuesto/cantidad desconocida y Coca-Cola, con una sola tarea humana y sin pedido incompleto.

O repitió 43/45/50: **43 y 50 aprobados**, ambos con domicilio y operación del tendero; 45 quedó `needs_review` porque el oráculo no podía distinguir un subtotal **explícitamente parcial** del total del pedido incompleto. Esa conversación mostró además una pregunta de pago prematura en la respuesta al agradecimiento, pese a seguir pendiente la cantidad comercial: el rótulo del juez no detectó ese defecto de experiencia.

Corrección P:

- La revisión LLM existente distingue informar medios de pago ante una consulta explícita de pedir elegir uno mientras siguen pendientes productos/condiciones. Corrige esa interrupción sin añadir llamadas ni clasificar frases mediante reglas.
- El juez extrae alcance del subtotal y una cita literal de la exclusión de productos pendientes. El oráculo independiente suma únicamente líneas con cantidad y precio acreditados. Una etiqueta «parcial» no permite sumar presupuesto sin cantidad, aceptar un importe incorrecto ni confirmar una canasta incompleta.
- Regresión del oráculo: subtotal parcial correcto se acepta; subtotal que suma el presupuesto se rechaza; cita de exclusión inventada es error del evaluador. El primer control falló antes de corregir. Los 39 contratos del compositor y aceptación/harness pasan después del ajuste.

No se sobrescriben los dictámenes N/O ni se convierten sus estados históricos en aprobaciones. Los manifiestos y el [consolidado](evidencias/correcciones-causas-50-2026-11-04.json) mantienen fuentes, diálogos, errores, contingencias y aserciones por campaña. La selección de entrega del caso 33 NO se fija como domicilio: su mensaje no lo solicitaba. La expectativa se corrigió antes de O; 33 no formó parte de N.

### Resultado final focalizado P y límite de cierre

Evidencia: `test-results/pareto-rootcauses-p/batch-45-45/20261105014429_94f00f3f/cases/45-real_supermarket_valor_calchichon_coca/case-report.json`. Huella de fuentes: `d47afb5a95b984e69a2565ee3ecc133a965be19801d762c0d98260f6e1b6faa9`.

El caso 45 completó tres turnos con **cero aserciones fallidas** y resultado agregado `integration_fallback`. El LLM conservó la solicitud por valor y la Coca-Cola, informó el subtotal parcial acreditado de $3.200 y dejó una única tarea `resolve_handoff` al tendero. No creó un pedido ni convirtió los $5.000 solicitados en una cantidad vendida. La revisión contextual corrigió una pregunta de pago que interrumpía la revisión comercial pendiente.

En el agradecimiento final, el compositor propuso un importe no respaldado por el contexto monetario de ese turno (`ungrounded_money`). El validador lo rechazó. El comprador recibió: «Con gusto. Tu consulta sigue pendiente con la tienda.». Esto demuestra contención del error, **no ausencia de error generativo**. Se conserva como degradación pendiente de robustez del compositor; no se elimina la protección, no se inventa precio y no se oculta con una aprobación del evaluador.

| Métrica P, solo caso 45 | Resultado |
|---|---:|
| Turnos / llamadas de VIA a DeepSeek | 3 / 9 |
| Tokens de VIA: entrada / salida / total | 36.895 / 2.135 / 39.030 |
| ACK p50 / p95 / máximo | 21 / 39 / 39 ms |
| Respuesta al comprador p50 / p95 / máximo | 7.422 / 9.912 / 9.912 ms |
| Revisiones semánticas / borradores corregidos | 2 / 2 |
| Pedidos incompletos / tareas humanas duplicadas | 0 / 0 |

Fuentes congeladas durante P y base de origen sin cambios; DeepSeek real y Meta/Google simulados. Los tokens de revisión están incluidos en el total de VIA. Las métricas de un solo caso no representan percentiles de producción ni capacidad bajo carga.

Comprobaciones locales finales: 13 regresiones Pareto, contrato de grounding, 39 pruebas del compositor y aceptación/harness aprobados. Tras el ajuste de entrega también pasaron los 13 contratos de continuidad y las 12 suites de arquitectura. La corrección del harness conserva los fallos del proveedor y del evaluador en sus propias categorías; no los convierte en éxitos de VIA.

**Pendientes verificables:** robustez de la redacción del acuse en 45, repetición completa de los 50 casos con la versión elegida para liberación y prueba de carga/latencia. No hubo commit, push ni despliegue.
