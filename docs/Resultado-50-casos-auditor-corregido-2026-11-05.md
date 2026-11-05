# Auditor corregido: 50 casos E2E, coherencia y latencia

Run **20261105051111_8b0f4b32**. Informe generado 2026-11-05T06:00:51.417Z. 50/50 casos ejecutados, 182 turnos principales, 17 pedidos y 17 ciclos completos del tendero.

**Resultado:** 41/50 aprobados automáticamente; quedan defectos reales, problemas del evaluador y latencia fuera del objetivo. Después de estos 50 se corrigieron dos detalles de tarifa/cantidad y se repitieron cinco conversaciones afectadas. La versión de esos últimos ajustes tiene validación focalizada, no otra campaña completa de 50. Los resultados se mantienen separados.

## Alcance y cambios

- Solo local: PostgreSQL clonado, backend real, Meta y Google simulados y DeepSeek real. Sin despliegue, cambios en producción ni mensajes de WhatsApp reales.
- Selección interactiva: se guarda en el mensaje de cliente el SKU/presentación exactos después de validar la oferta. El auditor recibe esa evidencia y no depende del título truncado.
- Auditoría: se ejecuta sobre una propuesta lista para resumen confirmable. Conserva el historial y corrige datos con evidencia; no verifica pagos, modifica catálogo ni autoriza excepciones.
- Mensaje y botones: redactor y emisor comparten el contrato de interacción. Una aclaración del auditor no puede arrastrar botones de pago/confirmación ni preguntas ajenas.
- Domicilio: el cero no aplicable de un pedido sin entrega no acredita tarifa gratuita. La tarifa general se distingue del cargo cotizado. El LLM interpreta la solicitud/aceptación y el auditor puede rectificar la modalidad; backend recalcula.
- Importe pendiente: se conserva el valor solicitado en la respuesta y se revisa su variante; no se activa la bandera de venta por valor ni se autoriza un producto pendiente.
- Coherencia semántica: la revisión existente recibe estado real del pedido, acción decidida, botones y aclaraciones del auditor. Revisa consultas de una canasta y aclaraciones; corrige texto sin cambiar la intención ni las condiciones comerciales. Invitaciones a agregar y confirmaciones válidas ya auditadas mantienen su número de llamadas; el redactor recibe la instrucción de respetar la acción contextual.
- El objetivo vigente es **8 segundos totales**, de recepción a último envío útil. No se cambió el timeout de cada proveedor a ocho ni se presentó el acuse webhook como respuesta al cliente.

## Componentes y regresiones

| Archivo | Corrección |
|---|---|
| [agentRuntime](../server/services/agentRuntime.js) | Evidencia validada del botón, requisito de datos completos antes de auditoría y contrato compartido de la interacción saliente. |
| [orderDataAuditor](../server/services/orderDataAuditor.js) | Historial con selección exacta y contexto del resumen comunicado; interpretación del consentimiento de entrega. |
| [llmReplyComposer](../server/services/llmReplyComposer.js) | Tarifa frente a cargo no aplicable, aclaración frente a botones y reconocimiento del importe pendiente sin autorizar venta. |
| [llmPlanner](../server/services/llmPlanner.js) | Distinguir consulta de tarifa, aceptación contextual de entrega y dirección recordada. |
| [groundingContracts](../server/domain/groundingContracts.js) / [coordinador](../server/services/conversationGroundingCoordinator.js) | Conservar identidad validada de una línea por importe sin permitir su confirmación cuando el catálogo no lo autoriza. Respetar revisión humana elegida por el LLM. |
| Harness local | Medir último envío del turno contra 8 s, registrar activación y comprobar hashes antes/después. No cambiar los veredictos funcionales para aprobarlos. |

