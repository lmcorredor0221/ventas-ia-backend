# Plan de cierre de GAPs del onboarding autogestionado

Fecha: 2026-10-14  
Producto: Ventas IA Ops Store  
Objetivo: permitir que cada cliente configure por autoservicio su Google Drive/Sheets y su WhatsApp Business, manteniendo el resto de la plataforma bajo control del administrador.

## 1. Objetivo operativo

El cliente debe poder:

- Iniciar o continuar su onboarding despues de autenticarse con Google.
- Confirmar su suscripcion y acceder al flujo posterior al pago.
- Autorizar su propia cuenta Google mediante OAuth 2.0.
- Crear automaticamente en su Drive las carpetas, hojas, encabezados y validaciones.
- Completar o corregir sus datos operativos permitidos.
- Conectar su WhatsApp Business mediante Embedded Signup de Meta o una guia manual controlada.
- Verificar que Google y WhatsApp quedaron realmente operativos.
- Ejecutar una prueba guiada sin editar parametros globales de la plataforma.

El administrador de plataforma debe poder:

- Administrar DeepSeek, proveedores, modelo, limites y simulador.
- Administrar planes, trial, gracia, pagos, excepciones y reconciliacion.
- Administrar politicas globales, permisos, observabilidad, webhooks y soporte.
- Ver el estado de todos los tenants y actuar sobre ellos con auditoria.
- Reintentar, bloquear o reabrir pasos de onboarding sin apropiarse de las credenciales del cliente.

## 2. Diagnostico actual

| GAP | Estado actual | Riesgo | Prioridad |
| --- | --- | --- | --- |
| WhatsApp Embedded Signup real | El backend devuelve metadata, pero no genera una URL ejecutable ni tiene callback | El cliente no puede completar WhatsApp desde la microapp | P0 |
| Binding WhatsApp | Acepta `phoneNumberId` y marca conectado sin prueba Graph, token, OTP ni webhook | Falsos positivos y conexiones rotas | P0 |
| Credenciales WhatsApp por tenant | Existe referencia por tenant, pero el envio puede caer al token global | Posible mezcla de clientes | P0 |
| Configuracion owner demasiado amplia | El owner puede editar politica del agente, rangos y referencias internas | El cliente modifica parametros reservados al administrador | P0 |
| Endpoint de configuracion sin lista blanca | `mergeConfig` acepta secciones arbitrarias | Escalada de permisos por API | P0 |
| Creacion de tenant desde UI | Existe endpoint backend, pero no hay flujo visual completo | Un cliente nuevo no puede iniciar autoservicio | P1 |
| OAuth Google publico | Funciona localmente; falta validar callback, redireccion y provisionamiento en URL publica | Onboarding incompleto en produccion | P1 |
| Pruebas de aceptacion | Las pruebas actuales son contractuales/locales | Se puede declarar listo sin integracion real | P1 |

## 3. Matriz de responsabilidades

| Capacidad | Cliente owner | Administrador plataforma | Sistema |
| --- | --- | --- | --- |
| Autenticacion Google | Ejecuta | No interviene | Valida identidad y membresia |
| Crear tienda/tenant | Solicita desde onboarding | Puede aprobar o corregir | Crea tenant y membresia |
| Suscripcion Mercado Pago | Contrata y gestiona su pago | Configura planes y excepciones | Recibe webhook y aplica estado |
| Google OAuth | Ejecuta y revoca su autorizacion | Puede ver estado, no token | Cifra refresh token y limita scopes |
| Drive/Sheets | Autoriza, abre y completa datos | Puede reintentar provisionamiento | Crea estructura y valida permisos |
| WhatsApp Business | Selecciona cuenta, numero y OTP | Configura Meta App y soporte | Intercambia, cifra y valida credenciales |
| Catalogo, clientes y pedidos | Completa datos operativos permitidos | Puede soporte | Consulta/escribe en recursos del tenant |
| DeepSeek | No configura | Configura globalmente | Consume configuracion comun y mide uso |
| Politica del agente | No cambia reglas sensibles | Administra | Aplica por tenant segun politica aprobada |
| Webhooks y observabilidad | Consulta estado propio | Administra todos | Registra eventos, errores y auditoria |
| Activacion final | Solicita validacion | Puede aprobar, bloquear o reabrir | Ejecuta checks tecnicos |

Regla: que una funcion sea visible en el frontend no significa que el cliente pueda ejecutarla. La autorizacion final debe estar en backend.

