# Ventas IA: arquitectura y funcionamiento real del código

**Base de este documento:** código fuente ejecutable del repositorio, migraciones y pruebas automatizadas.

Para el diagnóstico de límites internos, consistencia, seguridad y plan de evolución, consulta también [Arquitectura profunda de la app y del agente](./Arquitectura-profunda-app-y-agente.md).

**No se usaron como fuente los planes, briefs ni otros documentos existentes.** Cuando algo depende de una credencial, un proveedor externo o una variable de entorno, se indica como condición de operación, no como capacidad ya activa.

## 1. Qué es la aplicación

Ventas IA es una microaplicación SaaS multicliente para una tienda de barrio que recibe pedidos por WhatsApp. Su objetivo operativo es transformar mensajes desordenados en una conversación trazable con uno de estos resultados:

1. Respuesta de catálogo o guía de compra.
2. Pedido cotizado, con los datos que faltan claramente identificados.
3. Pedido confirmado, guardado y entregado a una persona para alistamiento y domicilio.
4. Caso escalado a una persona cuando el sistema no puede validar con seguridad lo pedido, hay una imagen, una queja, un descuento o una confirmación de pago.

No pretende reemplazar al tendero. El código está diseñado para que el agente consulte la fuente de datos de la tienda, formule preguntas, prepare el contexto y detenga el flujo en casos que requieren criterio humano.

## 2. Alcance comprobado en el repositorio

| Capacidad | Estado en código | Módulos principales |
| --- | --- | --- |
| Consola web React con nueve vistas operativas | Implementada | `src/App.jsx`, `src/styles.css` |
| Landing pública y entrada a la consola protegida | Implementada en el frontend | `src/App.jsx` |
| Inicio de sesión con Google, sesión HTTP y CSRF | Implementado | `server/services/authService.js`, `server/routes/auth.js` |
| Roles por tienda y administrador de plataforma | Implementado | `server/services/authService.js`, `server/routes/admin.js` |
| Creación autónoma de tenant y onboarding | Implementado | `server/services/saasControlPlane.js`, `server/routes/saas.js` |
| Suscripción mensual con Mercado Pago | Implementado con modo real y contrato local | `server/services/saasControlPlane.js`, `server/routes/mercadoPago.js` |
| Google OAuth, Drive y Sheets por tienda | Implementado con modo real y modo sandbox | `server/services/googleWorkspaceService.js`, `server/services/toolRegistry.js` |
| Importación de catálogo CSV | Implementada | `server/services/catalogImportService.js` |
| WhatsApp Cloud API, webhook y Embedded Signup | Implementado con modo real y mock | `server/routes/whatsapp.js`, `server/services/toolRegistry.js`, `server/services/saasControlPlane.js` |
| Planificador LLM para DeepSeek | Implementado | `server/services/llmPlanner.js`, `server/services/platformService.js` |
| Simulación local de DeepSeek con Codex CLI | Implementada para pruebas | `server/services/llmPlanner.js` |
| Escalamiento humano, respuesta y alistamiento | Implementado | `server/services/agentRuntime.js`, `server/services/toolRegistry.js` |
| Uso, límites mensuales y alertas | Implementado | `server/services/usageService.js`, `server/services/billingService.js` |
| Observabilidad de webhooks y eventos | Implementado | `server/services/platformService.js`, `server/routes/admin.js` |
| Persistencia JSON local y PostgreSQL | Implementado | `server/store/jsonStore.js`, `server/store/postgresStore.js` |

## 3. Arquitectura de ejecución

```text
Cliente por WhatsApp
        |
        v
Webhook Meta / POST /webhooks/whatsapp
        |
        +--> Verificación de firma y deduplicación de mensaje
        |
        v
AgentRuntime
        |
        +--> Perfil de cliente en Google Sheets
        +--> LLMPlanner: intención, canasta, faltantes y herramientas
        +--> ToolRegistry: catálogo, Drive, escritura, WhatsApp, aprobaciones
        |
        +--> Respuesta al cliente / pedido / escalamiento humano
        |
        v
Eventos, auditoría, uso, solicitudes humanas y consola React

Dueño de tienda
        |
        +--> Google Sign-In --> sesión y membresía de tenant
        +--> Onboarding --> Mercado Pago, Google, catálogo, WhatsApp

Administrador de plataforma
        |
        +--> configuración global de DeepSeek, planes, activación,
             consumo por tenant y observabilidad de webhooks
```

El servidor Express se arma en `server/index.js`. Crea una instancia de almacenamiento, eventos, medición de uso, bóveda de secretos, servicio Google, registro de herramientas, planificador LLM, runtime del agente, control plane SaaS y autenticación. Después monta las rutas bajo `/api` y `/webhooks`.

La aplicación React no contiene la lógica de negocio. Consume el backend cada cinco segundos para refrescar el resumen operativo y conserva fixtures solo para que la interfaz pueda visualizarse si el backend no está disponible.

