# Ejecución del cierre de brechas de Meta — 3 de noviembre de 2026

> **Estado posterior al desarrollo local:** las correcciones se publicaron el 3 de noviembre. Consultar [Recuperación del piloto](Recuperacion-piloto-y-autoservicio-2026-11-03.md) para commits, despliegues, Google en Producción, colas procesadas y bloqueos reales restantes. Las secciones de borrador y pendientes de este documento son antecedentes del trabajo.

## Resultado y alcance

Se implementaron y probaron localmente las correcciones de Embedded Signup, coexistencia y aislamiento por tenant. Se preparó una solicitud adicional de Meta para `public_profile` y se corrigieron las instrucciones de revisión. **Actualización 3 de noviembre, 12:28: la solicitud 1113554554901093 ya fue enviada y aparece en revisión. Este código aún no se ha desplegado.** La apertura autónoma a clientes externos también requiere resolver Google OAuth, colas y coexistencia; consultar la [auditoría posterior de preparación](Auditoria-preparacion-Meta-y-prueba-2026-11-03.md). Los apartados sobre el borrador documentan el estado anterior al envío.

No se creó otra app ni se invalidó la aprobación de los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. No se migraron números, no se purgaron datos y no se enviaron mensajes reales en estas pruebas.

## Versiones y ubicación del trabajo

Se partió de las ramas de los repositorios separados, sin reconstruir la solución desde la antigua rama local de MicroApp.

| Componente | Base | Rama de trabajo | Directorio |
| --- | --- | --- | --- |
| Backend | `backend/main`, `6f4ddc6029918d9cfd679ec628d7cccf916c9918` | `codex/meta-autoservicio-backend-20261103` | `C:/Users/Messi/.codex/worktrees/via-meta-autoservicio-20261103/backend` |
| Frontend | `frontend/main`, `9869283c0672fb088621d79a311f7e44ae2f0618` | `codex/meta-autoservicio-frontend-20261103` | `C:/Users/Messi/.codex/worktrees/via-meta-autoservicio-20261103/frontend` |

El hash base del backend coincide con el despliegue live observado en Render (`dep-dbkv17jm8hqs738m08m0`). La auditoría posterior confirmó mediante Vercel que el frontend live también coincide con la base indicada. Los cambios funcionales están en estos worktrees, pendientes de commit, push y despliegue. El directorio principal MicroApp contiene el diagnóstico, este informe y las evidencias.

## Correcciones implementadas

| Área | Comportamiento nuevo | Archivos principales dentro de cada worktree |
| --- | --- | --- |
| Callback de Meta | Lee `event` en el nivel superior; maneja cancelación/error, autorización denegada y finalización con WABA sin teléfono. Espera código y activos en cualquiera de los dos órdenes. Valida origen HTTPS Meta/Facebook. | Frontend: `src/features/whatsapp/embeddedSignup.js` |
| Tres rutas de alta | Número nuevo pide PIN y ejecuta `/register`; coexistencia usa Embedded Signup v4 explícito y `whatsapp_business_app_onboarding`, sin PIN nuevo ni `/register`; Cloud API existente requiere plataforma verificada. | Frontend: `src/App.jsx`; backend: `server/services/whatsappSignup.js` |
| Correlación | Intento aleatorio de 10 minutos ligado a propietario, tenant, propósito y ruta; se guarda su hash. Cambiar de tenant en el navegador impide completar la asociación anterior. | `whatsappSignup.js`, `saasControlPlane.js`, `routes/saas.js`, `App.jsx` |
| Validación de activos | Verifica negocio autorizado con Graph, pertenencia del teléfono a la WABA y correspondencia con la ruta. Si hay varios teléfonos, exige selección explícita. Renovar no permite cambiar de número/WABA. | `whatsappSignup.js` |
| Persistencia y reintentos | Guarda el token cifrado y las fases del intento; reanuda sin reutilizar el código de un solo uso. La asociación espera persistencia antes de responder. | `whatsappSignup.js`, `saasControlPlane.js`, `postgresStore.js` |
| Exclusividad del número | Reserva durable y restricciones únicas en PostgreSQL. Duplicados previos detienen la migración; no se elimina ni se elige arbitrariamente una tienda. | `014_whatsapp_phone_ownership.sql`, `postgresStore.js`, `jsonStore.js` |
| Webhook | Recorre todas las entradas, cambios, mensajes y estados; conserva validación HMAC, encolado y deduplicación. Rechaza propiedad ambigua en vez de usar la primera coincidencia. | `server/routes/whatsapp.js` |
| Historial y contactos | Sincronización inicial de coexistencia; importa historial como conversaciones cerradas sin LLM ni pedidos nuevos. Maneja progreso, consentimiento, duplicados y multimedia que llega antes/después del mensaje histórico. | `whatsappSignup.js`, `whatsappCoexistence.js` |
| Tendero en el celular | Los `smb_message_echoes` son mensajes humanos y activan atención manual; no se envían como una nueva solicitud al agente. | `whatsappCoexistence.js`, `agentRuntime.js` |
| Revocación | `PARTNER_REMOVED` / `ACCOUNT_OFFBOARDED` marcan acceso retirado y bloquean salida; una notificación de reconexión no valida por sí sola el token. | `whatsappCoexistence.js`, `toolRegistry.js` |
| Vigencia y pagos | No inventa 60 días si Meta omite vencimiento; muestra vigencia desconocida/no fijada según respuesta. Pago Meta directo al tenant, con estado no verificado y enlace a WhatsApp Manager. | `saasControlPlane.js`, `App.jsx` |
| Acceso externo | Nueva condición `META_FACEBOOK_LOGIN_ADVANCED_ACCESS_APPROVED=true`, además de los requisitos existentes. Por defecto false hasta comprobar acceso avanzado. | `.env.example`, `saasControlPlane.js`, `App.jsx` |

