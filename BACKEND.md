# Ventas IA Backend

La revisión técnica integral de la app, el agente, la persistencia, las integraciones y los riesgos está documentada en [Arquitectura profunda de la app y del agente](docs/Arquitectura-profunda-app-y-agente.md).

Backend ejecutable para el agente de ventas definido por el ACP adjunto. Mantiene separadas la lógica del agente, las herramientas, la persistencia multi-tenant y la capa visual.

## Ejecutar

```bash
npm run backend
```

El backend escucha por defecto en `http://127.0.0.1:3001`.

Por defecto usa persistencia JSON local para desarrollo. Para usar PostgreSQL:

```bash
STORAGE_DRIVER=postgres
DATABASE_URL=postgres://user:password@host:5432/database
DATABASE_SSL=auto
LLM_REQUEST_TIMEOUT_MS=15000
LLM_MAX_TOKENS=1200
AUTH_REQUIRED=false
CSRF_REQUIRED=false
SESSION_TTL_HOURS=168
VITE_GOOGLE_CLIENT_ID=
```

En Render se debe usar el `DATABASE_URL` interno del servicio PostgreSQL cuando el backend corre en la misma región/workspace.

Para la experiencia completa en desarrollo:

```bash
npm run backend
npm run dev
```

Vite proxifica `/api`, `/webhooks` y `/health` hacia el backend.

Para probar el piloto local con PostgreSQL, Google OAuth y auth obligatoria, configurar `.env.google.local` y ejecutar:

```bash
npm run backend:google
npm run dev:google
```

El helper `scripts/run-with-env.mjs` carga ese archivo local, replica `GOOGLE_CLIENT_ID` hacia `VITE_GOOGLE_CLIENT_ID` cuando hace falta y no imprime secretos.

## Endpoints principales

