# Auditor contextual de datos y venta por valor

Implementación autorizada en local. Sin commit, push ni despliegue. Conserva las correcciones previas. El auditor modifica únicamente el borrador del pedido; no código, prompts, catálogo, políticas ni pagos acreditados.

## Contrato

- `permite_venta_por_valor` es una bandera por producto/tenant, falsa si falta. Se incorpora a CSV y Sheets (columna Q), normalización y evidencia de catálogo.
- El LLM distingue `saleMode=amount`, `requestedAmount` (compra por importe) de `budgetAmount` (presupuesto máximo). Sin bandera no hay venta por importe. No se inventan gramos ni unidades.
- La aritmética y el escritor vuelven a validar modalidad, disponibilidad y condiciones comerciales; la bandera nunca procede del comprador ni del auditor.
- Antes del resumen confirmable, una llamada LLM audita la conversación del pedido y propone parches con citas. Puede corregir líneas, entrega, dirección, nombre y medio elegido. No puede acreditar pagos ni autorizar precios/excepciones.
- Los parches se aplican al borrador y se recalculan antes de redactar. Un cambio concurrente invalida la auditoría. Se preserva el consentimiento posterior del cliente.
- La auditoría se repite ante un resumen modificado, no ante cada mensaje. Una reparación por revisión, sin bucle de agentes. Fallos de auditoría no autorizan confirmar un borrador sin revisar.
- El historial y las evidencias se conservan por tenant. El registro de auditoría contiene cambios, citas, versión, duración y consumo; no aprendizaje ni modificación automática del sistema.

## Archivos previstos

| Componente | Cambio |
|---|---|
| `catalogImportService`, `googleWorkspaceService`, `toolRegistry` | Bandera en importación/lectura/escritura y compatibilidad con las 16 columnas anteriores. |
| `semanticContracts`, `llmPlanner` | Representación e interpretación contextual de compra por importe frente a presupuesto. |
| `deliveryPolicy`, `groundingContracts`, `groundedDecisionAgent`, `conversationGroundingCoordinator` | Precio por importe autorizado, evidencia comercial y restricciones del catálogo. |
| Nuevo `orderDataAudit` (dominio) y `orderDataAuditor` (servicio) | Propuesta estructurada, validación de campos/citas/candidatos y una llamada acotada al proveedor. |
| `agentRuntime`, `llmReplyComposer`, presentación del pedido | Integración antes del resumen, persistencia, recálculo y presentación de líneas por valor. |
| Contratos y escenarios E2E | Positivos y negativos de venta por importe; errores inyectados de canasta; no alterar pedidos correctos; aislamiento y concurrencia. |

## Validación inicial (histórica, anterior a las correcciones de este informe)

- [x] Bandera y dominio comercial con regresiones.
- [x] Auditor correctivo y controles independientes.
- [x] Integración, persistencia y visualización; build verificado, inspección visual pendiente.
- [x] Pruebas locales focalizadas con DeepSeek real y Meta/Google simulados (8/8).
- [x] Informe de resultados, límites y latencia.
- [ ] Objetivo de respuesta completa <=5 s: no cumplido; en la campaña completa, 127/178 turnos superan el objetivo (mediana 6,874 s; p95 12,565 s).
- [x] Campaña completa de 50 casos con auditor activo ejecutada localmente: 42 passed, 3 integration_fallback, 1 failed_functional y 4 evaluator_error. Ejecución completa no significa aceptación del piloto.
- [ ] Corregir aclaraciones falsas del auditor ante botones seleccionados (29/50), coherencia de entrega (33), redacción de venta por importe pendiente (45), contratos/latencia y defectos del evaluador. Los hallazgos están documentados; no se implementaron correcciones durante esta campaña.

Objetivo actualizado por el usuario: **respuesta útil completa <=8 s**. El objetivo anterior de 5 s se conserva arriba como resultado histórico, no como umbral vigente. La línea base completa L tiene mediana 7,6 s y p95 14,2 s; no se considera cumplido por limitar solo la llamada del auditor o enviar un acuse. Se registran mediana, p95, máximo y porcentaje fuera del objetivo, desde recepción hasta el último envío del turno. Una prueba focalizada no demuestra capacidad de producción.

Resultado y guía: [Implementación y validación local](Implementacion-auditor-datos-y-venta-por-valor-2026-11-05.md). Auditor desactivado por defecto para despliegues existentes; las pruebas lo activan explícitamente. No se ha desplegado.

Seguimiento de la campaña completa: [50 casos con auditor: fallos, consumo y latencia](Resultado-50-casos-auditor-activo-2026-11-04.md). Las 31 auditorías produjeron 29 aprobaciones, 2 aclaraciones falsas y ninguna corrección de datos en esta ejecución. Se mantuvieron intactos la base local fuente y los archivos de backend durante las pruebas. Los resultados focalizados 8/8 permanecen como evidencia separada.

## Corrección y repetición autorizadas (5 de noviembre UTC)