La sincronización inicial solo admite la ventana y frecuencia de Meta. Si una llamada falla con respuesta de error confirmada, puede reintentarse la fase pendiente. Si se pierde la respuesta y no se sabe si Meta aceptó la operación, se conserva ese estado y se evita repetir automáticamente una solicitud de un solo uso. No se presenta esa incertidumbre como una desconexión del canal.

## Verificación ejecutada

Runtime de verificación: **Node 24.22.1**, conforme al backend. El Node del sistema era 25.7.0; se utilizó el binario de Node 24 instalado mediante el registro npm oficial, sin cambiar el pin de producción.

| Comprobación | Resultado | Alcance real |
| --- | --- | --- |
| Backend `npm run test:backend` | PASS | Smoke, concurrencia y errores del agente, escenarios Colombia, proveedor LLM, auth, contratos Google/WhatsApp y Embedded Signup. Proveedores simulados donde lo definen esos contratos. |
| Backend `npm run test:whatsapp-onboarding` | PASS | Tres suites: contrato existente, nuevo autoservicio, lotes/coexistencia. Reejecutadas tras los últimos cambios. |
| Backend `npm run test:whatsapp-postgres` | PASS | PostgreSQL local real: concurrencia de reserva, unicidad, persistencia y recarga de secretos cifrados/intento/binding; rechazo de duplicados heredados. |
| `node server/tests/postgres-write-lanes.mjs` | PASS | Regresión de las colas de persistencia. |
| `node server/tests/integration-outbox.mjs` | PASS | Regresión de la cola de integración. |
| Frontend `npm run test:meta` | PASS, 4 casos | Cancelación, orden de callbacks/WABA sola, orígenes no admitidos y denegación; limpieza de listeners/timer. |
| Frontend `npm run build` | PASS | Compilación Vite final, 1.681 módulos. |
| `git diff --check` en ambos worktrees | PASS | Sin errores de whitespace; avisos normales de conversión LF/CRLF. |
| UI local en navegador | PASS | Coexistencia no pide PIN; número nuevo sí lo exige y no habilita continuar con PIN vacío. Sin iniciar autorización real. |

Casos negativos adicionales cubiertos: actor/tenant incorrecto, intento reemplazado, selección entre varios teléfonos sin exponer el token, reutilización de código evitada, teléfono de otro tenant, cambio de activos al renovar, activo que no es Cloud API, fallos recuperables de suscripción/sync, resultado de sync desconocido, firma inválida y mensajes históricos sin ejecución del LLM.

La prueba PostgreSQL utilizó la base local `ventas_ia_dev` y un esquema temporal `via_meta_test_*`; aplicó allí las migraciones, lo eliminó al terminar y comprobó que el hash de `public.app_state` no cambió. No aplicó migraciones ni alteró tablas existentes de desarrollo/producción.

Esto **no** representa una nueva ejecución E2E de los 40 casos con DeepSeek real ni un alta real aprobada por Meta. Es verificación del contrato e integración local y de la persistencia real.

## Solicitud de Meta preparada — registro histórico previo al envío