- `GET /health`
- `GET /health/ready`
- `GET /api/ops/overview?tenantId=andina`
- `POST /api/auth/google`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/tenants`
- `PATCH /api/tenants/:tenantId/config`
- `GET /api/conversations?tenantId=andina`
- `GET /api/events?tenantId=andina`
- `GET /api/pending-requests?tenantId=andina`
- `PATCH /api/orders/:id/status`
- `GET /api/usage?tenantId=andina`
- `POST /api/pending-requests/:id/resolve`
- `POST /api/agent/run`
- `POST /api/tools/:toolName/smoke-test`
- `POST /api/saas/tenants`
- `GET /api/saas/tenants/:tenantId/status`
- `POST /api/saas/tenants/:tenantId/subscription/checkout`
- `POST /api/saas/tenants/:tenantId/subscription/start-trial`
- `POST /api/saas/tenants/:tenantId/subscription/mock-activate` (solo contratos locales; bloqueado en producción)
- `GET /api/saas/connect/google/:tenantId/start`
- `GET /api/saas/tenants/:tenantId/google/oauth/start` (compatibilidad)
- `GET /api/saas/google/oauth/callback`
- `POST /api/saas/tenants/:tenantId/google/provision`
- `POST /api/saas/tenants/:tenantId/validate`
- `POST /api/saas/tenants/:tenantId/activate`
- `POST /api/admin/billing/jobs/run`
- `GET /webhooks/whatsapp`
- `POST /webhooks/whatsapp`
- `POST /webhooks/mercadopago`

## Flujo implementado

- Normaliza mensajes inbound de WhatsApp.
- Deduplica por `message_id`.
- Aísla datos por `tenantId`.
- Mide uso mensual por tenant: interacciones del agente, llamadas LLM, tokens, llamadas a herramientas y domicilios confirmados.
- Resuelve el cliente por número de WhatsApp usando `google_sheets_customer_profile_lookup` contra la hoja `Clientes`.
- Ejecuta un `LLMPlanner` con configuración global de plataforma. DeepSeek queda como proveedor transversal para todos los tenants; cada cliente consume el mismo motor y la medición de tokens/costos se imputa por tenant. En local usa simulación Codex cuando no hay secreto real.
- El contrato del planner es `ventas-ia-llm-plan.v2`: el LLM debe devolver `reasoningMode`, `customerUnderstanding`, `candidateItems`, `toolPlan`, `missingInfo` y `responseStrategy`, ademas de los campos legacy `intent`, `order`, `recommendedTools` y `missingFields`.
- El modo esperado de razonamiento comercial es `shopkeeper_guided_sale`: el LLM decide como tendero de barrio que entendio, que candidatos buscar, que herramienta usar y como guiar al cliente; el backend valida catalogo, stock, precio y escrituras.
- Para pruebas de escritorio sin API key, la plataforma puede usar `platformSettings.llm.simulator: codex`; el plan queda marcado como `executionMode: codex_simulated_deepseek` y `simulatedBy: codex` para no confundirlo con una llamada real a DeepSeek.
- La llamada real a DeepSeek usa endpoint OpenAI-compatible `chat/completions`, `response_format: { type: 'json_object' }`, timeout configurable, `max_tokens` configurable y trazabilidad de uso si el proveedor devuelve `usage`.
- Ejecuta flujo del agente: recepción, interpretación, perfil de cliente, catálogo, Drive, cotización, aprobación, pago y handoff humano.
- Para pedidos de domicilio, parsea canasta, cantidades y faltantes antes de consultar catálogo. Si falta cantidad, siempre pregunta.
- Para preguntas de disponibilidad, el agente no exige coincidencia literal: el planner conserva candidatos multiples y genera un `toolPlan`; el runtime ejecuta esas consultas contra catalogo y responde disponibilidad parcial cuando algunos productos no aparecen.
- Si el cliente no existe en Sheets, el identificador oficial es el número de WhatsApp y el agente pide nombre y dirección antes de guardar el perfil.
- Cuando el cliente confirma una canasta completa, registra el pedido en Google Sheets con `google_sheets_order_write` y escala a humano para preparación y entrega.
- Los pedidos aparecen en `GET /api/ops/overview` con su etapa efectiva. `PATCH /api/orders/:id/status` permite avanzar de `pending_human_preparation` a `preparing`, luego a `dispatched` y finalmente a `delivered`. La API rechaza saltos de etapa, evita avanzar mientras existe una solicitud humana pendiente y guarda `statusHistory` en el mismo pedido.
- Las transiciones de pedido pasan por `server/services/orderService.js`. El estado interno es canónico; al proyectar a Google Sheets se traduce a `confirmado`, `preparando`, `en_camino`, `entregado` o `cancelado`.
- `GET /health/ready` valida si el runtime está realmente listo para operar. En producción bloquea configuraciones incompletas de PostgreSQL, autenticación, Google, WhatsApp, secretos o proveedor LLM.
- Todas las solicitudes reciben `x-request-id`; el identificador se propaga a eventos de agente, herramientas, webhooks y transiciones de pedido para soporte.
- Si Google está conectado en modo live, cada avance actualiza la fila correspondiente de `Pedidos` antes de confirmar el cambio. Si la sincronización falla, el pedido conserva su etapa anterior; si Google no está conectado, el estado queda guardado en la plataforma con `sheetSyncStatus: pending` para que la interfaz lo advierta.
- Escala imágenes a humano según el ACP.
- Emite eventos ACP: `agent.started`, `tool.call.started`, `tool.call.completed`, `approval.requested`, `approval.granted`, `approval.denied`, `fallback.activated`, `agent.completed`, `agent.failed`.
- Guarda conversaciones, eventos, pendientes, transacciones y mensajes en JSON local o PostgreSQL, segun `STORAGE_DRIVER`.
- Las proyecciones externas de pedidos pueden procesarse con outbox durable activando `INTEGRATION_OUTBOX_ENABLED=true`. La tabla `integration_outbox` usa una clave idempotente, reintentos con backoff y un worker interno; el proceso espera el vaciado de la cola durante el apagado ordenado.
- Para revisar una exportación de estados históricos de Sheets sin modificarla, ejecutar `node scripts/audit-order-statuses.mjs --input ./export-pedidos.json`. El reporte lista equivalencias canónicas y valores desconocidos que requieren revisión manual.

## Control plane SaaS

La primera fase del modelo de suscripción ya está ejecutable en backend:

- Crea tenants nuevos con `POST /api/saas/tenants`.
- Genera checkout de suscripción Mercado Pago con `POST /api/saas/tenants/:tenantId/subscription/checkout`.
- Procesa cambios de suscripción desde `POST /webhooks/mercadopago`.
- Bloquea la operación del agente para tenants nuevos hasta que la suscripción, Google OAuth, aprovisionamiento y activación estén completas.
- Inicia OAuth Google con `GET /api/saas/tenants/:tenantId/google/oauth/start`.
- Completa OAuth con `GET /api/saas/google/oauth/callback`.
- Aprovisiona la estructura Google por tenant con `POST /api/saas/tenants/:tenantId/google/provision`.
- Valida el checklist de activación con `POST /api/saas/tenants/:tenantId/validate`.
- Activa la operación con `POST /api/saas/tenants/:tenantId/activate`.

Cuando faltan credenciales reales, el control plane opera en modo `sandbox_contract`; no inventa conexiones vivas. Con variables de entorno reales, prepara llamadas a:

- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_PREAPPROVAL_PLAN_ID`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `PUBLIC_APP_URL`
- `SECRET_ENCRYPTION_KEY`

