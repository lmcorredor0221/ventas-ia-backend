# Plan de persistencia incremental en PostgreSQL

**Fecha:** 2026-11-07  
**Estado:** propuesta técnica, pendiente de implementación  
**Alcance:** `PostgresStore`, runtime del agente, repositorios operativos, migraciones, telemetría y pruebas.

## 1. Objetivo

Eliminar el envío repetido del documento completo `app_state.document` cuando cambia un solo registro, manteniendo durabilidad, recuperación ante reinicios, consistencia entre entidades relacionadas e idempotencia.

El objetivo operativo es que una modificación de una conversación, pedido, solicitud, evento o contador escriba únicamente las filas afectadas. El snapshot global debe quedar como mecanismo explícito de bootstrap, recuperación o exportación, no como persistencia normal de cada mutación.

## 2. Diagnóstico confirmado

La implementación actual tiene dos caminos de persistencia:

```text
store.mutate()
  -> modifica el estado en memoria
  -> queueSave()
  -> espera 10 segundos de inactividad
  -> save({ includeMirrors: false })
  -> structuredClone(getState())
  -> JSON.stringify(state)
  -> UPDATE app_state SET document = <estado completo>
```

Y, en paralelo, varios dominios ya tienen escrituras específicas:

```text
persistConversation()  -> conversations
persistOrder()         -> orders
persistPendingRequest()-> pending_requests
persistEvent()         -> events
persistCustomerProfile()-> customer_profiles
persistUsageCounter()  -> usage_counters
persistTenantCritical()-> tenants y configuraciones relacionadas
```

Hallazgos importantes:

1. El snapshot diferido serializa el estado completo, no un delta.
2. El tamaño observado fue de `4.388.515` bytes por snapshot.
3. `includeMirrors: false` evita reconstruir tablas espejo durante el snapshot, pero no evita reescribir `app_state.document` completo.
4. La corrección desplegada en `64c6891` eliminó el snapshot cuando el barrido de casos manuales no encuentra vencimientos.
5. La corrección anterior no cambia todavía el comportamiento de una mutación real: si una ruta llama `mutate()`, puede seguir generando un snapshot completo después de 10 segundos.
6. `load()` usa `app_state` como base, pero reemplaza conversaciones, solicitudes, pedidos y contadores con datos de tablas relacionales. Esto permite migrar gradualmente sin cambiar todo de una vez.

## 3. Resultado objetivo

### 3.1 Fuente de verdad por dominio

| Dominio | Fuente operativa objetivo | Persistencia objetivo |
|---|---|---|
| Tenants y configuración | `tenants`, `subscriptions`, `google_connections`, `google_workspaces`, `whatsapp_bindings` | Transacciones críticas existentes, reforzadas con contratos explícitos |
| Conversaciones | `conversations` | Upsert por conversación y borrado transaccional de dependencias |
| Pedidos | `orders` | Transiciones con versión, lock y upsert transaccional |
| Solicitudes humanas | `pending_requests` | Upsert/resolución por solicitud |
| Eventos | `events` | Inserción individual o por lote controlado |
| Perfiles | `customer_profiles` | Upsert por tenant y WhatsApp ID |
| Uso | `usage_counters` | Upsert/incremento atómico por tenant, periodo y métrica |
| Catálogo | `products`, `drive_files`, `catalog_knowledge_indexes` | Escrituras por sincronización/versionado de catálogo |
| Webhooks e idempotencia | `webhook_events`, `processed_messages` | Inserción con claves únicas |
| Integraciones externas | `integration_outbox` | Outbox transaccional, posterior a commit de dominio |
| Estado residual de runtime | Inicialmente `app_state`; después, tabla o estructura específica | Sin snapshot en el hot path |

### 3.2 Papel final de `app_state`

Durante la transición se conservará `app_state` para:

- recuperación de campos todavía no normalizados;
- compatibilidad con instalaciones existentes;
- bootstrap y migración;
- exportación o checkpoint administrativo explícito.

No se debe eliminar hasta demostrar que las tablas relacionales cubren todos los campos que el runtime necesita para procesar mensajes, operar pedidos, resolver handoffs y cargar configuración.

## 4. Principios de diseño

