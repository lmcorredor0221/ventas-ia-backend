# Benchmark de nubes para VIA

**Fecha:** 21 de octubre de 2026  
**Decision que responde:** cual plataforma sostiene mejor el piloto y el crecimiento de VIA, considerando la arquitectura implementada, la proyeccion comercial de seis planes y la capacidad modelada de 10 a 1.000 tenants.

## Conclusion ejecutiva

**La mejor decision ahora es mantener el esquema hibrido Vercel + Render + Supabase, pero pasar inmediatamente a servicios pagados y persistentes.** No se recomienda una migracion a GCP, Azure o AWS antes del piloto comercial: hoy aumentaria el riesgo tecnico y de entrega sin una reduccion demostrada del costo total.

La arquitectura ya implementada encaja de forma directa con:

- **Vercel Pro** para el frontend React.
- **Render Web Service pagado** para recibir con baja latencia el webhook de Meta.
- **Render Background Worker pagado e independiente** para consumir la bandeja transaccional, ejecutar LLM, catalogo, WhatsApp y proyecciones a Google Sheets.
- **Supabase Pro** como PostgreSQL fuente de verdad y outbox durable.

GCP debe ser la primera alternativa a evaluar cuando el uso sostenido alcance aproximadamente **250 tenants** o cuando las metricas de cola, Postgres o costo por trabajo indiquen que el worker necesita autoscaling granular. Su equivalente natural es Cloud Run para API, Cloud Run Jobs o un servicio worker para la ejecucion, Cloud SQL para PostgreSQL, y Cloud Tasks o Pub/Sub solo despues de validar una migracion gradual de la cola. Azure y AWS son viables, pero no aportan una ventaja suficiente en la etapa actual salvo que aparezcan creditos, requisitos corporativos o capacidad operativa especifica en esas nubes.

Esta recomendacion no supone que Render sea intrinsecamente mas barato que las tres nubes. Recomienda la ruta con **menor riesgo total de operacion y migracion** mientras VIA valida conversion, carga y retencion.

## Alcance y fuentes

Este benchmark combina:

1. La arquitectura revisada en [Arquitectura y funcionamiento real de Ventas IA](Arquitectura-y-funcionamiento-real-Ventas-IA.md) y el flujo durable definido en [Plan de prioridad webhook, LLM y piloto](Plan-prioridad-webhook-llm-y-piloto.md).
2. La capacidad y presupuesto escalonado del libro [Dashboard estrategico VIA](Dashboard-estrategico-VIA-2026-10-21-mercado-ROI.xlsx), incluido en el estudio de [mercado y ROI](Estudio-mercado-ROI-VIA-2026-10-21.md).
3. La inspeccion directa de Render el 21 de octubre de 2026: `ventas-ia-backend-free` esta suspendido y el workspace muestra **7,08 GB usados sobre 5 GB incluidos**. El panel ofrece agregar metodo de pago para cobrar el excedente o pasar a Pro, que incluye 25 GB.
4. Precios y caracteristicas oficiales consultados el 21 de octubre de 2026. Los precios de nube varian por region, impuestos, almacenamiento, respaldo, egreso y compromiso; por tanto, las cifras no confirmadas por una calculadora con la region elegida se tratan como referencias, no como cotizaciones.

No se incluyen DeepSeek, Meta/WhatsApp, Mercado Pago, comisiones comerciales, soporte, impuestos ni desarrollo en la comparacion de nubes. Esos rubros ya viven en el modelo financiero y deben sumarse al costo de infraestructura elegido, no confundirse con el.

## Arquitectura que debe preservarse

```text
Meta WhatsApp
      |
      v
API publica / webhook  ---> PostgreSQL: inbound_messages + outbox
      |                                  |
      | HTTP 200 rapido                  v
      |                           worker durable independiente
      |                                  |
      v                                  +--> catalogo / Drive / Sheets
observabilidad                           +--> DeepSeek
                                         +--> WhatsApp Cloud API
```

Los principios no negociables son:

1. El webhook responde a Meta despues de persistir y deduplicar; no espera el LLM, Drive, Sheets ni el envio de WhatsApp.
2. PostgreSQL mantiene la fuente de verdad de conversaciones, pedidos, outbox, reintentos y eventos.
3. Un worker separado reclama trabajos, conserva locks, reintenta con backoff y lleva errores agotados a `dead_letter`.
4. Google Sheets es proyeccion operacional, no dependencia sincrona para aceptar un pedido.
5. API y worker deben mantenerse disponibles; una suspension automatica es incompatible con recibir mensajes de clientes.