## 4. Roles y fronteras de responsabilidad

### 4.1 Propietario u operador de una tienda

Una persona inicia sesión con Google y recibe membresías por tenant. El propietario puede:

- Ver solo los tenants donde posee membresía activa.
- Crear su tienda inicial.
- Gestionar checkout, cancelación y cambio de plan desde las rutas de facturación permitidas.
- Conectar su cuenta Google y aprovisionar su espacio operativo.
- Validar e importar su catálogo CSV.
- Seleccionar la ruta de alta de WhatsApp y lanzar Meta Embedded Signup cuando la plataforma está configurada.
- Atender solicitudes humanas, enviar una respuesta por plataforma o WhatsApp y abrir WhatsApp Web/Desktop.
- Modificar horarios y rangos de Sheets permitidos.

El propietario **no puede** modificar credenciales, modelo LLM, tokens, identificadores sensibles de integraciones ni límites de suscripción mediante el endpoint de configuración de tenant. Esa restricción vive en `server/services/tenantConfigPolicy.js`.

### 4.2 Administrador de plataforma

El administrador se reconoce por `PLATFORM_ADMIN_EMAILS` o por el campo persistido `platformRole: platform_admin`. Tiene acceso a:

- Configuración global del motor DeepSeek.
- Visión consolidada de tenants, suscripciones, consumo, último error y uso reciente.
- Planes, descuentos, excepciones temporales de acceso, cambios administrativos de plan y mantenimiento de facturación.
- Validación y activación final de cada tenant.
- Filtros y detalle de webhooks de todos los proveedores.
- Parámetros administrativos de un tenant.

El endpoint administrativo no devuelve valores secretos del LLM. Expone referencias, estado de configuración y parámetros no sensibles.

### 4.3 Cliente final de la tienda

El cliente final no inicia sesión en la microapp. Interactúa por WhatsApp. Su número `wa_id` es el identificador operativo de perfil y conversación, siempre dentro del tenant que recibió el webhook.

## 5. Aislamiento multicliente

El diseño de aislamiento aparece en varias capas y no depende de una sola convención visual.

| Capa | Mecanismo de aislamiento |
| --- | --- |
| Identidad | `tenantMembers` relaciona usuario, tenant, rol y estado. |
| API | `authorizeTenant`, `filterTenantsForRequest` y roles limitan rutas y listas. |
| Conversaciones | Cada conversación persiste `tenantId`; toda búsqueda por WhatsApp usa `tenantId + waId`. |
| Google | Hay conexión OAuth, refresh token, Drive raíz y spreadsheet por tenant. |
| WhatsApp | El webhook resuelve el tenant mediante `metadata.phone_number_id` contra `tenant.config.whatsapp.phoneNumberId`. |
| Secretos | La bóveda crea referencias por tenant, cifradas con AES-256-GCM. |
| Persistencia | Las tablas operativas llevan `tenant_id`; claves como productos y perfiles son compuestas por tenant. |
| Consumo | Contadores, ciclos de facturación y topes se calculan por tenant. |
| Interfaz | El selector de cliente y la carga del overview pasan `tenantId` al backend. |

### Observación importante sobre WhatsApp

El número, WABA y access token de envío se guardan por tenant. La verificación del webhook de Meta y la firma HMAC usan secretos de aplicación configurados en variables de entorno del servicio, porque pertenecen a la aplicación Meta que recibe el webhook. Es una separación intencional entre la aplicación proveedora compartida y los canales de cada tienda.

## 6. Funnel comercial y de activación

El repositorio implementa dos embudos distintos: uno de adquisición y activación SaaS, y otro operativo de pedidos.

### 6.1 Funnel comercial: de visita a tienda operativa

```text
Landing pública
  -> "Probar gratis" / "Entrar a mi tienda"
  -> Google Sign-In
  -> Crear tenant
  -> Prueba o suscripción
  -> OAuth Google
  -> Aprovisionar Drive y Sheets
  -> Importar catálogo
  -> Conectar WhatsApp Business
  -> Validar controles
  -> Activación por administrador
  -> Operación real
```

#### Landing

`LandingPage` en `src/App.jsx` presenta la propuesta comercial:

- Atención de pedidos de WhatsApp sin quedar pegado al celular.
- Catálogo, clientes y pedidos en el Google de la tienda.
- Decisión humana cuando hay duda.
- Plan básico de COP 89.000, hasta 400 domicilios y una calculadora orientativa de mensajes.
- Prueba de siete días solamente cuando un administrador la habilita en el plan. El plan por defecto en código tiene prueba desactivada.

La landing se sirve en `/` y `/landing` cuando el query string no contiene `app=1`. La consola se abre en `/?app=1`.

#### Registro y tenant

Después de Google Sign-In, un usuario sin membresías ve `TenantCreationView`. Esta solicita nombre de tienda y número de WhatsApp opcional. `SaasControlPlane.createTenant` crea:

- Tenant con industria `Tienda de barrio`.
- Configuración base de horario, Google, WhatsApp, políticas del agente y plan.
- Suscripción inicialmente `pending_payment`, o `trial` si el plan activa prueba.
- Contadores de uso y estado de onboarding.
- Membresía `owner` del usuario autenticado.
- Evento del embudo de facturación: `account_created` o `trial_started`.

#### Suscripción

El plan por defecto definido en `server/services/billingService.js` es:

| Dato | Valor actual en código |
| --- | --- |
| Id | `ventas_ia_400_domicilios` |
| Nombre | Ventas IA Básico |
| Precio | COP 89.000 mensuales |
| Domicilios incluidos | 400 |
| Interacciones de agente incluidas | 2.700 |
| Días de gracia | 5 |
| Prueba por defecto | Desactivada |

Si existe `MERCADOPAGO_ACCESS_TOKEN`, el backend crea una preapproval contra Mercado Pago y usa el `init_point` retornado. Si no existe, usa un contrato sandbox local que permite probar el flujo sin un cobro real. El webhook de Mercado Pago actualiza el estado usando `external_reference = tenantId`.

El código contempla checkout recuperable por siete días, cancelación al final del periodo, upgrade inmediato, downgrade programado al siguiente ciclo, descuentos, excepciones temporales y tareas de mantenimiento de cobro.

#### Google

El onboarding de Google exige suscripción activa. Pide los scopes:

- Identidad: `openid`, `email`, `profile`.
- Crear y gestionar archivos propios: `drive.file`.
- Leer y escribir Google Sheets: `spreadsheets`.

En modo real, el refresh token se cifra y se guarda por referencia. Luego se crea en el Drive del tenant:

```text
Ventas IA - {Nombre de tienda}/
  Catalogo y soportes/
  Clientes/
  Pedidos/
  Ventas IA Operacion - {Nombre de tienda} (Google Sheet)
```

El Sheet contiene cuatro pestañas:

| Hoja | Propósito |
| --- | --- |
| `Catalogo` | SKU, nombre, categoría, marca, presentación, precio, stock, aliases, activo y referencia Drive. |
| `Clientes` | Teléfono WhatsApp, nombre, dirección, barrio, notas, preferencias y fechas. |
| `Pedidos` | Id, cliente, dirección, canasta JSON, subtotal, estado, handoff y traza. |
| `Configuracion` | Valores operativos iniciales de la tienda. |

El aprovisionamiento aplica una validación de datos para el estado de pedidos. El CSV de catálogo permite sinónimos de encabezados, valida SKU único, nombre, precio, stock, presentación y activo. En modo real el catálogo se escribe a `Catalogo`; en modo de prueba se utiliza una fuente fixture local.

#### WhatsApp

Cada tenant escoge una de tres rutas:

1. Ya tiene una integración oficial Cloud API.
2. Tiene WhatsApp Business App y requiere guía de migración o activación.
3. Empieza desde cero.

La interfaz de onboarding muestra los pasos de diagnóstico, autorización Meta, cuenta WhatsApp, número/OTP, webhook y prueba. Si hay `META_APP_ID` y configuración Embedded Signup, la interfaz carga el SDK de Facebook y recibe `code`, `wabaId` y `phoneNumberId`. El backend intercambia el código, valida que el número pertenezca al WABA, cifra el token y solo entonces marca el canal como conectado.

La vinculación manual directa no puede marcar un número como activo: `saveWhatsAppBinding` exige `verifiedByProvider`. Es una protección contra asociar por error una cuenta ajena.

#### Validación y activación

La tienda queda lista para activar solo cuando se cumplan cinco chequeos:

1. Suscripción activa, autorizada, en prueba o periodo de gracia.
2. Google conectado.
3. Drive y Sheets aprovisionados.
4. DeepSeek global con referencia de API key.
5. Identificador de WhatsApp configurado para esa tienda.

Un administrador de plataforma realiza la activación final. A partir de allí `requireTenantOperational` impide procesar operación normal si faltan prerrequisitos o el acceso de facturación no es válido.

### 6.2 Funnel operativo: de mensaje a resultado

```text
Mensaje de WhatsApp
  -> Identificar tenant por phone_number_id
  -> Deduplicar mensaje
  -> Localizar cliente por wa_id
  -> Construir plan de razonamiento
  -> Consultar catálogo / perfil / Drive
  -> Responder, preguntar, cotizar o escalar
  -> Si confirma: registrar pedido
  -> Entregar solicitud clara al tendero para alistar
```

#### 1. Entrada y control del webhook

`server/routes/whatsapp.js` procesa la verificación GET de Meta y los POST entrantes. En modo con `WHATSAPP_APP_SECRET` valida `X-Hub-Signature-256`; sin ese secreto acepta el webhook, comportamiento adecuado solo para desarrollo o sandbox.

El endpoint toma el primer cambio de la entrada recibida, obtiene `metadata.phone_number_id` y ubica el tenant cuyo `config.whatsapp.phoneNumberId` coincide. Si no existe, devuelve error y no crea una conversación.