- App: `1094480476808501` — Ventas IA Ops Store.
- Negocio proveedor: `153671712161764` — Centro de Innovación Visual SAS.
- Configuración Embedded Signup conservada: `1021932474245234`.
- [Nuevo borrador `1113554554901093`](https://developers.facebook.com/apps/1094480476808501/app-review/submissions/?submission_id=1113554554901093&business_id=153671712161764).
- Se agregó `public_profile` a revisión. El borrador también muestra renovación del uso de los dos permisos WhatsApp anteriores; no significa que hayan perdido su aprobación.
- Se corrigió «Is Facebook Login integrated on this platform?» a **Sí** y se guardaron instrucciones que distinguen Google Sign-In de Facebook Login para empresas.
- Las instrucciones describen el error actual con honestidad y no presentan el video anterior como prueba de alta autónoma externa.
- El usuario confirmó que siguen correctas las tres respuestas heredadas: responsable Centro de Innovación Visual SAS en Colombia; no entregó datos por solicitudes de seguridad nacional en los últimos 12 meses; no tiene ninguno de los procedimientos enumerados por ese formulario.
- Estado visible: verificación, configuración e instrucciones completas; **Uso permitido** y **Tratamiento de datos** pendientes; **Enviar para revisión deshabilitado**. No se envió la solicitud.

### Comprobaciones registradas antes de presentar

La solicitud ya se envió posteriormente. Esta lista se conserva como antecedente; no representa el estado actual del botón de envío ni demuestra que el formulario final omita esos datos. Revisar lo efectivamente declarado sin cancelar ni duplicar la solicitud.

1. Revisar la lista de encargados de tratamiento: hoy contiene DeepSeek, Render y Supabase. Google Drive/Sheets guarda información de pedidos y Vercel opera el proxy `/api` y `/webhooks` según `vercel.json`; deben evaluarse e incluirse según el uso real. No basta con declarar únicamente al LLM y la base de datos.
2. Completar nombres, categorías y **países de tratamiento y acceso remoto**, como exige el formulario. No usar el país de la sede como sustituto de los lugares de procesamiento. No se inventaron países para cerrar el formulario.
3. La política pública de Google indica tratamiento internacional; la lista de subencargados Workspace tiene un alcance contractual específico. Las cuentas Gmail de las pruebas no acreditan un contrato Workspace ni una región de datos elegida. Vercel publica una lista de subencargados en su Trust Center. Contrastar las condiciones aplicables y la configuración de las cuentas antes de declarar una lista exhaustiva.
4. Una vez completo el formulario, el titular debe confirmar las declaraciones de uso permitido solicitadas por Meta; no fueron marcadas en esta ejecución. La instrucción de Computer Use exige confirmación al aceptar condiciones vinculantes.
5. Validar que un revisor pueda acceder a la funcionalidad necesaria con las instrucciones guardadas, incluyendo restricciones por prueba/suscripción. No se inventaron credenciales ni se abrió acceso público al tenant demo.

Fuentes consultadas para estas comprobaciones: [política de Google](https://policies.google.com/privacy?hl=es), [alcance y lista de Workspace](https://workspace.google.com/terms/subprocessors/), [Trust Center de Vercel](https://vercel.com/legal/sub-processors). Son fuentes de verificación, no prueba de la ubicación concreta de cada dato de VIA.

## Pendientes para liberar y probar de verdad

1. Finalizar/presentar el borrador y obtener el acceso avanzado pendiente. La FAQ de [Facebook Login para empresas](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business) exige acceso avanzado a `public_profile` para personas sin rol en la app. La pantalla genérica de error no prueba por sí sola que sea la única causa.
2. Resolver el ajuste OAuth de navegador integrado que se observó desactivado frente a la guía oficial. No se cambió durante esta ejecución. Mantener HTTPS, redirecciones estrictas y dominios autorizados. Requiere confirmación específica antes de ampliar ese acceso en Meta.
3. Verificar en la app las suscripciones a `messages`, `account_update`, `history`, `smb_app_state_sync` y `smb_message_echoes`, antes de habilitar coexistencia. Suscribir una WABA con `/subscribed_apps` no reemplaza la configuración de campos de webhook de la app. Esta verificación real sigue pendiente.
4. Antes de desplegar la migración 014, hacer consulta de solo lectura sobre duplicados de `whatsapp_bindings.phone_number_id`. La migración detiene el arranque si hay conflictos; resolverlos con evidencia de titularidad, sin purgar por defecto.
5. Revisar y publicar las ramas indicadas. Desplegar backend antes que frontend; verificar migración y salud. Configurar el nuevo indicador de acceso externo solo después de comprobar aprobación real. No cambiar tokens, app/config ni números de prueba por ensayo.
6. Ejecutar matriz real con dos tiendas externas independientes: número nuevo, Cloud API existente y coexistencia; cancelación y recuperación; mensaje entrante y respuesta; intervención móvil del tendero; renovación y revocación; método de pago propio del tenant. Registrar evidencia sin PIN, token ni código OAuth.
7. Antes de habilitar varios procesos escritores, sustituir el bloqueo de intentos en memoria por coordinación persistente y validar consistencia del runtime compartido. La exclusividad de teléfono sí es atómica en PostgreSQL, pero no convierte todo el estado actual de la aplicación en un sistema distribuido.
8. Probar volumen/retención del historial importado y multimedia pendiente. El desarrollo cubre contratos e idempotencia, no capacidad ilimitada ni todos los formatos multimedia de WhatsApp.

### Aceptación del piloto externo

No declarar el autoservicio listo por haber abierto el popup. Deben comprobarse autorización de persona sin rol, selección del negocio cliente, retorno a VIA, persistencia de activos, eventos de webhook, envío/recepción sin mezcla entre tenants y visibilidad de pago/canal/sync. La propiedad de negocio, WABA, número y pago corresponde al cliente; VIA opera la aplicación y el webhook compartidos.

## Evidencias

- [Coexistencia local sin PIN](evidencias/meta-autoservicio-20261103/coexistencia-local.jpg).
- [Número nuevo local con PIN obligatorio](evidencias/meta-autoservicio-20261103/numero-nuevo-local.jpg).
- [Estado real del borrador de Meta](evidencias/meta-autoservicio-20261103/solicitud-meta-borrador.jpg).

Consulta también el [diagnóstico de base](Diagnostico-Meta-Embedded-Signup-2026-11-03.md) para el contraste con los contratos oficiales y el error reproducido.
