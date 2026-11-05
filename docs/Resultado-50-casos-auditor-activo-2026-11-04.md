# 50 casos E2E con auditor de datos: resultados y latencia

Ejecución del **4 de noviembre de 2026, 22:22–23:02, Colombia** (5 de noviembre en UTC). Run: `20261105032251_b3b38c96`.

**La campaña terminó, pero no está lista para promoverse: 42/50 etiquetas aprobadas, fallos de contexto del auditor y objetivo de cinco segundos incumplido.** Se probaron 178 turnos principales y 17 pedidos persistidos. Los 17 completaron toma, alistamiento, despacho, notificación, cierre y apertura de una conversación nueva mediante las APIs locales.

No se modificó la lógica de VIA durante esta ejecución, no hubo despliegue ni mensajes reales. Se preservó el árbol de trabajo previo. Los únicos ajustes de ejecución fueron registrar la activación del auditor y el finish_reason del proveedor en el harness, más scripts locales de ejecución y análisis. No se cambió la interpretación contextual por respuestas simuladas.

## Condiciones verificadas y evidencia

- Backend real del workspace, PostgreSQL local clonado en `ventas_ia_e2e_20261105032251_b3b38c96`, tenant exclusivo `e2e_20261105032251_b3b38c96`.
- Catálogo de referencia de **300 productos**, más referencias adicionales por escenario; no se leyó ni modificó el catálogo de producción.
- `LLM_GROUNDING_ENABLED=true`, `LLM_ORDER_AUDIT_ENABLED=true`, auditor con límite de **5.000 ms**. Ese límite corresponde solo a su llamada, no a la respuesta completa. Interpretación con límite de 30.000 ms; resolución con presupuesto de 15.000 ms.
- DeepSeek real: se solicitó `deepseek-chat`; los cuerpos recibidos reportaron **deepseek-flash**. Es lo observado en las respuestas de esta campaña, no una suposición sobre otros modelos.
- Meta y Google simulados respetando los contratos del harness. Cliente sintético y juez independientes usan DeepSeek. Tendero simulado por API, no por navegador.
- Firma del webhook, challenge, estados de entrega ignorados y vínculo número–tenant: **5/5** contratos Meta aprobados. Cero solicitudes de red no autorizadas; solo proveedor de IA y servicios locales.
- La huella de `ventas_ia_dev` antes/después coincide: `a95776b0c7ae2a05c2cc3888748c19b5978d70703eab6bde37deec904f875d94`. También coinciden los hashes de archivos server antes/después. Fuente de la campaña: `87b42702a39fb407ce17bcc0b48862dde1d86facbfb43c2cbca9113c0e4af906`.
- El proceso salió con código 1 porque existen casos no aprobados; **ejecutó los 50**, no se interrumpió.

[Evidencia consolidada](evidencias/resultado-50-casos-auditor-activo-2026-11-04.json), [manifest](<../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/run-manifest.json>), [resumen original](<../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/summary.json>), [base original antes/después](<../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/baseline-source.json>) y [trazas del proveedor](<../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/provider-requests.json>).

## Resultado automático y revisión manual

| Estado original | Casos | Interpretación |
|---|---:|---|
| passed | 42 | Cumplen los oráculos automáticos, pero eso no descarta defectos ocultos. |
| integration_fallback | 3: 03, 29, 45 | Timeout o respuesta de contingencia. Dos terminan sin pedido; 29 sí termina. |
| failed_functional | 1: 50 | Repite la elección de variante y presenta botones de otra acción. El pedido termina. |
| evaluator_error | 4: 13, 21, 35, 43 | La evaluación no es confiable; no se convierten artificialmente en aprobados. |

Son **8 casos no aprobados**, no ocho pedidos cobrados incorrectamente. No se detectó incumplimiento de los contratos P0 de persistencia comprobados. En particular, el caso 45 no creó una venta no autorizada.

Además, entre los aprobados hay **tres casos con incidencias relevantes identificadas manualmente**: 02 (timeout recuperado), 10 (contrato de resolución rechazado) y 33 (contradicción sobre domicilio). El 13 combina error del evaluador con un rechazo de medida de VIA. Por tanto, no es válido presentar 42/50 como 42 conversaciones impecables ni calcular una tasa corregida excluyendo simplemente al evaluador.