- Seis regresiones de contrato aprobaron con red deshabilitada, incluyendo no repetir el auditor antes de recoger pago y no autorizar venta por importe con bandera falsa. [Prueba](../server/tests/auditor-coherence-regression.mjs).
- Seis controles adicionales comprueban la entrega al revisor del estado real, las cantidades completas y los botones, la corrección de cierres/pagos prematuros y la ausencia de otra revisión en confirmaciones válidas. [Prueba](../server/tests/reply-coherence-review-contract.mjs). Los dobles no prueban comprensión del español; esa se evalúa con el proveedor real.
- Ocho pruebas focalizadas con DeepSeek real aprobaron: variantes abreviadas, corrección de entrega y reparación/preservación del borrador. [Evidencia](../test-results/order-data-audit/2026-11-05T04-20-00-744Z/report.json). Son pruebas separadas y no se suman a los 50.
- Contratos de auditoría, grounding, domicilio, comercio, redactor y ofertas interactivas pasaron. La rama específica de carrera PostgreSQL de la suite de domicilio no se ejecutó sin su variable de conexión; los 50 sí usan PostgreSQL real local.
- La campaña focalizada anterior de cuatro casos motivó el ajuste final de auditoría tardía e identidad de la venta por importe. Sus tres aprobados y un error de evaluador no se mezclan con esta versión final.
- Primera repetición completa: 42/50 aprobados, 160 turnos, 17 pedidos, 19 auditorías (16 approve, 2 clarify válidas, 1 correct), p95 11,456 s y 44 turnos >8 s. Detectó cierre verbal prematuro en el caso 33 y divergencia de pregunta/acción en 42, corregidos antes de esta repetición final. [Evidencia previa](../test-results/contextual50-auditor-corregido-20261105/20261105042828_766337dd/audit-analysis.json).
- Domicilio no gratuito: 2/2 conversaciones con DeepSeek real y auditor activo aprobaron, tarifa $3.000, mínimo$10.000/$15.000, consultas de precio, pago por texto y adición de cantidades. Totales registrados $13.000 y$18.600. Almacenamiento JSON local en este control complementario; no sustituye PostgreSQL de los 50. [Evidencia](../test-results/delivery-commerce/2026-11-05T05-02-49-300Z/report.json).

- Una repetición intermedia se interrumpió al detectar que revisar también ask_more duplicaba la decisión contextual y podía generar una contingencia por términos obligatorios. Se retiró esa revisión adicional. No se mezcla esa corrida incompleta con los 50 de este informe. [Registro](../test-results/contextual50-auditor-final-20261105/execution-source-hashes.json).
- Controles DeepSeek del alcance final: tres borradores contradictorios se revisaron y la invitación a agregar mantuvo una sola llamada; evidencia y respuestas completas, incluyendo redacción todavía mejorable. Son controles de componente, no otros casos E2E. [Evidencia](../test-results/reply-coherence-live/2026-11-05T05-11-03-446Z/report.json).

- Cinco controles posteriores con DeepSeek real aprobaron: tarifa 0 conocida, tarifa $3.000, tarifa null desconocida, tarifa 0 con mínimo$15.000 y excepción autorizada0 frente a tarifa general$3.000. Duración de componente 1,457–1,993s; no es latencia E2E. [Evidencia](../test-results/delivery-evidence-live/2026-11-05T05-51-43-483Z/report.json).

## Resultado

| Estado automático | Casos |
|---|---:|
| passed | 41 |
| evaluator_error | 3 |
| failed_integrity | 1 |
| needs_review | 1 |
| integration_fallback | 1 |
| failed_functional | 3 |

Auditor: **19** revisiones en 17 casos. approve=17; clarify=2. Pedidos con sello: 17/17. Revisiones tras las que aún faltaban campos: 2.

Revisión manual completada: **sí**. Las etiquetas automáticas no sustituyen la inspección de conversaciones ni convierten un error de evaluador en aprobado.

## Validación posterior de los últimos dos ajustes

Run **test-results/contextual-auditor-cierre-20261105/20261105055204_60646f98**: 5 conversaciones, 19 turnos. Estados: passed=4, evaluator_error=1. No se sustituyen con ellos los resultados originales de 50.