Cada webhook se registra redactando cabeceras y campos sensibles. Los mensajes se deduplican con `messageId` y la tabla `processed_messages` cuando el almacenamiento es PostgreSQL.

#### 2. Perfil del cliente

Antes de planear la respuesta, `AgentRuntime.routeConversation` llama `google_sheets_customer_profile_lookup` usando `wa_id` como clave. En Google en vivo lee `Clientes`; sin integración viva, solo puede recurrir al fixture si el entorno permite `ALLOW_LOCAL_CATALOG_FALLBACK`.

Cuando faltan nombre o dirección en un domicilio, el plan los reporta como campos faltantes. Al recibirlos, el runtime hace upsert en la hoja `Clientes`. No inventa esos datos.

#### 3. Razonamiento y plan de herramientas

`LLMPlanner` produce el contrato `ventas-ia-llm-plan.v2`. El resultado incluye:

- Intención: `delivery_order`, `order_clarification`, `order_confirmation`, `catalog_query`, `discount_request`, `payment_confirmation` o `human_handoff`.
- Lectura del pedido del cliente, certeza, ocasión y si requiere domicilio.
- Candidatos de producto con término original, consulta inferida, cantidad, presupuesto, presentación, ambigüedad y SKU si existe.
- Herramientas sugeridas y filtros de consulta.
- Campos faltantes, estrategia de respuesta y confianza.

La configuración se toma de `platformLlmConfig`, que hoy fuerza DeepSeek en la consola administrativa. El tono y el idioma pueden adaptarse desde la política de cada tenant, pero la credencial y el modelo son globales de la plataforma.

Hay tres modos de ejecución:

| Modo | Cuándo se usa | Propósito |
| --- | --- | --- |
| API del proveedor | Con API key configurada | DeepSeek por Chat Completions; el código también contiene soporte genérico para OpenAI y Gemini. |
| Simulación Codex CLI | `simulator = codex_cli` | Pruebas locales de razonamiento DeepSeek sin consumo del proveedor. |
| Fallback estructurado local | Error de proveedor o modo mock | Mantener continuidad de pruebas con reglas, aliases, categorías y validaciones. |

El prompt de proveedor pide una inferencia tipo tendero colombiano: modismos, errores ortográficos, marcas incompletas, presentaciones, cantidades y pedidos por valor. Sin embargo, el fallback local usa reglas conocidas, comparación de tokens y distancia Levenshtein. Por tanto, el producto es un sistema **híbrido**: LLM para hipótesis y decisión, más controles deterministas para limitar riesgos y validar datos.

#### 4. Consulta y validación

El agente no da por cierta la disponibilidad que menciona un cliente. Para catálogo y pedidos usa estas herramientas:

| Herramienta | Acción real |
| --- | --- |
| `google_sheets_read_table` | Lee catálogo desde Sheets vivo si existe OAuth live; filtra por SKU, categoría o consulta. |
| `google_drive_file_picker` | Recupera referencias de fichas asociadas a productos desde el estado de Drive. |
| `google_sheets_customer_profile_lookup` | Busca al cliente por `wa_id`. |
| `google_sheets_customer_profile_upsert` | Crea o actualiza cliente y dirección. |
| `google_sheets_order_write` | Guarda un pedido confirmado, en estado pendiente de preparación humana. |
| `whatsapp_business_messaging` | Registra y envía un texto o template por Cloud API en modo live. |
| `approval_gate` | Crea una aprobación controlada. |
| `human_handoff` | Crea una solicitud humana con contexto operacional. |

La búsqueda local de respaldo normaliza tildes, separadores y mayúsculas; pondera coincidencias directas, aliases, prefijos y Levenshtein para tokens de seis o más caracteres. En una conexión Google real, la tabla se lee al momento de la herramienta y el resultado se refleja también en el almacenamiento local como caché operativa por tenant.

#### 5. Respuestas automáticas posibles

| Situación | Resultado de runtime |
| --- | --- |
| Pregunta por categoría o disponibilidad | Busca catálogo y presenta opciones o ausencia de coincidencia. |
| Pedido con productos claros y datos suficientes | Calcula subtotal y solicita confirmación. |
| Pedido nuevo sin nombre o dirección | Pregunta por los datos faltantes y guarda el perfil cuando recibe datos. |
| Marca con varias presentaciones | Mantiene la solicitud ambigua y pide confirmar presentación. |
| Pedido por valor, por ejemplo `5000 de ...` | Trata `5000` como presupuesto, no como cantidad de unidades. |
| Producto no encontrado, sin stock o no inferible | Crea handoff humano de alta urgencia. |
| Imagen entrante | Escala a persona para clasificarla. |
| Descuento excepcional | Crea aprobación comercial. |
| Pago reportado | Crea aprobación antes de cualquier escritura transaccional. |
| Queja, faltante o entrega equivocada | Escala a persona. |

#### 6. Confirmación y pedido físico

