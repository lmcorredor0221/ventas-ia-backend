# Evidencia de aceptación contextual v2 — 2026-11-04

Estos son resultados del instrumento v2, no una certificación de producción. Los fallos de proveedor, del evaluador y de la aplicación se distinguen abajo. Los veredictos semánticos requieren revisar sus citas: pueden contener inferencias incorrectas. No se han corregido componentes productivos en esta etapa.

**Conclusión:** el 40/40 histórico no acreditaba conversaciones completas. La nueva campaña conserva diálogos, borradores y acciones del tendero, y descubre errores intermedios aunque el pedido final se recupere. [Auditoría manual y ejemplos](Auditoria-manual-aceptacion-contextual-2026-11-04.md).

## Grounding activo — 20261104182259_3869c026

Campaña: contextual50-v2. Casos: 50. Turnos cliente/VIA: **182**. Aprobados por el instrumento original: **25/50**. Este porcentaje no es comparable al 40/40 histórico: cambió el oráculo y el número de turnos.

Huella de la fuente PostgreSQL sin cambios: **true**. Intentos bloqueados de salida no autorizada: **0**. Pedidos persistidos: **9**. Flujos del tendero aprobados: **9**.

p95 acuse: 4256 ms; recepción/procesamiento local: 12183 ms. Esto no mide rendimiento bajo carga ni latencia real de Meta/Google.

Recepción → primer envío simulado nuevo, solo turnos con respuesta: p50 **7147 ms**, p95 **12070 ms** (180 muestras). Los silencios se reportan como fallos, no como latencia cero.

### Segunda lectura del mismo diálogo (evaluador 2.1)

No se volvió a ejecutar VIA ni se cambiaron resultados originales. Se entregó al juez el catálogo completo, se separaron alternativas del subtotal y se comprobaron cantidades máximas directamente en los borradores. Cada reporte conserva hash del original y del evaluador. La revisión manual sigue siendo necesaria.

| Clasificación de la segunda lectura | Casos |
|---|---:|
| integration_fallback | 1 |
| needs_review | 9 |
| failed_integrity | 11 |
| passed | 19 |
| incomplete_actor | 1 |
| evaluator_error | 3 |
| failed_functional | 6 |

Señales independientes y superpuestas: **11 casos exceden cantidades/importes del comprador**; **5 tienen tareas pendientes duplicadas**; **2 contienen silencio**; **12 superan el objetivo de acuse en algún turno**. No sumar estas categorías como si fueran excluyentes.

| Consumo medido | Solicitudes | Con usage | Entrada | Salida | Total tokens |
|---|---:|---:|---:|---:|---:|
| application | 476 | 474 | 1299009 | 116782 | 1415791 |
| customer_actor | 132 | 132 | 209627 | 17770 | 227397 |
| semantic_judge | 50 | 50 | 1572247 | 50566 | 1622813 |

Comprador y juez consumen tokens de ensayo; **no se suman al consumo operativo de VIA por domicilio**. Solicitudes sin usage no se estiman como cero facturado.