| Caso | Causa y evidencia | Consecuencia real |
|---|---|---|
| 03 | Intérprete agota 30 s al recibir nombre, dirección y pago. | Respuesta a los 31,105 s; pierde continuidad hacia el cierre. No se creó pedido. No intervino el auditor en ese turno. |
| 29 | Auditor solo recibe id/rol/texto; pierde la selección interactiva de Coca-Cola 1,5 L. Además ignora su reiteración explícita en el texto del turno 3. | Aclaración falsa; redactor falla por required_term_missing. Tras reiterar datos, pedido correcto por $7.200. |
| 45 | SaleMode amount y requestedAmount=5000 sí se conservan. El SKU no autoriza venta por valor. El redactor anuncia erróneamente 250 g y luego produce importes sin marcadores aceptables. | Revisión humana correcta como límite comercial, pero explicación incorrecta/genérica. Dos fallbacks ungrounded_money. No se ejecuta auditor, porque la línea sigue pendiente. |
| 50 | Botón de yogurt de 150 g se reduce a título truncado en el historial del auditor. Este lo considera sin elegir. | Repregunta presentación, pero envía botones Efectivo/Tarjeta/Bre-B. El comprador debe reiterar; finalmente se registra $2.900. |
| 13 | El comprador sintético cambia una consulta por compra, incumpliendo el objetivo fijado. | No certifica el escenario de consulta; el rechazo independiente de medida se mantiene como hallazgo de VIA. |
| 21 | Juez atribuye Jabón Varela a SKU de Rey. | La cotización pública era correcta. Falla la evaluación, no el precio de VIA. |
| 35 | Juez reutiliza citas que contienen varios productos y fabrica fragmentos no literales. | La canasta de tres productos y $23.500 se conserva. Aparte, VIA pregunta por empaques de 12 como si aplicaran a arroz y aceite: defecto de redacción. |
| 43 | Juez atribuye al turno 5 una mención de producto del turno 4. | VIA sí retira el agua y conserva dos Chocoramos por $5.600. |
| 02 / 10 | Deadline de resolución de 15 s / IDs de necesidades reconstruidos en vez de copiados. | Recuperación o escalamiento, con demoras; el estado passed no informa la degradación. |
| 33 | VIA anuncia «el domicilio va sin costo» y el cliente acepta el resumen incluyendo domicilio; el borrador sigue delivery=false. | Comprobante final «No incluye servicio de domicilio». Auditor y juez lo aprueban. Hay una contradicción comercial aunque el total coincida por tarifa cero. |

En 45, el juez también exige un total definitivo y clasifica pérdida de necesidad. La revisión manual distingue: **los $5.000 permanecen en el borrador**, el total no se puede autorizar con bandera falsa y la escalación es esperada. El fallo probado está en la variante anunciada y la explicación al cliente. No se activó la bandera para forzar un aprobado.

La repetición «Subtotal de productos: Subtotal de productos» y «Domicilio: Domicilio» aparece en varios casos. Es un problema de integración de marcadores monetarios con la redacción del LLM; los números pueden ser correctos y aun así deteriorarse la experiencia.

## Qué aportó y qué no aportó el auditor

| Métrica | Resultado |
|---|---:|
| Llamadas / casos con auditoría | 31 / 19 |
| approve / correct / clarify / human_review | 29 / 0 / 2 / 0 |
| Correcciones aplicadas a datos en esta campaña | 0 |
| Aclaraciones falsas comprobadas | 2 (29 y 50) |
| Pedidos persistidos con sello de auditoría | 17 / 17 |
| Revisiones repetidas con el mismo hash dentro del caso | 0 |
| Revisiones tras las que aún faltaban campos | 12 |
| Duración mediana / p95 / máxima de auditoría | 1,451 / 2,049 / 2,110 s |

El auditor es una revisión LLM real y deja trazabilidad. **Esta campaña no demuestra corrección automática de datos: no emitió correct.** Los ocho controles focalizados anteriores sí incluyeron borradores deliberadamente erróneos, pero son otra ejecución y no se suman a estos cincuenta.

