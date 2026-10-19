# Plan detallado para cerrar los hallazgos de arquitectura

**Fecha:** 17 de octubre de 2026

**Base:** revisión de código ejecutable, migraciones, pruebas y documentación del repositorio.

**Documento relacionado:** [Arquitectura profunda de la app y del agente](./Arquitectura-profunda-app-y-agente.md).

Este plan convierte los seis hallazgos principales en trabajo ejecutable. Cada frente contiene el estado actual comprobado, el cambio propuesto, los archivos afectados, las pruebas necesarias, los riesgos de migración y los criterios para declarar el trabajo terminado.

## Estado de ejecución

**Corte:** 17 de octubre de 2026. La primera entrega del plan ya está aplicada en el repositorio:

- estados canónicos y traducción de estados para Google Sheets;
- `OrderService` para las transiciones de la cola y resolución humana;
- claim atómico de mensajes procesados en PostgreSQL y operación equivalente en JSON;
- persistencia esperada en los caminos críticos del agente y las herramientas;
- validación de configuración productiva, CORS explícito y `/health/ready`;
- cliente API frontend para mutaciones de pedidos y solicitudes humanas;
- contratos básicos para normalizar `Order` y `OpsOverview`;
- extracción de `OrderProgressCard` a `src/features/orders`;
- trazabilidad común para webhook, agente, herramientas y transiciones de pedido;
- outbox durable JSON/PostgreSQL con idempotencia, reintentos exponenciales, worker y apagado ordenado;
- serialización por pedido en `OrderService` y prueba de carrera para evitar dos transiciones simultáneas dentro del proceso;
- `x-request-id` generado en el cliente web y middleware del backend para correlacionar soporte;
- script de auditoría no destructiva para exportaciones históricas de estados de Sheets;
- pruebas de contrato de estados y configuración, además de la suite backend existente.

Quedan como siguientes entregas la unidad de trabajo PostgreSQL completa, extracción del resto de features frontend, migración de datos existentes en Sheets y una prueba de concurrencia multiinstancia contra una base real. El smoke test PostgreSQL local ya pasó con migraciones, tablas espejo, catálogo, SaaS, activación e idempotencia. PostgreSQL ya tiene columna e índice de versión y la persistencia estricta rechaza sobrescrituras obsoletas; todavía falta envolver transición, conversación y evento en una única transacción para rollback automático entre instancias. El outbox queda implementado y opt-in mediante `INTEGRATION_OUTBOX_ENABLED=true`; falta activarlo en producción después de validar cada adaptador externo.

## 1. Estado actual comprobado en el repositorio

| Hallazgo | Evidencia actual | Severidad | Orden |
| --- | --- | --- | --- |
| Estados incompatibles de pedido | `server/routes/api.js` valida estados en inglés; `server/services/googleWorkspaceService.js` configura validaciones en español | Alta | 1 |
| Persistencia dual y escrituras encoladas | `server/store/postgresStore.js` usa `app_state.document`, tablas espejo y `saveQueue`; varios callers no esperan `persist...` | Alta | 2 |
| `App.jsx` monolítico | `src/App.jsx` concentra navegación, fetch, mutaciones y vistas; `src/styles.css` concentra estilos globales | Alta de mantenimiento | 4 |
| Contratos HTTP distribuidos | `fetch` y formas de respuesta están repartidos en `src/App.jsx` sin cliente API ni esquema único | Alta de mantenimiento | 3 |
| Transición de pedido distribuida | `server/routes/api.js`, `agentRuntime.js` y `toolRegistry.js` actualizan partes distintas del ciclo | Alta | 2 |
| Defaults de desarrollo en producción | `server/config.js` permite fallback local, mock de WhatsApp y login de desarrollo; `server/index.js` monta `cors()` abierto | Alta de seguridad/operación | 1 |

El orden de trabajo prioriza primero la integridad del pedido y las barreras de producción. La extracción visual del frontend comienza después de estabilizar los contratos que consume.

## 2. Principios de implementación

