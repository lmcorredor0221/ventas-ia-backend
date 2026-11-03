# Informe financiero: costos y rentabilidad de VIA

**Fecha de corte:** 21 de octubre de 2026  
**Moneda de referencia:** USD y COP  
**Tasa de conversion para este modelo:** COP 3,300 por USD. Es una tasa de presupuesto definida para el analisis, no una TRM oficial ni la tasa definitiva de cobro.

## Conclusion ejecutiva

El dato de **USD 0.09** no corresponde de forma demostrable a una sola prueba E2E de 40 casos ni a 40 domicilios. Los archivos de DeepSeek agrupan el consumo por hora y por API key; esa franja incluye varias ejecuciones y otras solicitudes.

La corrida E2E final aprobada, `20261021055411_3c9799ea`, tiene un costo DeepSeek atribuible estimado entre **USD 0.0093 y USD 0.0126**. El rango se basa en sus tokens funcionales deduplicados y en el ajuste prudente por solicitudes HTTP sin `usage` individual.

Para un tenant que procese 500 domicilios al mes:

- **VIA paga DeepSeek:** USD 0.17 a USD 0.57 segun la complejidad conversacional; para presupuestar con reserva de telemetria, USD 0.24 a USD 0.77.
- **El tenant paga a Meta:** USD 0.80 a USD 2.00 si todos los mensajes son mensajes de servicio entregados dentro de la ventana activa. El valor depende de los mensajes salientes despues de su propia franquicia de 1,000 mensajes de servicio.
- El plan actual de **COP 99,000 por 500 domicilios** tiene margen de contribucion tecnico muy alto. No equivale a utilidad neta porque no se cuenta aun con facturas verificadas de infraestructura, soporte, cobro, impuestos ni ventas.

## 1. Conceptos que no deben mezclarse

| Concepto | Definicion en este informe |
| --- | --- |
| Caso E2E | Escenario de prueba. Puede ser una consulta, una aclaracion, una escalacion o un pedido. No equivale automaticamente a un domicilio. |
| Domicilio | Pedido completo que llega a confirmacion, pasa al tendero y puede marcarse en camino. |
| Mensaje entrante | Mensaje del comprador a WhatsApp. Meta no cobra por recibirlo. |
| Mensaje saliente | Mensaje que VIA entrega al comprador por Graph. Meta cobra por entrega y categoria. |
| Llamada DeepSeek | Una solicitud HTTP al modelo. Puede ser planner o composer. |
| Token cache hit | Entrada reutilizada por el cache de DeepSeek; tiene una tarifa muy inferior. |
| Costo VIA | DeepSeek y, cuando existan facturas verificadas, infraestructura y operacion propias. |
| Costo tenant | Meta/WhatsApp Business asociado al numero del tenant. No forma parte del costo de VIA si el tenant paga directo a Meta. |

## 2. Reconciliacion de los archivos de DeepSeek

Los dos ZIP suministrados son exportes de facturacion por **hora y API key**, no por `runId`, tenant, conversacion o pedido.

| Archivo | Costo total USD | Solicitudes | Cache hit | Cache miss | Tokens de salida |
| --- | ---: | ---: | ---: | ---: | ---: |
| `usage_data_2026-10-20_2026-10-20.zip` | 0.481260 | 1,447 | 843,386 | 916,903 | 272,042 |
| `usage_data_2026-10-21_2026-10-21.zip` | 0.069662 | 660 | 319,131 | 156,142 | 75,473 |
| Total exportado | 0.550923 | 2,107 | 1,162,517 | 1,073,045 | 347,515 |

Los datos que explican el aparente costo de USD 0.09 son:

| Periodo de facturacion DeepSeek | Costo USD | Solicitudes | Interpretacion correcta |
| --- | ---: | ---: | --- |
| 20/oct, 12:00 a 17:59 | 0.089519 | 444 | Consumo agregado de seis bloques horarios, no una corrida identificada. |
| 20/oct, 17:00 a 17:59 | 0.083868 | 426 | Una hora con muchas solicitudes; no coincide con una ejecucion E2E final aislada. |
| 20/oct, 23:00 a 23:59 | 0.035802 | 331 | Parte de las ejecuciones E2E iterativas de la noche. |
| 21/oct, 00:00 a 00:59 | 0.068384 | 649 | Incluye seis ejecuciones E2E, incluida la ultima aprobada. |