Cuando la intención es `order_confirmation`, el runtime:

1. Verifica que aún haya cupo de domicilios.
2. Escribe el pedido en `Pedidos` con estado `pending_human_preparation`.
3. Crea un handoff `Alistar domicilio confirmado` para operaciones.
4. Incluye cliente, número, dirección, productos, total y método de pago en el contexto humano.
5. Envía al cliente una confirmación con referencia de pedido.
6. Incrementa el contador mensual de domicilios confirmados.

Esto evita que el sistema represente un pedido confirmado como terminado: la preparación y la entrega continúan bajo responsabilidad de una persona.

## 7. Intervención humana y operación manual

### 7.1 Bandeja humana

Las herramientas `human_handoff` y `approval_gate` crean registros en `pendingRequests`. La vista **Aprobaciones** los separa por pendientes, pedidos para preparar y solicitudes para responder. Un pedido confirmado se muestra como una tarea simplificada de alistamiento, no como un bloque técnico de eventos.

Al resolver una solicitud, el operador puede:

- Aprobar o rechazar.
- Dejar una nota interna.
- Guardar una respuesta en plataforma.
- Enviar una respuesta por WhatsApp desde la plataforma.

Para enviar WhatsApp, el caso debe tener `wa_id`; de otro modo el backend devuelve precondición no cumplida. Toda resolución y respuesta genera auditoría y eventos.

### 7.2 Atención manual por WhatsApp Web/Desktop

Desde el detalle de conversación se puede abrir `https://wa.me/{wa_id}`. Al hacerlo, el frontend llama `POST /api/conversations/:id/manual-whatsapp`.

El backend entonces:

- Marca `manualMode = whatsapp_external`.
- Pausa la IA para **esa conversación**, no para todo el tenant.
- Registra una nota: la conversación continúa manualmente en WhatsApp Web/Desktop.
- Sigue guardando mensajes entrantes sin responderlos automáticamente.
- Después de cinco minutos de inactividad por defecto, cierra el caso como `closed_no_confirmation`, `not_confirmed` y lo mueve a historial.
- Un mensaje posterior abre un caso nuevo, salvo que el cliente indique explícitamente que continúa el pedido anterior dentro de una ventana de 30 minutos.

Este diseño evita mezclar pedidos nuevos con una conversación manual que el tendero ya dejó de actualizar en la consola.

## 8. Límite, medición y costo operativo en código

El sistema mide por tenant y periodo de facturación:

- Interacciones del agente.
- Domicilios confirmados.
- Llamadas a herramientas.
- Llamadas LLM.
- Tokens de entrada, salida y total del LLM.

Una interacción se incrementa por mensaje entrante que el agente procesa. Los mensajes recibidos durante `manual_active` no aumentan ese contador porque la IA está pausada para esa conversación.

El plan base impide nuevas interacciones al llegar a 2.700 y nuevos domicilios confirmados al llegar a 400. Genera alertas en 70 %, 85 % y 100 %. No hay un límite de tokens LLM por defecto: el valor `includedLlmTokens` es nulo, aunque los tokens sí quedan registrados. Si la API no reporta uso, el estimador usa aproximadamente un token por cada cuatro caracteres de texto.

Por eso, en el código actual “2.700 interacciones” es el límite facturable operativamente. No equivale de manera estricta a 2.700 mensajes de WhatsApp, ni a una cuota directa de Meta, ni a una cuota de tokens de DeepSeek.

## 9. Interfaz y navegación

La interfaz está contenida principalmente en `src/App.jsx` y usa `lucide-react` para iconografía. Las vistas activas son:

| Vista | Función |
| --- | --- |
| Resumen | Atención prioritaria, plan, embudo y salud operativa. |
| Tienda viva | Gemelo visual de conversaciones, zonas y alertas. |
| Conversaciones | Listado filtrable y detalle separado por tabs: chat, resumen y acciones. |
| Onboarding | Suscripción, Google, catálogo, WhatsApp y validación. |
| Centro de control | Configuración global de IA y radar administrativo, solo admin. |
| Observabilidad | Webhooks por proveedor, tenant, estado y fecha, solo admin. |
| Aprobaciones | Bandeja humana de decisiones, respuestas y alistamiento. |
| Analítica | Uso del plan, flujo, riesgos y eventos. |
| Configuración | Horarios, rangos de Google Sheets y estado de herramientas permitidas. |

### Tienda viva

`StoreMap` traduce el estado real de conversaciones y eventos a zonas visuales. Priorizan aprobación, bloqueo, degradación y handoff sobre efectos decorativos. Al seleccionar un personaje abre el detalle de la conversación, desde donde se puede abrir WhatsApp.

La vista incluye agrupación visual cuando hay volumen, paneles de foco de zona, controles de cámara y una alerta de prioridad. Su objetivo es visualizar operación, no inventar movimiento: las ubicaciones se derivan de estado, etapa, herramienta y eventos de la conversación.