| Caso | Turnos | Resultado original | Evaluador 2.1 | Pedido | Evidencia |
|---|---:|---|---|---|---|
| 01-pedido_claro_con_cliente_conocido | 2 | failed_functional | integration_fallback | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/01-pedido_claro_con_cliente_conocido/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/01-pedido_claro_con_cliente_conocido.json) |
| 02-pedido_claro_con_cantidad_faltante | 6 | failed_functional | failed_integrity | Sí | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/02-pedido_claro_con_cantidad_faltante/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/02-pedido_claro_con_cantidad_faltante.json) |
| 03-cliente_nuevo_domicilio_pide_nombre_direccion | 9 | failed_functional | failed_integrity | Sí | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/03-cliente_nuevo_domicilio_pide_nombre_direccion/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/03-cliente_nuevo_domicilio_pide_nombre_direccion.json) |
| 04-cliente_nuevo_completa_datos | 3 | failed_functional | needs_review | Sí | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/04-cliente_nuevo_completa_datos/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/04-cliente_nuevo_completa_datos.json) |
| 05-disponibilidad_producto_premium | 2 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/05-disponibilidad_producto_premium/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/05-disponibilidad_producto_premium.json) |
| 06-consulta_cafe_generica_infiere_similares | 3 | passed | needs_review | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/06-consulta_cafe_generica_infiere_similares/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/06-consulta_cafe_generica_infiere_similares.json) |
| 07-categoria_jugos | 3 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/07-categoria_jugos/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/07-categoria_jugos.json) |
| 08-categoria_algo_para_la_sed | 2 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/08-categoria_algo_para_la_sed/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/08-categoria_algo_para_la_sed.json) |
| 09-categoria_mecato_onces | 3 | failed_functional | needs_review | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/09-categoria_mecato_onces/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/09-categoria_mecato_onces.json) |
| 10-categoria_mercado | 3 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/10-categoria_mercado/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/10-categoria_mercado.json) |
| 11-categoria_aseo | 3 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/11-categoria_aseo/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/11-categoria_aseo.json) |
| 12-categoria_onces_panaderia | 2 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/12-categoria_onces_panaderia/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/12-categoria_onces_panaderia.json) |
| 13-consulta_combo_jamon_queso_pan_parcial | 3 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/13-consulta_combo_jamon_queso_pan_parcial/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/13-consulta_combo_jamon_queso_pan_parcial.json) |
| 14-indeciso_antojo_dulce | 3 | passed | needs_review | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/14-indeciso_antojo_dulce/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/14-indeciso_antojo_dulce.json) |
| 15-indeciso_desayuno_rapido | 2 | failed_functional | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/15-indeciso_desayuno_rapido/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/15-indeciso_desayuno_rapido.json) |
| 16-indeciso_algo_frio_para_tomar | 3 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/16-indeciso_algo_frio_para_tomar/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/16-indeciso_algo_frio_para_tomar.json) |
| 17-indeciso_presupuesto_bajo | 2 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/17-indeciso_presupuesto_bajo/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/17-indeciso_presupuesto_bajo.json) |
| 18-producto_impreciso_gaseosa | 2 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/18-producto_impreciso_gaseosa/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/18-producto_impreciso_gaseosa.json) |
| 19-producto_impreciso_leche_bolsa | 2 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/19-producto_impreciso_leche_bolsa/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/19-producto_impreciso_leche_bolsa.json) |
| 20-producto_impreciso_papel_bano | 2 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/20-producto_impreciso_papel_bano/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/20-producto_impreciso_papel_bano.json) |
| 21-producto_impreciso_jabon_ropa | 3 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/21-producto_impreciso_jabon_ropa/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/21-producto_impreciso_jabon_ropa.json) |
| 22-mercado_basico_con_lista_parcial | 9 | failed_integrity | failed_integrity | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/22-mercado_basico_con_lista_parcial/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/22-mercado_basico_con_lista_parcial.json) |
| 23-pedido_claro_aseo_domicilio | 2 | failed_functional | incomplete_actor | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/23-pedido_claro_aseo_domicilio/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/23-pedido_claro_aseo_domicilio.json) |
| 24-pedido_claro_sin_domicilio | 7 | failed_functional | failed_integrity | Sí | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/24-pedido_claro_sin_domicilio/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/24-pedido_claro_sin_domicilio.json) |
| 25-producto_impreciso_savital_sobre | 3 | passed | passed **(objeción manual: formato incorrecto)** | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/25-producto_impreciso_savital_sobre/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/25-producto_impreciso_savital_sobre.json) |
| 26-consulta_precio_chocoramo | 3 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/26-consulta_precio_chocoramo/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/26-consulta_precio_chocoramo.json) |
| 27-indeciso_lonchera_nino | 3 | passed | evaluator_error | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/27-indeciso_lonchera_nino/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/27-indeciso_lonchera_nino.json) |
| 28-producto_no_catalogado_salmon | 2 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/28-producto_no_catalogado_salmon/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/28-producto_no_catalogado_salmon.json) |
| 29-cliente_nuevo_coca_domicilio | 3 | failed_integrity | evaluator_error | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/29-cliente_nuevo_coca_domicilio/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/29-cliente_nuevo_coca_domicilio.json) |
| 30-pedido_confirmado_dale_hagale | 3 | failed_functional | needs_review | Sí | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/30-pedido_confirmado_dale_hagale/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/30-pedido_confirmado_dale_hagale.json) |
| 31-consulta_tintico_cafe | 3 | failed_functional | needs_review | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/31-consulta_tintico_cafe/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/31-consulta_tintico_cafe.json) |
| 32-pedido_claro_despensa_domicilio | 7 | failed_integrity | failed_integrity | Sí | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/32-pedido_claro_despensa_domicilio/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/32-pedido_claro_despensa_domicilio.json) |
| 33-pedido_con_typos_colombianos | 5 | passed | needs_review | Sí | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/33-pedido_con_typos_colombianos/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/33-pedido_con_typos_colombianos.json) |
| 34-pedido_sin_cantidades_debe_preguntar | 6 | failed_integrity | failed_integrity | Sí | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/34-pedido_sin_cantidades_debe_preguntar/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/34-pedido_sin_cantidades_debe_preguntar.json) |
| 35-pedido_despensa_sin_cantidades | 9 | failed_integrity | failed_integrity | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/35-pedido_despensa_sin_cantidades/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/35-pedido_despensa_sin_cantidades.json) |
| 36-consulta_lacteos | 2 | passed | passed | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/36-consulta_lacteos/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/36-consulta_lacteos.json) |
| 37-descuento_escala_aprobacion | 2 | passed | failed_functional | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/37-descuento_escala_aprobacion/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/37-descuento_escala_aprobacion.json) |
| 38-pago_requiere_aprobacion | 1 | evaluator_error | failed_functional | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/38-pago_requiere_aprobacion/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/38-pago_requiere_aprobacion.json) |
| 39-pide_humano | 2 | passed | failed_functional | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/39-pide_humano/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/39-pide_humano.json) |
| 40-pedido_confirmado_handoff_operaciones | 9 | failed_functional | failed_integrity | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/40-pedido_confirmado_handoff_operaciones/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/40-pedido_confirmado_handoff_operaciones.json) |
| 41-real_supermarket_saludo_solo_domicilio | 2 | failed_functional | needs_review | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/41-real_supermarket_saludo_solo_domicilio/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/41-real_supermarket_saludo_solo_domicilio.json) |
| 42-real_supermarket_pago_tarjeta_es_preferencia | 9 | infra_error | failed_integrity | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/42-real_supermarket_pago_tarjeta_es_preferencia/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/42-real_supermarket_pago_tarjeta_es_preferencia.json) |
| 43-real_supermarket_correccion_sin_producto | 6 | passed | passed | Sí | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/43-real_supermarket_correccion_sin_producto/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/43-real_supermarket_correccion_sin_producto.json) |
| 44-real_supermarket_agrega_producto_a_canasta | 9 | failed_functional | failed_integrity | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/44-real_supermarket_agrega_producto_a_canasta/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/44-real_supermarket_agrega_producto_a_canasta.json) |
| 45-real_supermarket_valor_calchichon_coca | 2 | failed_integrity | failed_integrity | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/45-real_supermarket_valor_calchichon_coca/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/45-real_supermarket_valor_calchichon_coca.json) |
| 46-real_supermarket_foto_producto_handoff | 2 | failed_functional | failed_functional | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/46-real_supermarket_foto_producto_handoff/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/46-real_supermarket_foto_producto_handoff.json) |
| 47-real_supermarket_reclamo_faltante_handoff | 2 | passed | failed_functional | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/47-real_supermarket_reclamo_faltante_handoff/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/47-real_supermarket_reclamo_faltante_handoff.json) |
| 48-real_supermarket_comprobante_pago_aprobacion | 1 | evaluator_error | failed_functional | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/48-real_supermarket_comprobante_pago_aprobacion/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/48-real_supermarket_comprobante_pago_aprobacion.json) |
| 49-real_supermarket_no_hay_ponque_escalamiento | 2 | failed_functional | needs_review | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/49-real_supermarket_no_hay_ponque_escalamiento/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/49-real_supermarket_no_hay_ponque_escalamiento.json) |
| 50-real_supermarket_confirmacion_solo_eso | 3 | failed_integrity | evaluator_error | No | [Diálogo](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases/50-real_supermarket_confirmacion_solo_eso/case-report.md) · [Reevaluación](../test-results/contextual-v2-grounding/20261104182259_3869c026/evaluation-v2.1/50-real_supermarket_confirmacion_solo_eso.json) |

