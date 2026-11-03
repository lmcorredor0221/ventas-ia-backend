# VIA: capacidad y costos de infraestructura

**Fecha de corte:** 21 de octubre de 2026  
**Moneda de planeación:** USD 1 = COP 3.300  
**Alcance:** infraestructura de VIA. No incluye DeepSeek ni los cargos de WhatsApp que paga cada tenant directamente a Meta.

## Conclusión ejecutiva

VIA no tiene actualmente un problema de capacidad demostrada por carga. Tiene dos bloqueos de producción y una brecha de observabilidad que impiden afirmar una capacidad comercial:

1. **Render está suspendido.** El servicio `ventas-ia-backend-free` agotó la cuota de transferencia gratuita de su workspace. Mientras siga suspendido, Meta no podrá entregar webhooks al backend.
2. **Vercel está en Hobby.** El frontend consume muy poco, pero Hobby es para uso personal no comercial. VIA debe pasar a Pro antes de comercializar el servicio.
3. **La base de datos de VIA no es visible para la conexión actual de Supabase.** Por ello no se puede atribuir un plan, costo, tamaño, CPU, IOPS, conexiones ni egress actuales a VIA. El proyecto visible es de otra aplicación y no se debe cargar a este modelo.

La corrida E2E final sí da una base de rendimiento funcional: 40 de 40 casos aprobados, `p95` de respuesta del webhook de **29 ms** y `p95` del trabajo asíncrono de **4,268 s**. La cola protege el webhook, pero el worker procesa cada lote de forma **secuencial**. Con los supuestos explícitos de este informe, una sola instancia serial no debe planearse para más de aproximadamente **6 tenants del plan de 500 domicilios** durante picos de diez veces el promedio. Escalar requiere concurrencia acotada y una prueba de carga antes de prometer una cifra mayor.

## Evidencia consultada directamente

| Plataforma | Recurso VIA verificado | Estado y consumo observado | Lectura |
| --- | --- | --- | --- |
| Render | Web service `ventas-ia-backend-free` (`srv-db7sqqmq1p3s73elv1eg`) | Plan Free, Ohio, suspendido por Render. Dashboard: 0,15 CPU, 512 MB RAM. Workspace: 244,9/750 horas gratuitas, 7,08/5 GB de transferencia, 7 minutos de pipeline. Sin tarjeta registrada. | Incidente de disponibilidad. Los 7,08 GB son del workspace, que además contiene otro servicio, por lo que no son una medición atribuible solo a VIA. |
| Render | Postgres y Key Value | No hay recursos administrados de Render en el workspace. | VIA no usa una cola administrada de Render hoy. |
| Vercel | `ventas-ia-frontend` | Hobby. Últimos 30 días: 221,53 MB de Fast Data Transfer, 35.359 CDN requests, 19 s de CPU de requests y cero invocaciones de Function. | El frontend está muy por debajo de cuota. No es el cuello de botella actual. |
| Supabase | Proyecto de datos de VIA | La cuenta conectada muestra una organización Pro, pero solo expone el proyecto `oacyylgnzwcmtnwoiuak`, que corresponde a otra aplicación. El proyecto esperado de VIA no es accesible con esta conexión. | Costo y capacidad actuales de Postgres de VIA: **no verificados**. No se debe inventar ni imputar el costo del proyecto ajeno. |

### Límites y tarifas oficiales de referencia

