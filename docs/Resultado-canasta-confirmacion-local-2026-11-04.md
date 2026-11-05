# Resultado local: continuidad de canasta — 2026-11-04

DeepSeek real, catálogo de 300 productos, webhook firmado y Graph simulado sobre clones PostgreSQL locales. No hubo despliegue. Los actores son adaptativos: se compara el mismo corpus, no una reproducción idéntica de cada frase. Las expectativas comerciales no se redujeron para obtener aprobaciones.

Antes: [20261104182259_3869c026](../test-results/contextual-v2-grounding/20261104182259_3869c026/summary.md). Después: [20261104193454_396f8b87](../test-results/cart-continuity-full50/20261104193454_396f8b87/summary.md).

| Medida | Antes | Después |
|---|---:|---:|
| Casos | 50 | 50 |
| Turnos | 182 | 196 |
| Casos con cantidades/importes superiores a la canasta del comprador | 11 | 0 |
| Casos con botón Confirmar pedido y producto pendiente | 1 | 0 |
| Pedidos persistidos | 9 | 9 |
| Flujos del tendero aprobados | 9 | 9 |
| Casos con silencio | 2 | 1 |
| Reparaciones del contrato de identidad | 0 | 12 |

La medida de confirmación anterior inspecciona botones efectivamente enviados y el borrador del mismo turno; no pretende detectar todas las frases de confirmación posibles. Las cantidades incluyen todos los borradores intermedios, no solo el pedido final.

## Resultado completo del evaluador

| Clasificación automática | Casos |
|---|---:|
| needs_review | 20 |
| passed | 9 |
| failed_functional | 15 |
| infra_error | 1 |
| integration_fallback | 4 |
| failed_integrity | 1 |

Una clasificación needs_review/evaluator_error no certifica éxito ni demuestra por sí sola un fallo de VIA. Las citas, diálogos y aserciones quedan disponibles. Los fallos ajenos a estas dos correcciones no se descartan.

## Detalle por caso