En el repositorio existen diez ejecuciones E2E entre 23:15 y 00:59, con resultados de 11/40 a 40/40. La ultima ejecucion exitosa termino a las 00:59. Por tanto, atribuir los USD 0.068384 de la hora completa, o los USD 0.09 de otra franja, a una sola corrida seria incorrecto.

### Costo atribuible a la corrida 40/40

La corrida final contiene:

| Medida | Valor |
| --- | ---: |
| Solicitudes HTTP DeepSeek capturadas por el runner | 112 |
| Eventos LLM que el runner sumo sin depurar | 95 |
| Eventos funcionales con uso, al eliminar acumulados entre pasos | 83 |
| Cache hit | 47,609 |
| Cache miss | 17,390 |
| Tokens de salida | 10,988 |

El exporte real muestra para `deepseek-flash` en hora valle USD 0.003/M para cache hit, USD 0.15/M para cache miss y USD 0.60/M para salida. La misma tarifa aparece en la documentacion vigente de DeepSeek.

```text
costo tokens medidos =
  47,609 x 0.003 / 1,000,000 +
  17,390 x 0.15  / 1,000,000 +
  10,988 x 0.60  / 1,000,000
= USD 0.009344
```

Hay 29 solicitudes HTTP sin `usage` individual. No es posible saber con los artefactos actuales si son reintentos, fallos o llamadas facturables adicionales. Se usan dos referencias para acotar el costo:

| Metodo | Costo estimado de la corrida 40/40 |
| --- | ---: |
| Tokens funcionales deduplicados | USD 0.009344 |
| Prorrateo de la hora 00:00 usando 112 de 649 solicitudes | USD 0.011801 |
| Reserva prudente: escalar tokens por 112 / 83 | USD 0.012609 |

El rango respaldado por evidencia es entonces **USD 0.0093 a USD 0.0126**, no USD 0.09.

## 3. Evidencia funcional E2E usada para proyectar domicilios

La suite cubrio 40 escenarios, pero no son 40 domicilios completos:

| Cobertura | Resultado |
| --- | ---: |
| Escenarios que comienzan una intencion de pedido a domicilio | 13 |
| Flujos que completan pago, confirmacion y pedido | 2 |
| Consultas de catalogo | 24 mensajes |
| Solicitudes de descuento, pago sensible o humano | 3 mensajes |
| Mensajes entrantes de cliente | 45 |
| Mensajes Graph salientes antes de despacho | 44 |
| Avisos de pedido en camino verificados | 1 |
| Mensajes interactivos | 11 |
| Mensajes de texto | 33 |

Los dos flujos completos son los casos 30 y 40. Ambos registraron 3 mensajes del comprador, 3 envios de VIA antes del despacho, un aviso adicional de despacho y 4 llamadas funcionales al modelo.

### Escenarios por domicilio

| Escenario | Evidencia | Entrantes | Salientes | Llamadas LLM | Cache hit | Cache miss | Salida | DeepSeek por domicilio, valle |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bajo | Promedio de casos 30 y 40 | 3 | 4 | 4 | 1,408 | 831 | 367 | USD 0.000349 |
| Medio | Bajo + aclaracion de cantidad del caso 02 | 4 | 5 | 6 | 2,560 | 1,230 | 700 | USD 0.000612 |
| Alto | Bajo + tres aclaraciones equivalentes al caso 02 | 6 | 7 | 10 | 4,864 | 2,028 | 1,366 | USD 0.001138 |

La proyeccion media es la base para los planes comerciales. Bajo y alto son sensibilidad, no promesas de que cada pedido tendra exactamente ese numero de turnos.

## 4. Tarifas y reglas de cobro

### DeepSeek, costo de VIA

Se utiliza `deepseek-flash`. La documentacion oficial publica las siguientes tarifas:

| Tipo | Hora valle USD / M | Hora pico USD / M |
| --- | ---: | ---: |
| Entrada cache hit | 0.003 | 0.006 |
| Entrada cache miss | 0.150 | 0.300 |
| Salida | 0.600 | 1.200 |

Hora pico DeepSeek: UTC 01:00-04:00 y 06:00-10:00 de lunes a viernes. El horario comercial colombiano suele caer fuera de esas franjas, pero debe presupuestarse el doble para una reserva de pico.

### WhatsApp Business Platform, costo del tenant

Para los calculos se asume que el comprador esta en Colombia y que Meta factura directamente al negocio titular del numero:

| Categoria | Tarifa Colombia USD por mensaje entregado | Uso en VIA |
| --- | ---: | --- |
| Servicio | 0.0008 despues de los primeros 1,000 mensajes mensuales por numero | Respuestas libres dentro de la ventana de atencion. |
| Utilidad | 0.0008 desde el primer mensaje | Plantilla de pedido confirmado, cambio o entrega si se usa fuera de la ventana. |
| Autenticacion | 0.0008 desde el primer mensaje | No se usa en el ciclo de pedido actual. |
| Marketing | 0.0125 desde el primer mensaje | No se usa en el ciclo de pedido actual. |

Reglas aplicadas:

1. Meta cobra mensajes **entregados**, no simplemente enviados.
2. Los mensajes entrantes del cliente no generan este cargo.
3. Desde el 1 de octubre de 2026, los mensajes de servicio se cobran por mensaje; los primeros 1,000 de servicio por numero empresarial y mes son gratuitos.
4. La franquicia es por numero de WhatsApp Business del tenant. No se comparte entre tenants ni se convierte en una bolsa de VIA.
5. Si el aviso "pedido en camino" sale despues de la ventana de 24 horas, debe enviarse como plantilla de utilidad. Esa plantilla se cobra desde el primer mensaje.
6. Los puntos de entrada Click-to-WhatsApp pueden crear ventanas promocionales sin cargo, pero no se consideran en el presupuesto base porque no todos los pedidos provienen de un anuncio elegible.

La pagina general de precios de Meta conserva texto anterior que dice que las respuestas de servicio son gratuitas dentro de 24 horas. Para esta fecha de corte se da prioridad a la FAQ de Meta, que anuncia expresamente el cobro de servicio desde el 1 de octubre de 2026 y la franquicia de 1,000 mensajes. Se debe confirmar el rate card de la cuenta de cada tenant antes de facturarle.

## 5. Proyeccion mensual por tenant: escenario medio

El escenario medio refleja un pedido completo mas una aclaracion. Los valores DeepSeek son costos de VIA. Los valores Meta son pagos directos del tenant y no se incluyen en el ingreso de VIA.

| Domicilios | Entrantes | Salientes | Mensajes Meta cobrables | Llamadas DeepSeek | Cache hit | Cache miss | Salida | VIA DeepSeek esperado USD / COP | VIA reserva USD / COP | Meta tenant USD / COP |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 400 | 500 | 0 | 600 | 256,000 | 122,950 | 70,000 | 0.0612 / 202 | 0.0826 / 273 | 0.0000 / 0 |
| 200 | 800 | 1,000 | 0 | 1,200 | 512,000 | 245,900 | 140,000 | 0.1224 / 404 | 0.1652 / 545 | 0.0000 / 0 |
| 300 | 1,200 | 1,500 | 500 | 1,800 | 768,000 | 368,850 | 210,000 | 0.1836 / 606 | 0.2478 / 818 | 0.4000 / 1,320 |
| 500 | 2,000 | 2,500 | 1,500 | 3,000 | 1,280,000 | 614,750 | 350,000 | 0.3061 / 1,010 | 0.4130 / 1,363 | 1.2000 / 3,960 |
| 1,000 | 4,000 | 5,000 | 4,000 | 6,000 | 2,560,000 | 1,229,500 | 700,000 | 0.6121 / 2,020 | 0.8260 / 2,726 | 3.2000 / 10,560 |
| 2,000 | 8,000 | 10,000 | 9,000 | 12,000 | 5,120,000 | 2,459,000 | 1,400,000 | 1.2242 / 4,040 | 1.6520 / 5,452 | 7.2000 / 23,760 |

La reserva aumenta DeepSeek en 34.9% para cubrir la diferencia entre 83 eventos con `usage` y 112 solicitudes HTTP. No es un cobro observado; es una cobertura prudente hasta que se instrumente cada solicitud.

Los mensajes Meta cobrables son los salientes de servicio que exceden los primeros 1,000 por **numero de WhatsApp Business del tenant y por mes**. Bajo el escenario medio, cada domicilio genera cinco mensajes salientes de servicio. Por tanto, en el plan Pro de 500 domicilios se estiman 2,500 mensajes: 1,000 gratuitos y **1,500 cobrables**, equivalentes a **USD 1.20 / COP 3,960** a la tarifa colombiana usada en este modelo. Los mensajes entrantes no se cobran; las plantillas de otra categoria o enviadas fuera de la ventana activa pueden cambiar el valor.

### Sensibilidad a la complejidad del pedido