## 4. Plan de implementacion

### Fase P0-A: cerrar limites de seguridad y permisos

Objetivo: impedir que un owner modifique configuracion administrativa o marque integraciones falsas.

Archivos principales:

- `server/routes/api.js`
- `server/routes/saas.js`
- `server/services/authService.js`
- `server/services/saasControlPlane.js`
- `src/App.jsx`

Actividades:

1. Crear un esquema de payload permitido para `PATCH /api/tenants/:tenantId/config`.
2. Permitir al owner solamente datos operativos definidos: rangos aprobados de Sheets, datos de tienda y preferencias no sensibles.
3. Mover `agentPolicy`, `orderPolicy`, `saas`, referencias de secretos, enforcement y configuracion de proveedores a rutas admin.
4. Agregar autorizacion explicita para rutas administrativas por tenant.
5. Ocultar o reemplazar en la UI del cliente los campos de referencias tecnicas y politica global.
6. Hacer que `validate` y `activate` requieran rol admin, o dejar `validate` como solicitud del owner y `activate` exclusivamente admin. La segunda opcion es la recomendada.
7. Agregar auditoria de actor, tenant, campos modificados y resultado.

Criterios de cierre:

- Un owner no puede modificar `tenant.config.saas`, `agentPolicy`, `orderPolicy`, tokens ni referencias de secretos.
- Un administrador puede ejecutar soporte sin acceder a valores planos.
- Tests de autorizacion cubren owner, operator, usuario sin membresia y platform admin.

### Fase P0-B: WhatsApp Business autoservicio real

Objetivo: que el cliente conecte su propio WhatsApp desde Onboarding, sin copiar credenciales tecnicas.

Archivos principales:

- `server/routes/saas.js`
- `server/services/saasControlPlane.js`
- `server/services/secretVault.js`
- `server/services/toolRegistry.js`
- `server/routes/whatsapp.js`
- `src/App.jsx`

Actividades:

1. Crear la ruta publica de callback para Embedded Signup.
2. Generar la URL real de autorizacion de Meta con `META_APP_ID`, config id, state firmado y tenant asociado.
3. Persistir el state con expiracion, tenant, usuario iniciador y uso unico.
4. Recibir el resultado de Meta y completar el intercambio de codigo en backend.
5. Consultar Graph API para obtener y validar WABA, numero, permisos y estado.
6. Guardar el access token cifrado en `SecretVault` con referencia exclusiva del tenant.
7. Guardar `wabaId`, `phoneNumberId`, numero visible y nombre verificado solo despues de validar Graph API.
8. Registrar la asociacion del webhook y verificar que el numero corresponde al tenant.
9. Cambiar el estado a `connected` solo despues de completar todas las validaciones.
10. Eliminar el fallback de `WHATSAPP_ACCESS_TOKEN` para operacion productiva multi-tenant. Puede conservarse un modo local explicitamente marcado como mock.
11. Implementar una prueba de envio y recepcion por tenant.
12. Si Embedded Signup no esta disponible, mostrar guia manual, pero no permitir marcar conectado solo con un ID. La guia manual debe terminar en una validacion admin o Graph API verificable.

Criterios de cierre:

- El boton de alta abre Meta desde la microapp.
- El callback vuelve a Onboarding y actualiza el estado sin copiar datos tecnicos.
- Un token de tenant A nunca se usa para tenant B.
- Un `phoneNumberId` inventado no puede pasar a estado conectado.
- El webhook rechaza numeros no asociados.
- La prueba real de mensaje identifica tenant, numero y resultado.

### Fase P0-C: Google Drive/Sheets como autoservicio completo

Objetivo: consolidar el flujo que ya funciona localmente y eliminar ambiguedad tecnica para el cliente.

Archivos principales:

- `server/services/saasControlPlane.js`
- `server/services/googleWorkspaceService.js`
- `server/routes/saas.js`
- `src/App.jsx`

Actividades:

1. Mantener OAuth exclusivo del owner del tenant.
2. Despues del callback, redireccionar al frontend con estado seguro en lugar de mostrar JSON tecnico.
3. Actualizar automaticamente el onboarding cuando la cuenta queda conectada.
4. Permitir un solo boton `Crear estructura en mi Google` despues de OAuth.
5. Hacer idempotente el aprovisionamiento para no crear carpetas duplicadas al reintentar.
6. Mostrar al cliente solo cuenta, carpeta, hoja, estado y boton para abrir Sheets.
7. Mover referencias tecnicas y rangos avanzados a una vista administrativa o avanzada protegida.
8. Agregar validacion de lectura/escritura sobre `Catalogo`, `Clientes` y `Pedidos`.
9. Permitir revocar y reconectar Google sin revelar refresh tokens.