Se audita frecuentemente al cerrar la canasta y otra vez al registrar el pago. Las revisiones tienen hashes distintos; no es un error de caché del mismo borrador. Existe oportunidad de reservar la revisión completa para la cotización lista para presentar al cliente, manteniendo la selección contextual del momento y la invalidación ante cambios. En los datos observados no hubo revisiones antes de collectionComplete=true; el trabajo extra aparece principalmente antes de completar pago/datos.

El auditor revisa el borrador antes de redactar. No garantiza por sí solo que el texto y los botones posteriores representen ese borrador, ni que una aclaración del auditor quede conectada a la siguiente pregunta interactiva. Los casos 33 y 50 evidencian esos límites.

## Latencia observada

Desde recepción HTTP hasta captura del último envío saliente en el simulador. Se excluye el tiempo que tardan el comprador sintético y el juez. Percentiles por rango más cercano. Los 178 turnos obtuvieron respuesta; la aceptación operativa no equivale a responder en cinco segundos.

| Tramo / grupo | Muestras | Mediana s | p95 s | Máximo s | >5 s |
|---|---:|---:|---:|---:|---:|
| Acuse del webhook | 178 | 0,010 | 0,024 | 0,046 | 0 |
| Respuesta completa | 178 | 6,874 | 12,565 | 31,105 | 127 |
| Antes de iniciar agente | 178 | 0,028 | 2,413 | 3,652 | 0 |
| Agente hasta respuesta | 178 | 6,744 | 12,354 | 30,263 | 122 |
| Turnos con auditor | 31 | 7,759 | 12,133 | 12,231 | 30 |
| Turnos sin auditor | 147 | 6,608 | 12,651 | 31,105 | 97 |

**127/178 respuestas (71,3%) exceden cinco segundos.** Solo 51 cumplen ese límite. El webhook responde rápido: p95 24 ms. La espera dominante se encuentra después, en el agente.

| Etapa registrada en turnos | Eventos | Mediana s | p95 s | Máximo s |
|---|---:|---:|---:|---:|
| planner | 152 | 2,299 | 3,472 | 30,017 |
| grounding | 129 | 1,966 | 2,967 | 4,498 |
| composer | 154 | 1,572 | 2,289 | 2,763 |
| composer_evidence_review | 55 | 1,466 | 2,223 | 2,481 |
| auditor | 31 | 1,451 | 2,049 | 2,110 |

Interpretación, resolución y redacción se realizan en serie; algunas respuestas agregan revisión de evidencia y auditoría. **Quitar solamente el auditor no solucionaría el objetivo**: 97/147 turnos sin auditor también excedieron cinco segundos. La diferencia entre grupos no es un experimento A/B: difieren su complejidad y los actos conversacionales.

Los eventos de etapa no contienen necesariamente todos los intentos fallidos ni las pruebas auxiliares; no se suman percentiles ni se trata su suma como tiempo exacto de un turno. El timeout de 02 aparece como rechazo de grounding, no como llamada resuelta. Hay esperas previas de hasta 3,652 s cuya atribución exacta a cola/persistencia requiere más instrumentación; no se afirma que todo ese tiempo sea PostgreSQL.

Los tres mayores retrasos fueron: 03/T4 **31,105 s** (timeout intérprete), 02/T1 **20,185 s** (deadline resolutor) y 10/T3 **17,004 s** (reparación de contrato/resolución). Ninguno ejecutó auditor en ese turno. No se reprodujeron aquí los tres minutos observados previamente en producción; esta prueba no incluye latencias reales de Meta/Google ni concurrencia de tiendas.

## Consumo y persistencia

| Origen de llamadas reales | Solicitudes | Entrada reportada | Salida reportada | Total reportado |
|---|---:|---:|---:|---:|
| application | 580 | 2.983.230 | 122.414 | 3.105.644 |
| customer_actor | 130 | 267.189 | 23.267 | 290.456 |
| semantic_judge | 56 | 3.362.941 | 63.806 | 3.426.747 |