1. **Compatibilidad incremental:** conservar las rutas públicas y los nombres de respuesta mientras se extraen módulos internos.
2. **Una fuente de verdad por dominio:** el pedido tendrá un estado canónico; Google Sheets será una proyección externa.
3. **Idempotencia antes que reintentos:** ninguna integración debe reintentarse si puede duplicar pedidos o mensajes.
4. **Observabilidad de cada cambio:** toda transición debe incluir tenant, pedido, conversación, actor, estado anterior, estado nuevo y resultado de sincronización.
5. **Producción fail-closed:** una configuración incompleta debe bloquear el arranque o la activación del tenant, no simular éxito.
6. **Despliegue por etapas:** cada fase debe ser reversible y pasar pruebas antes de activar la siguiente.

## 3. Frente 1: unificar estados de pedido

### 3.1 Situación actual

La API permite la secuencia:

```text
pending_human_preparation -> preparing -> dispatched -> delivered
```

`src/App.jsx` utiliza esos mismos valores para filtros, actores de Tienda Viva y botones. En cambio, `server/services/googleWorkspaceService.js` crea validaciones de Sheets para `draft`, `confirmado`, `preparando`, `entregado` y `cancelado`. `ToolRegistry.syncLiveOrderStatus()` escribe el estado de la app en la columna `Pedidos!G:J` sin traducirlo.

### 3.2 Diseño objetivo

Crear un módulo de dominio sin dependencia de React ni Google:

```text
server/domain/orderStatus.js
```

Debe exportar:

- `ORDER_STATUSES`;
- `ORDER_TRANSITIONS`;
- `isOrderStatus(value)`;
- `canTransition(from, to)`;
- `toCustomerLabel(status)`;
- `toGoogleSheetStatus(status)`;
- `fromGoogleSheetStatus(value)`.

El valor canónico será el contrato de la API y del estado persistido. Google recibirá una proyección traducida. El frontend debe importar o recibir el mismo contrato, no duplicar diccionarios de estados en distintos componentes.

### 3.3 Trabajo concreto

1. Crear el enum y las transiciones en `server/domain/orderStatus.js`.
2. Reemplazar el objeto `allowedNext` de `server/routes/api.js` por `canTransition`.
3. Reemplazar la lógica de `effectiveOrderStatus` por una función que siempre devuelva estado canónico.
4. Actualizar `server/services/agentRuntime.js` en confirmación y resolución humana.
5. Actualizar `server/services/toolRegistry.js` para traducir solo al escribir Google.
6. Actualizar `server/services/googleWorkspaceService.js` para que las validaciones acepten el vocabulario acordado.
7. Mantener lectura compatible durante una ventana de migración: aceptar `confirmado`, `preparando`, `entregado` y `cancelado` y convertirlos al enum canónico.
8. Actualizar `src/App.jsx` y, durante la extracción frontend, mover el mapa a `src/domain/orders/status.js`.
9. Revisar semillas, fixtures y documentación para que no introduzcan valores antiguos sin pasar por el adaptador.
10. Añadir un campo de diagnóstico `sheetStatus` o `sheetSyncStatus` cuando el valor proyectado difiera del canónico.

### 3.4 Migración de datos

No se debe editar manualmente cada fila sin respaldo. El procedimiento será:

1. exportar una copia de `Pedidos`;
2. contar y listar valores distintos de la columna `estado`;
3. traducir valores conocidos con `fromGoogleSheetStatus`;
4. marcar valores desconocidos como `needs_review` en un reporte, sin inventar un estado;
5. actualizar validaciones de la hoja;
6. validar que todos los pedidos activos tengan un estado canónico equivalente;
7. retirar la compatibilidad de escritura antigua después de una ventana acordada.

### 3.5 Pruebas y aceptación

Crear `server/tests/order-status-contract.mjs` con:

- todas las transiciones válidas;
- saltos inválidos;
- traducción canónico ↔ Sheets;
- valores desconocidos rechazados;
- serialización de etiquetas para el tendero.

Agregar casos a `server/tests/colombia-scenarios.mjs` para confirmar un pedido y avanzar sus tres etapas. La fase se acepta cuando la app, la API y Google representan el mismo pedido con estados equivalentes y ningún valor interno en inglés se escribe directamente en la validación de Sheets.

## 4. Frente 2: centralizar la transición del pedido

### 4.1 Situación actual