Criterios de cierre:

- Una cuenta cliente puede completar OAuth, provisionar y abrir su Sheet.
- Reintentar no duplica la estructura.
- Se valida lectura y escritura real.
- Otro tenant no puede consultar ni editar los recursos.

### Fase P1-A: entrada de autoservicio y ciclo de onboarding

Objetivo: que un nuevo cliente pueda comenzar sin intervencion tecnica.

Actividades:

1. Crear pantalla inicial despues de Google Sign-In: `Crear mi tienda` o `Continuar onboarding`.
2. Solicitar solo nombre comercial, ciudad y telefono de la tienda.
3. Crear tenant y membresia owner con el usuario autenticado.
4. Crear checkout Mercado Pago y asociarlo al tenant.
5. Bloquear Google operativo y WhatsApp real hasta que la suscripcion este activa, de acuerdo con la decision vigente.
6. Mostrar pasos y estados persistentes aunque el usuario cierre sesion.
7. Permitir retomar onboarding desde el ultimo paso.
8. Definir claramente que el cliente paga WhatsApp Business y que la plataforma solo cobra el uso del SaaS.

Criterios de cierre:

- Un usuario nuevo puede pasar de login a tenant creado, checkout, Google y WhatsApp sin soporte tecnico.
- Un tenant no puede ver otro tenant.
- El sistema conserva el estado despues de refresh, logout/login y reintentos.

### Fase P1-B: consola del administrador

Objetivo: concentrar todo lo que no debe configurar el cliente.

Actividades:

1. Mantener DeepSeek exclusivamente en Centro de control.
2. Agregar acciones admin para reintentar provisionamiento Google, revisar WhatsApp, bloquear/reabrir onboarding y activar tenant.
3. Agregar vista de credenciales como estado y referencia, nunca valor plano.
4. Agregar filtros por tenant, estado, proveedor, fecha y error.
5. Mostrar auditoria de cada accion administrativa.
6. Separar claramente `Configuracion de tienda` de `Configuracion de plataforma`.
7. Evitar que un admin necesite editar manualmente archivos del cliente para completar una conexion.

Criterios de cierre:

- El administrador puede resolver un onboarding bloqueado desde la consola.
- Ningun secreto aparece en UI, logs o respuestas API.
- Las acciones administrativas son auditables y reversibles cuando aplique.

### Fase P1-C: estados y experiencia de onboarding

Objetivo: que el usuario entienda que debe hacer en cada paso.

Estados minimos:

- Pendiente de suscripcion.
- Suscripcion activa.
- Google pendiente.
- Google autorizado.
- Drive/Sheets aprovisionados.
- WhatsApp pendiente de ruta.
- WhatsApp en autorizacion Meta.
- WhatsApp esperando OTP.
- WhatsApp validando webhook.
- Conexion lista.
- Requiere soporte del administrador.
- Operacion habilitada.

Cada estado debe mostrar: que significa, que necesita el usuario, accion disponible, ultimo error y como reintentar.

### Fase P1-D: pruebas de aceptacion

Crear pruebas separadas para:

1. Owner cliente nuevo sin tenant.
2. Owner con tenant y suscripcion activa.
3. Google OAuth exitoso.
4. Google OAuth cancelado o sin refresh token.
5. Provisionamiento Google repetido.
6. WhatsApp Embedded Signup exitoso.
7. WhatsApp sin permisos.
8. WhatsApp OTP fallido.
9. WhatsApp numero no asociado.
10. Token de tenant A intentando usarse en tenant B.
11. Owner intentando modificar configuracion admin.
12. Platform admin reabriendo un onboarding.
13. Usuario sin membresia intentando consultar un tenant.
14. Suscripcion vencida bloqueando operacion.
15. Reconexion despues de revocar Google o WhatsApp.

Cada prueba debe dejar:

- Request y respuesta relevantes sin secretos.
- Estado inicial y final del tenant.
- Evento de auditoria.
- Resultado de webhook o proveedor.
- Captura de UI cuando el criterio sea visual.