| Domicilios | DeepSeek VIA bajo USD | DeepSeek VIA medio USD | DeepSeek VIA alto USD | Meta tenant bajo USD | Meta tenant medio USD | Meta tenant alto USD |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 0.0349 | 0.0612 | 0.1138 | 0.0000 | 0.0000 | 0.0000 |
| 200 | 0.0698 | 0.1224 | 0.2277 | 0.0000 | 0.0000 | 0.3200 |
| 300 | 0.1047 | 0.1836 | 0.3415 | 0.1600 | 0.4000 | 0.8800 |
| 500 | 0.1745 | 0.3061 | 0.5692 | 0.8000 | 1.2000 | 2.0000 |
| 1,000 | 0.3490 | 0.6121 | 1.1383 | 2.4000 | 3.2000 | 4.8000 |
| 2,000 | 0.6980 | 1.2242 | 2.2766 | 5.6000 | 7.2000 | 10.4000 |

La columna Meta supone que todos los mensajes salientes son de servicio y se entregan dentro de la ventana activa. Si uno de los mensajes por domicilio debe ser una plantilla de utilidad por salir despues de 24 horas, el costo de Meta es mayor solo por debajo de 250 domicilios en el escenario medio:

| Domicilios, escenario medio | Meta si los 5 mensajes son servicio USD | Meta con 1 utilidad por domicilio USD |
| ---: | ---: | ---: |
| 100 | 0.0000 | 0.0800 |
| 200 | 0.0000 | 0.1600 |
| 300 | 0.4000 | 0.4000 |
| 500 | 1.2000 | 1.2000 |
| 1,000 | 3.2000 | 3.2000 |
| 2,000 | 7.2000 | 7.2000 |

## 6. Modelo de precios recomendado

La IA no determina el precio de VIA: el costo esperado medido es muy bajo y aun la reserva maxima descrita abajo equivale a cerca de COP 15.03 por domicilio. El precio debe cubrir valor operativo, producto, soporte, captacion, riesgo de cobranza, infraestructura compartida y rentabilidad; no solo tokens.

### Planes sugeridos

Todos los precios son mensuales, **antes de IVA cuando aplique**, incluyen la plataforma VIA y no incluyen los cargos directos de Meta.

La columna de reserva maxima no es el costo esperado ni un valor que se facture al tenant. Es un techo de presupuesto por tenant: toma el escenario alto de la prueba E2E, aplica la tarifa pico vigente de DeepSeek y adiciona un 100% de contingencia. Es decir, equivale a cuatro veces el costo alto en hora valle. Se muestra en USD y COP a la tasa de presupuesto de COP 3,300/USD.

| Plan | Domicilios incluidos | Precio sugerido COP | Precio efectivo por domicilio COP | Reserva VIA DeepSeek medio COP | Reserva maxima DeepSeek mensual (alto, pico, +100%) | Mensajes Meta cobrables | Pago Meta tenant estimado COP | Contribucion antes de costos compartidos COP | Margen de contribucion |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Inicio | 100 | 29,900 | 299 | 273 | USD 0.46 / COP 1,503 | 0 | 0 | 29,627 | 99.1% |
| Base | 200 | 49,900 | 250 | 545 | USD 0.91 / COP 3,005 | 0 | 0 | 49,355 | 98.9% |
| Crecimiento | 300 | 69,900 | 233 | 818 | USD 1.37 / COP 4,508 | 500 | 1,320 | 69,082 | 98.8% |
| Pro | 500 | 99,000 | 198 | 1,363 | USD 2.28 / COP 7,513 | 1,500 | 3,960 | 97,637 | 98.6% |
| Escala | 1,000 | 169,000 | 169 | 2,726 | USD 4.55 / COP 15,026 | 4,000 | 10,560 | 166,274 | 98.4% |
| Red | 2,000 | 279,000 | 140 | 5,452 | USD 9.11 / COP 30,052 | 9,000 | 23,760 | 273,548 | 98.0% |

El plan de 500 en COP 99,000 es sostenible con los costos comprobados. La recomendacion comercial es usar **planes escalonados + bolsas de 100 domicilios adicionales por COP 19,900**. Deja un precio incremental de COP 199 por domicilio, evita que un pico operativo obligue a cambiar de plan de inmediato y mantiene descuento por volumen en los planes altos.

El precio no debe crecer de forma lineal porque la infraestructura, producto y monitoreo se comparten entre tenants. Tampoco debe bajar hasta el costo de IA: ese costo no cubre soporte humano, fallas de integracion, ventas ni mantenimiento.

