# Auditoría de preparación de VIA y fallo de la prueba — 3 de noviembre de 2026

> **Actualización posterior:** Google está en Producción, Test Local reconectó su hoja, los ocho trabajos de Sheets se procesaron y backend/frontend se publicaron. Meta rechazó el token por cierre de sesión (190/467); siguen pendientes su reemplazo válido, la propiedad/marca Google y confirmar tres campos de coexistencia. El estado vigente y los hashes están en [Recuperación del piloto](Recuperacion-piloto-y-autoservicio-2026-11-03.md). El contenido siguiente conserva el diagnóstico de las 12:28.

Fecha de corte: 2026-11-03, 12:28, America/Bogota. Inspección de producción, paneles oficiales y código; no se modificó la configuración ni se desplegó. No se enviaron mensajes, renovaron credenciales, movieron números ni purgaron datos.

## Resultado ejecutivo

**Esperar la revisión de `public_profile` no resuelve todos los bloqueos.** Se confirmó un fallo de Google durante el procesamiento de un mensaje entrante, Google OAuth continúa publicado como Prueba, faltan suscripciones de coexistencia y la configuración de Render no activa las colas preparadas en el código.

El número de prueba de Meta continúa disponible en la cuenta y el piloto sigue habilitado para `test-local`. No se encontró evidencia de que Meta haya suspendido las pruebas por la nueva revisión. Sin embargo, no se verificó mediante Graph la validez actual del token de salida: recibir un webhook no demuestra que ese token permita responder.

La aprobación de los dos permisos WhatsApp se conserva. La solicitud adicional **1113554554901093** está **en revisión**, con `public_profile` como nueva solicitud. El panel dice que la mayoría se revisan en 20 días; no es una fecha garantizada ni una espera mínima obligatoria. Los documentos anteriores describían el borrador y quedaron actualizados con esta cronología.

## 1. Incidente observado

En los logs de `ventas-ia-backend-free`, instancia `6c785`, aparece el 3 de noviembre a las **12:13:43 p. m.**:

```text
Google API 400: invalid_grant
Token has been expired or revoked.
GoogleWorkspaceService.refreshAccessToken
ToolRegistry.liveGoogleContext
ToolRegistry.googleSheetsCustomerProfileLookup
AgentRuntime.routeConversation
AgentRuntime.processInbound
server/routes/whatsapp.js:114
statusCode: 502
toolName: google_sheets_customer_profile_lookup
```

La traza confirma que un mensaje entrante pasó al backend y falló al renovar el acceso de Google, antes de planificar con el LLM y enviar la respuesta. Es compatible con la prueba reportada. **No se obtuvo el ID exacto de esa conversación ni su correlación final con el mensaje del usuario**: la sesión administrativa de VIA quedó pendiente de selección manual de cuenta Google. No convertir esa limitación en una afirmación de que el tenant se borró.

En la versión desplegada, `routeConversation()` consulta primero el perfil en Sheets. `liveGoogleContext()` propaga el error de renovación. El manejador registra la conversación como degradada y vuelve a lanzar el error; no envía una respuesta de contingencia en esa rama. Por eso un fallo en Google puede verse como silencio en WhatsApp.

Además, la rama síncrona reclama la deduplicación antes del procesamiento. Si después falla Google, el código no libera esa reclamación. Un reintento del mismo mensaje puede considerarse duplicado sin volver a completar la respuesta. Debe probarse y corregirse la recuperación, sin desactivar la deduplicación ni reproducir automáticamente pedidos antiguos.

## 2. Configuración realmente observada