`PATCH /api/orders/:id/status` valida autorización, sincroniza Google, muta el pedido, actualiza parcialmente la conversación, persiste y emite un evento. `AgentRuntime.resolveHumanRequest()` ejecuta otra variante de la misma lógica para aprobación humana. `ToolRegistry.googleSheetsOrderWrite()` crea pedidos y `syncLiveOrderStatus()` actualiza Google por separado.

Esto deja reglas duplicadas y permite que un cambio hecho desde una ruta no tenga exactamente el mismo comportamiento que uno hecho desde una solicitud humana.

### 4.2 Diseño objetivo

Crear:

```text
server/services/orderService.js
```

Responsabilidades:

- localizar el pedido;
- comprobar tenant y actor;
- calcular el estado efectivo;
- validar la transición;
- comprobar solicitudes humanas pendientes;
- actualizar `statusHistory`;
- actualizar conversación relacionada;
- registrar evento y auditoría;
- solicitar sincronización externa;
- devolver un resultado uniforme.

La ruta HTTP y `AgentRuntime.resolveHumanRequest()` deben llamar a este servicio. Ninguno de los dos debe mutar directamente `ordersByTenant` para cambiar de etapa.

### 4.3 Política de consistencia

Se implementará en dos pasos:

**Paso A, compatible con la arquitectura actual:**

1. ejecutar la validación y mutación de dominio en una única función;
2. sincronizar Google antes de confirmar la transición cuando Google está conectado;
3. si Google no está conectado, guardar `sheetSyncStatus: not_connected` y permitir la operación según la política del tenant;
4. si Google responde error, no cambiar el estado y devolver un error accionable;
5. esperar explícitamente las persistencias críticas.

**Paso B, cuando el volumen lo justifique:**

1. guardar la transición local en una transacción PostgreSQL;
2. crear una tarea de sincronización externa idempotente;
3. procesarla después del commit;
4. marcar `synced`, `retrying` o `failed` sin revertir el estado interno ya confirmado.

El Paso B evita que una caída temporal de Google impida operar la cola, pero requiere una tabla de outbox o una cola durable.

### 4.4 Trabajo concreto

1. Crear `OrderService` con métodos `createConfirmedOrder`, `transition`, `cancel` y `syncProjection`.
2. Mover la lógica de `server/routes/api.js` al servicio.
3. Reutilizarlo desde `resolveHumanRequest`.
4. Hacer que `ToolRegistry` delegue creación y actualización de pedido en el servicio, o que solo actúe como adaptador externo.
5. Definir respuesta uniforme:

```json
{
  "order": {},
  "previousStatus": "preparing",
  "status": "dispatched",
  "projection": { "provider": "google_sheets", "status": "synced" },
  "eventId": "..."
}
```

6. Devolver `409` solo por conflicto de transición o versión; usar `503`/`502` para integración no disponible y un código estable.

### 4.5 Pruebas y aceptación

Agregar pruebas para:

- dos operadores intentando la misma transición;
- transición con solicitud humana pendiente;
- error de Google antes de mutar localmente;
- respuesta idempotente cuando se repite la misma solicitud;
- resolución humana y ruta HTTP produciendo el mismo resultado;
- conversación, pedido, auditoría y hoja quedando alineados.

La fase se acepta cuando existe una sola implementación de las reglas de transición y todas las entradas del ciclo pasan por ella.

## 5. Frente 3: hacer consistente la persistencia

### 5.1 Situación actual

`PostgresStore` mantiene el documento completo `app_state.document`, tablas espejo y una cola `saveQueue`. `mutate()` cambia memoria y encola `save()`. Los métodos `persistConversation`, `persistOrder`, `persistPendingRequest`, `persistEvent` y otros encolan upserts separados. En `AgentRuntime`, `ToolRegistry` y `EventService` varios llamados no esperan la promesa.

### 5.2 Objetivo por etapas

**Etapa 1: hacer visibles los errores y esperar lo crítico**

1. Cambiar todos los callers de persistencia crítica para usar `await`.
2. Hacer que `EventService.emit()` devuelva una promesa cuando la persistencia esté habilitada.
3. Separar `fireAndForgetEvent()` para telemetría no crítica.
4. Añadir métricas `queue_depth`, `queue_lag_ms`, `last_write_error` y `last_success_at`.
5. Hacer que el cierre del proceso ejecute `flush()` y reporte fallo si no puede completar.