La estructura aprovisionada por tenant incluye carpeta raíz, carpetas operativas y una hoja con pestañas `Catalogo`, `Clientes`, `Pedidos` y `Configuracion`. Si existen credenciales Google reales, el backend intercambia el `code` OAuth, cifra el `refresh_token` con `SECRET_ENCRYPTION_KEY`, refresca access tokens bajo demanda y crea carpetas/Sheets reales por API. Sin credenciales reales, opera en `sandbox_contract`. Los tokens se guardan como referencias (`*_GOOGLE_REFRESH_TOKEN_REF`), no como secretos planos.

## Identidad y sesiones

La Fase 1 del plan ya tiene una primera implementación local:

- `POST /api/auth/google` valida Google ID token real cuando existe `GOOGLE_CLIENT_ID`; sin credenciales opera en modo `sandbox_contract` para pruebas locales con perfil controlado.
- Crea sesión propia `httpOnly`, `SameSite=Lax`, con duración configurable por `SESSION_TTL_HOURS`.
- Mantiene `users`, `tenant_members`, `sessions` y `audit_events`.
- Si `AUTH_REQUIRED=true`, los endpoints con `tenantId` exigen sesión y membresía activa.
- Si `AUTH_REQUIRED=false`, el backend conserva compatibilidad con demos y pruebas existentes, pero si llega una sesión válida filtra tenants, conversaciones, eventos y pendientes por membresía.
- Crear un tenant con sesión activa asocia automáticamente al usuario como `owner`.
- Las acciones sensibles de SaaS/configuración requieren rol `owner`; operación del agente y smoke tests requieren `owner` u `operator`.
- El frontend ya consume `/api/auth/me`, `/api/auth/google` y `/api/auth/logout`; si `AUTH_REQUIRED=true` muestra un panel de acceso antes del tablero.
- Si existe `VITE_GOOGLE_CLIENT_ID`, el frontend renderiza Google Identity Services. Si no existe, muestra un acceso local de desarrollo contra el modo `sandbox_contract`.
- Si `CSRF_REQUIRED=true`, toda mutación autenticada debe enviar `X-CSRF-Token` con el token de sesión entregado por `/api/auth/me` o `/api/auth/google`.

## Auditoria sensible

El backend registra `audit_events` para acciones que afectan operación, dinero, datos o integraciones:

- Identidad: login, logout, asociación de owner a tenant.
- SaaS: creación de tenant, checkout Mercado Pago, activación/mock activation, webhooks Mercado Pago, validación y activación.
- Billing Mercado Pago SaaS: planes, checkout pendiente, recuperación de checkout, historial de pagos, descuentos, excepciones, sincronización admin, mantenimiento local de conciliación y embudo.
- Google: inicio OAuth, conexión OAuth y provisioning Drive/Sheets.
- Configuración: cambios de `tenant.config`, incluyendo LLM/Google/WhatsApp.
- Intervención humana: aprobación/rechazo de pendientes.
- Herramientas con efecto: `google_sheets_customer_profile_upsert`, `google_sheets_order_write`, `approval_gate`, `human_handoff`, `transactional_write` y `whatsapp_business_messaging`.