1. **No borrar el snapshot de inmediato.** Primero se elimina su uso implícito y luego se reduce su alcance.
2. **Cada mutación debe declarar su dominio.** No se debe permitir que una modificación de una entidad operativa dependa accidentalmente de un `mutate()` genérico.
3. **La respuesta HTTP debe esperar la escritura crítica.** Si la respuesta afirma que una acción fue aplicada, la transacción de PostgreSQL debe haber terminado.
4. **Las operaciones relacionadas deben ser atómicas.** Pedido, conversación, solicitud, contador y outbox deben persistirse en una sola transacción cuando representen una misma transición de negocio.
5. **La lectura debe tener una fuente clara.** No se debe mezclar silenciosamente un registro nuevo de una tabla con un valor viejo de `app_state`.
6. **La recuperación debe ser comprobable.** Cada fase debe incluir un reinicio y comparación de estado antes de retirar el fallback.
7. **La observabilidad debe distinguir snapshot de escritura incremental.** Un `UPDATE app_state` no debe confundirse con un upsert normal de una fila.

## 5. Plan por fases

### Fase 0 — Línea base y protección

**Objetivo:** medir sin cambiar el comportamiento.

Tareas:

- Añadir telemetría a cada escritura con `domain`, `operation`, `rowCount`, `payloadBytes`, `transactionId` y `caller`.
- Mantener visible `serializedBytes`, `dirtyMutations` e `includeMirrors` en los snapshots existentes.
- Añadir una bandera de despliegue, inicialmente desactivada, por ejemplo `POSTGRES_INCREMENTAL_PERSISTENCE_ENABLED`.
- Registrar quién llama a `mutate()` en producción y clasificar la mutación por dominio.
- Medir durante al menos un ciclo normal de uso: snapshots, upserts, bytes enviados, errores, latencia y locks.

Entregable: matriz de llamadas `mutate()` y persistencias por dominio.

### Fase 1 — Inventario exhaustivo de mutaciones

**Objetivo:** evitar perder datos al retirar el snapshot automático.

Auditar todas las llamadas a:

- `store.mutate()`;
- `queueSave()`;
- `persistTenantCritical()`;
- `persistConversation()` y `deleteConversation()`;
- `persistOrder()`, `commitOrderEdit()` y `commitManualOrder()`;
- `persistPendingRequest()`, `persistEvent()`, `persistTransaction()`;
- `persistCustomerProfile()`, `persistUsageCounter()`;
- escrituras de WhatsApp, Google, catálogo, webhooks, outbox y mensajes procesados.

Para cada llamada documentar:

| Campo | Pregunta |
|---|---|
| Entidad | ¿Qué objeto cambia? |
| Tabla | ¿Dónde debe quedar durable? |
| Clave | ¿Cuál es la clave primaria o idempotente? |
| Relación | ¿Qué otras filas deben cambiar juntas? |
| Caller | ¿Quién inicia la operación? |
| Espera | ¿El caller espera la promesa? |
| Fallback | ¿Qué ocurre si la escritura falla? |
| Rehidratación | ¿`load()` puede reconstruirlo desde tablas? |

No se debe desactivar el snapshot global de un dominio hasta completar esta matriz.

### Fase 2 — Contrato de escritura por dominio

**Objetivo:** sustituir mutaciones genéricas por operaciones explícitas.

Implementar una frontera interna uniforme, por ejemplo:

```js
store.applyConversationChange({ conversationId, patch, reason })
store.applyOrderTransition({ orderId, expectedVersion, change, outboxEntries })
store.applyPendingRequestChange({ requestId, patch })
store.appendEvent(event)
store.incrementUsage({ tenantId, period, metric, delta })
```

El nombre final puede variar, pero cada operación debe:

- actualizar el estado en memoria solo después de validar la operación;
- escribir la tabla canónica;
- aplicar locks o control de versión donde corresponda;
- escribir dependencias relacionadas en la misma transacción;
- devolver una promesa que el caller pueda esperar;
- emitir outbox únicamente después del commit lógico;
- registrar métricas de bytes y latencia.

El método genérico `mutate()` se conservará temporalmente para estado residual y pruebas, pero dejará de ser la ruta normal para entidades ya normalizadas.

### Fase 3 — Rehidratación desde PostgreSQL

**Objetivo:** que un reinicio no dependa del snapshot completo para los dominios migrados.

Cambios previstos en `load()`:

1. Cargar primero configuración y estado residual compatible.
2. Cargar tablas canónicas mediante repositorios o consultas agrupadas.
3. Reemplazar las colecciones en memoria con las filas relacionales, igual que ya se hace con conversaciones, solicitudes, pedidos y contadores.
4. Validar que no queden duplicados, filas huérfanas o versiones menores que las del almacenamiento.
5. Reportar en `/health/ready` cualquier dominio que no pueda rehidratarse.