## 5. Orden de ejecucion

1. P0-A: permisos, lista blanca y separacion de configuracion.
2. P0-B: WhatsApp real por tenant.
3. P0-C: endurecer Google autoservicio e idempotencia.
4. P1-A: entrada de nuevo cliente y retomar onboarding.
5. P1-B: acciones administrativas y observabilidad.
6. P1-C: estados y textos de onboarding.
7. P1-D: pruebas de aceptacion locales y publicas.
8. Solo despues: configuracion definitiva de Render, Vercel, OAuth publico, Meta y Mercado Pago.

## 6. Criterio de salida antes de declarar listo

- [ ] El cliente puede hacer Google OAuth y provisionar Drive/Sheets sin soporte.
- [ ] El cliente puede conectar WhatsApp Business sin copiar tokens.
- [ ] WhatsApp solo se marca conectado despues de validacion real.
- [ ] Cada tenant usa sus propias credenciales y numero.
- [ ] El owner no puede modificar configuracion administrativa.
- [ ] DeepSeek, billing, planes, observabilidad y politicas globales son admin-only.
- [ ] Existe entrada de autoservicio para un cliente nuevo.
- [ ] Google y WhatsApp pueden reconectarse y revocarse.
- [ ] Los webhooks rechazan eventos de otros tenants.
- [ ] Las pruebas de aislamiento pasan con dos tenants reales o de prueba.
- [ ] La UI no presenta estados mock como si fueran productivos.
- [ ] La documentacion de despliegue queda actualizada con las variables y callbacks reales.

## 7. Evidencia actual y deuda aceptada

Actualmente `npm run build` y `npm run test:backend` pasan, incluyendo pruebas contractuales de Google y WhatsApp. Esto demuestra consistencia local del contrato, pero no cierra el objetivo de autoservicio real. El plan solo se considerara cerrado cuando existan pruebas de proveedor real, aislamiento por tenant y una ruta completa desde login hasta conexion operativa.

Documentos relacionados:

- `docs/Seguimiento-consolidado-planes-vigentes.md`
- `docs/Plan-implementacion-SaaS-Ventas-IA.docx`
- `docs/Plan-implementacion-Mercado-Pago-SaaS.md`
- `docs/Plan-despliegue-via-leanagentbuilder.md`

## 8. Registro de ejecución

### 2026-10-14 — P0-A, control de acceso y configuración

Implementado y validado localmente:

- El owner del tenant solo puede editar horarios y rangos operativos de Google Sheets.
- El owner ya no puede modificar `agentPolicy`, WhatsApp, credenciales, referencias de secretos ni parámetros SaaS mediante la configuración genérica.
- La activación dejó de estar disponible para el owner y pasó a rutas protegidas de platform admin.
- El administrador dispone de acciones explícitas para validar y activar una tienda desde Centro de control.
- La configuración administrativa tiene una lista blanca de secciones y campos auditables.
- La vista Configuración del cliente muestra referencias protegidas como solo lectura y remite la gestión a Onboarding o Centro de control.

Evidencia:

- `npm run build` aprobado.
- `node server/tests/auth-smoke.mjs` aprobado.
- `npm run test:backend` aprobado después de mover la activación a `/api/admin/tenants/:tenantId/activate`.

Pendiente para cerrar P0-A completamente:

- Probar con dos tenants autenticados y verificar que un token, conexión o webhook de un tenant no pueda operar sobre otro.
- Completar la matriz de permisos visuales para la creación de tenant nuevo y la reapertura de onboarding.

### 2026-10-14 — P0-B, control de conexión WhatsApp

Implementado como base segura, pendiente de credenciales y prueba real de Meta:

- Se agregó la confirmación `/api/saas/tenants/:tenantId/whatsapp/embedded-signup/complete`.
- El backend intercambia el código de Embedded Signup, valida el número contra la cuenta WhatsApp Business y solo después guarda el token en `SecretVault` por tenant.
- La ruta de binding ya no puede marcar un número como conectado sin validación del proveedor.
- El envío live ya no usa `WHATSAPP_ACCESS_TOKEN` global como respaldo; exige la referencia de secreto del tenant.
- Se documentaron `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` y la URI de retorno como configuración de plataforma.

Pendiente:

- Configurar App Review, permisos avanzados, HTTPS y callback público de Meta.
- Ejecutar prueba real de alta, OTP, webhook y mensaje de salida.