El detalle implementado y los flags de activacion estan en el [plan de prioridad](Plan-prioridad-webhook-llm-y-piloto.md). La nube puede cambiar, pero estos contratos no.

## Estado actual y brecha de produccion

| Componente | Estado observado o modelado | Riesgo | Accion obligatoria antes del piloto |
|---|---|---|---|
| Render backend | `ventas-ia-backend-free` suspendido por exceder el ancho de banda incluido del workspace gratuito | Meta no puede entregar webhooks de forma fiable | Pasar el API a compute pagado y contratar un workspace o consumo con facturacion habilitada |
| Worker | El codigo tiene `npm run worker`, pero requiere un servicio persistente separado | El flag asincrono no es seguro sin consumidor durable | Crear y verificar un Background Worker con los mismos secretos y `DATABASE_URL` |
| Vercel | Uso observado bajo en el ultimo periodo; el presupuesto de produccion usa Pro | El plan actual debe validarse para uso comercial y limites reales | Pasar a Pro al abrir el piloto y fijar alertas de gasto |
| Supabase/PostgreSQL | El libro modela Pro/Micro; el proyecto y su plan productivo aun deben confirmarse de forma inequivoca | Datos, backups, RLS, limites y costos no verificables si se apunta al proyecto equivocado | Confirmar proyecto, region, RLS, backup, cuota y `DATABASE_URL` del entorno productivo |
| Observabilidad | Hay telemetria funcional, pero no una linea base de CPU, memoria, cola y DB consolidada | No se puede decidir escala con evidencia | Instrumentar p50/p95 de webhook y worker, edad de outbox, profundidad de cola, errores, pool y CPU/IO de DB |

Agregar solo una tarjeta a Render evita la suspension por exceso de ancho de banda, pero **no convierte el servicio Free en una base apta para el webhook**: Render documenta que Free no es para produccion y que el servicio se duerme tras 15 minutos sin trafico. Un webhook de Meta necesita un endpoint disponible sin el retraso de un arranque en frio.

## Demanda usada en el modelo

La hoja `Capacidad` presupone el caso conservador de todos los tenants en Plan Pro, con 500 domicilios al mes, cuatro mensajes entrantes de trabajo por domicilio, 8 horas operativas diarias y factor de pico 10. Es una cota de capacidad, no una prediccion de la mezcla comercial real.

| Tenants | Domicilios/mes | Trabajos entrantes/mes | Pico modelado de trabajos/hora | Presupuesto mensual actual del esquema hibrido |
|---:|---:|---:|---:|---:|
| 10 | 5.000 | 20.000 | 833 | USD 95 / COP 313.500 |
| 25 | 12.500 | 50.000 | 2.083 | USD 95 / COP 313.500 |
| 50 | 25.000 | 100.000 | 4.167 | USD 125 / COP 412.500 |
| 100 | 50.000 | 200.000 | 8.333 | USD 210 / COP 693.000 |
| 250 | 125.000 | 500.000 | 20.833 | USD 330 / COP 1.089.000 |
| 500 | 250.000 | 1.000.000 | 41.667 | USD 515 / COP 1.699.500 |
| 1.000 | 500.000 | 2.000.000 | 83.333 | USD 765 / COP 2.524.500 |

Los valores son el presupuesto vigente del modelo, con tasa de COP 3.300 por USD. Incluyen frontend, web, worker y base de datos por tramo; **no son la factura actual**. La facturacion actual conocida no es comparable porque Render esta en Free/suspendido y el plan productivo de Supabase aun debe validarse.

## Comparacion por alternativa

| Criterio | Esquema recomendado ahora: Vercel + Render + Supabase | GCP | Azure | AWS |
|---|---|---|---|---|
| Mapeo a la arquitectura actual | Directo: Web Service, Background Worker y Postgres mantienen API, outbox y worker | Alto: Cloud Run API + worker/Jobs + Cloud SQL. Cloud Tasks/Pub/Sub es evolutivo, no obligatorio el primer dia | Alto: Container Apps + Jobs/Service Bus + PostgreSQL Flexible Server | Alto: ECS/Fargate o Lambda + SQS + RDS PostgreSQL |
| Cambio de codigo e infraestructura | Bajo | Medio: contenedores, IAM, secretos, observabilidad, red y DB nuevos | Medio-alto: identidades, red, Service Bus, observabilidad y DB | Alto: IAM, VPC, NAT o endpoints, ALB/API Gateway, ECS/SQS/RDS y observabilidad |
| Operacion para un equipo pequeno | Muy simple | Simple-media | Media | Media-alta |
| API siempre disponible | Si, en compute pagado | Si, `min instances` o configuracion equivalente | Si, min replicas | Si, tareas o Lambda provisionada segun diseno |
| Worker durable | Servicio Render separado | Cloud Run Job/worker o servicio consumidor | Container Apps Job/worker | ECS/Fargate worker o Lambda/SQS |
| Escala por picos | Buena, con limites por plan e instancias | Excelente y granular | Excelente y granular | Excelente, con mas piezas |
| Base PostgreSQL administrada | Supabase, con credito de Micro dentro de Pro | Cloud SQL | Azure Database for PostgreSQL Flexible Server | Amazon RDS PostgreSQL |
| Mejor momento para VIA | Ahora hasta 250 tenants, sujeto a pruebas de carga | Cuando 250+ tenants o la elasticidad/operacion lo justifique | Solo con credito Azure, compra corporativa o integracion Microsoft relevante | Solo con equipo DevOps, requisitos AWS o necesidad enterprise concreta |