Durante esta fase, en modo sombra, se puede comparar el estado reconstruido con el snapshot sin usar el snapshot para sobrescribir datos más nuevos.

### Fase 4 — Desactivar el snapshot automático por dominio

**Objetivo:** impedir que las rutas migradas vuelvan a enviar 4,4 MB.

La transición debe ser gradual:

1. Desactivar snapshots automáticos para conversaciones y eventos.
2. Verificar reinicio, lectura de dashboard, webhook e intervención humana.
3. Desactivar snapshots automáticos para pedidos y solicitudes humanas.
4. Verificar concurrencia, versiones, resolución de handoff y outbox.
5. Desactivar snapshots automáticos para perfiles, uso y catálogo.
6. Mantener snapshot solo para estado residual o acción explícita de checkpoint.

En esta fase, `queueSave()` no debe ejecutarse como efecto secundario de un no-op. Para dominios migrados, una escritura incremental exitosa debe ser suficiente para durabilidad.

### Fase 5 — Reducir y retirar el snapshot global como fuente operativa

**Objetivo:** que `app_state` deje de crecer con conversaciones, eventos, pedidos y catálogos.

Tareas:

- Crear un comando o endpoint administrativo de checkpoint explícito.
- Migrar cualquier campo residual a una tabla con esquema claro.
- Mantener `app_state` únicamente para metadata de compatibilidad, migración o recuperación, si todavía es necesario.
- Crear una migración de limpieza solo después de verificar backups y restauración.
- Retirar código de merge que pueda reintroducir filas eliminadas desde un snapshot antiguo.

Esta fase requiere una ventana de mantenimiento o un procedimiento de rollback probado.

## 6. Cambios técnicos propuestos

### 6.1 Nuevos componentes

- `PersistenceContext`: identifica tenant, dominio, operación y correlación.
- `DomainWrite` o equivalente: contrato común para transacciones incrementales.
- Repositorios específicos para los dominios que todavía mezclen estado en memoria y SQL.
- `CheckpointService`: única ruta autorizada para crear un snapshot global.
- Comparador de rehidratación para modo sombra y pruebas de reinicio.

Los nombres son orientativos; se deben confirmar después de terminar la matriz de Fase 1.

### 6.2 Cambios en `PostgresStore`

- Separar claramente `saveSnapshot()` de las escrituras normales.
- Renombrar o encapsular `queueSave()` para que no sea una API genérica usada por cualquier mutación.
- Añadir una cola o transacción por dominio cuando sea necesario, sin bloquear operaciones no relacionadas.
- Mantener `save({ includeMirrors: true })` solo para bootstrap/checkpoint explícito.
- Añadir guardas que rechacen snapshots automáticos en dominios migrados cuando la bandera de la fase esté activa.
- Mantener el merge defensivo de checkpoints de WhatsApp y Google, pero probarlo por separado porque son datos sensibles a carreras.

### 6.3 Migraciones SQL

No se propone una migración destructiva en la primera iteración. Las migraciones iniciales deberían ser aditivas:

- índices y restricciones únicas que falten;
- columnas de versión o `updated_at` donde el control de concurrencia lo necesite;
- tabla de checkpoints o metadata solo si el inventario demuestra que hace falta;
- tabla de auditoría de persistencia únicamente si la telemetría existente no basta.

Antes de crear una tabla nueva se debe verificar que no duplique una tabla operativa ya existente.

## 7. Pruebas obligatorias

### Unitarias

- Un no-op no agenda snapshot.
- Una mutación de conversación no modifica `app_state` cuando el dominio está migrado.
- Una mutación de pedido conserva versión y rechaza escrituras obsoletas.
- Una resolución de solicitud actualiza solicitud, conversación y evento según el contrato.
- Un incremento de uso es atómico.
- Varias mutaciones agrupadas no generan duplicados.

### Integración PostgreSQL

- Crear estado, cerrar el proceso y rehidratarlo desde tablas.
- Eliminar una conversación y confirmar que no reaparecen sus solicitudes.
- Confirmar pedido y verificar pedido, conversación, contador y outbox en una sola unidad lógica.
- Provocar fallo entre operaciones relacionadas y confirmar rollback.
- Ejecutar dos writers sobre el mismo pedido y comprobar control de versión.
- Comparar bytes escritos antes y después de activar la persistencia incremental.

### Producción controlada

- Health check y readiness después de cada fase.
- Monitoreo de `postgres.snapshot`, `postgres.incremental_write`, `write_lag_ms`, errores y deadlocks.
- Verificación de webhook, dashboard, cola de atención humana, catálogo y checkout.
- Confirmar que el ancho de banda deja de aumentar en bloques de 4,4 MB durante periodos sin mutaciones.