| Componente | Evidencia | Implicación |
| --- | --- | --- |
| App Meta | `1094480476808501`, Ventas IA Ops Store; publicada | Se conserva la aplicación existente. |
| Negocio proveedor | `153671712161764`, Centro de Innovación Visual SAS | Es el proveedor de VIA, no sustituye al negocio propietario de cada tienda. |
| Tech Provider | 2/2 pasos completados; negocio y revisión WhatsApp aprobados | No falta volver a registrar el proveedor. Tech Partner/marketing son ampliaciones, no requisitos adicionales del piloto de pedidos. |
| Permisos WhatsApp | `whatsapp_business_messaging` y `whatsapp_business_management` aprobados | No volver a pedirlos por renovar un token. |
| Facebook externo | Nueva revisión de `public_profile` en curso | Falta resolver acceso avanzado para personas sin rol en la app y validar después el flujo externo. |
| Número de ensayo | `+1 555 202 4079`, Conectado, calidad Alta en Meta | El recurso de prueba no desapareció. Esto no acredita el envío E2E actual. |
| Piloto Render | `META_WHATSAPP_TEST_CHANNEL_ENABLED=true`, tenant `test-local` | La prueba corresponde a Test Local, no a Demo De Tienda. |
| Activos de ensayo | phone ID `1299193049952421`; WABA `1114395574566075` | Conservar la asociación y distinguirla de los activos reales que se creen después. |
| Endpoint | `https://ventas-ia-backend-free.onrender.com/webhooks/whatsapp` en Meta y Render | Coinciden; la traza demuestra recepción real. |
| Backend live | `6f4ddc6029918d9cfd679ec628d7cccf916c9918`, despliegue `dep-dbkv17jm8hqs738m08m0` | Las correcciones locales del 3 de noviembre no están publicadas. |
| Frontend live | `9869283c0672fb088621d79a311f7e44ae2f0618`, Vercel `dpl_DaK9hjasSQ9X3F6AMLrdcG1YRJxv` | Hash comprobado mediante el conector de Vercel. |
| Readiness | HTTP 200, `ok:true`, producción, almacenamiento PostgreSQL, WhatsApp live | Es comprobación de configuración; el código no hace una prueba completa de credenciales, colas y dependencias. No equivale a canal sano. |
| Render | Instancia Free; aviso de suspensión por inactividad y arranque de 50 s o más | Riesgo de latencia para pilotos; no es la causa probada del `invalid_grant`. |

`+57 321 945 0893` continúa siendo el teléfono usado como comprador en las pruebas hasta ejecutar explícitamente su incorporación como número de la tienda demo. No se realizó esa migración. El usuario Google `ventasiaopsstore@gmail.com` no determina por sí mismo la propiedad de una WABA.

## 3. Google: bloqueo adicional confirmado

Se abrió el proyecto **`ventas-ia-piloto-lmcorredor`**. Su cliente OAuth coincide con `GOOGLE_CLIENT_ID` en Render y con el cliente utilizado por VIA:

`132907858536-m5a67j0kg5rmnii7e549ufhfetimligi.apps.googleusercontent.com`

Hallazgos del panel:

- Audiencia: **Usuarios externos**.
- Publicación: **Prueba**.
- Usuarios de prueba: únicamente `lmcorredor@gmail.com` y `ventasiaopsstore@gmail.com`.
- Botón **Publicar app deshabilitado**; Google pide completar la información de marca.
- Página principal, política de privacidad y términos: campos vacíos.
- Dominios declarados: `leanagentbuilder.com` y `ventas-ia-backend-free.onrender.com`.
- Alcances no sensibles: `openid`, perfil, email y `drive.file`.
- Alcance sensible: **`https://www.googleapis.com/auth/spreadsheets`**.
- Centro de verificación: no exige verificación mientras siga en Prueba; **no significa que esté verificada para público general**.

Google documenta que una aplicación externa en Testing emite refresh tokens con vencimiento de siete días, salvo cuando solo solicita identidad básica. VIA también solicita Drive/Sheets, por lo que no aplica esa excepción. La configuración explica una causa de caducidad recurrente. La traza `expired or revoked` por sí sola no permite distinguir la fecha exacta de expiración de una revocación.

Acciones necesarias:

1. Completar marca y enlaces públicos reales (`https://via.leanagentbuilder.com/`, `/privacidad`, `/terminos`), verificando su contenido y accesibilidad antes de guardar. Confirmar dominio en Search Console si Google lo requiere.
2. Decidir el alcance mínimo. El código actual pide `spreadsheets`; mantenerlo exige resolver la verificación correspondiente para publicación externa. Alternativa a evaluar: operar únicamente con `drive.file` en archivos creados o autorizados expresamente para VIA. Google Sheets admite ese alcance. No quitar `spreadsheets` sin probar lectura, búsqueda, escritura, reconexión y archivos existentes.
3. Completar publicación/verificación según la ruta elegida. No prometer que solo cambiar el estado elimina todos los requisitos.
4. Reconectar Drive/Sheets del tenant afectado conservando sus carpetas, hojas y datos. Publicar la app no revive un refresh token ya inválido.
5. Validar renovación posterior al vencimiento del access token y seguimiento durante más de siete días. Iniciar sesión en VIA con Google no es lo mismo que renovar el consentimiento de Drive/Sheets.

