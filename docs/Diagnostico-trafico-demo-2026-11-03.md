# Diagnóstico de tráfico de Demo De Tienda — 2026-11-03

## Alcance y evidencia de producción

Tenant `demo-de-tienda`, propietario `ventasiaopsstore@gmail.com`. Número de tienda `+57 321 945 0893`; este es ahora el canal real de la tienda, no el antiguo comprador de las pruebas sandbox. Horas de Colombia (UTC−5).

- La vinculación de Meta existía, pero VIA conservaba la activación operativa pendiente y el acceso bloqueado. Se validó y activó mediante Centro de control → Clientes → Demo De Tienda. El onboarding pasó a «Operación habilitada», 5/5.
- 14:17:30: Meta entregó `account_update`, `WEBHOOK_CONFIG_UPDATED`, suscripción a la app. Ese evento no era un mensaje de comprador.
- 14:25:31: llegó «Hola quiero hacer un pedido» desde otro número. WABA `1462684029188164`, phone number ID `1378839898644302`. El enrutamiento identificó correctamente la tienda demo y encoló el mensaje.
- 14:29:43: VIA registró respuesta de contingencia por falta de acceso operativo a Google Drive/Sheets y creó una solicitud humana. Hubo callbacks de estado de entrega; no se observó un error de credencial de Meta en este envío.
- 14:29:50: el callback de Meta confirmó `read`, `billable: false`, categoría `service` y tipo `free_customer_service` para esa respuesta.
- 14:31:55: quedó registrado `google.oauth.connected` de la cuenta de la tienda, posterior al fallo de catálogo. Debe conservarse esta reconexión, no repetir OAuth ni copiar datos de Test Local.
- Abrir «Resolver solicitud» dejó la pantalla en blanco: `ReferenceError: error is not defined` en `HumanQueue`.
- Consulta directa de `inbound_messages`: los cinco eventos quedaron `completed`, sin `last_error`. El último sync terminó a las 14:38:17. El mensaje de texto se procesó una sola vez; el account_update requirió dos intentos.

## Causas verificadas

1. El gate de activación de VIA impedía operar antes de la activación administrativa. Conectar WhatsApp y habilitar operación no eran equivalentes en esta versión.
2. Render registró PostgreSQL `40P01` (deadlock) a las 14:19. `save`/`persistTenantCritical` bloqueaban `app_state` antes de `tenants`; `persistWhatsAppOnboarding` lo hacía en orden inverso.
3. El procesamiento de coexistencia esperaba `store.flush()` incluso después del checkpoint durable. Un guardado global de todas las tablas mantenía ocupado el worker compartido; el texto entrante quedó detrás de la sincronización de contactos. La demora observada fue aproximadamente 4 minutos 12 segundos, no tiempo de generación del LLM.
4. El agente no pudo obtener contexto Google operativo y aplicó contingencia humana. El fallo ocurrió antes de la reconexión registrada; esta evidencia no permite atribuirlo con certeza a un código concreto de OAuth.
5. `HumanQueue` referenciaba `error`, una variable inexistente, al renderizar avisos. La corrección se limita a comprobar `notice`.

## Correcciones y validación

- Mismo orden de locks para snapshots, escritura crítica y checkpoint WhatsApp.
- Coexistencia espera su persistencia durable; no espera adicionalmente el snapshot global. El almacenamiento sin checkpoint conserva el fallback `flush`.
- Protección de la proyección WhatsApp frente a snapshots obsoletos, limitada al número, configuración, intento de onboarding y secretos referenciados. No debe sobrescribir Google, activación ni otros secretos.
- El checkpoint captura versión y contenido antes de encolar; una escritura incompatible obsoleta devuelve `whatsapp_checkpoint_conflict` (409 reintentable), sin declarar éxito ni avanzar versión. Una revocación se persiste por ese checkpoint, sin un merge genérico previo que pueda borrarla.
- Corrección del render de solicitudes humanas en frontend.
- Contratos de arquitectura, Embedded Signup, autoservicio, coexistencia y recuperación de Google verificados localmente con Node 24.22.1.
- Regresión de coexistencia: el test falla antes del cambio si se invoca el flush global y pasa después; los errores del checkpoint se propagan.
- Prueba React de render: reproduce el ReferenceError anterior y comprueba cola vacía, aviso de error y aviso de éxito tras el cambio. Build y cuatro pruebas Meta del frontend aprobados.
- PostgreSQL real local: tests concurrentes en schema temporal; se verifica que las tablas preexistentes de `public` conservan sus hashes. No se migra ni purga producción para esta corrección.
- Ejecutar `npm run test:whatsapp-postgres-locks` con Node 24 y PostgreSQL local `ventas_ia_dev`. Incluye reinicio, versiones, rollback, secretos cifrados, conflictos y revocación reaplicada; rechaza URLs de bases remotas.

## Límites y comprobación tras publicar