### Conversaciones

La bandeja usa dos tabs horizontales de espacio de trabajo:

- **Listado:** búsqueda por cliente, ID, necesidad o herramienta; filtro de estado.
- **Detalle:** conversación, resumen y acciones de una conversación seleccionada.

El detalle tiene además tabs de **Chat**, **Resumen** y **Acciones**. El botón Abrir WhatsApp se encuentra en el encabezado y registra el cambio a atención manual. En dispositivos móviles la navegación abre el detalle como una vista separada para no intentar reducir todo el escritorio a una columna estrecha.

### Onboarding

El onboarding representa el estado emitido por el backend. No se basa solo en texto estático: muestra checks de suscripción, OAuth, aprovisionamiento, LLM y WhatsApp. También incluye importador CSV, panel de facturación y wizard para los tres puntos de partida de WhatsApp.

## 10. API funcional

### Autenticación

| Método y ruta | Uso |
| --- | --- |
| `POST /api/auth/google` | Crea sesión usando Google ID token o contrato sandbox. |
| `GET /api/auth/me` | Devuelve usuario, membresías y token CSRF de sesión. |
| `POST /api/auth/logout` | Revoca la sesión. |

### Operación por tenant

| Método y ruta | Uso |
| --- | --- |
| `GET /api/ops/overview?tenantId=` | Resumen, inbox, historial, solicitudes, eventos, herramientas y uso. |
| `GET /api/conversations` | Bandeja filtrada por tenant. |
| `GET /api/conversations/:id` | Detalle de conversación. |
| `POST /api/conversations/:id/manual-whatsapp` | Pausa IA y marca atención manual del caso. |
| `GET /api/pending-requests` | Solicitudes humanas del tenant. |
| `POST /api/pending-requests/:id/resolve` | Aprueba, rechaza y opcionalmente responde. |
| `POST /api/agent/run` | Simula una entrada del agente por API local. |
| `GET /api/usage` | Uso mensual por tenant. |
| `PATCH /api/tenants/:tenantId/config` | Configuración editable por propietario. |

### SaaS y onboarding

| Método y ruta | Uso |
| --- | --- |
| `POST /api/saas/tenants` | Crea tenant. |
| `GET /api/saas/tenants/:tenantId/status` | Estado combinado de onboarding. |
| `POST /api/saas/tenants/:tenantId/subscription/checkout` | Inicia checkout. |
| `GET /api/saas/tenants/:tenantId/google/oauth/start` | Inicia OAuth Google. |
| `GET /api/saas/google/oauth/callback` | Recibe callback OAuth. |
| `POST /api/saas/tenants/:tenantId/google/provision` | Crea Drive y Sheets. |
| `POST /api/saas/tenants/:tenantId/google/catalog/validate` | Valida CSV. |
| `POST /api/saas/tenants/:tenantId/google/catalog/import` | Importa catálogo. |
| `GET /api/saas/tenants/:tenantId/whatsapp/status` | Estado de WhatsApp. |
| `POST /api/saas/tenants/:tenantId/whatsapp/intent` | Guarda ruta de alta. |
| `POST /api/saas/tenants/:tenantId/whatsapp/embedded-signup/start` | Prepara Embedded Signup. |
| `POST /api/saas/tenants/:tenantId/whatsapp/embedded-signup/complete` | Valida y persiste conexión Meta. |
| `POST /api/saas/tenants/:tenantId/validate` | Ejecuta validación final. |

### Administración de plataforma

La familia `/api/admin/*` requiere rol de plataforma. Incluye overview, settings de LLM, webhooks, planes, sincronización de Mercado Pago, descuentos, excepciones, cambio de plan, mantenimiento, activación de tenant, configuración privilegiada y funnel de facturación.

### Webhooks

| Método y ruta | Uso |
| --- | --- |
| `GET /webhooks/whatsapp` | Verificación de Meta. |
| `POST /webhooks/whatsapp` | Mensajes y estados entrantes de WhatsApp. |
| `POST /webhooks/mercadopago` | Eventos de preapproval y facturación. |

## 11. Persistencia y modelo de datos

### Modo local

Sin `DATABASE_URL`, la aplicación utiliza `JsonStore`: un archivo JSON local con estado inicial y fixtures. Es apropiado para desarrollo y pruebas, no para múltiples instancias de servidor.

### Modo PostgreSQL

Con `STORAGE_DRIVER=postgres` y `DATABASE_URL`, `PostgresStore` aplica migraciones automáticamente. Mantiene un documento JSONB completo en `app_state` y lo proyecta a tablas relacionales para consultas operativas. Entre las tablas principales se encuentran:

- `tenants`, `tenant_members`, `users`, `sessions`, `audit_events`.
- `conversations`, `pending_requests`, `orders`, `transactions`, `processed_messages`.
- `products`, `drive_files`, `customer_profiles`, `google_connections`, `google_workspaces`.
- `subscriptions`, `billing_plans`, `subscription_payments`, `billing_usage_cycles`, descuentos y excepciones.
- `webhook_events`, `events`, `usage_counters`.