VIA hizo 580 solicitudes: **578 con usage y 2 sin usage**. Los 3.105.644 tokens son los reportados, no una estimación de los dos requests incompletos. Los cuerpos incompletos llegaron a registrar HTTP 200, pero no una finalización válida; HTTP 200 solo no acredita éxito. Todas las finalizaciones recibidas fueron stop, sin length observado. No se calcularon precios ni se imputaron los tokens del juez al costo comercial del agente.

| Etapa en contadores locales | Llamadas | Entrada | Salida |
|---|---:|---:|---:|
| planner | 169 | 694.221 | 54.122 |
| grounding | 149 | 1.007.405 | 36.549 |
| composer | 171 | 850.312 | 22.010 |
| composer_evidence_review | 55 | 267.321 | 4.853 |
| order_data_audit | 31 | 145.825 | 3.048 |
| interpreter_contract_repair | 4 | 18.192 | 2.204 |

El auditor consumió **145.825 tokens de entrada y 3.048 de salida (148.873 total)**: 4,8% del total reportado de aplicación, aproximadamente 4.802 tokens por revisión. Estos contadores incluyen 579 registros y 3.106.062 tokens, frente a 580 requests/3.105.644 tokens reportados: UsageService estima tokens cuando falta usage y no equivale al ledger del proveedor. Se conserva la diferencia, sin forzar reconciliación ni presentarla como consumo exacto facturado.

El consumo de aplicación incluye los 178 turnos principales y comprobaciones posteriores de reapertura; no es costo por domicilio. Hay consultas y escalaciones que no generan pedido.

La lectura final de PostgreSQL fue READ ONLY sobre el clon: **195 inbound procesados, 17 altas de pedido para Sheets, 34 proyecciones y 17 notificaciones de despacho**. Las 263 entradas de outbox quedaron processed, sin last_error ni reintentos. Son proyecciones contra simuladores, no confirmación de escritura en Google real.

## Comparación con la última campaña completa L

| Indicador | L anterior | Auditor activo |
|---|---:|---:|
| Etiquetas passed | 41/50 | 42/50 |
| Turnos principales | 156 | 178 |
| Pedidos y flujo tendero completados | 15 | 17 |
| Mediana respuesta | 7,597 s | 6,874 s |
| p95 respuesta | 14,165 s | 12,565 s |
| Máximo | 30,286 s | 31,105 s |
| Requests de aplicación | 484 | 580 |
| Tokens reportados de aplicación | 2.465.796 | 3.105.644 |

**No es una prueba causal del auditor.** Cambiaron el código, correcciones intermedias y conversaciones generadas. El hash anterior es `fbe6b8e73abb80431a400056fad2f95b4fd423ffbb21295e3931ef18ef874707`. No se atribuye el cambio de aprobados o latencia exclusivamente al auditor. La nueva ejecución sigue sin cumplir el objetivo de experiencia, aun con algunos indicadores agregados mejores.

## Acciones propuestas, sin implementar en esta ejecución

1. **Contexto verificable del auditor y pregunta única (P1).** En `server/services/orderDataAuditor.js` conservar selecciones interactivas verificadas, SKU/presentación y referencia al mensaje; aprovechar el registro de interacciones existente, sin interpretar títulos truncados como texto libre. En `server/services/agentRuntime.js` y el constructor de interacciones, llevar la aclaración elegida por el LLM a una única acción compartida entre texto y botones. Validar 29/50 con botones y con texto. El backend verifica pertenencia/versiones, el LLM interpreta el contexto.
2. **Entrega coherente (P1).** Revisar intérprete, auditor y `llmReplyComposer.js` para distinguir servicio no solicitado, solicitado, tarifa conocida y modalidad confirmada. No inferir entrega de un número cero. Evaluar cambios tardíos mediante el LLM y comparar el resumen público con el pedido persistido. Añadir al oráculo el caso 33 y tarifa no cero.
3. **Comunicación de venta por valor no habilitada (P1).** En `llmReplyComposer.js` separar requestedAmount de importe autorizado, conservar la variante seleccionada y explicar la revisión pendiente. No convertir automáticamente el importe en cantidad, no modificar flags ni prometer un total final no autorizado. Probar 45 falso y su variante habilitada como escenarios distintos.
4. **Presupuesto del turno y auditoría en el momento útil (P1).** Instrumentar las esperas de cola/persistencia y cada intento en `conversationGroundingCoordinator.js`, `llmProviderGateway.js` y runtime. Reutilizar evidencia vigente y decidir contextualmente si hay una cotización completa antes de auditar. Reducir llamadas seriales redundantes y payload; conservar límites de integridad. No ampliar el timeout ni sustituir el análisis por palabras clave para aparentar cumplir cinco segundos.
5. **Contratos y redacción (P2).** En resolutor/contratos, asegurar correspondencia de rawItemId y medidas sin introducir selección por score rígido. En compositor, usar marcadores tipados que permitan números seguros sin duplicar etiquetas o aplicar unidades de huevos a arroz/aceite. Medir reparaciones y revisar 02/10/13/35.
6. **Evaluador (P1 de confiabilidad).** En `server/tests/helpers/contextualCustomerActor.js` y `businessOutcomeAssertions.js`, fijar el objetivo del comprador o declarar explícitamente sus cambios; asociar cada cita al turno y producto correctos. Contar rechazos técnicos aunque luego el caso termine. No debilitar verificaciones de importes ni aprobar casos por eliminar afirmaciones fallidas.