| Servicio | Plan o recurso | Tarifa / límite relevante | Uso en este modelo |
| --- | --- | --- | --- |
| Render | Free actual | 0,1 CPU y 512 MB para web service según la documentación; el dashboard actual muestra 0,15 CPU y 512 MB. | No apto para el piloto comercial mientras el workspace esté suspendido. |
| Render | `0.5c-512mb`, `1c-2g`, `2c-4g` | 0,5 CPU/512 MB, 1 CPU/2 GB y 2 CPU/4 GB. Presupuesto mensual usado: USD 7, 25 y 85, respectivamente. | Web y worker dedicados en los escenarios. |
| Render | Workspace Pro | USD 25/mes, para controles de equipo y escalamiento; el workspace Hobby actual tiene 5 GB incluidos y cobra USD 0,15/GB adicional cuando hay método de pago. | Se presupuesta desde el escenario de 50 tenants. |
| Supabase | Free | 500 MB de base, CPU compartida/500 MB RAM, 5 GB egress y pausa tras una semana de inactividad. | No recomendado para producción. |
| Supabase | Pro + Micro | Pro USD 25/mes; Micro aproximadamente USD 10/mes. El primer compute Micro se cubre con el crédito del primer proyecto, para un costo base aproximado de USD 25/mes. | Punto de partida productivo propuesto. |
| Supabase | Small, Medium, Large | Aproximadamente USD 15, 60 y 110 de compute. Pro aporta 8 GB de disco y 250 GB de egress; los excedentes se facturan por uso. | Escalones de base de datos sujetos a métricas reales. |
| Vercel | Hobby actual | 100 GB Fast Data Transfer, 1 M CDN requests, pero solo para uso personal y no comercial. | Debe salir de Hobby. |
| Vercel | Pro | USD 20/mes, un seat de despliegue y USD 20 de crédito; incluye 1 TB de transferencia y 1 M CDN requests en la franja base. | Costo fijo desde el piloto comercial. |