Las auditorías se escriben tanto en JSON local como en la tabla PostgreSQL `audit_events`.

## Uso, cuotas y plan comercial

La microapp ya tiene una primera capa transversal de medición comercial por tenant:

- El plan base queda configurado como `ventas_ia_1000_domicilios`.
- Cada tenant incluye `includedDeliveries: 1000` y `includedInteractions: 5000`.
- El backend incrementa `agent_interactions` solo para mensajes inbound no duplicados.
- El planner registra `llm_calls`, `llm_prompt_tokens`, `llm_completion_tokens` y `llm_total_tokens`; si DeepSeek devuelve `usage`, usa esos valores reales, y si corre en simulación local estima tokens.
- Cada herramienta exitosa suma `tool_calls` y `tool_calls.<nombre_herramienta>`.
- Cada pedido confirmado por el agente suma `deliveries_confirmed`.
- Si se alcanza 80%, 90% o 100% de los límites de interacciones o domicilios, emite `budget.threshold_reached`.
- Si el tenant supera el límite mensual de interacciones o domicilios, el backend bloquea la operación con `tenant_usage_limit_exceeded`.
- `GET /api/usage?tenantId=...` devuelve resumen mensual, límites, porcentajes y contadores crudos.
- `GET /api/ops/overview?tenantId=...` incluye el mismo resumen en `usage` para que el tablero lo pueda visualizar.

En PostgreSQL estos contadores se persisten en `usage_counters`; en JSON local quedan dentro de `usageCountersByTenant`.

## PostgreSQL

El backend tiene un adapter opcional `PostgresStore` para mover la persistencia fuera del archivo JSON. La primera fase conserva el contrato actual del store y guarda:

- Snapshot completo en `app_state.document` para compatibilidad con el agente actual.
- Tablas espejo para operación SaaS, identidad y agente: `users`, `tenant_members`, `sessions`, `audit_events`, `tenants`, `subscriptions`, `google_connections`, `google_workspaces`, `whatsapp_bindings`, `products`, `drive_files`, `customer_profiles`, `conversations`, `orders`, `pending_requests`, `transactions`, `events`, `processed_messages`, `usage_counters` y `secret_references`.
- Escrituras explícitas a repositorios PostgreSQL para `tenants`, `subscriptions`, `google_connections`, `google_workspaces`, `secret_references` y `events` cuando el backend corre con `STORAGE_DRIVER=postgres`.
- Escrituras explícitas para operación del agente: `conversations`, `orders`, `customer_profiles`, `pending_requests`, `transactions` y `processed_messages`.
- Lecturas SQL directas para rutas operativas (`tenants`, `conversations`, `events`, `pending_requests`, `ops/overview`), herramientas de catálogo, Drive y perfil de cliente, lookup de conversaciones por WhatsApp y deduplicación por `messageId`.
- El `AgentRuntime` ya ejecuta su flujo principal en modo async para poder consultar repositorios SQL antes de decidir, marcar idempotencia persistente y devolver conversaciones actualizadas desde base de datos.
- Migraciones SQL en `server/db/migrations`, incluidas `008_integration_outbox.sql` y `011_inbound_messages_and_interactions.sql`. Esta última incorpora la recepción durable de webhooks y las ofertas de interacción de WhatsApp.

Esto permite desplegar en Render con Managed PostgreSQL y después granularizar el resto de repositorios por tabla sin reescribir el flujo del agente.

Para probar PostgreSQL local en Windows:

1. Confirma que el servicio local de PostgreSQL está iniciado y usa la URL de la base de desarrollo `ventas_ia_dev` definida en la configuración local del repositorio (la referencia de desarrollo está en `.env.example`).
2. En una ventana nueva de PowerShell, sin reutilizar una URL de Render ni de producción, ejecuta:

```powershell
npm run test:postgres:local
```