- [x] Reproducir en contratos la pérdida de selección validada, el pago adjunto a una aclaración del auditor y el cero de entrega no aplicable presentado como tarifa.
- [x] Conservar en el mensaje de cliente la selección exacta únicamente después de validar la oferta; el auditor recibe ese dato junto al historial completo.
- [x] Compartir un contrato de interacción entre redactor y emisor; una aclaración de datos no puede adjuntar botones de pago ni confirmación.
- [x] Diferenciar tarifa general de entrega y cargo de una cotización sin domicilio. Intérprete/auditor evalúan el consentimiento contextual de entrega; los importes se recalculan en el backend.
- [x] Conservar el importe solicitado pendiente de revisión sin autorizar la venta ni inventar una presentación. Reutilizar revisión semántica existente para esas respuestas.
- [x] Ocho controles de auditor con DeepSeek real: variantes por botón, corrección de entrega, importe/duplicación, omisión, pedido correcto, presupuesto y bandera no autorizada.
- [x] Validación de conversaciones completas 29, 33, 45 y 50; conservación de resultados originales y repetición focalizada posterior.
- [x] Repetición de los 50 con auditor activo, revisión manual de todos los casos y contraste de latencia con 8 s.
- [x] Informe de cambios, límites y evidencia. Sin despliegue.
- [ ] Aceptación integral: persisten errores funcionales y de evaluación. Completar la campaña no significa aprobar los50.
- [ ] Latencia total <=8s: no cumplida,61/182 turnos fuera del objetivo.

### Coherencia de respuesta y separación de responsabilidades

La primera repetición completa `20261105042828_766337dd` produjo 42/50 aprobados automáticos. Corrigió las aclaraciones falsas de variantes29/50 y conservó el importe pendiente45; el auditor corrigió la entrega del33, pero una respuesta anterior todavía agradecía una compra inexistente. Se amplió el contexto de la revisión semántica existente con `orderCreated`, `replyInteraction`, campos pendientes y resultado/correcciones del auditor.

La revisión se aplica a consultas con canasta, aclaraciones del auditor y conflicto entre selección de presentación y cantidad pendiente. El LLM revisa el significado y corrige el texto; no cambia la acción contextual, los botones ni los datos comerciales. No hay clasificador nuevo por palabras clave. Confirmaciones válidas e invitaciones a agregar conservan su número de llamadas. La redacción debe respetar `ask_more`/`invite_additions`; no reinterpretar cantidades ni sustituir esa acción por pago.

Una ejecución intermedia se interrumpió tras detectar que revisar también las invitaciones duplicaba la decisión y podía desembocar en `required_term_missing`. Esa ampliación se retiró. La corrida final es independiente (`contextual50-auditor-final-v2-20261105`), mantiene código congelado y no incorpora los aprobados parciales a sus50 resultados.

Controles adicionales: seis pruebas de contrato de coherencia, la suite de contratos del redactor, cuatro controles de componente con DeepSeek y dos conversaciones con tarifa$3.000/mínimo$10.000 o$15.000. Estas últimas registraron totales$13.000 y$18.600; dos de sus ocho turnos excedieron8s (máximo9,842s). Aprobar funcionalmente no acredita el objetivo de latencia.

Durante la repetición congelada `20261105051111_8b0f4b32` se inspeccionaron también los casos aprobados. En05/07/50 la revisión del redactor trataba una tarifa configurada en cero como desconocida; el fixture efectivamente fija `deliveryFee:0` y `deliveryMinimumSubtotal:0`. Se corrigió la distinción entre cero explícito, null desconocido y cargo no aplicable. En34 se amplió la evidencia de cantidades a `orderItems` completos porque los campos pendientes priorizados podían ocultarlas. El LLM interpreta esa evidencia; no se añadió un clasificador por palabras clave.

## Cierre de esta iteración

Informe: [50 casos, revisión individual y validación posterior](Resultado-50-casos-auditor-corregido-2026-11-05.md).

- Campaña completa: **41 passed,3 evaluator_error,1 failed_integrity,1 needs_review,1 integration_fallback y3 failed_functional**.182turnos,17pedidos y17ciclos tendero aprobados. No se reclasificaron automáticamente los falsos positivos.
- Auditor:19llamadas,17approve y2clarify justificadas por modalidad no acordada. Cero revisiones duplicadas y17/17pedidos con sello. Las selecciones de variantes29/50 ya no provocan aclaraciones falsas.
- Latencia total: mediana6,761s,p95 12,062s,máximo14,759s;61/182(33,5%) superan8s. La suma de llamadas secuenciales pesa más que el auditor aislado; no se sustituyó la interpretación por heurísticas para bajar artificialmente el tiempo.
- Ajustes posteriores de tarifa/cantidad:5/5controles de componente con DeepSeek aprobaron. Después se repitieron05,07,33,34,50 en `20261105055204_60646f98`:4passed y1evaluator_error(34, citas atribuidas al turno incorrecto). Inspección manual confirmó cantidades, tarifa y secuencia de botones;3pedidos/ciclos tendero correctos. Persisten redacción mejorable33 y demora07.
- Esta repetición focalizada tiene19turnos,mediana6,112s,p95/máximo14,764s y5turnos>8s. Los dos últimos ajustes **no tienen otra campaña completa de50**; su cobertura posterior es focalizada. No se sumaron sus aprobados a los50 originales.
- Pendientes reales fuera de las aclaraciones falsas del auditor: omisión inicial recuperada01, precio extendido a otras variantes12, recuperación de lonchera27, medida/huevos35 y continuidad humana47. Evaluador: citas14/21/32/34, exclusión de presupuesto17 y afirmaciones erróneas parciales27/35/50. Integración: un `fetch failed`31.
- Base local fuente intacta en ambas campañas; backend congelado durante cada ejecución. Meta y Google simulados, DeepSeek real. No se hizo commit, push ni despliegue.