| Caso | Estado automático | Inspección posterior |
|---|---|---|
| 05 | passed | Tarifa y mínimo0 reconocidos como conocidos en consulta; no pedido tras negativa. 2 turnos, máximo7,489s. |
| 07 | passed | Tarifa y mínimo0 informados correctamente. Consulta por otras presentaciones de granadilla mantiene desconocidos reales; sin pedido. Respuesta extensa y turno2 de14,764s: sigue pendiente rendimiento/naturalidad. |
| 33 | passed | Conserva2Chocoramo+1Cifrut y$7.400; auditor aclara modalidad sin pago/confirmación; luego domicilio0,total7.400,confirmación y registro. Persiste frase innecesaria de revisión de tienda al preguntar modalidad. Máximo10,539s. |
| 34 | evaluator_error | Presentación y cantidades aclaradas, después pago y botones de confirmación; pedido5.000 y ciclo tendero correctos. Evaluator_error porque el juez usa citas de productos del turno3 en turno4 donde no se repiten. No se cambia etiqueta. Máximo9,267s. |
| 50 | passed | Secuencia variante150g → agregar/ajustar → pagoTarjeta → auditorapprove → botonesconfirmación → pedido2.900,domicilio0. Ninguna falsa ambigüedad por título truncado; cinco turnos≤6,393s. |

Latencia: mediana 6.112 s, p95 14.764 s, máximo 14.764 s, 5/19 turnos >8s. Tampoco acredita el objetivo. Base fuente intacta: true; código congelado durante la repetición: true.

[Evidencia focalizada](../test-results/contextual-auditor-cierre-20261105/20261105055204_60646f98/audit-analysis.json) y [revisión de conversaciones](../test-results/contextual-auditor-cierre-20261105/20261105055204_60646f98/manual-review.json).

## Comparación de latencia

| Métrica | Campaña anterior | Corregida |
|---|---:|---:|
| Turnos | 178 | 182 |
| Mediana total | 6.874 s | 6.761 s |
| p95 total | 12.565 s | 12.062 s |
| Máximo total | 31.105 s | 14.759 s |
| Turnos >8 s | 61/178 | 61/182 (33.5 %) |
| p95 acuse webhook | 0.024 s | 0.022 s |
| Revisiones del auditor | 31 | 19 |

Objetivo de todas las respuestas <=8 s: **no cumplido**. p95 <=8 s: **no**. Turnos sin respuesta: **0**; se reportan aparte de los percentiles, no se consideran respuestas rápidas. No basta la mediana.

Las conversaciones las genera un comprador LLM y no son idénticas entre campañas. Esta comparación no es un experimento A/B que atribuya cada variación al auditor. No sumar percentiles entre etapas.

| Etapa observada | Llamadas | Mediana | p95 | Máxima |
|---|---:|---:|---:|---:|
| planner | 160 | 2.390 s | 3.401 s | 5.773 s |
| grounding | 131 | 2.005 s | 2.891 s | 3.540 s |
| composer | 156 | 1.574 s | 2.348 s | 3.152 s |
| composer_evidence_review | 61 | 1.634 s | 2.449 s | 3.541 s |
| auditor | 19 | 1.695 s | 2.451 s | 2.451 s |

| Llamadas LLM observadas en el turno | Turnos con respuesta | Mediana total | p95 total | >8s |
|---|---:|---:|---:|---:|
| 1 | 25 | 2.306 s | 4.599 s | 0 |
| 2 | 44 | 4.137 s | 7.323 s | 0 |
| 3 | 46 | 6.510 s | 9.868 s | 9 |
| 4 | 58 | 9.186 s | 13.584 s | 43 |
| 5 | 9 | 10.392 s | 14.054 s | 9 |

Conteo por eventos instrumentados, sin atribuir duraciones desconocidas de errores de transporte. La suma de medianas/p95 de componentes no es la latencia de una conversación. La cadena de llamadas y el tiempo antes de procesar se contrastan con cada turno.