**Etapa 2: delimitar la fuente de verdad**

1. Definir las tablas espejo como fuente de lectura operativa en PostgreSQL.
2. Usar `app_state` solo para migración, recuperación o estado global aún no normalizado.
3. Documentar qué campos siguen viviendo únicamente en el JSONB.
4. Evitar que una lectura operativa combine arbitrariamente snapshot y tabla.

**Etapa 3: transacciones de dominio**

1. Añadir una función de unidad de trabajo en `PostgresStore`.
2. Ejecutar pedido, conversación, solicitud y evento relacionado en una transacción.
3. Mantener la variante JSON con una implementación equivalente para pruebas locales.
4. Introducir outbox para Google, WhatsApp y otros efectos que no pueden participar en la transacción PostgreSQL.

### 5.3 Idempotencia y concurrencia

La tabla `processed_messages` ya tiene `message_id` como clave primaria y `ON CONFLICT DO NOTHING`, pero el flujo primero consulta `isMessageProcessed()` y luego persiste. Dos webhooks concurrentes pueden pasar la consulta antes de que alguno inserte.

Trabajo requerido:

1. crear `claimProcessedMessage()` que haga `INSERT ... ON CONFLICT DO NOTHING RETURNING message_id`;
2. procesar el mensaje solo si la inserción devuelve una fila;
3. guardar estado `processing`, `processed` o `failed` si se necesita reintento seguro;
4. agregar una clave de idempotencia para confirmación de pedido;
5. usar control optimista de versión para pedidos, por ejemplo `updatedAt` o `version`.

### 5.4 Pruebas y aceptación

Crear pruebas PostgreSQL que ejecuten:

- dos webhooks simultáneos con el mismo `messageId`;
- dos cambios de estado concurrentes;
- caída simulada durante una unidad de trabajo;
- fallo de una escritura seguida de `flush()`;
- reinicio del proceso con trabajos pendientes.

La fase se acepta cuando un duplicado no crea dos conversaciones, dos pedidos ni dos cargos de uso, y cuando un error de persistencia no queda oculto detrás de una respuesta HTTP de éxito.

## 6. Frente 4: contratos API y extracción progresiva del frontend

### 6.1 Situación actual

`src/App.jsx` contiene estados, `fetch`, transformación de respuestas y vistas. Hay múltiples efectos de carga para sesión, overview, onboarding, billing, administración y webhooks. Los nombres de los campos se interpretan directamente en los componentes.

### 6.2 Fase 1: cliente API sin cambiar pantallas

Crear:

```text
src/core/api/client.js
src/core/api/contracts.js
src/core/api/errors.js
```

El cliente debe encargarse de:

- `credentials: include`;
- token CSRF;
- serialización JSON;
- timeout y cancelación;
- errores HTTP uniformes;
- fechas y valores opcionales;
- request ID enviado en cada llamada.

`contracts.js` debe definir inicialmente contratos de:

- `OpsOverview`;
- `Order`;
- `PendingRequest`;
- `Conversation`;
- `TenantStatus`;
- `BillingStatus`;
- `WebhookEvent`.

Como el proyecto es JavaScript, se puede comenzar con JSDoc y validadores en desarrollo. Si el equipo acepta una migración gradual, los contratos pueden convertirse a TypeScript después de estabilizar los nombres.

### 6.3 Fase 2: extraer features

Orden recomendado:

1. `features/orders`: cola, tarjeta, timeline y acciones.
2. `features/conversations`: lista, detalle, respuesta y modo manual.
3. `features/onboarding`: pasos, conexiones y catálogo.
4. `features/live-store`: actores, zonas y selección de pedido.
5. `features/analytics` y `features/admin`.

Cada feature debe recibir datos derivados y callbacks del shell durante la primera extracción. Después puede usar hooks propios de lectura y mutación.

### 6.4 Fase 3: estado de servidor y navegación