### 1. Vercel + Render + Supabase: alternativa recomendada ahora

**Por que gana hoy:** preserva lo construido, permite separar API y worker sin redisenar el dominio, y entrega una ruta concreta al piloto. El costo presupuestado de USD 95 mensuales para 10-25 tenants incluye el piso productivo de los cuatro componentes; por ello es mas honesto que comparar solo un contenedor serverless contra toda la plataforma actual.

Configuracion inicial propuesta:

- Vercel Pro para frontend y limites/alertas comerciales.
- Render Pro workspace, Web Service `1c-2g` para el webhook y Background Worker `1c-2g` para `npm run worker`.
- Supabase Pro con Micro incluido inicialmente; confirmar region, backup y pooler.
- Desplegar migration `011_inbound_messages_and_interactions.sql`, probar worker, y solo entonces activar `WHATSAPP_ASYNC_INBOUND_ENABLED=true`.

Render tiene un plan Pro de workspace de USD 25 al mes, con 25 GB de ancho de banda incluido; sus compute plans actuales confirman que `1c-2g` corresponde al anterior Standard. Supabase Pro cuesta USD 25 e incluye un credito de USD 10, suficiente para un proyecto Micro de 1 GB; por eso el presupuesto inicial de USD 95 es coherente como piso de plataforma, aunque debe cotejarse contra la factura final de la cuenta.

**Limite:** no se debe asumir que este conjunto escala indefinidamente. A partir de 250 tenants se debe comparar el costo marginal de worker/DB con GCP usando telemetria real, no migrar por anticipacion.

### 2. GCP: mejor ruta de evolucion tecnica

Arquitectura objetivo sin alterar el contrato funcional:

```text
Vercel Pro o Firebase Hosting
        |
Cloud Run API (minimo una instancia para webhook)
        |
Cloud SQL PostgreSQL <- outbox -> Cloud Run worker / Cloud Run Job
                                      |
                           Meta, DeepSeek, Google Sheets
```

En una segunda fase, y solo si la telemetria lo justifica, Cloud Tasks o Pub/Sub puede recibir los eventos ya confirmados desde el outbox. No debe sustituir de golpe el patron PostgreSQL-outbox: primero se conserva el origen de verdad, se prueba entrega idempotente y se mide.

Ventajas:

- Cloud Run escala por solicitud y concurrencia, con controles de minimos para el endpoint de Meta.
- Puede pagar menos computo durante valles si la mayor parte del trabajo se ejecuta bajo demanda.
- Tiene una ruta limpia para colas, observabilidad, IAM y presupuesto a medida que el volumen crezca.

Precauciones:

- Un API que pueda recibir un webhook sin retraso no debe depender de escalar a cero. Cloud Run permite minimos, pero esa disponibilidad tiene costo.
- Cloud SQL es una partida separada. El `db-f1-micro` publicado a USD 0,0105/hora (aprox. USD 7,67/mes de compute) no tiene SLA; sirve como referencia minima, **no** como recomendacion de produccion para VIA.
- Deben cotizarse region, HA, almacenamiento, backups, egreso, Cloud Logging, Secret Manager y soporte. Migrar base de datos y OAuth antes de tener una causa medible seria costo y riesgo evitables.

**Veredicto:** preparar un diseno de salida para GCP, pero no iniciarlo ahora. Reabrir la decision al alcanzar 250 tenants, al superar de forma sostenida los umbrales de cola/DB o si Render deja de cumplir los SLO definidos.

### 3. Azure: alternativa condicional de negocio