- Confirmar commits realmente activos en Render y Vercel; un push por sí solo no demuestra despliegue.
- Confirmar que persisten la conexión de WhatsApp y la reconexión de Google de la tienda.
- Volver a abrir la cola humana y comprobar que ya no queda en blanco.
- Frontend comprobado en producción: «Pedidos y pendientes» muestra la solicitud humana del demo, sin nuevo ReferenceError después de cargar el bundle corregido. La tarea sigue pendiente hasta recuperar el flujo.
- Resolver la contingencia por el flujo normal y probar catálogo/respuesta con un mensaje nuevo. No declarar probado un pedido completo solo porque entró el webhook.
- Medir nuevamente la latencia: un snapshot que ya tiene el lock todavía puede retrasar el checkpoint. Esta corrección no elimina todas las fuentes de latencia ni las limitaciones de Render Free.
- La protección de snapshots comienza con el primer checkpoint versionado; durante el recambio no realizar otra vinculación hasta que la versión anterior del proceso deje de servir. No se promete coordinación segura con procesos que aún ejecuten código anterior.
- La activación administrativa sigue siendo una brecha de autoservicio; se activó esta tienda, sin suprimir globalmente los controles de acceso.
- No es necesario enviar otra solicitud de permisos a Meta por estas correcciones.

## Versiones de partida

- Backend de producción: `60571fb44e43af46db680afd2bc5aee548e8b6e3`.
- Frontend de producción: `90903c14c7eb253d5f797901943546468a77d9f3`.
- Frontend corregido: `54b74a2a3605478368294ba8ea0f1a2b6a5148a8`, Vercel `ApmKbptiwFaK76x9VgzCCkZrPBz5`, Production Ready, dominio `via.leanagentbuilder.com`.
- Usar los worktrees `via-meta-autoservicio-20261103/backend` y `frontend`; el checkout principal está en una versión anterior y no es la base del despliegue.

## Verificación en vivo y hallazgo de reinicio

- Backend `c605d0142ccc6a8e07bffddf1c244869b2a5780f` desplegado como `dep-dbl3n3bncjis73e167qg`, Live a las 14:53:46. PostgreSQL activo; Node 24.22.2.
- Consulta posterior al despliegue: activación `active`, phone number ID `1378839898644302` y conexión Google `connected`, con `connectedAt=2026-11-03T19:30:35.272Z`. Se conservaron las conexiones.
- La acción Aprobar sobre `handoff-4afc91dd` respondió «Esta tarea ya fue atendida». No se envió respuesta manual al comprador. La consulta PostgreSQL demostró que la tarea seguía `pending` en `pending_requests`, asociada a `wa-241381eb`, pero no existía en `app_state.document.pendingRequests`.
- Causa adicional: el arranque cargaba solamente el snapshot general; la UI consultaba las tablas operativas y el resolver buscaba en memoria. Una tarea durable creada después del snapshot aparecía en pantalla pero no podía resolverse después de reiniciar. Se requiere recuperar el estado operativo durable antes de aceptar solicitudes.

## Catálogo propio del demo

- Se comprobó que `Catalogo` en la hoja `1QpR44qdL4EEpLgIPEZwoTLb43hnGjWVUObAsK3PfAZc` tenía solo encabezados. No se reutilizó la hoja de Test Local.
- El usuario autorizó cargar el catálogo de prueba del repositorio. Se generó CSV con los 100 productos de `server/data/bogotaCatalogSeed.js`, conservando SKU, nombre, categoría, marca, presentación, precio, stock, aliases y activo. Los identificadores ficticios `drv-*` se dejaron vacíos: no son archivos reales de Drive.
- Importación realizada desde VIA: vista previa de 100 filas válidas, 100 activas y cero advertencias; después Copiar a Google Sheets. Hoja verificada visualmente, incluido SKU `BOG-MAS-100` en la fila 101. Esto acredita escritura real de VIA a Google después de la reconexión.
- Precios de prueba: `BOG-BEB-044`, Coca-Cola original 1.5 L, COP 7.200; `BOG-PAN-019`, Ponque Chocoramo 65 g, COP 2.800. No son tarifas comerciales verificadas para una tienda real.
- La interfaz mostraba «El archivo necesita ajustes» después de importar correctamente porque confundía el contrato de importación con el de validación. Se corrigió la representación del resultado `status=imported` para mostrar el éxito y el conteo.
- Falta medir una nueva interacción después de recuperar la conversación; la escritura del catálogo y el callback `read` anterior no equivalen a un pedido E2E completado.

## Recuperación de estado operativo

- El arranque recupera conversaciones, tareas y pedidos desde sus tablas durables dentro de una lectura consistente PostgreSQL. Reemplaza esas tres proyecciones del snapshot, incluso si una tabla está vacía, para no reabrir tareas resueltas ni resucitar registros borrados. Mantiene las conexiones y secretos por sus rutas existentes.
- `npm run test:postgres:recovery` pasó en PostgreSQL local real: GET de una tarea ausente del snapshot y POST de resolución después de reiniciar; rechazo de tareas resueltas/denegadas; aislamiento entre tenants; preparación de pedido con versión; segundo reinicio; tablas vacías; secretos Google/WhatsApp intactos. El schema temporal se elimina y los hashes de `public` quedan sin cambios. No se hace HTTP externo.
- `npm run test:architecture`: siete contratos aprobados después de esta corrección.
- Frontend `d6ca7220acda23fd4a44dab6e82618430e1aa459`, Vercel `A6Zs868mqbHoykHhoAGsker7zbFv`, Production Ready: corrige el aviso posterior a importar productos.