Después: regresiones focalizadas con DeepSeek, controles positivos de reparación y negativos de consentimiento, repeticiones independientes de casos críticos y otra campaña congelada. Aceptación: cero aclaraciones falsas de selección, coherencia texto/botones/entrega, ninguna confirmación con pendientes, importes y flags por tenant preservados, **respuesta completa <=5 s** bajo el escenario definido. Reportar también p50/p95/máximo y repeticiones; un promedio bajo no basta.

## Los cincuenta casos, uno por uno

Cada número abre el informe original con conversación y comprobaciones. No se sobrescribieron sus veredictos. Máximo en segundos por turno principal.

| Caso | Estado original | Turnos | Auditorías | Máximo s | Revisión |
|---|---|---:|---:|---:|---|
| [01](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/01-pedido_claro_con_cliente_conocido/case-report.md) | passed | 4 | 2 | 12,133 | Pedido y despacho correctos: $12.000. |
| [02](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/02-pedido_claro_con_cantidad_faltante/case-report.md) | passed | 6 | 2 | 20,185 | Recupera pedido; timeout del resolutor de 15 s oculto por passed. |
| [03](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/03-cliente_nuevo_domicilio_pide_nombre_direccion/case-report.md) | integration_fallback | 5 | 2 | 31,105 | Timeout de interpretación de 30 s; no culmina el pedido. |
| [04](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/04-cliente_nuevo_completa_datos/case-report.md) | passed | 4 | 1 | 10,744 | Dos paquetes de arepas: $13.000; etiquetas monetarias repetidas. |
| [05](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/05-disponibilidad_producto_premium/case-report.md) | passed | 2 | 0 | 7,577 | Consulta de café, sin compra. |
| [06](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/06-consulta_cafe_generica_infiere_similares/case-report.md) | passed | 3 | 0 | 9,426 | Opciones de café molido. |
| [07](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/07-categoria_jugos/case-report.md) | passed | 4 | 0 | 10,065 | Opciones Cifrut; pendiente humano verificable para otras presentaciones. |
| [08](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/08-categoria_algo_para_la_sed/case-report.md) | passed | 3 | 0 | 10,294 | Recomendación de bebidas. |
| [09](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/09-categoria_mecato_onces/case-report.md) | passed | 4 | 0 | 15,059 | Consulta resuelta; primera respuesta con poca variedad. |
| [10](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/10-categoria_mercado/case-report.md) | passed | 4 | 0 | 17,004 | Consulta resuelta, pero dos rechazos por rawItemId inválidos. |
| [11](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/11-categoria_aseo/case-report.md) | passed | 3 | 0 | 12,212 | Consulta de aseo sin compra. |
| [12](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/12-categoria_onces_panaderia/case-report.md) | passed | 3 | 0 | 12,096 | Consulta de onces. |
| [13](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/13-consulta_combo_jamon_queso_pan_parcial/case-report.md) | evaluator_error | 5 | 1 | 12,387 | Comprador simulado cambia consulta a compra; además hubo rechazo de medida. |
| [14](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/14-indeciso_antojo_dulce/case-report.md) | passed | 2 | 0 | 13,439 | Opciones dulces. |
| [15](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/15-indeciso_desayuno_rapido/case-report.md) | passed | 4 | 0 | 11,711 | Opciones para desayuno; pertinencia mejorable. |
| [16](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/16-indeciso_algo_frio_para_tomar/case-report.md) | passed | 3 | 0 | 12,565 | No inventa refrigeración; consulta a la tienda. |
| [17](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/17-indeciso_presupuesto_bajo/case-report.md) | passed | 4 | 0 | 12,490 | Presupuesto de $5.000 tratado como límite. |
| [18](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/18-producto_impreciso_gaseosa/case-report.md) | passed | 3 | 0 | 9,391 | Opciones de gaseosa pequeña. |
| [19](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/19-producto_impreciso_leche_bolsa/case-report.md) | passed | 2 | 0 | 6,827 | Leche entera en bolsa y precios. |
| [20](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/20-producto_impreciso_papel_bano/case-report.md) | passed | 3 | 0 | 9,808 | Presentaciones de papel. |
| [21](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/21-producto_impreciso_jabon_ropa/case-report.md) | evaluator_error | 3 | 0 | 8,465 | VIA cotiza bien; el juez confunde Varela con Rey. |
| [22](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/22-mercado_basico_con_lista_parcial/case-report.md) | passed | 7 | 2 | 11,145 | Tres referencias elegidas: $16.500. |
| [23](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/23-pedido_claro_aseo_domicilio/case-report.md) | passed | 3 | 2 | 8,225 | Papel y dos jabones: $17.000. |
| [24](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/24-pedido_claro_sin_domicilio/case-report.md) | passed | 4 | 1 | 7,759 | Yogurt y Festival: $9.700. |
| [25](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/25-producto_impreciso_savital_sobre/case-report.md) | passed | 3 | 0 | 7,954 | Aclara shampoo sachet frente a acondicionador/botella. |
| [26](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/26-consulta_precio_chocoramo/case-report.md) | passed | 2 | 0 | 7,075 | Consulta de Chocoramo sin crear pedido. |
| [27](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/27-indeciso_lonchera_nino/case-report.md) | passed | 3 | 0 | 15,956 | Respeta preferencia dulce/lácteo al aclararla. |
| [28](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/28-producto_no_catalogado_salmon/case-report.md) | passed | 2 | 0 | 7,234 | Salmón ausente, pendiente humano; sin sustitución. |
| [29](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/29-cliente_nuevo_coca_domicilio/case-report.md) | integration_fallback | 5 | 2 | 9,786 | Auditor pide aclaración ya resuelta; fallback; finaliza correctamente por $7.200. |
| [30](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/30-pedido_confirmado_dale_hagale/case-report.md) | passed | 4 | 2 | 9,678 | Dale, hágale distingue cierre de lista y aceptación; $2.200. |
| [31](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/31-consulta_tintico_cafe/case-report.md) | passed | 3 | 0 | 12,651 | Distingue café preparado de empacado. |
| [32](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/32-pedido_claro_despensa_domicilio/case-report.md) | passed | 5 | 2 | 7,493 | Arroz, aceite y huevos: $23.500. |
| [33](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/33-pedido_con_typos_colombianos/case-report.md) | passed | 4 | 1 | 8,606 | Productos $7.400 correctos; anuncia domicilio gratis y luego lo excluye. |
| [34](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/34-pedido_sin_cantidades_debe_preguntar/case-report.md) | passed | 6 | 2 | 10,645 | Aclara presentaciones y cantidades; $5.000. |
| [35](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/35-pedido_despensa_sin_cantidades/case-report.md) | evaluator_error | 7 | 2 | 9,671 | Pedido $23.500 correcto; juez usa citas inválidas. Redacción de empaques mejorable. |
| [36](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/36-consulta_lacteos/case-report.md) | passed | 3 | 0 | 11,001 | Leche o queso como alternativas; no crea compra. |
| [37](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/37-descuento_escala_aprobacion/case-report.md) | passed | 2 | 0 | 3,001 | Rebaja no autorizada remitida al humano. |
| [38](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/38-pago_requiere_aprobacion/case-report.md) | passed | 2 | 0 | 6,475 | Aviso de transferencia, sin acreditar pago. |
| [39](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/39-pide_humano/case-report.md) | passed | 2 | 0 | 3,343 | Solicitud de persona remitida al humano. |
| [40](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/40-pedido_confirmado_handoff_operaciones/case-report.md) | passed | 3 | 1 | 6,377 | Bre-B por texto, pan $7.600. |
| [41](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/41-real_supermarket_saludo_solo_domicilio/case-report.md) | passed | 2 | 0 | 3,640 | Saludo contextual de Rocío; no busca productos inexistentes. |
| [42](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/42-real_supermarket_pago_tarjeta_es_preferencia/case-report.md) | passed | 3 | 1 | 10,949 | Tarjeta débito como preferencia; $8.400. |
| [43](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/43-real_supermarket_correccion_sin_producto/case-report.md) | evaluator_error | 6 | 2 | 6,981 | Quita agua, conserva dos Chocoramos $5.600; juez cita otro turno. |
| [44](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/44-real_supermarket_agrega_producto_a_canasta/case-report.md) | passed | 4 | 1 | 7,385 | Agrega queso sin borrar pan; $17.400. |
| [45](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/45-real_supermarket_valor_calchichon_coca/case-report.md) | integration_fallback | 4 | 0 | 7,747 | Importe $5.000 conservado; bandera impide venta. Respuesta cita variante equivocada y cae en fallback. |
| [46](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/46-real_supermarket_foto_producto_handoff/case-report.md) | passed | 3 | 0 | 5,692 | Imagen: aclara intención y remite al humano. |
| [47](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/47-real_supermarket_reclamo_faltante_handoff/case-report.md) | passed | 2 | 0 | 2,423 | Reclamo de entrega anterior, sin nueva compra. |
| [48](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/48-real_supermarket_comprobante_pago_aprobacion/case-report.md) | passed | 2 | 0 | 6,514 | Aviso de transferencia, sin aprobación financiera. |
| [49](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/49-real_supermarket_no_hay_ponque_escalamiento/case-report.md) | passed | 2 | 0 | 7,897 | Conserva Chocoramos y ponqué de mora pendiente. |
| [50](../test-results/contextual50-auditor-20261104/20261105032251_b3b38c96/cases/50-real_supermarket_confirmacion_solo_eso/case-report.md) | failed_functional | 6 | 2 | 12,231 | Auditor repregunta variante elegida; texto y botones no coinciden. Pedido final $2.900 correcto. |