Diagnóstico: los turnos con 1–2 llamadas observadas permanecieron bajo 8 s; con 4 llamadas, 43/58 lo superaron; con 5, 9/9. El auditor aislado tuvo mediana 1,695 s/p95 2,451s, mientras el tiempo previo al agente tuvo mediana 27 ms/p95 1,913 s/máximo 4,248 s. Esto señala acumulación de trabajo secuencial y algunos retrasos previos; no demuestra que quitar el auditor resuelva el problema ni atribuye todo a DeepSeek. Las revisiones no se añaden a todos los turnos.

Siguiente optimización local: (1) guion fijo y trazas por etapa para comparación reproducible; (2) recortar evidencia duplicada y longitud de salida conservando los atributos relevantes; (3) verificar esperas de agrupación/cola y reutilización de resultados por revisión; (4) conservar intérprete, resolución y auditoría con responsabilidades separadas, sin omitir inferencia ni validar con respuestas prefabricadas. Repetir aceptación y carga después de cada cambio. No implementado ni desplegado en esta tarea.

## Hallazgos revisados

| Casos | Clasificación | Evidencia | Acción pendiente o conclusión |
|---|---|---|---|
| 29,50 | Auditor corregido | Recibe SKU y presentación exactos de la selección validada; ambos pasan la auditoría sin rechazar el título truncado. En50 persiste otro problema de tarifa en esta campaña. | Conservar validación de oferta/tenant y no confiar en títulos del comprador. |
| 22,33 | Aclaración válida del auditor | No se había acordado entrega ni recogida. Pregunta la modalidad, sin botones de pago/confirmación; tras la respuesta explícita aprueba. Ninguna auditoría se repite sobre la misma revisión. | La explicación de33 aún menciona revisión de tienda innecesariamente; mejorar redacción sin eliminar la aclaración válida. |
| 05,07,50 | VIA: tarifa cero tratada como desconocida | El fixture configura deliveryFee=0 y mínimo=0; algunas respuestas dicen que la tarifa está pendiente pese a esa evidencia. | Corregido después de esta campaña: distinguir cero conocido, null y cargo no aplicable. Cinco controles DeepSeek y repetición E2E separada. |
| 34 | VIA: cantidad y botón de variante | La lista priorizada de campos pendientes ocultaba quantity=null, por lo que el revisor no recibía la condición completa de la canasta. | Corregido después de esta campaña: revisión consulta orderItems completos. Repetición34 separada, sin reetiquetar el resultado original. |
| 01 | VIA: omisión temporal de producto | El razonamiento registrado menciona Cifrut pero semanticItems lo omite inicialmente; la repetición del comprador recupera la línea. El pedido final correcto no elimina el defecto inicial. | Validar completitud entre necesidades interpretadas y líneas en el intérprete; mantener evidencia antes del auditor. |
| 12 | VIA: precio extendido a variantes no acreditadas | T2 aplica $5.200 a sabores limón/pollo con evidencia de natural; T3 se retracta. El juez lo aprueba. | Vincular cada afirmación de precio a su SKU real y ampliar control del juez a consultas, sin imponer coincidencia textual exacta. |
| 27 | Mixto: recuperación pobre y juez | Opciones de lonchera poco pertinentes; no resuelve la necesidad de lácteos. El juez además acusa recomendar fórmula infantil que el texto excluye expresamente. | Separar calidad de recuperación/contexto del falso positivo de recomendación. |
| 35 | VIA: validación de medida; juez parcialmente incorrecto | Solicitud de huevos AA x12 llega a explicit_measure_mismatch y atención humana, sin pedido; se repiten agradecimientos. El juez también afirma que no existe presentación6 aunque COL-163 sí existe. | Reproducir candidato/medida y resolución que activan la barrera; conservar control de medidas. Mejorar cierre humano contextual. |
| 47 | VIA: continuidad en atención humana | Hay respuesta, pero repite el texto de conexión sin reconocer la aclaración sobre el jugo faltante. | Usar contexto durante atención humana; no es silencio de transporte ni motivo para reactivar venta autónoma. |
| 14,21,32 | Evaluador: evidencia inválida | Citas que no aparecen literalmente, cita vacía o correspondencia SKU/nombre incorrecta. No se pueden convertir automáticamente en aprobados. | Reparar generación de evidencia del juez; conservar validación de citas y veredicto original. |
| 17 | Evaluador: falso positivo de presupuesto | Marca producto$5.600 por superar$5.000, aunque el agente lo excluye expresamente y ofrece sopa$3.900. El juez semántico aprueba. | Distinguir mención/exclusión de recomendación efectiva en businessOutcomeAssertions. |
| 31 | Integración: transporte DeepSeek | La primera llamada falla con fetch failed y activa contingencia; después recupera la consulta. | Medir error/transporte aparte; una contingencia rápida no acredita análisis LLM correcto. |
| 03,50 | Límites de la simulación | El comprador03 repite confirmar cuando faltan datos; el juez50 exige dirección del diálogo aunque existe perfil guardado. También hay fallo de tarifa real50. | Diferenciar memoria válida, consentimiento de entrega y repetición artificial del comprador; no exonerar errores reales. |
| 40,otros | VIA: naturalidad | Importes correctos pero etiquetas monetarias repetidas y respuestas largas en consultas. | Reducir longitud manteniendo evidencia; evitar sumar una nueva llamada general a todos los turnos. |
| Conjunto | Rendimiento: objetivo8s incumplido | 61/182 turnos exceden8s; p95 12,062s. La mediana6,761s no demuestra cumplimiento. | Optimizar cadena de llamadas y recuperación, verificar tiempos previos al agente; preservar evaluación contextual y medir con guion fijo. |