La equivalencia tecnica es Container Apps para API y worker, Container Apps Jobs para tareas, Service Bus para una cola administrada opcional y PostgreSQL Flexible Server como base. Container Apps tiene un grant mensual de 180.000 vCPU-segundos, 360.000 GiB-segundos y dos millones de solicitudes; sus replicas tambien pueden escalar a cero, mientras que las replicas minimas se cobran en inactividad.

Esto encaja tecnicamente, pero no crea una ventaja sobre GCP para VIA. La base de datos Burstable B1ms publicada cuesta USD 12,41/mes antes de almacenamiento, backup, red y monitoreo; una B2s cuesta USD 49,64/mes. La conveniencia aparece si VIA obtiene creditos Azure, debe integrarse con Entra/Microsoft o vende a clientes empresariales que lo exijan.

**Veredicto:** no migrar por costo en la etapa piloto. Mantenerlo como opcion comercial/corporativa.

### 4. AWS: alternativa enterprise, no de arranque

Una implementacion equivalente usaria ECS/Fargate para API y worker, SQS para colas, RDS PostgreSQL y CloudWatch/Secrets Manager. Es una plataforma madura y robusta, pero exige decidir VPC, IAM, subredes, seguridad, balanceo o API Gateway, observabilidad y costos de red desde el primer dia.

Como referencia, usando tarifas publicas de Fargate Linux/x86 de N. Virginia, dos servicios permanentes de 0,25 vCPU y 0,5 GB suman aproximadamente **USD 17,77/mes solo de compute**: todavia faltan RDS, almacenamiento, backups, balanceador o API Gateway, logs, egreso y frontend. Por tanto, AWS no demuestra una ventaja de costo frente al piso actual; compra flexibilidad a cambio de operacion adicional.

**Veredicto:** reservar para una etapa enterprise, requerimientos de seguridad/regulacion concretos o cuando haya capacidad DevOps dedicada.

## Referencias de precios: lo comparable y lo que no

| Referencia oficial | Dato util | Como debe usarse |
|---|---|---|
| Render Free | Se suspende o duerme; no se recomienda para produccion | Confirma que no sirve como API de Meta |
| Render Pro workspace | USD 25/mes, 25 GB incluidos | Parte del presupuesto Render, mas compute |
| Supabase Pro + Micro | USD 25/mes y USD 10 de credito para Micro | Piso de base gestionada; validar proyecto real |
| Cloud Run | Factura por CPU, memoria, solicitudes y region; ofrece free tier | Cotizar con region, minimos y concurrencia reales |
| Cloud SQL `db-f1-micro` | USD 0,0105/h, shared core, sin SLA | Referencia de laboratorio, no DB de produccion |
| Azure Container Apps | 180.000 vCPU-s, 360.000 GiB-s y 2M requests incluidos | Ahorra en valles, pero min replicas y DB tienen costo |
| Azure PostgreSQL B1ms | USD 12,41/mes | Piso de DB antes de storage, backup y red |
| AWS Fargate | Tarifa por vCPU-s y GB-s asignados | Compute es solo una parte; sumar RDS, red y logs |

No se publica una tabla que prometa que GCP, Azure o AWS cuestan exactamente menos que el modelo actual. Una cotizacion seria requiere como minimo: region, alta disponibilidad, almacenamiento y crecimiento de DB, retencion de logs, egreso a Meta/Google/DeepSeek, dominios, soporte, cantidad de entornos y politica de backups. Excluir esos componentes produciria un benchmark artificialmente favorable al proveedor que solo se mida por CPU.

## Recomendacion por etapa

| Etapa | Capacidad comercial aproximada | Plataforma recomendada | Decisiones y validaciones |
|---|---:|---|---|
| Piloto | 10-25 tenants | Vercel Pro + Render pagado + Supabase Pro | API y worker separados, RLS/backups confirmados, alertas, carga de 25 tenants equivalentes |
| Validacion | 50 tenants | Mismo esquema | Medir p95, cola, DB y costo unitario; no ampliar recursos por intuicion |
| Crecimiento controlado | 100 tenants | Mismo esquema, subir recursos segun metricas | Prueba de carga, concurrencia worker y pool DB; presupuesto modelo USD 210/mes |
| Punto de decision | 250 tenants | Render escalado o GCP comparado con datos reales | Ejecutar calculadora GCP regional y prueba de migracion no productiva; presupuesto actual USD 330/mes |
| Escala | 500 tenants | Elegir por SLO/costo marginal medido | GCP se vuelve candidato preferido; presupuesto actual USD 515/mes |
| Plataforma madura | 1.000 tenants | GCP o Render escalado segun benchmark actualizado | Multiinstancia, DR, restore drills, colas administradas si la outbox lo demanda; presupuesto actual USD 765/mes |

## Umbrales de escala que deciden con evidencia