Fuentes oficiales: [Render Pricing](https://render.com/pricing), [Render Compute Plans](https://render.com/docs/compute-plans), [Supabase Pricing](https://supabase.com/pricing), [Supabase Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk), [Vercel Hobby](https://vercel.com/docs/plans/hobby) y [Vercel Pro](https://vercel.com/docs/plans/pro-plan).

## Arquitectura y capacidad observada

El flujo correcto ya está encaminado en el código:

`Meta webhook -> PostgreSQL/integration_outbox -> worker -> catálogo/DeepSeek -> respuesta WhatsApp -> Google Sheets asíncrono`.

La prueba E2E local final validó que el webhook confirma rápido y que el procesamiento costoso se ejecuta después. Es el patrón que evita que Meta reintente por una llamada a DeepSeek, Google o el catálogo lenta.

Sin embargo, `IntegrationOutbox.drain()` obtiene un lote y ejecuta `await handler(entry)` dentro de un `for`. Por tanto, una instancia de worker procesa sus elementos uno por uno. PostgreSQL usa `FOR UPDATE SKIP LOCKED`, lo que permite que varias instancias reclamen trabajos diferentes, pero no existe todavía concurrencia acotada dentro de cada worker ni una prueba de carga que valide dicho escalamiento.

### Modelo de capacidad, no promesa de producción

Los cálculos siguientes usan los datos medidos y estos supuestos editables en el dashboard:

| Variable | Valor | Justificación |
| --- | ---: | --- |
| Domicilios por tenant | 500/mes | Plan Pro actual de referencia. |
| Mensajes entrantes que generan trabajo | 4 por domicilio | Supuesto conservador de una conversación de pedido, datos y confirmación. Debe reemplazarse con telemetría de producción. |
| Horas activas | 8 h/día, 30 días | Ventana comercial de planeación. |
| Factor de pico | 10x | Reserva para concentrar pedidos en horas de mayor demanda. |
| Worker p95 | 4,268 s/trabajo | Corrida E2E final de 40 casos. Incluye procesamiento asíncrono, no es una prueba de saturación. |
| Utilización objetivo | 60% | Margen para reintentos, variación de LLM, Meta y Google. |

Una instancia serial alcanza aproximadamente `3.600 / 4,268 x 60% = 506` trabajos/hora de planeación. Un tenant de 500 domicilios aporta 2.000 trabajos/mes: promedio 8,3/hora y pico modelado de 83/hora. El límite indicativo es `506 / 83 = 6` tenants. Es una señal de arquitectura, no una cuota comercial definitiva.

## Proyección de infraestructura compartida

La siguiente tabla presupone que antes de llegar a 10 tenants se agrega concurrencia acotada de 10 trabajos por worker, límites por proveedor, backpressure y pruebas de carga. Mientras eso no exista, la columna **workers seriales equivalentes** representa el riesgo real de mantener el diseño actual.

| Tenants Pro 500 | Domicilios/mes | Pico trabajos/h | Workers seriales equivalentes | Workers con concurrencia 10 a validar | Perfil propuesto | Infraestructura USD/mes | Infraestructura COP/mes | COP/tenant |
| ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 10 | 5.000 | 833 | 2 | 1 | Web `1c-2g`, 1 worker `1c-2g`, Supabase Pro/Micro, Vercel Pro | 95 | 313.500 | 31.350 |
| 25 | 12.500 | 2.083 | 5 | 1 | Igual al anterior, sujeto a carga | 95 | 313.500 | 12.540 |
| 50 | 25.000 | 4.167 | 9 | 1 | Web `1c-2g`, 1 worker `1c-2g`, Render Pro, Supabase Small, Vercel Pro | 125 | 412.500 | 8.250 |
| 100 | 50.000 | 8.333 | 17 | 2 | Web `2c-4g`, 2 workers `1c-2g`, Render Pro, Supabase Small, Vercel Pro | 210 | 693.000 | 6.930 |
| 250 | 125.000 | 20.833 | 42 | 5 | Web `2c-4g`, 5 workers `1c-2g`, Render Pro, Supabase Medium, Vercel Pro | 330 | 1.089.000 | 4.356 |
| 500 | 250.000 | 41.667 | 83 | 9 | 2 web `2c-4g`, 9 workers `1c-2g`, Render Pro, Supabase Medium, Vercel Pro | 515 | 1.699.500 | 3.399 |
| 1.000 | 500.000 | 83.333 | 165 | 17 | 2 web `2c-4g`, 17 workers `1c-2g`, Render Pro, Supabase Large, Vercel Pro | 765 | 2.524.500 | 2.525 |

Los costos Render de la tabla son presupuesto de diseño, no factura vigente. La tarifa definitiva depende del plan elegido, región, impuestos y uso adicional. Tampoco incluye DeepSeek, Meta, dominios, soporte, nómina, impuestos, recaudo o herramientas de observabilidad externas.

## Impacto financiero a 500 domicilios por tenant

Para hacer comparable la capacidad con el modelo comercial, se usó el plan Pro de VIA de COP 99.000 por tenant y 500 domicilios. El resultado conserva el costo DeepSeek operativo que ya estaba modelado en el dashboard y suma la infraestructura compartida de esta proyección.

| Tenants Pro 500 | Ingreso mensual COP | Infraestructura COP | Costo DS operativo COP | Resultado antes de gastos generales COP | Margen antes de gastos generales |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 990.000 | 313.500 | 13.628 | 662.872 | 67,0% |
| 25 | 2.475.000 | 313.500 | 34.070 | 2.127.430 | 85,9% |
| 50 | 4.950.000 | 412.500 | 68.140 | 4.469.360 | 90,3% |
| 100 | 9.900.000 | 693.000 | 136.280 | 9.070.720 | 91,6% |
| 250 | 24.750.000 | 1.089.000 | 340.700 | 23.320.300 | 94,2% |
| 500 | 49.500.000 | 1.699.500 | 681.400 | 47.119.100 | 95,2% |
| 1.000 | 99.000.000 | 2.524.500 | 1.362.800 | 95.112.700 | 96,1% |

El resultado anterior **no es utilidad neta**. Aún faltan gastos generales, soporte, medios de pago, impuestos, ventas, atención de incidentes y cualquier consumo que rebase las cuotas incluidas. El dashboard permite modificar los supuestos y recalcula las cifras.

## Puntos de escalamiento y acciones

| Prioridad | Acción | Disparador | Resultado esperado |
| --- | --- | --- | --- |
| P0 | Restaurar Render: añadir método de pago o pasar de workspace; mantener web en plan pagado. | Estado actual: suspendido por egress. | Webhook disponible y costo controlado. |
| P0 | Confirmar el proyecto Supabase de VIA comparando el host/referencia de `DATABASE_URL` en Render sin revelar secretos, y reconectar esa organización al conector. | Estado actual: base real no accesible. | Inventario de DB, backups, disco, CPU, IOPS, conexiones y facturación atribuibles a VIA. |
| P0 | Pasar `ventas-ia-frontend` a Vercel Pro. | Antes de uso comercial. | Cumplimiento del uso comercial y presupuestos de gasto. |
| P1 | Separar el servicio HTTP del worker en Render y verificar `WHATSAPP_ASYNC_INBOUND_ENABLED=true`, `INTEGRATION_OUTBOX_ENABLED=true`, HTTP sin workers y worker dedicado. | Antes del piloto con varios tenants. | ACK de Meta independiente de DeepSeek, Sheets y Google. |
| P1 | Agregar concurrencia acotada configurable al worker, rate limits por Meta/DeepSeek y métricas de profundidad/edad de cola. | Antes de 10 tenants Pro 500. | Evitar crecimiento lineal de workers seriales. |
| P1 | Ejecutar prueba de carga contra staging con tráfico de Meta simulado, no el Graph API real. | Tras instrumentar métricas. | Convertir la proyección en una capacidad y un costo validados. |
| P2 | Escalar Supabase por señales reales: CPU sostenida >60%, pooler >70%, p95 de consultas, IOPS, disco >70% o backlog creciente. | Cuando aparezcan métricas del proyecto VIA. | Pasar Micro -> Small -> Medium sin anticiparse innecesariamente. |
| P2 | Usar Render Pro y workers múltiples/autoscaling al superar 50 tenants o antes si la carga lo exige. | Pico o cola por encima del SLO durante carga. | Capacidad horizontal y recuperación ante fallos. |

## Observabilidad mínima antes de ampliar el piloto

La telemetría actual aporta decisiones del agente, tokens, llamadas, duración, webhook y outbox. No registra de forma propia CPU, RSS/memoria, event loop lag, I/O, conexiones PostgreSQL, IOPS o profundidad y edad de cola con series temporales.

Instrumentar, sin registrar PII de mensajes:

- webhook: tasa, `p50/p95/p99`, 2xx/4xx/5xx y reintentos de Meta;
- outbox: pendientes, edad máxima, reclamos, reintentos, fallos terminales y duración por tipo;
- worker: concurrencia activa, cola, `p95` por etapa, event-loop lag, CPU y RSS;
- Postgres: conexiones/pooler, CPU, memoria, disco, IOPS, `p95` SQL, locks y tamaño;
- proveedores: DeepSeek/Meta/Google por tenant, latencia, errores, límites y costo;
- frontend: Core Web Vitals, errores JavaScript y requests de CDN.

Definir alertas iniciales: webhook `p95 > 1 s`, backlog con edad `> 60 s`, worker `p95 > 15 s`, error de proveedor `> 2%` en 10 minutos, y uso de CPU, memoria, pool o disco `> 70%` sostenido. Los umbrales se recalibran con carga medida.

## Límites del análisis

- Render estaba suspendido; no hubo series de CPU/memoria reales de VIA para convertir la estimación en benchmark.
- Los datos de Vercel son de frontend estático y no permiten inferir la capacidad del backend.
- No se pudo consultar el Supabase que usa realmente VIA. Hasta resolverlo, cualquier costo de DB es una proyección de precio oficial, no una factura actual.
- La corrida E2E fue funcional y secuencial; valida comportamiento, no 10, 100 o 1.000 tenants simultáneos.
- Los escenarios toman 500 domicilios por tenant. El Excel permite modificar este y los demás supuestos.

## Recomendación

Para un piloto comercial de hasta **5 tenants de 500 domicilios**, contratar o restaurar Render, migrar Vercel a Pro y operar Supabase Pro/Micro solo después de identificar el proyecto correcto. Antes de vender el plan a **10 tenants**, implementar concurrencia controlada, separar worker del HTTP, instrumentar la plataforma y superar una prueba de carga.

No conviene pagar desde hoy la arquitectura de 100 tenants. Conviene eliminar los bloqueos P0, medir 2 a 4 semanas del piloto y escalar por señales: profundidad de cola, latencia, conexiones, CPU, disco y gasto real. Esto conserva una experiencia sólida sin sobredimensionar el costo.