## Consumo real por actor

| Actor | Solicitudes | Tokens entrada | Tokens salida | Tokens reportados |
|---|---:|---:|---:|---:|
| application | 579 | 2.986.941 | 117.536 | 3.104.477 |
| customer_actor | 132 | 267.357 | 23.558 | 290.915 |
| semantic_judge | 55 | 3.295.021 | 55.061 | 3.350.082 |

Comprador sintético y juez no son costos operativos del agente. El consumo con usage reportado no incluye tokens desconocidos de llamadas incompletas. Los turnos no equivalen a pedidos: hay consultas y escalamientos.

## Los 50 casos

| Caso | Estado automático | Turnos | Pedido | Auditorías | Máxima total | Revisión |
|---|---|---:|---|---:|---:|---|
| [01](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/01-pedido_claro_con_cliente_conocido/case-report.md) | passed | 6 | Sí | 1 | 10.377 s | El pedido final de $12.000 es correcto, pero el intérprete omitió inicialmente los dos Cifrut. Se recuperaron porque el comprador insistió; el aprobado oculta esa pérdida temporal. |
| [02](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/02-pedido_claro_con_cantidad_faltante/case-report.md) | passed | 6 | Sí | 1 | 6.922 s | Presentación por botón, cantidad por texto, invitación a agregar, pago y confirmación coherentes. Pedido de tres Chocoramos y dos Cifrut: $12.000. |
| [03](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/03-cliente_nuevo_domicilio_pide_nombre_direccion/case-report.md) | passed | 6 | Sí | 1 | 8.160 s | Cliente nuevo: conserva nombre, dirección y pago; pedido de $13.000. El comprador sintético repite «confirmo» cuando todavía se le piden datos. |
| [04](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/04-cliente_nuevo_completa_datos/case-report.md) | passed | 4 | Sí | 1 | 9.455 s | Interpreta dos paquetes de cinco arepas, conserva los datos del cliente y cobra $13.000. No confunde paquetes con piezas. |
| [05](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/05-disponibilidad_producto_premium/case-report.md) | passed | 2 | No | 0 | 8.329 s | Consulta de café y precio de $24.500 correctos. Dice que la tarifa y el mínimo requieren confirmación pese a estar configurados en cero; corregido y repetido después. |
| [06](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/06-consulta_cafe_generica_infiere_similares/case-report.md) | passed | 3 | No | 0 | 8.199 s | Responde la consulta de café y precio de $16.500; respeta que no es una compra. |
| [07](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/07-categoria_jugos/case-report.md) | passed | 3 | No | 0 | 14.054 s | Presenta jugos y precios correctos, pero trata la tarifa conocida como pendiente. Corregido y repetido después; continúa habiendo verbosidad. |
| [08](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/08-categoria_algo_para_la_sed/case-report.md) | passed | 3 | No | 0 | 9.498 s | Ofrece opciones de agua con precios correctos. Respuesta extensa y latencia por encima del objetivo. |
| [09](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/09-categoria_mecato_onces/case-report.md) | passed | 4 | No | 0 | 13.209 s | Sugiere productos para onces. Reconoce que desconoce la sal de la mantequilla; la promesa de seguimiento humano requiere mejor precisión. |
| [10](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/10-categoria_mercado/case-report.md) | passed | 3 | No | 0 | 10.711 s | Responde inicialmente solo sobre arroz; tras la aclaración del comprador ofrece opciones de aceite y huevos. No crea un pedido. |
| [11](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/11-categoria_aseo/case-report.md) | passed | 3 | No | 0 | 10.348 s | Consulta de aseo con precios y presentaciones correctos; respeta la negativa a comprar. |
| [12](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/12-categoria_onces_panaderia/case-report.md) | passed | 4 | No | 0 | 13.956 s | Extiende el precio de $5.200 de las papas naturales a otros sabores sin evidencia suficiente. Se retracta después; el evaluador no detecta la contradicción. |
| [13](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/13-consulta_combo_jamon_queso_pan_parcial/case-report.md) | passed | 4 | No | 0 | 12.968 s | Conserva necesidades de jamón, queso y pan. No inventa propiedades que desconoce y las deriva a revisión. |
| [14](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/14-indeciso_antojo_dulce/case-report.md) | evaluator_error | 3 | No | 0 | 9.918 s | La cita del juez omite parte del nombre de la chocolatina Jet y no es literal. Error del evaluador; no se registra pedido. |
| [15](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/15-indeciso_desayuno_rapido/case-report.md) | passed | 2 | No | 0 | 8.113 s | Sugiere sopa para desayuno. No hay pedido incorrecto, pero la pertinencia de la recomendación es mejorable. |
| [16](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/16-indeciso_algo_frio_para_tomar/case-report.md) | passed | 4 | No | 0 | 9.095 s | No equipara la categoría de bebida con su temperatura actual; consulta la condición desconocida. |
| [17](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/17-indeciso_presupuesto_bajo/case-report.md) | failed_integrity | 3 | No | 0 | 14.759 s | Ofrece una opción de $3.900 y excluye expresamente otra de $5.600 por exceder el presupuesto de $5.000. El validador confunde mención con recomendación. |
| [18](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/18-producto_impreciso_gaseosa/case-report.md) | passed | 3 | No | 0 | 10.364 s | Las opciones de gaseosas cambian parcialmente al solicitar precios. No se registra pedido; conviene mejorar continuidad de la lista. |
| [19](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/19-producto_impreciso_leche_bolsa/case-report.md) | passed | 3 | No | 0 | 8.614 s | Consulta de leche: Alquería $4.700 y Colanta $4.800; sin pedido. |
| [20](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/20-producto_impreciso_papel_bano/case-report.md) | passed | 3 | No | 0 | 10.392 s | No inventa paquetes de papel de seis u ocho rollos cuando encuentra cuatro y doce. Escala la condición desconocida. |
| [21](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/21-producto_impreciso_jabon_ropa/case-report.md) | evaluator_error | 3 | No | 0 | 8.569 s | Respuestas sobre Varela, Ariel y Rey; el juez agrega Fab con una cita vacía. Error del evaluador. |
| [22](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/22-mercado_basico_con_lista_parcial/case-report.md) | passed | 9 | Sí | 2 | 10.628 s | Mercado de tres productos por $16.500. La auditoría aclara correctamente entrega o recogida; después aprueba. Reconfirmaciones alargan el diálogo. |
| [23](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/23-pedido_claro_aseo_domicilio/case-report.md) | passed | 3 | Sí | 1 | 7.335 s | Pedido de aseo por $17.000 correcto; tres turnos y un ciclo completo del tendero. |
| [24](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/24-pedido_claro_sin_domicilio/case-report.md) | passed | 4 | Sí | 1 | 11.530 s | El comprador solicita domicilio durante la conversación, aunque el nombre del escenario diga sin domicilio. Pedido final de $9.700 coherente con esa solicitud. |
| [25](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/25-producto_impreciso_savital_sobre/case-report.md) | passed | 3 | No | 0 | 10.549 s | Identifica champú Savital de 18 ml por $1.200, sin confundirlo con acondicionador. |
| [26](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/26-consulta_precio_chocoramo/case-report.md) | passed | 2 | No | 0 | 7.173 s | Distingue Chocoramo de 65 g por $2.800 y mini de 35 g por $1.600. No crea pedido en la consulta. |
| [27](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/27-indeciso_lonchera_nino/case-report.md) | needs_review | 2 | No | 0 | 13.741 s | Recuperación poco pertinente para lonchera y necesidad de lácteos sin resolver. El juez también acusa recomendar una fórmula que la respuesta excluye. |
| [28](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/28-producto_no_catalogado_salmon/case-report.md) | passed | 2 | No | 0 | 7.330 s | Producto desconocido: deriva a atención humana sin inventar salmón en el catálogo. |
| [29](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/29-cliente_nuevo_coca_domicilio/case-report.md) | passed | 5 | Sí | 1 | 7.868 s | El botón abreviado ya no provoca una aclaración falsa del auditor. Coca-Cola de 1,5 L, datos actualizados, efectivo y total de $7.200. |
| [30](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/30-pedido_confirmado_dale_hagale/case-report.md) | passed | 4 | Sí | 1 | 8.088 s | Interpreta «dale, hágale» según el contexto; recoge el pago antes de confirmar el pedido de $2.200. |
| [31](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/31-consulta_tintico_cafe/case-report.md) | integration_fallback | 4 | No | 0 | 10.847 s | Falla de transporte inicial de DeepSeek («fetch failed»); usa contingencia y luego recupera la consulta. No se considera una respuesta LLM rápida correcta. |
| [32](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/32-pedido_claro_despensa_domicilio/case-report.md) | evaluator_error | 5 | Sí | 1 | 8.229 s | Tres productos por $23.500 correctos. El juez asigna nombres de Diana/Premier a SKU equivocados y produce evidencia inválida. |
| [33](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/33-pedido_con_typos_colombianos/case-report.md) | passed | 4 | Sí | 2 | 12.124 s | Conserva dos Chocoramos y un Cifrut por $7.400. El auditor aclara la modalidad y luego aprueba. La redacción de revisión humana aún resulta innecesaria. |
| [34](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/34-pedido_sin_cantidades_debe_preguntar/case-report.md) | passed | 5 | Sí | 1 | 9.868 s | Pedido final de $5.000 correcto; una pregunta de cantidad se acompaña de botones de presentación. Se amplió la evidencia de cantidades y se repitió después. |
| [35](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/35-pedido_despensa_sin_cantidades/case-report.md) | failed_functional | 9 | No | 0 | 11.912 s | La selección de huevos AA por doce es rechazada por explicit_measure_mismatch y deriva a humano. No hay pedido; se repiten agradecimientos. El juez también desconoce una presentación de seis existente. |
| [36](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/36-consulta_lacteos/case-report.md) | passed | 3 | No | 0 | 13.584 s | Responde consultas de leche y queso sin crear pedido. Los tres turnos exceden ocho segundos y son extensos. |
| [37](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/37-descuento_escala_aprobacion/case-report.md) | passed | 2 | No | 0 | 3.509 s | Escala el descuento sin concederlo automáticamente. La frase sobre una futura aprobación podría ser más neutral. |
| [38](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/38-pago_requiere_aprobacion/case-report.md) | passed | 2 | No | 0 | 7.047 s | Registra aviso de pago sin verificar ni acreditar el dinero. |
| [39](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/39-pide_humano/case-report.md) | passed | 2 | No | 0 | 3.279 s | Respeta la solicitud explícita de hablar con una persona. |
| [40](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/40-pedido_confirmado_handoff_operaciones/case-report.md) | passed | 3 | Sí | 1 | 8.943 s | Pan por $7.600 y Bre-B por texto, con auditoría correcta. Repite etiquetas monetarias innecesariamente. |
| [41](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/41-real_supermarket_saludo_solo_domicilio/case-report.md) | passed | 2 | No | 0 | 4.137 s | Saludo de Rocío y pregunta por productos; informa correctamente la política comercial configurada en cero. |
| [42](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/42-real_supermarket_pago_tarjeta_es_preferencia/case-report.md) | passed | 5 | Sí | 1 | 6.861 s | Tres Chocoramos por $8.400. Secuencia de variante, agregar, tarjeta, resumen auditado y confirmación coherente. |
| [43](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/43-real_supermarket_correccion_sin_producto/case-report.md) | passed | 5 | Sí | 1 | 9.013 s | «Sin el agua» elimina solo esa línea; conserva dos Chocoramos por $5.600. |
| [44](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/44-real_supermarket_agrega_producto_a_canasta/case-report.md) | passed | 5 | Sí | 1 | 7.977 s | Agrega queso sin perder el pan anterior. Pedido final de $17.400. |
| [45](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/45-real_supermarket_valor_calchichon_coca/case-report.md) | passed | 2 | No | 0 | 9.423 s | Conserva la solicitud de $5.000 de salchichón y Coca-Cola de 350 ml. Con bandera de venta por valor falsa, escala sin convertir el importe en cantidad ni autorizar el pedido. |
| [46](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/46-real_supermarket_foto_producto_handoff/case-report.md) | passed | 2 | No | 0 | 3.896 s | Ante imagen no especificada pregunta su significado; atiende la solicitud de humano sin fabricar contenido visual. |
| [47](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/47-real_supermarket_reclamo_faltante_handoff/case-report.md) | failed_functional | 2 | No | 0 | 2.737 s | Responde durante atención humana, pero repite el texto de conexión y no reconoce la aclaración del jugo faltante. Fallo de continuidad, no silencio. |
| [48](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/48-real_supermarket_comprobante_pago_aprobacion/case-report.md) | passed | 2 | No | 0 | 7.696 s | Aviso de transferencia por texto: notifica al tendero sin verificar el pago. Este escenario no prueba una imagen real de comprobante. |
| [49](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/49-real_supermarket_no_hay_ponque_escalamiento/case-report.md) | passed | 2 | No | 0 | 7.580 s | No selecciona una alternativa no aceptada a Ramo mora. Conserva los tres Chocoramos y escala el pendiente. |
| [50](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/cases/50-real_supermarket_confirmacion_solo_eso/case-report.md) | failed_functional | 7 | Sí | 1 | 11.485 s | El auditor ya reconoce el yogurt de 150 g elegido por botón. Persiste contradicción de tarifa conocida en cero, corregida y repetida después. Pedido final de $2.900. |

## Evidencia y límites

- Base fuente intacta: **sí**. Código estable durante la campaña: **sí**. Auditor activo: **true**.
- [Resumen original](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/summary.json), [manifest](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/run-manifest.json), [análisis por turno](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/audit-analysis.json), [revisión manual](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/manual-review.json), [proveedor](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/provider-requests.json), [base original antes/después](../test-results/contextual50-auditor-final-v2-20261105/20261105051111_8b0f4b32/baseline-source.json).
- [Consolidado JSON](evidencias/resultado-50-casos-auditor-corregido-2026-11-05.json).
- Catálogo de pruebas de 300 productos más fixtures por caso. No valida los datos ni latencia de Google/Meta reales, carga concurrente ni UI móvil. Se conserva separación por tenant y clone local.
- No se eliminan los fallos de una campaña cambiando sus etiquetas. Pruebas focalizadas y controles con errores inyectados se informan aparte.

Comando de repetición: `node scripts/e2e/run-contextual-audit-local.mjs` (carga credencial local sin imprimirla; crea un clon y un run nuevo).