El script obtiene `DATABASE_URL` de `.env.example` y rechaza cualquier host distinto de `127.0.0.1`/`localhost` o una base distinta de `ventas_ia_dev`. `PostgresStore.load()` aplica las migraciones pendientes antes de las aserciones. El smoke crea registros con el prefijo `Tienda PG Smoke`; por ello no ejecutar este comando con una URL productiva.

## Revision contra el plan

Estado de ejecucion frente al plan SaaS:

- Multi-tenant base: implementado. El backend aísla por `tenantId`, tiene configuración por tenant y bloquea operación si el tenant no está activo.
- Identidad Google: primera implementación local completada. Hay login Google contract-first, sesión httpOnly, CSRF para mutaciones autenticadas, roles `owner/operator/viewer`, membresía por tenant, auditoría, prueba de bloqueo de acceso cruzado y frontend conectado a `/api/auth/*`. Falta probar Google Sign-In con `VITE_GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_ID` reales y activar `AUTH_REQUIRED=true` en piloto.
- Suscripción Mercado Pago: implementado a nivel contrato/API. Crea checkout, procesa webhook, valida `x-signature` HMAC cuando hay secret y cambia estado. Falta probar con credenciales reales y eventos reales de renovación/cancelación.
- Billing Mercado Pago SaaS: primera implementación local ejecutada. Hay modelo `pending_payment`, plan default `ventas_ia_1000_domicilios`, tablas PostgreSQL de billing, endpoints owner `/api/billing/*`, endpoints admin `/api/admin/billing/*`, recuperación de checkout, historial de pagos, descuentos, excepciones, embudo, job local `POST /api/admin/billing/jobs/run` y UI owner/admin con administración visual de planes. Falta conectar credenciales sandbox/productivas, consulta real de sincronización, cron de reconciliación e historial con comprobante real.
- Google operativo Drive/Sheets: implementado con OAuth contract-first y ruta live. Genera URL OAuth, maneja `state`, scopes y callback; con `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `SECRET_ENCRYPTION_KEY`, intercambia `code`, guarda `refresh_token` cifrado y refresca access tokens bajo demanda. Las herramientas `google_sheets_read_table`, `google_sheets_customer_profile_lookup`, `google_sheets_customer_profile_upsert` y `google_sheets_order_write` usan Sheets reales cuando el tenant esta en modo `live`, y actualizan el espejo local como cache. Falta probar con una cuenta Google real.
- Aprovisionamiento Google: implementado en modo sandbox/contrato y modo live por API. Define y puede crear carpetas, Sheets, pestañas, encabezados y validación de estado de pedido. Falta probar creación real en Google Drive/Sheets con credenciales del proyecto.
- Validación y activación: implementado. El tenant solo opera cuando suscripción, Google, provisioning, LLM y WhatsApp cumplen checks.
- PostgreSQL: implementado como adapter inicial. Hay migraciones, tablas espejo, escrituras explícitas para entidades SaaS críticas y operación del agente, lecturas SQL directas en rutas/herramientas críticas y deduplicación persistente por `processed_messages`. Falta retirar gradualmente la dependencia del snapshot JSONB que aun se conserva como compatibilidad.
- Agente LLM/DeepSeek: implementado en simulación Codex y con contrato JSON para proveedor API. Existe prueba local con `fetch` simulado que valida bearer token, endpoint, `response_format`, modelo y uso reportado. Falta ejecutar con una API key real de DeepSeek y evaluar calidad en conversaciones reales.
- WhatsApp por tenant: implementado en configuración, routing inbound por `phoneNumberId`, envío outbound live por Graph API usando el token resuelto desde `tenant.config.whatsapp.accessTokenRef` y asistente de activación dentro del onboarding. El wizard pregunta si el cliente ya tiene Cloud API, si usa WhatsApp Business App o si empieza desde cero; guarda la ruta, prepara Embedded Signup cuando existan credenciales Meta y deja guía manual cuando no. El webhook rechaza `phone_number_id` ausente o no asociado a un tenant, y la activación exige `phoneNumberId` real. Falta probar Embedded Signup y webhook con URL pública/credenciales reales.
- Seguridad de secretos: implementado como referencias en `secret_references` y vault local cifrado para tokens Google live. Falta conectar secret manager real.
- Observabilidad: implementado con eventos operativos, auditoría sensible en `audit_events` y medición mensual de uso/cuotas en `usage_counters`. Falta alertas productivas y política de retención.
- Admin Plataforma: implementado en local. Expone `/api/admin/overview`, `/api/admin/settings`, `/api/admin/webhooks` y `/api/admin/billing/*` para ver clientes, pagos, consumo, configuración DeepSeek global, Mercado Pago, embudo SaaS y webhooks históricos/recientes por proveedor, estado, tenant y búsqueda.

## Contratos de herramientas

Las herramientas externas están implementadas en modo `mock`/contract-first hasta configurar credenciales reales:

- `whatsapp_business_messaging`
- `google_sheets_customer_profile_lookup`
- `google_sheets_customer_profile_upsert`
- `google_sheets_order_write`
- `google_sheets_read_table`
- `google_drive_file_picker`
- `approval_gate`
- `human_handoff`
- `transactional_write`

El backend no almacena secretos planos desde la interfaz. Usa referencias de secreto por tenant, alineadas con el ACP.

## Deuda pendiente para producción

- Cargar credencial global real de DeepSeek en la plataforma y desactivar `platformSettings.llm.simulator: codex` en producción.
- Probar Google Sign-In real con credenciales Google Cloud y activar `AUTH_REQUIRED=true` / `CSRF_REQUIRED=true` en un ambiente piloto.
- Conectar evaluaciones contra LLM real para medir que DeepSeek/OpenAI/Gemini producen `toolPlan` correcto sin depender del simulador local.
- Crear contratos ACP formales para `google_sheets_customer_profile_lookup`, `google_sheets_customer_profile_upsert` y `google_sheets_order_write`.
- Ejecutar prueba real end-to-end con una cuenta Google de cliente donde `Catalogo`, `Clientes` y `Pedidos` sean leidos/escritos por las herramientas live.
- Ejecutar prueba real end-to-end con Meta/WhatsApp Cloud API usando URL pública, `phoneNumberId`, WABA y token del comercio.
- Retirar gradualmente la dependencia del snapshot JSONB restante: hoy sigue sirviendo como compatibilidad y semilla local, aunque el flujo principal del `AgentRuntime` ya consulta repositorios async para conversaciones, tenants y deduplicación.
- Convertir `resolveHumanRequest` y algunas validaciones del control plane a lecturas puramente SQL para que no dependan del estado en memoria.
- Conectar un secret manager administrado para resolver las referencias guardadas en `secret_references`; hoy existe vault local cifrado para piloto.
- Ejecutar prueba real end-to-end de creación Drive/Sheets contra APIs Google usando el refresh token del tenant.
- Probar la validación HMAC de Webhooks Mercado Pago contra eventos reales del ambiente productivo/sandbox.
- Completar UI de facturación owner/admin y jobs automáticos de reconciliación Mercado Pago.

## Pruebas

```bash
npm run test:backend
POSTGRES_TEST_DATABASE_URL=postgres://user:password@127.0.0.1:5432/ventas_ia_dev DATABASE_SSL=disable npm run test:postgres
npm run build
python C:\Users\Messi\.agents\skills\webapp-testing\scripts\with_server.py --server "npm run backend" --port 3001 --server "npm run dev -- --port 5173" --port 5173 --timeout 45 -- python tests\verify_ui.py
```

## Archivos de operación

- `.env.example`: variables mínimas para desarrollo, PostgreSQL local y piloto.
- `docs/Checklist-piloto-produccion.md`: checklist para activar URL pública, Google Cloud, Mercado Pago, DeepSeek y controles de seguridad.
- `scripts/google-live-pilot.ps1`: arranque local para probar OAuth Google real con `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `SECRET_ENCRYPTION_KEY`.
- `scripts/google-live-create-tenant.mjs`: crea un tenant piloto, activa suscripción mock y devuelve la URL OAuth con `loginHint`.