No se cambia de nube solo por numero de tenants. Se dispara una revision de recursos cuando alguno de estos indicadores se mantiene durante una semana de operacion normal o aparece en una prueba de carga reproducible:

| Senal | Umbral | Primera accion |
|---|---|---|
| Webhook | p95 mayor a 1 segundo o errores mayores a 1 % | Revisar DB/deduplicacion, recursos del API, red y dependencia externa |
| Cola/outbox | edad mayor a 60 segundos, backlog creciente o reintentos mayores a 2 % | Escalar o paralelizar worker; revisar LLM, catalogo, Meta y Sheets |
| Worker | p95 mayor a 15 segundos o saturacion de concurrencia | Perfilar herramienta lenta; no aumentar CPU sin diagnostico |
| PostgreSQL | CPU, IO, disco o pool mayor a 70 % sostenido | Optimizar indices/consultas, pool y luego subir tier |
| Integraciones | errores Meta, Google o DeepSeek mayores a 2 % en 10 minutos | Activar backoff/degradacion y aislar proveedor antes de escalar infraestructura |
| Costo | costo de plataforma por tenant aumenta tres meses seguidos sin mejora de SLO | Comparar proveedor alterno con trafico y configuracion equivalentes |

## Plan de ejecucion recomendado

### Antes del piloto

1. Convertir Render a plataforma pagada: no dejar el webhook en Free ni resolverlo solo con recarga de ancho de banda.
2. Crear el worker Render separado con `npm run worker`, secretos identicos y health/alertas propias.
3. Validar el proyecto productivo de Supabase: URL, region, plan, RLS, backup, restauracion y pooler.
4. Instrumentar los SLO anteriores y etiquetar metricas por tenant sin registrar contenido sensible de mensajes.
5. Ejecutar carga local y una prueba controlada equivalente a 25 tenants antes de abrir altas comerciales.

### Durante los primeros 90 dias

1. Medir por cohorte: webhook p95, tiempo a primera respuesta, tiempo de pedido, outbox age, costo DeepSeek, error por integracion y consumo DB.
2. Comparar facturas reales con el presupuesto de USD 95/125 y corregir la hoja `Infraestructura`; no usar la reserva como gasto observado.
3. Revisar semanalmente ancho de banda Render y gasto Vercel/Supabase; crear alertas antes de los limites.
4. En 100 tenants, hacer una prueba de capacidad de 200 tenants equivalentes y documentar resultados.

### Decision de migracion

1. Al llegar a 250 tenants o cualquiera de los umbrales anteriores, ejecutar una prueba aislada en GCP con la misma version de API, esquema de DB anonimo y trabajo sintetico.
2. Comparar p95, tasa de error, costo por 1.000 trabajos, costo de DB, egreso, tiempo de despliegue y carga operativa durante dos semanas.
3. Migrar solo si GCP mejora un SLO critico o reduce el costo total de plataforma al menos 20 % despues de incluir migracion, observabilidad, backup y soporte.

## Decisiones que no deben tomarse aun

- No migrar PostgreSQL solo por el precio nominal de una instancia pequena sin SLA.
- No reemplazar PostgreSQL-outbox por una cola cloud antes de demostrar idempotencia y recuperacion de fallos.
- No poner API, worker y base de datos en nubes distintas: agrega egreso, latencia, secretos y superficie operativa sin beneficio actual.
- No asumir que la capacidad de una nube equivale a clientes atendidos: deben hacerse pruebas de carga con el perfil de VIA y el LLM real.
- No usar recursos Free para un endpoint de Meta que debe estar disponible todo el dia.

## Fuentes oficiales

- [Render: planes y precio de workspace](https://render.com/pricing), [planes de compute](https://render.com/docs/compute-plans), [limites de Free](https://render.com/docs/free) y [ancho de banda](https://render.com/docs/outbound-bandwidth).
- [Vercel: uso incluido en Pro](https://vercel.com/changelog/included-pro-usage-is-now-credit-based).
- [Supabase: precio Pro y compute](https://supabase.com/pricing) y [facturacion de compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute).
- [Google Cloud Run: precios](https://cloud.google.com/run/pricing), [configuracion de facturacion](https://docs.cloud.google.com/run/docs/configuring/billing-settings) y [Cloud SQL PostgreSQL](https://cloud.google.com/sql/pricing?hl=en).
- [Azure Container Apps](https://azure.microsoft.com/en-us/pricing/details/container-apps/) y [Azure Database for PostgreSQL Flexible Server](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/).
- [AWS ECS/Fargate: precios](https://aws.amazon.com/ecs/pricing/).