La prueba local conserva un fixture interno marcado como `verifiedByProvider` para validar el resto del flujo sin fingir una respuesta de Meta. No se considera evidencia de alta real.

### 2026-10-14 — Registro técnico de Meta

Completado en la cuenta de Meta autenticada de `lmcorredor@gmail.com`:

- Se creó la app global `Ventas IA Ops Store`.
- App ID: `1094480476808501`.
- Caso de uso: conexión con clientes a través de WhatsApp.
- Portfolio asociado: `Centro de Innovación Visual`.
- La app permanece en modo desarrollo; no se publicó ni se inició App Review.
- Se creó la configuración de Business Login `Ventas IA WhatsApp Onboarding` con permisos `whatsapp_business_management` y `whatsapp_business_messaging`.
- Configuration ID: `2134538237437313`.
- El App Secret se guardó únicamente en `.env.google.local` como `META_APP_SECRET`; no se registra en documentación ni salida de consola.

Impacto en la implementación:

- El backend local ya puede devolver el `appId` y `configId` para iniciar Embedded Signup desde Onboarding.
- El secreto global identifica la app y permite el intercambio seguro del código; los tokens de WABA y número siguen almacenándose por tenant en `SecretVault`.
- La creación de la app y la configuración de permisos no tiene evidencia de cobro por sí misma. El uso de WhatsApp Business y los mensajes sujetos a las condiciones de Meta sí pueden generar cargos y requieren definir el esquema de facturación antes de producción.

Pendiente externo:

- Publicar el backend con HTTPS y configurar `https://<backend-publico>/webhooks/whatsapp` en Meta.
- Definir y guardar un token de verificación de webhook en el entorno público.
- Completar el alta de proveedor de tecnología/App Review para clientes externos.
- Probar un tenant real mediante Embedded Signup, OTP, webhook y mensaje saliente.

### 2026-10-14 — P1-A, entrada de cliente nuevo

Implementado localmente:

- Después del login de Google, una cuenta sin membresía ya no cae en una tienda de ejemplo ni queda frente a una pantalla vacía.
- La interfaz solicita únicamente el nombre de la tienda y, opcionalmente, el número de WhatsApp.
- La creación usa la ruta autenticada `POST /api/saas/tenants`, asocia automáticamente al usuario como owner y continúa hacia Onboarding.
- La configuración de Drive/Sheets y WhatsApp permanece dentro del flujo guiado de Onboarding.

### 2026-10-14 — P0-C, Google autoservicio e idempotencia

Implementado y validado localmente:

- Repetir el aprovisionamiento de Google reutiliza el workspace ya provisionado y no crea recursos duplicados.
- La respuesta marca `reused: true` para que la UI pueda comunicar que se retomó una configuración existente.
- Se agregó evidencia al smoke test con dos llamadas consecutivas y el mismo `spreadsheet.id`.

La prueba contractual de WhatsApp cubre el intercambio de código, la validación de pertenencia del número al WABA y la lectura posterior del secreto en `SecretVault`, usando Graph API simulado y sin publicar la aplicación.

### 2026-10-14 — P1-B/P1-C, administración y estados visibles

Implementado localmente:

- Centro de control expone las acciones administrativas de validar y activar tenant.
- La vista del tenant comunica que el cliente configura conexiones y que la plataforma habilita la operación.
- La UI de configuración del cliente dejó referencias de Google, WhatsApp y política del agente en solo lectura, con navegación hacia Onboarding o Centro de control.
- La vista de onboarding distingue conexión pendiente, guía manual, alta guiada y conexión confirmada.

Pendiente:

- Completar el flujo visual de reintento/revocación de cada proveedor.
- Probar con sesión real de owner sin tenant y con sesión de platform admin en navegador, además de los smoke tests de backend.

## 9. Estado de salida

Estado actual: **listo para pruebas locales de producto; no listo para declarar producción**.

Cerrado localmente: permisos básicos, entrada de tenant nuevo, Google idempotente, inicio de Embedded Signup, validación de pertenencia WABA/número, almacenamiento de secreto por tenant, activación admin-only, UI de configuración protegida y pruebas contractuales.

Bloqueado por dependencias externas: credenciales y App Review de Meta, HTTPS/callback público, webhook público de WhatsApp, prueba real de OTP y mensaje, dos tenants reales en aislamiento, OAuth Google público y validación final de Mercado Pago en entorno publicado.