Fuentes: [expiración OAuth de Google](https://developers.google.com/identity/protocols/oauth2#expiration), [alcances oficiales de Sheets](https://developers.google.com/workspace/sheets/api/scopes). Evidencia: [Google en Prueba](evidencias/auditoria-preparacion-20261103/google-en-prueba.png).

## 4. Webhooks y coexistencia

Campos observados en la app Meta, versión v26.0:

| Campo | Estado | Uso |
| --- | --- | --- |
| `messages` | Suscrito | Mensajes normales y estados de entrega. |
| `account_update` | Suscrito | Actualizaciones de cuenta. |
| `history` | **No suscrito** | Historial compartido en coexistencia. |
| `smb_app_state_sync` | **No suscrito** | Sincronización de datos de la app Business. |
| `smb_message_echoes` | **No suscrito** | Mensajes enviados por el tendero desde su app. |

Los últimos tres deben completarse al preparar coexistencia, coordinadamente con el despliegue del manejador correspondiente. Activarlos no sustituye la suscripción de cada WABA a la app mediante `/subscribed_apps`, que debe formar parte del alta del tenant.

El enlace de registro alojado que muestra Meta incluye explícitamente `version:v4`, `sessionInfoVersion:3` y `featureType:whatsapp_business_app_onboarding`. La interfaz desplegada de VIA todavía no contiene toda la corrección local de rutas. `sessionInfoVersion` no es la versión de Embedded Signup.

La revisión anterior también encontró OAuth de navegador integrado desactivado frente a la guía de implementación. Hay que contrastar y ajustar el navegador soportado sin debilitar HTTPS ni redirecciones estrictas. **No se probó que ese ajuste sea la causa única de “Función no disponible”.**

Evidencia legible: [campos del webhook](evidencias/auditoria-preparacion-20261103/webhook-campos.json). Contratos: [implementación Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/) y [coexistencia Business App](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/).

## 5. Colas, recuperación y experiencia

La lista completa de variables del servicio Render no contiene `WHATSAPP_ASYNC_INBOUND_ENABLED`, `ASYNC_INBOUND_ENABLED` ni `INTEGRATION_OUTBOX_ENABLED`, y no hay grupos de entorno enlazados. En el código desplegado esas opciones son falsas por defecto. La traza por `whatsapp.js:114` confirma que el incidente recorrió la rama síncrona.

Consecuencias del código/configuración inspeccionados:

- El webhook espera el procesamiento del agente cuando no está activada la entrada asíncrona.
- `IntegrationOutbox.start()` y `drain()` no trabajan con `enabled=false`.
- Los cambios de estado de pedidos pueden crear proyecciones `order.sheet_projection` aunque el consumidor esté desactivado. **No se obtuvo el conteo real de trabajos pendientes**; no afirmar que la cola esté vacía.
- La consulta de perfil/catálogo sigue dependiendo de Google vivo. Activar el ACK asíncrono no elimina ese error por sí solo.
- El fallo de una dependencia debe verse en la tienda y recibir una respuesta apropiada cuando el canal de salida esté sano; no debe convertirse en silencio ni en un pedido inventado.

Secuencia requerida: validar firma → persistir mensaje y trabajo de forma durable e idempotente en PostgreSQL → devolver 200 a Meta → procesar conversación/respuesta → proyectar a Sheets con recuperación. Nunca confirmar recepción antes de tener una copia durable. Definir estados separados para recibido, procesando, fallido recuperable, respuesta pendiente y completado.

Antes de activar consumidores, consultar pendientes por tenant, tipo, fecha y estado; separar mensajes antiguos de una prueba vigente y decidir su recuperación. No vaciar tablas ni drenar automáticamente respuestas antiguas. Mantener un único escritor hasta verificar la coordinación entre procesos.

## 6. Credenciales de Meta y facturación

Hay que separar tres credenciales: sesión de acceso a VIA, refresh token de Google y token de Meta. Renovar una no repara las otras.

El piloto tiene configurado `META_WHATSAPP_TEST_ACCESS_TOKEN`; su presencia no acredita validez. La configuración de Embedded Signup real usa token de sistema con duración configurada de 60 días, distinto del token temporal generado para ensayos. **No se inspeccionó el valor ni se comprobó su fecha real con Graph en esta auditoría.** La recepción de mensajes no requiere que el token de salida esté vigente.

La validación previa a la siguiente prueba debe consultar, de forma segura y sin enviar mensajes, validez, expiración, app emisora, permisos y acceso al teléfono/WABA del token realmente utilizado por el tenant. El código actual guarda el token de piloto en el almacén del tenant durante conectar/renovar; por ello actualizar una variable de Render no basta para asumir que ese almacén ya usa el valor nuevo. Verificar la ruta documentada de renovación.

Para clientes reales: credenciales obtenidas por Embedded Signup, cifradas por tenant, alertas anticipadas y reconexión guiada ante caducidad/revocación. No prometer un token irrevocable ni operar comercialmente pegando tokens temporales cada día.

El modelo objetivo conserva negocio, número, WABA y método de pago del cliente. La configuración local informa `billing.payer=tenant`, pero aún no verifica la preparación de facturación. Antes de mensajes facturables debe comprobarse el medio de pago de esa cuenta. No se configuró facturación consolidada ni línea de crédito del proveedor. [Alta de clientes como Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/).

## 7. Código local frente a producción

Se conservaron y contrastaron los worktrees descritos en [Ejecución de autoservicio](Ejecucion-Meta-autoservicio-2026-11-03.md). Ya incluyen correcciones locales de callback, separación de número nuevo/coexistencia/Cloud API, validación de activos, reserva única de teléfono en PostgreSQL, reanudación de fases, tratamiento de historial/eco y vigencia de token. **No están desplegadas.** Las pruebas registradas allí son locales; no demuestran un alta real externa.

Antes de publicar:

1. Resolver los hallazgos de Google y recuperación del error, sin perder las mejoras previas del intérprete/resolutor.
2. Verificar duplicados de teléfono antes de migración `014_whatsapp_phone_ownership.sql`. La migración detiene el arranque si encuentra conflictos. La consulta productiva quedó sin resultado verificado por bloqueo del control del navegador; no se aplicó la migración.
3. Revisar el nuevo gate `META_FACEBOOK_LOGIN_ADVANCED_ACCESS_APPROVED`. Por defecto bloquea Embedded Signup hasta aprobación; distinguirlo de las pruebas con un canal existente y, si procede, de un piloto interno autorizado. No convertir esa excepción en apertura a clientes externos.
4. Preparar la publicación del backend, variables/consumidores y frontend en orden, con evidencias de commit y salud. La autorización de despliegue quedó pausada por el usuario; no se retomó en esta auditoría.
5. Configurar los eventos de coexistencia cuando el backend que los interpreta esté listo.

## 8. Plan de cierre y criterios de aceptación

| Prioridad | Actividad | Evidencia para cerrar | Depende de `public_profile` |
| --- | --- | --- | --- |
| P0 | Correlacionar el incidente y reconectar Google del tenant correcto | Traza/tenant/mensaje exactos; consulta real a su hoja correcta sin `invalid_grant` | No |
| P0 | Publicar Google y resolver alcance sensible | Audiencia externa apta, marca completa, verificación aplicable resuelta y cuenta externa autorizando Drive/Sheets | No |
| P0 | Comprobar/renovar acceso Meta del piloto | Token válido del teléfono de ensayo, permisos correctos y almacén tenant actualizado | No |
| P0 | Corregir recuperación y activar colas coordinadamente | ACK tras persistencia; caída de Google no pierde mensajes; reinicio/reintento no duplica pedidos ni respuestas | No |
| P1 | Revisar y desplegar correcciones locales de alta/coexistencia | Hashes backend/frontend, migración segura, pruebas contractuales y regresión aprobadas | No para preparar; sí para validar acceso externo |
| P1 | Completar tres suscripciones de coexistencia y OAuth aplicable | Campos suscritos; eventos recibidos y clasificados por tenant | No para preparar |
| P1 | Seguimiento solicitud enviada | Meta aprueba `public_profile`; permisos anteriores siguen activos | Sí |
| P1 | Alta de una persona sin rol en la app | Desde VIA el cliente elige su propio negocio y número; vuelve correctamente y recibe/envía | Sí |
| P1 | Matriz con dos tenants independientes | Sin mezcla de números, credenciales, pedidos, catálogo ni facturación | Sí para altas externas reales |
| P1 | Revisión de declaración y acceso del revisor | Instrucciones reproducibles, suscripción/demo accesible y proveedores/países declarados según uso real | Revisión documental ahora |
| P2 | Estabilidad operativa | Tiempo de ACK y respuesta medido; alertas por cola/credencial; instancia adecuada para piloto sin arranque frío | No |

No cancelar ni duplicar la solicitud enviada solo por reparar credenciales o preparar la demo. La lista final de encargados/países del formulario enviado no se reabrió completamente; queda como comprobación documental, no como una nueva falta confirmada. No inventar países ni declaraciones.

### Matriz de prueba final

1. Piloto con `+1 555 202 4079`: comprador autorizado escribe; VIA busca catálogo real, pide datos y forma de pago, confirma con botones, tendero alista y marca en camino; se notifica una vez y se cierra. Mensaje posterior puede iniciar otro pedido.
2. Google falla o se revoca: persistencia del mensaje, alerta clara, respuesta segura si Meta está sano y recuperación controlada; cero pedidos duplicados.
3. Meta falla/caduca: distinguir error de envío de error Google; estado de entrega visible, renovación sin cambiar tenant/teléfono, reintento idempotente.
4. Reinicio después del ACK y antes de responder: el trabajo durable se recupera.
5. Número nuevo real: titular externo, negocio propio, verificación/PIN cuando corresponda, WABA suscrita, retorno a VIA y primer mensaje.
6. WhatsApp Business App: flujo de coexistencia elegible, sin exigir borrado del número; consentimiento/sync; mensaje móvil del tendero no provoca bucle; historial no crea pedidos nuevos.
7. Cloud API existente: activo autorizado y verificado, sin registrar a ciegas ni reasignar un teléfono de otra tienda.
8. Cancelación, denegación, ventana cerrada, código consumido y retorno tardío: explicación útil y reanudación segura.
9. Tenant A y B simultáneos: rechazo de vinculación duplicada y acceso cruzado; cada cliente conserva su método de pago.
10. Operación continua más de siete días y renovación: no depender de tokens temporales de la consola; medir caducidad real y alertas.

**Cierre:** no considerar el autoservicio listo por una aprobación aislada, un HTTP 200, un número “Conectado” o un popup abierto. Se requiere evidencia del recorrido completo y de sus fallos recuperables.

## 9. Accesos y límites de esta auditoría

- Render: logs y configuración leídos por navegador; conector requiere reconexión.
- Google Cloud: audiencia, marca, alcances, centro de verificación y cliente OAuth inspeccionados directamente.
- Meta: revisión, proveedor, cuenta de prueba y campos de webhook inspeccionados directamente.
- Vercel: despliegue consultado por conector, comparado con remoto.
- Supabase: proyecto correcto `mmcxphpstxjugxjrdffb`, organización Pro. Se intentó una consulta SQL de solo lectura sobre colas/bindings; el navegador dejó de responder y no se obtuvo resultado. No se afirma que no haya duplicados ni trabajos pendientes.
- VIA administrativa: la selección automática de Google se bloqueó; se solicitó al usuario elegir su cuenta. No se correlacionó aún el evento exacto ni se probó el token real del tenant.
- No se ejecutaron nuevamente los 40 E2E ni se modificó backend/frontend en esta auditoría; se revisaron el código desplegado y el trabajo local ya existente.

## 10. Ruta rápida para la próxima revisión

1. Revisar [solicitudes Meta](https://developers.facebook.com/apps/1094480476808501/app-review/submissions/?business_id=153671712161764) y anotar permiso NUEVO frente a acceso existente.
2. En [Render Logs](https://dashboard.render.com/web/srv-db7sqqmq1p3s73elv1eg/logs), tomar hora, herramienta y proveedor que falla; no atribuir todo a Meta.
3. Correlacionar con Test Local en VIA antes de usar Demo De Tienda.
4. Comprobar [audiencia Google](https://console.cloud.google.com/auth/audience?project=ventas-ia-piloto-lmcorredor), [marca](https://console.cloud.google.com/auth/branding?project=ventas-ia-piloto-lmcorredor) y [alcances](https://console.cloud.google.com/auth/scopes?project=ventas-ia-piloto-lmcorredor).
5. Verificar flags/consumidores y pendientes; validar token del tenant con lectura de Graph sin imprimirlo.
6. Solo entonces ejecutar una prueba nueva autorizada y registrar ID de mensaje, tenant, pedido y estado final de entrega.
