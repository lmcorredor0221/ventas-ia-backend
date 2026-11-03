# Simulacion de costos para 500 domicilios

> **Estado: reemplazado.** Este documento contiene una proyeccion preliminar anterior a la conciliacion de los exportes reales de DeepSeek. Para cifras de costo, atribucion de la prueba E2E, facturacion Meta por tenant y precios comerciales, usar [Informe-financiero-costos-y-rentabilidad-VIA-2026-10-21.md](Informe-financiero-costos-y-rentabilidad-VIA-2026-10-21.md).

**Fecha:** 21 de octubre de 2026  
**Base funcional:** corrida E2E final de 40 casos iniciada el 20 de octubre y consolidada en la madrugada del 21 de octubre de 2026.  
**Alcance:** pedidos recibidos por WhatsApp y procesados por VIA. No incluye infraestructura, Google Workspace, almacenamiento, soporte humano, impuestos, pasarela de pagos ni costos de Meta Business Agent.

## Resumen ejecutivo

Para 500 domicilios de **un tenant con un unico numero de WhatsApp Business**, el costo variable directamente atribuible a WhatsApp Business y DeepSeek se proyecta entre **USD 0.99 y USD 3.22** por ciclo mensual, equivalente a **COP 3,118 a COP 10,188** usando una TRM ilustrativa de COP 3,163.76 por USD.

El costo medio esperado es **USD 1.53 a USD 1.85** por 500 domicilios, o **COP 4,831 a COP 5,866**, segun DeepSeek facture en hora valle o pico. Representa **COP 9.66 a COP 11.73 por domicilio**.

El rubro dominante es WhatsApp una vez agotados los primeros 1,000 mensajes de servicio gratis del numero empresarial. La inferencia de DeepSeek representa entre 12% y 26% del costo de estos escenarios gracias al cache de contexto.

## Evidencia de las pruebas E2E

La ejecucion final disponible en `test-results/e2e-semantic/20261021055411_3c9799ea/` aprobo los 40 de 40 casos. Sus resultados relevantes son:

| Medida observada | Resultado |
| --- | ---: |
| Casos E2E aprobados | 40 / 40 |
| Mensajes recibidos desde Meta simulada | 45 |
| Mensajes enviados a Meta simulada | 44 |
| Solicitudes HTTP a DeepSeek interceptadas en red | 112 |
| Referencias de uso LLM reportadas por el runner | 95 |
| Tokens sumados por el runner sin deduplicar | 83,839 |
| Mediana de webhook | 29 ms |
| P95 del worker | 4,268 ms |

El flujo completo de pedido claro, pago, confirmacion y despacho se observa en el caso 30:

1. El cliente solicita agua a domicilio.
2. VIA envia la cotizacion y botones de pago.
3. El cliente elige Efectivo.
4. VIA envia la confirmacion y los botones Confirmar pedido, Ajustar pedido y Hablar con la tienda.
5. El cliente confirma.
6. El tendero toma el pedido y luego lo marca en camino.
7. VIA envia un unico aviso final: el pedido ya va en camino.

### Lo que la suite si y no representa

La suite valida 40 escenarios de negocio, pero no representa una muestra estadistica de 40 domicilios completos:

| Cobertura observada | Casos o mensajes |
| --- | ---: |
| Escenarios que inician una intencion de pedido a domicilio | 13 escenarios |
| Escenarios que completan pago, confirmacion, pedido y handoff | 2 escenarios |
| Consultas de catalogo | 24 mensajes |
| Solicitudes de descuento, pago sensible o humano | 3 mensajes |
| Mensajes entrantes totales | 45 |
| Mensajes Graph salientes antes de despacho | 44 |
| Avisos de despacho comprobados por tendero | 1 |
| Mensajes interactivos Graph | 11 |
| Mensajes de texto Graph | 33 |

Por ello, una proyeccion de 500 domicilios debe partir de los dos flujos completos y sumar aclaraciones de los casos que las probaron. Escalar linealmente los 40 casos produciria una estimacion de consultas de catalogo, no de 500 pedidos entregados.

## Limite de la telemetria actual

Los 95 registros de uso no son 95 llamadas facturables independientes. El runner conserva eventos LLM acumulados en varios pasos de una misma conversacion y luego los vuelve a sumar. Al deduplicar por caso, evento, marca de tiempo y traza se obtienen 83 eventos con uso:

| Medida deduplicada | Resultado |
| --- | ---: |
| Eventos LLM con uso | 83 |
| Tokens de entrada reportados | 64,999 |
| Tokens de salida reportados | 10,988 |
| Tokens totales reportados | 75,987 |
| Entrada cache hit | 47,609 |
| Entrada cache miss | 17,390 |

El contador HTTP del runner registra 112 solicitudes a DeepSeek. El resumen original cuenta 95 entradas, porque suma listas acumuladas de eventos por paso; la deduplicacion de esas listas deja 83 llamadas funcionales con uso. Quedan **29 solicitudes HTTP sin una medicion de uso individual**. No se puede afirmar aun si fueron reintentos, llamadas auxiliares o solicitudes facturables sin almacenar el identificador de solicitud que devuelve el proveedor.