**Desacuerdo que sigue abierto:** el juez vuelve a aprobar el caso 25, pero la auditoría observa una botella de 180 ml dentro de opciones descritas como sobres de 18 ml. Ese aprobado no acredita corrección funcional. Consultar también los casos 14, 31, 41 y 46 en la auditoría manual.

Reevaluación adicional: 50 solicitudes del juez, 2978437 tokens reportados, 0 solicitudes sin usage. Este consumo tampoco pertenece al servicio operativo por domicilio.


Manifiesto y configuración: [run-manifest.json](../test-results/contextual-v2-grounding/20261104182259_3869c026/run-manifest.json). Uso real por solicitud: [provider-requests.json](../test-results/contextual-v2-grounding/20261104182259_3869c026/provider-requests.json). Resumen completo: [summary.json](../test-results/contextual-v2-grounding/20261104182259_3869c026/summary.json).

## Flujo anterior — 20261104185929_4ebc724b

Campaña: contextual50-v2. Casos: 6. Turnos cliente/VIA: **21**. Aprobados por el instrumento original: **0/6**. Este porcentaje no es comparable al 40/40 histórico: cambió el oráculo y el número de turnos.

Huella de la fuente PostgreSQL sin cambios: **true**. Intentos bloqueados de salida no autorizada: **0**. Pedidos persistidos: **3**. Flujos del tendero aprobados: **3**.