## 8. Criterios de aceptación

La implementación se considera exitosa cuando:

1. Las consultas de lectura y polling no generan snapshots.
2. Una mutación de una entidad normalizada escribe solo las tablas afectadas.
3. El tamaño de la escritura es proporcional al payload modificado, no al estado global.
4. Un reinicio conserva conversaciones, pedidos, solicitudes, uso, eventos y configuración.
5. No aparecen divergencias entre memoria y tablas canónicas después de una operación exitosa.
6. Los errores de persistencia son visibles y no se ocultan detrás de una respuesta HTTP exitosa.
7. El snapshot global solo aparece con causa explícita: bootstrap, recuperación o checkpoint.
8. Existe un rollback documentado y probado antes de desactivar el fallback.

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Un campo todavía depende de `app_state` | Matriz de Fase 1 y modo sombra antes de retirar snapshots |
| Escrituras parciales entre entidades | Transacciones de dominio y outbox después del commit |
| Carreras entre runtime y operador | Versiones, locks y pruebas de dos writers |
| Estado viejo reintroduce filas eliminadas | Rehidratación desde tablas y prohibición de merge ciego |
| Mayor complejidad de código | Contratos por dominio, repositorios pequeños y telemetría uniforme |
| Rollout difícil de revertir | Feature flag y checkpoint previo por tenant/entorno |
| Secretos incluidos en snapshots | Mantener referencias, no secretos planos; revisar exportaciones |

## 10. Orden recomendado de implementación

1. Completar matriz de mutaciones.
2. Instrumentar bytes, dominio y caller.
3. Crear contratos incrementales para conversaciones y eventos.
4. Migrar pedidos, solicitudes y outbox con pruebas transaccionales.
5. Migrar perfiles, uso y configuraciones.
6. Rehidratar todo desde tablas canónicas.
7. Activar bandera incremental en staging.
8. Activar por dominio en producción.
9. Mantener observación de ancho de banda y errores.
10. Reducir `app_state` y retirar el snapshot automático cuando la evidencia lo permita.

## 11. Decisión pendiente antes de implementar

La decisión técnica más importante es si `app_state` quedará como:

- **checkpoint de recuperación de baja frecuencia**, recomendado para la transición; o
- **metadata residual únicamente**, opción final más limpia pero que exige completar toda la normalización.

La recomendación es adoptar la primera opción durante las fases 0 a 4 y migrar a la segunda solo después de completar las pruebas de rehidratación y rollback.

## 12. Estado actual

- Corrección de snapshots sin cambios desplegada en `64c6891`.
- No se observan snapshots periódicos en los logs posteriores al despliegue.
- El snapshot completo todavía puede ocurrir ante una mutación real.
- Este documento describe el siguiente trabajo y no implementa todavía la persistencia incremental.

## 13. Implementación iniciada

La primera pieza de la migración quedó preparada, sin activar todavía ningún dominio en producción:

- Se agregó `POSTGRES_INCREMENTAL_PERSISTENCE_ENABLED`, desactivado por defecto.
- `PostgresStore.mutate()` acepta `{ snapshot: false, domain, operation }` para que una ruta pueda declarar que su escritura durable ocurre en una tabla específica.
- Cuando la bandera está activa y la mutación declara `snapshot: false`, no se agenda `app_state`; se registra telemetría `postgres.incremental_mutation`.
- Con la bandera desactivada se conserva el comportamiento anterior, incluso si una llamada declara `snapshot: false`.
- Se agregó un contrato automatizado que cubre ambos modos, evitando activar la migración antes de completar el inventario de callers.
- Se marcaron como candidatos incrementales varios callers con escritor explícito: eventos, auditoría, conversaciones, solicitudes, pedidos, perfiles, transacciones, webhooks y mensajes procesados.
- La carga de eventos ya prefiere la tabla canónica cuando existe, manteniendo el documento antiguo como fallback de transición.
- Los contadores de uso y ciclos de facturación ya tienen escrituras incrementales; los umbrales de presupuesto se guardan en `usage_budget_alerts` mediante la migración `016_usage_budget_alerts.sql`.
- La lectura de catálogo en vivo puede persistir su proyección `products`/`drive_files` sin usar `app_state`.

Esta fase es deliberadamente preparatoria: todavía no se debe activar la variable en Render. El siguiente cambio debe migrar un dominio completo —incluyendo su rehidratación después de reinicio y sus escrituras relacionadas— y probarlo antes de marcarlo como incremental.