Hay por tanto dos defectos de observabilidad que deben corregirse antes de usar estas cifras para conciliacion de facturas:

- el resumen E2E duplica eventos de uso historicos;
- no todas las solicitudes interceptadas dejan un registro de `usage` individual en el reporte.

Esta simulacion no usa los 83,839 tokens como costo directo. Toma como referencia casos completos deduplicados y mantiene por separado entrada cache hit, entrada cache miss y salida. Es una proyeccion operativa, no una factura.

## Escenarios de consumo por domicilio

Los escenarios mantienen el mismo contrato funcional probado: Meta entrega el webhook, VIA responde rapidamente, persiste el flujo, consulta el catalogo, usa DeepSeek para interpretar y redactar, y envia respuestas por la API de WhatsApp.

| Escenario | Conversacion representativa | Entrantes | Salientes | Llamadas DeepSeek | Cache hit | Cache miss | Salida |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Bajo | Pedido claro, pago interactivo, confirmacion y despacho | 3 | 4 | 4 | 1,408 | 831 | 367 |
| Medio | Escenario bajo mas una aclaracion de producto, presentacion o direccion | 4 | 5 | 6 | 2,560 | 1,230 | 700 |
| Alto | Escenario bajo mas tres turnos de ajuste, ambiguedad, sustitucion o confirmacion adicional | 6 | 7 | 10 | 4,864 | 2,028 | 1,366 |

El escenario bajo es el promedio de los dos flujos completos: casos 30 y 40. Cada uno tuvo 3 mensajes entrantes, 3 envios Graph antes de despacho, un aviso adicional de despacho, 4 llamadas LLM, 1,408 tokens cache hit, entre 823 y 838 cache miss, y entre 357 y 377 tokens de salida. El escenario medio agrega el patron de aclaracion del caso 02: 1 mensaje entrante, 1 salida Graph, 2 llamadas LLM, 1,152 cache hit, 399 cache miss y 333 tokens de salida. El alto agrega tres aclaraciones de ese mismo patron.

## Volumen proyectado para 500 domicilios

| Escenario | Mensajes entrantes | Mensajes salientes | Solicitudes DeepSeek | Cache hit | Cache miss | Tokens de salida |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Bajo | 1,500 | 2,000 | 2,000 | 704,000 | 415,250 | 183,500 |
| Medio | 2,000 | 2,500 | 3,000 | 1,280,000 | 614,750 | 350,000 |
| Alto | 3,000 | 3,500 | 5,000 | 2,432,000 | 1,013,750 | 683,000 |

## Tarifas aplicadas

### WhatsApp Business Platform

- Se proyecta solo mensajeria de servicio o utilidad transaccional entregada por VIA.
- Meta concede los primeros **1,000 mensajes de servicio gratis por numero de WhatsApp Business y por mes**.
- Para Colombia se aplica **USD 0.0008 por mensaje de servicio adicional**.
- Se asume que los avisos de pedido en camino enviados dentro de la ventana de servicio siguen esta tarifa. Si se envia un aviso fuera de la ventana de 24 horas, debe ser una plantilla de utilidad y puede aplicar otra tarifa.
- No se incluyen mensajes de marketing, autenticacion, conversaciones iniciadas por Meta Business Agent ni cargos de un proveedor intermediario.

### DeepSeek

La configuracion de costos se calcula con la tarifa vigente de `deepseek-flash`:

| Tipo de token | Hora valle USD / M tokens | Hora pico USD / M tokens |
| --- | ---: | ---: |
| Entrada cache hit | 0.003 | 0.006 |
| Entrada cache miss | 0.150 | 0.300 |
| Salida | 0.660 | 1.320 |

DeepSeek considera hora pico UTC 01:00-04:00 y 06:00-10:00 de lunes a viernes, salvo festivos chinos. La jornada diurna colombiana cae normalmente fuera de esas franjas, pero se presentan ambos costos para no ocultar la sensibilidad.

**Riesgo tecnico:** las pruebas actuales aun invocan el alias `deepseek-chat`. La documentacion de DeepSeek indica que los aliases `deepseek-chat` y `deepseek-reasoner` fueron retirados en julio de 2026. Antes de produccion debe fijarse el modelo soportado `deepseek-flash` y verificar que reporte `usage` completo.

## Costos proyectados

TRM usada unicamente para lectura en pesos: **COP 3,163.76 por USD**. La factura se liquida en USD y la conversion real dependera de la fecha, el medio de pago y el emisor.

| Escenario | WhatsApp USD | DeepSeek valle USD | Total valle USD | Total valle COP | Costo valle / domicilio COP |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bajo | 0.8000 | 0.1855 | 0.9855 | 3,118 | 6.24 |
| Medio | 1.2000 | 0.3271 | 1.5271 | 4,831 | 9.66 |
| Alto | 2.0000 | 0.6101 | 2.6101 | 8,258 | 16.52 |