p95 acuse: 2849 ms; recepción/procesamiento local: 7312 ms. Esto no mide rendimiento bajo carga ni latencia real de Meta/Google.

Recepción → primer envío simulado nuevo, solo turnos con respuesta: p50 **4185 ms**, p95 **7290 ms** (21 muestras). Los silencios se reportan como fallos, no como latencia cero.

### Segunda lectura del mismo diálogo (evaluador 2.1)

No se volvió a ejecutar VIA ni se cambiaron resultados originales. Se entregó al juez el catálogo completo, se separaron alternativas del subtotal y se comprobaron cantidades máximas directamente en los borradores. Cada reporte conserva hash del original y del evaluador. La revisión manual sigue siendo necesaria.

| Clasificación de la segunda lectura | Casos |
|---|---:|
| failed_functional | 3 |
| evaluator_error | 3 |

Señales independientes y superpuestas: **0 casos exceden cantidades/importes del comprador**; **0 tienen tareas pendientes duplicadas**; **0 contienen silencio**; **2 superan el objetivo de acuse en algún turno**. No sumar estas categorías como si fueran excluyentes.

| Consumo medido | Solicitudes | Con usage | Entrada | Salida | Total tokens |
|---|---:|---:|---:|---:|---:|
| application | 41 | 41 | 52504 | 8952 | 61456 |
| customer_actor | 16 | 16 | 20939 | 2110 | 23049 |
| semantic_judge | 6 | 6 | 188561 | 4805 | 193366 |

Comprador y juez consumen tokens de ensayo; **no se suman al consumo operativo de VIA por domicilio**. Solicitudes sin usage no se estiman como cero facturado.

| Caso | Turnos | Resultado original | Evaluador 2.1 | Pedido | Evidencia |
|---|---:|---|---|---|---|
| 01-pedido_claro_con_cliente_conocido | 4 | failed_functional | failed_functional | Sí | [Diálogo](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/cases/01-pedido_claro_con_cliente_conocido/case-report.md) · [Reevaluación](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/evaluation-v2.1/01-pedido_claro_con_cliente_conocido.json) |
| 03-cliente_nuevo_domicilio_pide_nombre_direccion | 3 | failed_integrity | evaluator_error | No | [Diálogo](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/cases/03-cliente_nuevo_domicilio_pide_nombre_direccion/case-report.md) · [Reevaluación](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/evaluation-v2.1/03-cliente_nuevo_domicilio_pide_nombre_direccion.json) |
| 25-producto_impreciso_savital_sobre | 3 | failed_functional | failed_functional | No | [Diálogo](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/cases/25-producto_impreciso_savital_sobre/case-report.md) · [Reevaluación](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/evaluation-v2.1/25-producto_impreciso_savital_sobre.json) |
| 30-pedido_confirmado_dale_hagale | 2 | failed_integrity | evaluator_error | No | [Diálogo](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/cases/30-pedido_confirmado_dale_hagale/case-report.md) · [Reevaluación](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/evaluation-v2.1/30-pedido_confirmado_dale_hagale.json) |
| 43-real_supermarket_correccion_sin_producto | 5 | failed_functional | failed_functional | Sí | [Diálogo](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/cases/43-real_supermarket_correccion_sin_producto/case-report.md) · [Reevaluación](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/evaluation-v2.1/43-real_supermarket_correccion_sin_producto.json) |
| 50-real_supermarket_confirmacion_solo_eso | 4 | failed_functional | evaluator_error | Sí | [Diálogo](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/cases/50-real_supermarket_confirmacion_solo_eso/case-report.md) · [Reevaluación](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/evaluation-v2.1/50-real_supermarket_confirmacion_solo_eso.json) |