## Reproducibilidad y límites

Comandos locales utilizados (credenciales cargadas en memoria, sin publicarlas):

`node scripts/e2e/run-contextual-audit-local.mjs`

`node scripts/e2e/analyze-contextual-auditor.mjs test-results/contextual50-auditor-20261104/20261105032251_b3b38c96`

`node scripts/e2e/capture-auditor-db-evidence.mjs test-results/contextual50-auditor-20261104/20261105032251_b3b38c96`

`node scripts/e2e/report-contextual-auditor.mjs test-results/contextual50-auditor-20261104/20261105032251_b3b38c96`

El launcher crea un run con fecha/ID y usa una base clonada. Mantener el consolidado y las evidencias del run antes de repetir: el log y hashes del directorio padre se renuevan. El clon de esta ejecución queda disponible para diagnóstico; no se borró la base fuente.

Una campaña no mide capacidad simultánea ni CPU/IO de producción. Los checks básicos de tenant y persistencia no sustituyen todas las variantes de concurrencia. Aquí no se repitieron sistemáticamente los críticos ni se probó UI móvil. El catálogo base usa tarifa y mínimo cero: se necesitan además combinaciones no cero y casos por tenant. El caso 45 es negativo para la bandera de venta por valor; los positivos del auditor/importe están en la [validación focalizada anterior](Implementacion-auditor-datos-y-venta-por-valor-2026-11-05.md), no se cuentan dentro del 42/50. Estos límites y los defectos observados impiden declarar listo el piloto.