### Margen bruto, contribucion y utilidad

- **Ingreso por suscripcion:** precio del plan de VIA.
- **Costo variable directo de VIA medido:** DeepSeek. En Pro 500 se reserva COP 1,363 mensuales.
- **Costo directo del tenant:** Meta/WhatsApp. En Pro 500 medio se estiman 1,500 mensajes de servicio cobrables, por COP 3,960 mensuales; no es costo de VIA si el tenant tiene facturacion directa.
- **Margen de contribucion antes de costos compartidos:** suscripcion menos DeepSeek. En Pro 500: COP 97,637 o 98.6%.
- **Margen bruto definitivo y utilidad estimada:** no se pueden calcular con rigor aun. Faltan facturas verificadas de Render, Vercel, PostgreSQL/Supabase, almacenamiento, monitoreo, soporte, pasarela, impuestos, cobranza, ventas y administracion.

No es correcto presentar el 98.6% como utilidad neta. Es la contribucion disponible para pagar costos fijos y generales.

## 7. Consolidado financiero de VIA

Escenario: tenants en plan Pro de 500 domicilios, costo DeepSeek con reserva media y Meta pagado directamente por cada tenant.

| Tenants Pro 500 | Ingreso suscripciones COP | DeepSeek VIA reservado COP | Contribucion antes de compartidos COP | Meta directo pagado por tenants COP | Infraestructura compartida |
| ---: | ---: | ---: | ---: | ---: | --- |
| 10 | 990,000 | 13,630 | 976,370 | 39,600 | Sin factura verificable |
| 50 | 4,950,000 | 68,150 | 4,881,850 | 198,000 | Sin factura verificable |
| 100 | 9,900,000 | 136,300 | 9,763,700 | 396,000 | Sin factura verificable |

Los costos que escalan por tenant son DeepSeek, almacenamiento incremental, soporte y, si VIA los subsidiara, los cargos Meta. Los costos compartidos son backend, base de datos, observabilidad, despliegue, dominio, seguridad y desarrollo. Para obtener utilidad neta debe aplicarse:

```text
utilidad antes de impuestos =
  ingresos por suscripciones
  - DeepSeek
  - infraestructura compartida verificable
  - soporte y operacion
  - comisiones de cobro
  - ventas y administracion
```

## 8. Recomendaciones operativas

1. Mantener Meta como facturacion directa del tenant. VIA debe mostrar una estimacion por numero y no marcarla como ingreso propio.
2. Cobrar suscripcion por domicilios, no por tokens ni por mensajes. Para el tendero es predecible y VIA absorbe una variacion tecnica muy pequena.
3. Registrar por cada envio Meta el estado de entrega y la categoria de pricing; registrar por cada llamada DeepSeek `tenant_id`, `conversation_id`, `order_id`, `request_id`, cache hit, cache miss, salida y costo.
4. Corregir el reporte E2E para no sumar listas de eventos acumulados entre pasos. Hoy muestra 95 referencias y 83 llamadas funcionales.
5. Medir durante un mes piloto la proporcion real de pedidos que requiere aclaracion, cuantas notificaciones salen despues de 24 horas y el consumo por tenant. Con esa informacion se puede sustituir la reserva por una tarifa observada.
6. Antes de prometer precios de WhatsApp, validar en Business Manager el rate card y la moneda de facturacion del tenant. Las tarifas se determinan por mensaje entregado, categoria y mercado del destinatario.

## Fuentes

- Exportes entregados: `usage_data_2026-10-20_2026-10-20.zip` y `usage_data_2026-10-21_2026-10-21.zip`.
- Evidencia E2E: `test-results/e2e-semantic/20261021055411_3c9799ea/`.
- [DeepSeek Models and Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [WhatsApp Business Platform FAQ](https://whatsappbusiness.com/es-la/resources/faq/)
- [WhatsApp Business Platform Pricing](https://whatsappbusiness.com/es-la/products/platform-pricing/)
- [Meta rate cards](https://developers.facebook.com/docs/whatsapp/pricing#rate-cards-effective-october-1-2026)

Las paginas de Meta mostraron una diferencia entre texto promocional antiguo y la FAQ de octubre de 2026. Este informe usa la actualizacion fechada de la FAQ para mensajes de servicio y la tarifa Colombia de la hoja de tarifas; la cuenta del tenant prevalece sobre cualquier estimacion.