1. Separar estado de servidor (`overview`, conversaciones, pedidos) de estado visual (`selectedOrderId`, pestaña, filtros, sidebar).
2. Centralizar la política de refresco después de mutaciones.
3. Mantener estados de carga, error, vacío y éxito por feature.
4. Formalizar rutas en `src/app/routes.js`.
5. Cargar vistas pesadas de forma diferida.
6. Dividir `src/styles.css` por tokens, layout y feature sin cambiar visualmente en la primera fase.

### 6.5 Pruebas y aceptación

1. Probar el cliente API con respuestas válidas, `401`, `403`, `409`, `422`, `500` y timeout.
2. Probar la cola de pedidos sin montar el resto de la app.
3. Probar navegación directa a cada vista.
4. Mantener las pruebas responsive existentes en 1440, 390 y 320 píxeles.
5. Comparar el bundle antes y después de la carga diferida.

La fase se acepta cuando una modificación de pedidos no requiere editar el módulo de conversaciones, onboarding o administración, y las pantallas muestran errores accionables sin romper el shell.

## 7. Frente 5: cerrar los defaults de desarrollo en producción

### 7.1 Situación actual

En `server/config.js`:

- `whatsappMode` por defecto es `mock`;
- `allowLocalCatalogFallback` puede activarse fuera de producción;
- `allowDevGoogleLogin` se activa si no hay `GOOGLE_CLIENT_ID`;
- `authRequired` depende de una variable de entorno.

En `server/index.js` se usa `cors()` sin una lista de orígenes explícita. Estos defaults son prácticos para local, pero deben ser imposibles o muy visibles en producción.

### 7.2 Diseño de configuración segura

Crear `server/configValidation.js` con dos modos:

```text
development: permite sandbox explícito
production: exige configuración real
```

En producción, validar al arrancar:

- `NODE_ENV=production`;
- `AUTH_REQUIRED=true`;
- `CSRF_REQUIRED=true`;
- `GOOGLE_CLIENT_ID` y secreto cuando Google está activo;
- `DATABASE_URL` y `STORAGE_DRIVER=postgres`;
- `FRONTEND_APP_URL` con HTTPS;
- `WHATSAPP_PROVIDER_MODE=live` y secretos necesarios;
- `ALLOW_LOCAL_CATALOG_FALLBACK=false`;
- proveedor LLM real o una política explícita de bloqueo;
- `CORS_ALLOWED_ORIGINS` igual al dominio de frontend;
- secretos de Mercado Pago si el billing está activo.

El endpoint `/health` debe seguir indicando que el proceso está vivo. Añadir `/health/ready` para indicar si puede operar realmente y devolver componentes fallidos sin revelar secretos.

### 7.3 CORS y cookies

1. Reemplazar `cors()` por una configuración que acepte solo `FRONTEND_APP_URL` y orígenes locales explícitos.
2. Habilitar `credentials` únicamente para esos orígenes.
3. Revisar `SameSite`, `Secure` y dominio de la cookie de sesión en el despliegue real.
4. Añadir una prueba que confirme que un origen no autorizado recibe rechazo.

### 7.4 Pruebas y aceptación

Crear `server/tests/production-config.mjs` que:

- falle si se inicia producción con mock de WhatsApp;
- falle si falta PostgreSQL;
- falle si auth real está incompleta;
- rechace fallback local;
- verifique CORS permitido y rechazado;
- confirme que `/health/ready` identifica la dependencia faltante.

La fase se acepta cuando un despliegue accidental con valores de desarrollo no puede presentarse como operativo.

## 8. Frente transversal: trazabilidad y soporte

La plataforma ya tiene eventos, auditoría y registros de webhook, pero cada operación no tiene un identificador común. Añadir un contexto de trazabilidad:

```text
traceId
tenantId
providerEventId
messageId
conversationId
orderId
toolCallId
actorId
```

### Trabajo

1. Crear middleware de `requestId`.
2. Propagar el ID al `AgentRuntime` y `ToolRegistry`.
3. Incluirlo en eventos `agent.*`, `tool.*`, `order.*` y `webhook.*`.
4. Mostrarlo al administrador como identificador de soporte.
5. Redactar teléfonos, tokens y payloads sensibles antes de guardar eventos.

### Aceptación

Dado un `orderId` o `messageId`, soporte debe poder localizar la entrada de WhatsApp, el plan del agente, las herramientas llamadas, la solicitud humana, la transición y la sincronización externa.