Reevaluación adicional: 6 solicitudes del juez, 356947 tokens reportados, 0 solicitudes sin usage. Este consumo tampoco pertenece al servicio operativo por domicilio.


Manifiesto y configuración: [run-manifest.json](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/run-manifest.json). Uso real por solicitud: [provider-requests.json](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/provider-requests.json). Resumen completo: [summary.json](../test-results/contextual-v2-legacy-comparison/20261104185929_4ebc724b/summary.json).

## Comparación acotada con el flag desactivado

Mismo hash de fuentes: **true**. Mismo catálogo: **true**. Solo se comparan los 6 casos seleccionados en ambas corridas. El comprador es adaptativo: los diálogos no son idénticos ni esto estima una tasa poblacional de mejora. No se hizo checkout de otro commit; "flujo anterior" significa el mismo árbol de trabajo con grounding apagado.

| Caso | Turnos activo/apagado | Pedido activo/apagado | Evaluación activo/apagado |
|---|---:|---|---|
| 01-pedido_claro_con_cliente_conocido | 2/4 | No/Sí | integration_fallback/failed_functional |
| 03-cliente_nuevo_domicilio_pide_nombre_direccion | 9/3 | Sí/No | failed_integrity/evaluator_error |
| 25-producto_impreciso_savital_sobre | 3/3 | No/No | passed/failed_functional |
| 30-pedido_confirmado_dale_hagale | 3/2 | Sí/No | needs_review/evaluator_error |
| 43-real_supermarket_correccion_sin_producto | 6/5 | Sí/Sí | passed/failed_functional |
| 50-real_supermarket_confirmacion_solo_eso | 3/4 | No/Sí | evaluator_error/evaluator_error |

## Validación focalizada del comprador corregido (2.1)

Nueva ejecución local 20261104191214_0d415b43, instrumento 2.1.0. Solo casos 23, 29, 40 y 50; no reemplaza la campaña de 50 ni es una nueva tasa global. Huella de la fuente sin cambios: **true**. No se corrigió el backend entre ambas pruebas.

| Caso | Turnos | Resultado | Terminación | Pedido | Evidencia |
|---|---:|---|---|---|---|
| 23-pedido_claro_aseo_domicilio | 3 | failed_functional | order_created | Sí | [Diálogo y aserciones](../test-results/contextual-v21-actor-validation/20261104191214_0d415b43/cases/23-pedido_claro_aseo_domicilio/case-report.md) |
| 29-cliente_nuevo_coca_domicilio | 4 | failed_functional | order_created | Sí | [Diálogo y aserciones](../test-results/contextual-v21-actor-validation/20261104191214_0d415b43/cases/29-cliente_nuevo_coca_domicilio/case-report.md) |
| 40-pedido_confirmado_handoff_operaciones | 9 | failed_integrity | customer_finished | No | [Diálogo y aserciones](../test-results/contextual-v21-actor-validation/20261104191214_0d415b43/cases/40-pedido_confirmado_handoff_operaciones/case-report.md) |
| 50-real_supermarket_confirmacion_solo_eso | 4 | failed_functional | order_created | Sí | [Diálogo y aserciones](../test-results/contextual-v21-actor-validation/20261104191214_0d415b43/cases/50-real_supermarket_confirmacion_solo_eso/case-report.md) |

Uso adicional medido: VIA 54 solicitudes/142633 tokens; comprador 16/33443; juez 4/241435. [Resumen completo](../test-results/contextual-v21-actor-validation/20261104191214_0d415b43/summary.json).

## Condición para continuar

Prioridad 1: preservar identidad y cantidad de cada línea al aclarar o reiterar datos; no pedir confirmación con productos pendientes. Prioridad 2: responder consultas intercaladas y conservar la intención de agregar, retirar o comparar. Prioridad 3: revisar latencias por etapa y fallos del proveedor, sin ocultarlos con respuestas predeterminadas.

Antes de corregir la aplicación: cerrar desacuerdos del instrumento y revisar los casos incompletos por actor. Conservar el flag apagado por defecto. Pendientes de liberación: comparación completa de ambas versiones, tres repeticiones críticas, variantes concurrentes de SuperMarket, continuidad del tendero en excepciones desde la UI y comprobación de Sheets real. No se realizó despliegue con este informe.