| Escenario | WhatsApp USD | DeepSeek pico USD | Total pico USD | Total pico COP | Costo pico / domicilio COP |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bajo | 0.8000 | 0.3710 | 1.1710 | 3,705 | 7.41 |
| Medio | 1.2000 | 0.6541 | 1.8541 | 5,866 | 11.73 |
| Alto | 2.0000 | 1.2203 | 3.2203 | 10,188 | 20.38 |

Formula DeepSeek:

```text
costo = (cache_hit / 1,000,000 * tarifa_hit)
       + (cache_miss / 1,000,000 * tarifa_miss)
       + (salida / 1,000,000 * tarifa_salida)
```

Formula WhatsApp:

```text
costo = max(0, mensajes_salientes_de_servicio - 1,000) * USD 0.0008
```

## Reconciliacion de telemetria y sensibilidad

Aplicando la tarifa de DeepSeek a los 83 eventos funcionales deduplicados de la suite completa, el consumo medido de la ejecucion fue:

| Ejecucion E2E de 40 casos | Cache hit | Cache miss | Salida | DeepSeek valle | DeepSeek pico |
| --- | ---: | ---: | ---: | ---: | ---: |
| Medicion funcional deduplicada | 47,609 | 17,390 | 10,988 | USD 0.0100 | USD 0.0200 |

No se debe interpretar ese centavo de dolar como el costo de 40 domicilios: 24 de los 45 mensajes de cliente fueron consultas de catalogo, y solo dos escenarios concluyeron todo el ciclo de pedido. Sirve para auditar el consumo de la ejecucion y confirmar que la composicion de la respuesta tiene un costo reducido frente a WhatsApp.

La telemetria deja 29 solicitudes HTTP a DeepSeek sin `usage` asociado. Como cota prudente, la siguiente tabla trata esas 29 solicitudes como si tuvieran el mismo consumo promedio de las 83 medidas. Es una reserva de costo, no un cobro confirmado.

| Escenario | DeepSeek valle con reserva USD | DeepSeek pico con reserva USD | Total valle con reserva USD | Total pico con reserva USD |
| --- | ---: | ---: | ---: | ---: |
| Bajo | 0.2503 | 0.5007 | 1.0503 | 1.3007 |
| Medio | 0.4413 | 0.8826 | 1.6413 | 2.0826 |
| Alto | 0.8233 | 1.6466 | 2.8233 | 3.6466 |

La reserva incrementa solamente el componente DeepSeek en 34.9%. No altera el conteo de mensajes Meta ni reemplaza la instrumentacion por solicitud.

## Lecturas operativas

1. Con 500 domicilios concentrados en un unico numero de tienda, los mensajes enviados superan la franquicia gratuita. WhatsApp explica entre 74% y 88% del costo proyectado.
2. La franquicia no se reparte entre tenants. Cada tenant recibe su propia franquicia solo en el numero de WhatsApp Business que tenga registrado. Si un tenant procesa sus propios 500 domicilios, se calculan sus propios 2,000, 2,500 o 3,500 mensajes salientes; no puede compensarlos con numeros de otros tenants.
3. Sin cache de DeepSeek, el costo de IA en hora valle subiria aproximadamente a USD 0.285, USD 0.511 y USD 0.964 en los escenarios bajo, medio y alto, respectivamente. Es importante conservar mensajes y catalogo estables en el contexto para aprovechar cache.
4. El costo de los casos que escalan a humano no es necesariamente mayor: una escalacion temprana por producto ausente o ambiguedad puede requerir menos llamadas que varios ciclos de aclaracion. El costo humano no esta incluido aqui.
5. Los botones interactivos reducen texto libre y ciclos de aclaracion. Pago, confirmacion y ajuste deben seguir siendo interactivos cuando el contrato de Meta lo permita.

## Recomendaciones antes de facturar o escalar

1. Instrumentar cada llamada al proveedor con `tenant_id`, `conversation_id`, `order_id`, modelo, categoria, hora, tokens cache hit, cache miss, salida, costo calculado y `request_id`.
2. Corregir el resumen E2E para que no vuelva a sumar eventos LLM historicos y para que toda solicitud interceptada deje una medicion individual o un motivo de ausencia.
3. Migrar y fijar el modelo a `deepseek-flash`; ejecutar los 40 casos despues del cambio y comparar costo, latencia y calidad.
4. Reportar uso Meta por numero de telefono y categoria de mensaje. La franquicia de 1,000 mensajes es por numero, no por tenant global.
5. Medir por separado envios dentro y fuera de la ventana de servicio de 24 horas, porque las plantillas de utilidad o marketing cambian la tarifa.

## Fuentes de tarifas

- [WhatsApp Business Platform pricing](https://whatsappbusiness.com/es-la/products/platform-pricing/)
- [Preguntas frecuentes de WhatsApp Business](https://whatsappbusiness.com/es-la/resources/faq/)
- [DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [DeepSeek change log](https://api-docs.deepseek.com/updates/)
- [DeepSeek context caching](https://api-docs.deepseek.com/guides/kv_cache/)

Las tarifas de proveedores pueden cambiar. Antes de emitir precios comerciales o cargar saldo, se debe contrastar esta matriz con el rate card y la cuenta de facturacion vigentes.