## 9. Secuencia recomendada de ejecución

### Fase 0 — preparación

- congelar el contrato actual de estados;
- inventariar valores existentes en Sheets y PostgreSQL;
- crear fixtures representativos de pedido, conversación y solicitud;
- definir dashboard mínimo de errores y latencia;
- documentar variables de entorno de producción.

**Salida:** inventario, respaldos y pruebas base verdes.

### Fase 1 — seguridad y estados

- validación de configuración de producción;
- CORS explícito;
- enum canónico y adaptador de Sheets;
- pruebas de transición y migración de valores.

**Salida:** ningún nuevo pedido usa estados incompatibles y un deploy incompleto falla temprano.

### Fase 2 — pedido y persistencia

- `OrderService`;
- persistencias críticas esperadas;
- claim atómico de mensajes;
- control de concurrencia;
- trazabilidad básica.

**Salida:** una transición tiene un solo punto de decisión y puede investigarse de principio a fin.

### Fase 3 — contratos y frontend

- cliente API;
- validadores de respuesta;
- extracción de pedidos y conversaciones;
- navegación formal;
- estados de servidor separados de estados visuales.

**Salida:** la consola es mantenible por capacidad sin cambiar el comportamiento operativo.

### Fase 4 — outbox y escala

- outbox para proyecciones externas de Google Sheets y extensión posterior a WhatsApp;
- reintentos idempotentes con backoff y límite de intentos;
- worker interno con apagado ordenado para tareas largas;
- retiro gradual de `app_state` como fuente operativa.

**Salida:** el proceso HTTP no depende de que todos los proveedores externos respondan dentro de la misma solicitud.

## 10. Matriz de tareas y dependencias

| ID | Trabajo | Archivos principales | Complejidad | Dependencias |
| --- | --- | --- | --- | --- |
| A1 | Enum y traducción de estados | `server/domain/orderStatus.js`, Google, API | M | Ninguna |
| A2 | Migración y validación Sheets | Google Workspace, script de auditoría | M | A1 |
| B1 | Servicio de transición | `server/services/orderService.js`, API, runtime | L | A1 |
| B2 | Persistencia crítica esperada | runtime, tools, events, store | M | B1 |
| B3 | Idempotencia atómica | migración, `PostgresStore`, webhook | M | Ninguna |
| B4 | Unidad de trabajo PostgreSQL | `PostgresStore`, migración | L | B1/B2 |
| C1 | Configuración fail-closed | config, index, health | M | Ninguna |
| C2 | CORS y cookie segura | index, auth, tests | S | C1 |
| D1 | Cliente API y contratos | `src/core/api` | M | Contratos de API estabilizados |
| D2 | Extraer pedidos | `src/features/orders` | M | D1, A1 |
| D3 | Extraer conversaciones/onboarding | `src/features/*` | L | D1 |
| E1 | Trazabilidad de extremo a extremo | middleware, events, admin | M | B1 |
| E2 | Outbox y worker | migración, servicio de jobs | L | B4/E1 |

## 11. Criterios generales de cierre

El plan completo se considera cerrado cuando:

- la API tiene un único estado canónico de pedido;
- Google Sheets recibe una proyección compatible y auditada;
- todas las transiciones pasan por `OrderService`;
- los duplicados de Meta no generan dos operaciones;
- los errores de persistencia son visibles y accionables;
- producción no puede iniciar con mocks o fallback accidental;
- el frontend consume contratos centralizados;
- pedidos, conversaciones y Tienda Viva comparten la misma fuente de estado;
- existe una traza completa por `messageId`, `conversationId` y `orderId`;
- las pruebas de contrato, concurrencia, seguridad y responsive están verdes.

## 12. Qué no se debe hacer durante el cierre

- No migrar el backend a microservicios antes de resolver las fronteras internas.
- No cambiar simultáneamente nombres públicos de endpoints y estados sin una ventana de compatibilidad.
- No ocultar fallos de Google o WhatsApp devolviendo respuestas de éxito simuladas en producción.
- No extraer componentes visuales sin extraer primero el contrato de datos que consumen.
- No retirar `app_state` hasta confirmar que las tablas normalizadas cubren todas las entidades que usa el runtime.