| Caso | Excesos antes → después (turnos) | Confirmación incompleta después | Pedido / tendero | Resultado global |
|---|---:|---:|---|---|
| [01-pedido_claro_con_cliente_conocido](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/01-pedido_claro_con_cliente_conocido/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [02-pedido_claro_con_cantidad_faltante](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/02-pedido_claro_con_cantidad_faltante/case-report.md) | 1 → 0 | 0 | Sí / passed | needs_review |
| [03-cliente_nuevo_domicilio_pide_nombre_direccion](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/03-cliente_nuevo_domicilio_pide_nombre_direccion/case-report.md) | 5 → 0 | 0 | Sí / passed | needs_review |
| [04-cliente_nuevo_completa_datos](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/04-cliente_nuevo_completa_datos/case-report.md) | 0 → 0 | 0 | Sí / passed | needs_review |
| [05-disponibilidad_producto_premium](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/05-disponibilidad_producto_premium/case-report.md) | 0 → 0 | 0 | No / No ejecutado | passed |
| [06-consulta_cafe_generica_infiere_similares](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/06-consulta_cafe_generica_infiere_similares/case-report.md) | 0 → 0 | 0 | No / No ejecutado | passed |
| [07-categoria_jugos](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/07-categoria_jugos/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [08-categoria_algo_para_la_sed](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/08-categoria_algo_para_la_sed/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [09-categoria_mecato_onces](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/09-categoria_mecato_onces/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [10-categoria_mercado](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/10-categoria_mercado/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [11-categoria_aseo](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/11-categoria_aseo/case-report.md) | 0 → 0 | 0 | No / No ejecutado | infra_error |
| [12-categoria_onces_panaderia](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/12-categoria_onces_panaderia/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [13-consulta_combo_jamon_queso_pan_parcial](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/13-consulta_combo_jamon_queso_pan_parcial/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [14-indeciso_antojo_dulce](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/14-indeciso_antojo_dulce/case-report.md) | 0 → 0 | 0 | No / No ejecutado | passed |
| [15-indeciso_desayuno_rapido](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/15-indeciso_desayuno_rapido/case-report.md) | 0 → 0 | 0 | No / No ejecutado | passed |
| [16-indeciso_algo_frio_para_tomar](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/16-indeciso_algo_frio_para_tomar/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [17-indeciso_presupuesto_bajo](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/17-indeciso_presupuesto_bajo/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [18-producto_impreciso_gaseosa](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/18-producto_impreciso_gaseosa/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [19-producto_impreciso_leche_bolsa](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/19-producto_impreciso_leche_bolsa/case-report.md) | 0 → 0 | 0 | No / No ejecutado | passed |
| [20-producto_impreciso_papel_bano](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/20-producto_impreciso_papel_bano/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [21-producto_impreciso_jabon_ropa](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/21-producto_impreciso_jabon_ropa/case-report.md) | 0 → 0 | 0 | No / No ejecutado | passed |
| [22-mercado_basico_con_lista_parcial](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/22-mercado_basico_con_lista_parcial/case-report.md) | 1 → 0 | 0 | No / No ejecutado | integration_fallback |
| [23-pedido_claro_aseo_domicilio](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/23-pedido_claro_aseo_domicilio/case-report.md) | 0 → 0 | 0 | No / No ejecutado | integration_fallback |
| [24-pedido_claro_sin_domicilio](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/24-pedido_claro_sin_domicilio/case-report.md) | 2 → 0 | 0 | No / No ejecutado | failed_functional |
| [25-producto_impreciso_savital_sobre](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/25-producto_impreciso_savital_sobre/case-report.md) | 0 → 0 | 0 | No / No ejecutado | passed |
| [26-consulta_precio_chocoramo](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/26-consulta_precio_chocoramo/case-report.md) | 0 → 0 | 0 | No / No ejecutado | passed |
| [27-indeciso_lonchera_nino](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/27-indeciso_lonchera_nino/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [28-producto_no_catalogado_salmon](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/28-producto_no_catalogado_salmon/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [29-cliente_nuevo_coca_domicilio](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/29-cliente_nuevo_coca_domicilio/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [30-pedido_confirmado_dale_hagale](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/30-pedido_confirmado_dale_hagale/case-report.md) | 0 → 0 | 0 | No / No ejecutado | integration_fallback |
| [31-consulta_tintico_cafe](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/31-consulta_tintico_cafe/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [32-pedido_claro_despensa_domicilio](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/32-pedido_claro_despensa_domicilio/case-report.md) | 2 → 0 | 0 | Sí / passed | needs_review |
| [33-pedido_con_typos_colombianos](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/33-pedido_con_typos_colombianos/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [34-pedido_sin_cantidades_debe_preguntar](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/34-pedido_sin_cantidades_debe_preguntar/case-report.md) | 1 → 0 | 0 | Sí / passed | failed_functional |
| [35-pedido_despensa_sin_cantidades](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/35-pedido_despensa_sin_cantidades/case-report.md) | 3 → 0 | 0 | Sí / passed | needs_review |
| [36-consulta_lacteos](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/36-consulta_lacteos/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [37-descuento_escala_aprobacion](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/37-descuento_escala_aprobacion/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [38-pago_requiere_aprobacion](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/38-pago_requiere_aprobacion/case-report.md) | 0 → 0 | 0 | No / No ejecutado | integration_fallback |
| [39-pide_humano](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/39-pide_humano/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [40-pedido_confirmado_handoff_operaciones](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/40-pedido_confirmado_handoff_operaciones/case-report.md) | 1 → 0 | 0 | Sí / passed | needs_review |
| [41-real_supermarket_saludo_solo_domicilio](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/41-real_supermarket_saludo_solo_domicilio/case-report.md) | 0 → 0 | 0 | No / No ejecutado | needs_review |
| [42-real_supermarket_pago_tarjeta_es_preferencia](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/42-real_supermarket_pago_tarjeta_es_preferencia/case-report.md) | 2 → 0 | 0 | No / No ejecutado | needs_review |
| [43-real_supermarket_correccion_sin_producto](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/43-real_supermarket_correccion_sin_producto/case-report.md) | 0 → 0 | 0 | Sí / passed | passed |
| [44-real_supermarket_agrega_producto_a_canasta](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/44-real_supermarket_agrega_producto_a_canasta/case-report.md) | 2 → 0 | 0 | No / No ejecutado | needs_review |
| [45-real_supermarket_valor_calchichon_coca](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/45-real_supermarket_valor_calchichon_coca/case-report.md) | 1 → 0 | 0 | No / No ejecutado | needs_review |
| [46-real_supermarket_foto_producto_handoff](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/46-real_supermarket_foto_producto_handoff/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [47-real_supermarket_reclamo_faltante_handoff](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/47-real_supermarket_reclamo_faltante_handoff/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [48-real_supermarket_comprobante_pago_aprobacion](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/48-real_supermarket_comprobante_pago_aprobacion/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [49-real_supermarket_no_hay_ponque_escalamiento](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/49-real_supermarket_no_hay_ponque_escalamiento/case-report.md) | 0 → 0 | 0 | No / No ejecutado | failed_functional |
| [50-real_supermarket_confirmacion_solo_eso](../test-results/cart-continuity-full50/20261104193454_396f8b87/cases/50-real_supermarket_confirmacion_solo_eso/case-report.md) | 0 → 0 | 0 | Sí / passed | failed_integrity |

## Consumo, latencia y aislamiento

| Rol | Solicitudes y tokens reales |
|---|---|
| application | {"requests":575,"withUsage":569,"unreported":6,"inputTokens":1594899,"outputTokens":126949,"totalTokens":1721848} |
| customer_actor | {"requests":145,"withUsage":144,"unreported":1,"inputTokens":241320,"outputTokens":18219,"totalTokens":259539} |
| semantic_judge | {"requests":49,"withUsage":49,"unreported":0,"inputTokens":2873976,"outputTokens":56305,"totalTokens":2930281} |

Mediciones locales: {"webhookAckP95Ms":45,"workerProcessingP95Ms":10768,"plannerP95Ms":4525,"composerP95Ms":1636,"groundingP95Ms":2661}. No constituyen una prueba de capacidad o latencia de WhatsApp real.

Huella PostgreSQL fuente sin cambios: **true**. Salidas no autorizadas: **0**.

Hash de fuentes probadas: 6a8107e4e746339aac72967c22df7b27c04ee741c41ec7ef46b869696ba94f37. Catálogo idéntico a la referencia anterior: true.

## Alcance de la conclusión

Se observaron 0 casos con excesos de canasta y 0 con botón de confirmación incompleta en esta corrida. Estos resultados se complementan con las regresiones de contrato y no reemplazan repeticiones críticas, concurrencia, UI o Sheets real.

Los problemas de unidad frente a paquete, consultas intercaladas de precios/flete, escalamiento duplicado y silencios se revisan separadamente. El flag de grounding conserva su valor predeterminado deshabilitado. No se declara preparada la liberación por corregir dos defectos.

## Repetición focalizada de la versión final

La campaña de 50 casos detectó una regresión de selección: el título abreviado del botón volvía al intérprete y reabría la variante. Después se corrigió para conservar la elección validada, consultar el SKU actual y pedir al resolutor LLM la continuación. No se atribuye esa corrección posterior a la campaña anterior.

Ejecución final: [20261104201327_8e570e13](../test-results/cart-continuity-final/20261104201327_8e570e13/summary.md). Hash: 6e772cfe9d25fea888c291499c4e38a8cb3f8eb61d504c0075e3688411316494.

| Caso | Turnos | Excesos de canasta | Confirmación incompleta | Pedido / tendero | Resultado global |
|---|---:|---:|---:|---|---|
| [02-pedido_claro_con_cantidad_faltante](../test-results/cart-continuity-final/20261104201327_8e570e13/cases/02-pedido_claro_con_cantidad_faltante/case-report.md) | 5 | 0 | 0 | Sí / passed | needs_review |
| [03-cliente_nuevo_domicilio_pide_nombre_direccion](../test-results/cart-continuity-final/20261104201327_8e570e13/cases/03-cliente_nuevo_domicilio_pide_nombre_direccion/case-report.md) | 5 | 0 | 0 | Sí / passed | needs_review |
| [24-pedido_claro_sin_domicilio](../test-results/cart-continuity-final/20261104201327_8e570e13/cases/24-pedido_claro_sin_domicilio/case-report.md) | 7 | 0 | 0 | No / No ejecutado | needs_review |
| [32-pedido_claro_despensa_domicilio](../test-results/cart-continuity-final/20261104201327_8e570e13/cases/32-pedido_claro_despensa_domicilio/case-report.md) | 5 | 0 | 0 | Sí / passed | needs_review |
| [35-pedido_despensa_sin_cantidades](../test-results/cart-continuity-final/20261104201327_8e570e13/cases/35-pedido_despensa_sin_cantidades/case-report.md) | 6 | 0 | 0 | Sí / No ejecutado | evaluator_error |
| [50-real_supermarket_confirmacion_solo_eso](../test-results/cart-continuity-final/20261104201327_8e570e13/cases/50-real_supermarket_confirmacion_solo_eso/case-report.md) | 5 | 0 | 0 | Sí / passed | needs_review |

Totales de repetición: {"cases":6,"turns":33,"overflow":0,"premature":0,"orders":5,"tendero":4,"silence":0,"repair":0}. Base fuente sin cambios: true; salidas no autorizadas: 0.

Consumo de VIA en repetición: {"requests":92,"withUsage":92,"unreported":0,"inputTokens":262953,"outputTokens":19893,"totalTokens":282846}. Latencia: {"webhookAckP95Ms":3138,"workerProcessingP95Ms":8339,"plannerP95Ms":2984,"composerP95Ms":1563,"groundingP95Ms":2371}.

Las clasificaciones globales conservan los fallos de experiencia y del evaluador; una selección correcta no significa venta completa. Los siete grupos de regresión de contrato, grounding, arquitectura y contrato del evaluador pasaron con esta versión. WhatsApp y Google externos no se ejercitan en estas campañas.

La [revisión manual y los pendientes](Correccion-canasta-y-confirmacion-local-2026-11-04.md) distinguen el bloqueo de botones corregido, las consultas de flete sin responder, el identificador de pago por texto y los fallos del juez.