La persistencia serializa las escrituras con una cola interna y hace upserts. Esto reduce conflictos dentro de una instancia de Node. El diseño no muestra una cola de trabajos distribuida ni coordinación entre varias instancias de runtime; esa es una limitación relevante si se escala horizontalmente.

## 12. Seguridad implementada

| Control | Implementación |
| --- | --- |
| Sesiones | Cookie HTTP-only, `SameSite=Lax`, `Secure` en producción, expiración configurable. |
| Google Sign-In | Consulta `tokeninfo` y valida `aud` contra `GOOGLE_CLIENT_ID` cuando está configurado. |
| CSRF | Requerido para métodos mutables cuando `AUTH_REQUIRED=true`, salvo login. |
| RBAC | Roles owner, operator y viewer; admin separado por plataforma. |
| Secretos de tenant | AES-256-GCM con `SECRET_ENCRYPTION_KEY` o `GOOGLE_TOKEN_ENCRYPTION_KEY`. |
| Secretos en UI | Solo referencias, nunca valor de secret. |
| WhatsApp | Validación HMAC cuando existe app secret; mapping de número a tenant. |
| Mercado Pago | Validación de firma cuando existe `MERCADOPAGO_WEBHOOK_SECRET`. |
| Auditoría | Acciones de usuario, integración, aprobación, facturación y herramientas. |
| Idempotencia | Mensajes WhatsApp persistidos en `processed_messages`. |

### Condiciones obligatorias de producción

El código permite modos de desarrollo. Antes de producción se deben habilitar, como mínimo:

- `AUTH_REQUIRED=true` y `CSRF_REQUIRED=true`.
- Google Client ID y Client Secret reales.
- Clave de cifrado de secretos estable y protegida.
- `STORAGE_DRIVER=postgres` y `DATABASE_URL`.
- `ALLOW_LOCAL_CATALOG_FALLBACK=false`.
- `WHATSAPP_PROVIDER_MODE=live`, `WHATSAPP_APP_SECRET` y token de verificación de webhook.
- Access token y secret de Mercado Pago junto con secreto de webhook.
- URL pública correcta para callbacks OAuth y webhooks.

Sin estos valores, varias rutas usan contratos sandbox o mocks. Eso permite probar el producto, pero no significa que el proveedor externo esté habilitado.

## 13. Observabilidad y trazabilidad

El sistema genera eventos en cada paso relevante:

- Inicio, completado y fallo del agente.
- Plan LLM creado y fallback del proveedor.
- Inicio, finalización y error de herramientas.
- Solicitudes, aprobaciones, rechazos y handoffs humanos.
- Umbrales de presupuesto y excedentes.
- Webhooks recibidos, procesados, ignorados, rechazados o fallidos.
- Suscripciones, Google OAuth, aprovisionamiento, conexión WhatsApp e importación de catálogo.

La consola administrativa agrega por tenant: estado de pago, acceso, Google, WhatsApp, consumo, último uso, último error y resumen de webhooks. La vista Observabilidad ofrece filtros por tenant, proveedor, estado, texto y rango de fechas sobre los webhooks persistidos.

Los payloads de webhook se pasan por una función de redacción antes de guardarse. El límite en memoria para eventos generales es 500 y el de webhooks de estado es 2.000, aunque PostgreSQL almacena los eventos que recibe mediante las tablas correspondientes.

## 14. Ventajas que el código permite comunicar honestamente

### Para una tienda

- **Ordena conversaciones reales:** cada caso tiene estado, siguiente paso, historial y responsable humano cuando aplica.
- **Consulta datos de la tienda:** catálogo, cliente y pedidos están diseñados para vivir en Sheets/Drive de cada cliente.
- **No adivina stock como hecho:** busca catálogo antes de cotizar o confirma la necesidad de intervención humana.
- **Reduce repetición:** usa el número de WhatsApp para recordar nombre, dirección y preferencias del cliente cuando existen.
- **Entrega una orden legible:** un pedido confirmado llega al tendero con productos, total, dirección y forma de pago disponible.
- **Mantiene control humano:** imágenes, reclamos, descuentos, pagos y productos ambiguos no se ejecutan como decisiones autónomas.
- **Permite cambiar de canal:** el operador puede seguir por WhatsApp Web/Desktop sin que la IA continúe contestando ese caso.

### Para la plataforma SaaS

- **Escala por tenant:** modelos de datos, membresías, secretos, consumo y conexiones están separados.
- **Un motor de IA compartido:** DeepSeek se gobierna desde el administrador para evitar credenciales y políticas por tienda.
- **Cobro controlado:** plan, trial, pago, gracia, cancelación, upgrades, downgrades, descuentos y excepciones tienen estado persistente.
- **Costo observable:** mide llamadas LLM, tokens, herramientas, interacciones y domicilios.
- **Soporte operable:** webhooks, errores y estados se pueden revisar centralmente sin entrar a cada tenant.

## 15. Límites y precauciones deducidos del código

Estas observaciones no son pendientes de un plan: son límites actuales verificables en la implementación.

1. **El fallback sigue teniendo reglas locales.** Aunque la API LLM recibe un prompt heurístico, la continuidad sin proveedor usa diccionarios, keywords y matching. Se debe etiquetar en la interfaz y en la operación como fallback, no como inferencia de DeepSeek.
2. **No hay un programador de sincronización de catálogo cada cuatro horas en el backend revisado.** La lectura viva ocurre al ejecutar herramientas y actualiza una caché por tenant. No se encontró un worker o cron de sincronización de Drive/Sheets.
3. **La búsqueda de fichas Drive no llama a Drive en vivo.** `google_drive_file_picker` toma las referencias guardadas en el estado; el catálogo live alimenta esas referencias durante la lectura de Sheets.
4. **El webhook procesa el primer cambio de una entrada Meta.** Una carga con múltiples cambios no se itera completamente en la ruta actual.
5. **La validación de firma se omite si no hay secreto configurado.** Es útil para sandbox, pero inseguro como configuración productiva.
6. **La activación final es administrativa.** El dueño completa gran parte del onboarding, pero no activa por sí mismo el tenant aun cuando todos los checks sean válidos.
7. **El acceso a la aplicación puede quedar abierto si `AUTH_REQUIRED` no se configura.** El código se comporta deliberadamente de forma permisiva para desarrollo.
8. **No hay límite de tokens LLM incluido por defecto.** Se miden tokens, pero el plan aplica topes de interacciones y domicilios. La promesa comercial de costo IA debe gobernarse con un valor explícito o una alerta administrativa.
9. **El mantenimiento de facturación es una función invocable, no un scheduler autónomo dentro del proceso.** Para aplicar vencimientos y gracia automáticamente en producción necesita ejecución periódica externa.
10. **PostgreSQL mantiene snapshot JSONB además de proyecciones relacionales.** Ofrece rapidez de evolución y trazabilidad, pero agrega carga de escritura; se debe observar al crecer el volumen.

## 16. Pruebas presentes en el código

El `package.json` define pruebas para backend, escenarios colombianos, proveedores LLM, autenticación, Google live contract, WhatsApp live contract, Embedded Signup, PostgreSQL, Mercado Pago sandbox, importación de catálogo y plan de autoservicio.

Durante la elaboración de este documento se ejecutaron directamente:

| Comando | Resultado |
| --- | --- |
| `node server/tests/colombia-scenarios.mjs` | Correcto: 50 escenarios, 57 pasos. |
| `node server/tests/llm-provider.mjs` | Correcto: contrato de proveedores LLM. |

También se revisó el script compuesto `npm run test:backend`, que incluye smoke backend, escenarios Colombia, LLM, autenticación, Google, WhatsApp live y Embedded Signup. Este documento no afirma ejecución de proveedores reales: los contratos de integración usan mocks controlados cuando no se aportan credenciales externas.

## 17. Mapa de archivos para mantenimiento

| Área | Archivos de referencia |
| --- | --- |
| Arranque y configuración | `server/index.js`, `server/config.js` |
| API de operación | `server/routes/api.js`, `server/routes/auth.js` |
| SaaS, pagos y onboarding | `server/routes/saas.js`, `server/routes/billing.js`, `server/routes/mercadoPago.js`, `server/services/saasControlPlane.js` |
| WhatsApp | `server/routes/whatsapp.js`, `server/services/toolRegistry.js` |
| Agente | `server/services/agentRuntime.js`, `server/services/llmPlanner.js` |
| Google y catálogo | `server/services/googleWorkspaceService.js`, `server/services/catalogImportService.js` |
| Seguridad | `server/services/authService.js`, `server/services/secretVault.js`, `server/services/tenantConfigPolicy.js` |
| Consumo y observabilidad | `server/services/usageService.js`, `server/services/events.js`, `server/services/platformService.js` |
| Persistencia | `server/store/jsonStore.js`, `server/store/postgresStore.js`, `server/db/migrations/` |
| Interfaz | `src/App.jsx`, `src/data/acpModel.js`, `src/styles.css` |
| Pruebas | `server/tests/`, `tests/` |

## 18. Conclusión técnica

El repositorio implementa una base SaaS completa para operación comercial asistida por WhatsApp: tiene aislamiento por tenant, onboarding, autenticación Google, estructura operativa en Google, conexión WhatsApp, facturación, motor LLM, herramientas, control humano, uso y trazabilidad.

Su diferenciador operativo es el equilibrio entre automatización y control: el agente convierte mensajes en hipótesis verificables, consulta las fuentes de la tienda y entrega una decisión humana clara cuando la certeza no es suficiente. El valor no está en prometer autonomía total, sino en que una tienda pueda atender más ordenadamente sin perder decisión sobre inventario, precio, pago y entrega.
