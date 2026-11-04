# Diagnóstico de conexión de tiendas con Meta — 3 de noviembre de 2026

> Actualización 3 de noviembre, 12:28: se implementaron correcciones y pruebas locales en worktrees basados en las versiones remotas. La solicitud adicional `1113554554901093` de `public_profile` **ya está enviada y en revisión**; el código aún no está desplegado. Este documento conserva el diagnóstico inicial, cuando el permiso todavía se podía agregar al borrador. Para el estado vigente y los bloqueos adicionales confirmados de Google, colas y webhooks, consultar la [auditoría de preparación](Auditoria-preparacion-Meta-y-prueba-2026-11-03.md) y la [ejecución local](Ejecucion-Meta-autoservicio-2026-11-03.md).

## Conclusión actualizada de la auditoría

**La aprobación de los dos permisos de WhatsApp sigue vigente, pero no basta para afirmar que el alta de clientes externos está habilitada.** Se comprobó un requisito adicional pendiente: `public_profile` aparece como **«Listo para la prueba»**, con 52 llamadas, y su menú permite **«Agregar a la revisión de la app»**. La documentación oficial de Facebook Login para empresas exige acceso avanzado a ese permiso para autorizar usuarios sin rol en la app.

Este es el bloqueo principal identificado y una explicación consistente del error «Función no disponible». La pantalla genérica no entrega una causa técnica única: **la resolución solo se podrá confirmar después de obtener ese acceso y repetir el flujo con un cliente externo**. No atribuirlo únicamente al navegador, al perfil de Facebook o a una espera de propagación.

La revisión anterior fue incompleta al considerar suficientes los dos permisos de WhatsApp. No se perdió la aprobación ni corresponde volver a registrar toda la aplicación.

En esta ampliación se inspeccionaron páginas y código, y se reprodujo el inicio de autorización. No se modificaron permisos/configuraciones, no se presentó una nueva solicitud, no se vinculó un número y no se desplegó código. Este documento es el único cambio local del análisis.

## Estado confirmado

- App: **Ventas IA Ops Store**, identificador `1094480476808501`; negocio de plataforma `153671712161764`.
- Meta muestra aprobados `whatsapp_business_messaging` y `whatsapp_business_management` en la solicitud anterior. La tarjeta vacía «No enviada» corresponde a una nueva solicitud; no invalida la aprobación anterior.
- La app figura publicada, sin acciones requeridas, y el caso de uso muestra completado el alta como proveedor de tecnología.
- En Render, servicio `ventas-ia-backend-free` (`srv-db7sqqmq1p3s73elv1eg`), se habilitó `META_WHATSAPP_ADVANCED_ACCESS_APPROVED=true`. El despliegue `dep-dbkv17jm8hqs738m08m0` quedó live con commit `6f4ddc6029918d9cfd679ec628d7cccf916c9918`; la comprobación de readiness respondió correctamente.
- VIA ya muestra «Conectar con Meta». La habilitación global no significa que la tienda ya tenga un número conectado.

## Configuración revisada en Meta

En Facebook Login para empresas → Configurar se observaron activos OAuth del cliente, OAuth web, HTTPS, modo estricto y JavaScript SDK. El dominio/URI permitido es `https://via.leanagentbuilder.com/`. OAuth de navegador integrado aparecía desactivado; la guía vigente de implementación incluye activarlo. No se cambió este ajuste durante la inspección.

Hay dos configuraciones distintas:

| ID | Nombre | Variación | Uso observado |
| --- | --- | --- | --- |
| `1021932474245234` | Ventas IA WhatsApp | Registro insertado de WhatsApp | Es la que envía VIA y la que usa el enlace alojado de Meta. |
| `2134538237437313` | Ventas IA WhatsApp Onboarding | General | No sustituir la anterior solo por su nombre. |

La configuración de registro insertado solicita los dos permisos WhatsApp aprobados, activos de cuentas de WhatsApp y token de usuario del sistema con duración de 60 días. Incluye Cloud API y Marketing Messages API; no se aceptaron nuevas condiciones ni se habilitaron activos durante el diagnóstico.

## Primeras comprobaciones y límites de esa evidencia

1. El usuario reportó «Función no disponible» en el popup OAuth de Facebook, antes de elegir negocio o número.
2. En el Chrome accesible estaba activo el perfil de página **CeinVisual**. Se cambió al perfil personal administrador.
3. El enlace alojado de Embedded Signup generado por Meta, con la misma app y configuración, abrió correctamente la pantalla «Conecta tu cuenta fácilmente con Centro de Innovación Visual».
4. Esa prueba solo verificó la apertura del flujo alojado. No se pulsó Continuar, no se completó un registro y no se vinculó un número al tenant. Tampoco demuestra por sí sola que el cambio de perfil fuera la única causa del error del SDK de VIA.
5. El usuario abrió VIA en el navegador interno. Se observó **Demo De Tienda**, cuenta `ventasiaopsstore@gmail.com`, Google conectado y WhatsApp pendiente. La ruta seleccionada era «Empieza desde cero»; el botón requería un PIN de seis dígitos.
6. Tras ingresar el PIN directamente, se inició un intento nuevo desde VIA. La observación de red confirmó `POST /api/saas/tenants/demo-de-tienda/whatsapp/embedded-signup/start` con HTTP 200 y un evento `Page.windowOpen` hacia OAuth de Facebook con la app y configuración correctas. El popup se abrió en una ventana separada de Chrome, no expuesta entre las pestañas controlables. Se pidió al titular identificar si muestra login, registro o el error original. No se capturaron el PIN ni el contenido del POST.

La apertura del popup quedó comprobada. En esa comprobación, `/health/ready` respondió HTTP 200 en aproximadamente 0,23 segundos y las consultas de estado del tenant respondieron HTTP 200. La ampliación siguiente sustituye la incertidumbre inicial sobre qué pantalla mostraba el popup.

## Reproducción con la cuenta demo y contraste oficial

- VIA en el navegador interno: **Demo De Tienda**, Google conectado, WhatsApp pendiente. Facebook en ese navegador: identidad **Ventasia Opsstore**; es una sesión distinta de la del administrador en Chrome.
- Se lanzó un intento nuevo desde VIA. `/embedded-signup/start` respondió HTTP 200 con `appId=1094480476808501`, `configId=1021932474245234`, Graph `v26.0` y `responseType=code`.
- El SDK abrió el diálogo OAuth con esos identificadores. Se observó telemetría `client_login_denied_response` y el usuario aportó la captura «Función no disponible». No se observó una llamada a `/embedded-signup/complete` en el intento.
- Por tanto, **este fallo ocurre en la autorización de Facebook, antes de seleccionar el negocio/número y antes del canje de código del backend**. No lo provoca en este punto PostgreSQL, Sheets, el webhook de mensajes ni el registro del teléfono.
- El enlace alojado por Meta abrió una portada con el nombre del proveedor y un selector de porfolio, pero no se completó autorización. El selector se observó sin opciones visibles; esto no demuestra que la cuenta carezca de porfolios ni que el enlace alojado resuelva el error del SDK.
- En la app publicada, los dos permisos WhatsApp figuran «Lista para publicar» y su solicitud anterior está aprobada. `public_profile` permanece «Listo para la prueba», con la acción de enviarlo a revisión.
- La FAQ oficial de Facebook Login para empresas, consultada el 3 de noviembre, exige acceso avanzado a `public_profile` para usuarios externos. El texto de la ficha que dice que el permiso se concede automáticamente no demuestra acceso avanzado: hay que distinguir acceso inicial/de prueba y aprobación para externos.

**Matiz técnico:** este requisito de acceso de la app no significa añadir indiscriminadamente `scope: public_profile` al token de usuario del sistema ni cambiarlo por un token de usuario personal. Mantener la configuración específica de Embedded Signup y solicitar la habilitación que corresponda en App Review.

## Modelo de cuentas y responsabilidades

| Elemento | Titular/responsable esperado | Consecuencia para VIA |
| --- | --- | --- |
| Aplicación de Meta y condición de proveedor de tecnología | Centro de Innovación Visual SAS | Una app compartida sirve a múltiples tiendas; cada tienda no crea una app de desarrollador. |
| Identidad Google usada para entrar a VIA | Usuario de VIA | No cambia la sesión de Facebook ni concede derechos sobre activos Meta. |
| Autenticación Facebook y consentimiento | Persona con permisos sobre el negocio cliente | Meta comprueba quién puede compartir sus activos. No invitar a cada cliente como administrador/tester de la app de VIA. |
| Porfolio empresarial, WABA y número del cliente | Negocio cliente | Seleccionar/crear los activos de la tienda y autorizar acceso a VIA. No seleccionar el porfolio del proveedor para todas las tiendas. |
| Credenciales de integración y operación del webhook | VIA, con autorización del cliente | Guardar y usar credenciales y asociación de activos por tenant. |
| Método de pago de WhatsApp | Cliente, en su cuenta de Meta | Modelo de pago directo a Meta por consumo facturable; suscripción VIA separada. |

El nombre **«Centro de Innovación Visual»** en la pantalla «incorporación … con» identifica al proveedor que solicita acceso; por sí solo no indica que el cliente esté usando los activos o la tarjeta del proveedor. Hay que comprobar además qué porfolio/WABA se seleccionan.

El PIN de seis dígitos que pide hoy VIA se usa para registrar/proteger un número en Cloud API; no autentica al usuario en Facebook ni sustituye el consentimiento, el código SMS o la vinculación desde la app del celular. No debe exigirse de forma idéntica para todos los caminos.

La guía oficial para Tech Providers indica que el cliente agrega su método de pago en WhatsApp Manager. En el código revisado no se encontró un flujo para asignar una línea de crédito de VIA. Por ello, **no hay base para afirmar cobro consolidado a VIA**. No se inspeccionó un método de pago final de esta tienda ni se completó su alta; hay que verificarlo al terminar. El procedimiento de compartir crédito de un Solution Partner es otro modelo, no un paso obligatorio que deba copiarse de la colección de Postman.

## Continuación segura de la prueba

1. Usar la sesión de VIA que tiene la tienda correcta abierta. Chrome y el navegador interno pueden tener sesiones distintas.
2. Confirmar que la ruta seleccionada corresponde al uso real del número: nuevo, Cloud API existente o WhatsApp Business App. No confundir el número de cliente de pruebas con el número de tienda.
3. Si la ruta pide PIN, el titular lo ingresa directamente en VIA; no copiarlo a chat, documentos o capturas.
4. Abrir **Conectar con Meta desde VIA**, usando un perfil personal con acceso al negocio. No reutilizar la URL temporal de un popup anterior.
5. Si aparece login o verificación, dejar la ventana abierta para el titular. Observar el resultado antes de afirmar que se corrigió el error.
6. La prueba se considera completa solo cuando Meta devuelve la autorización a VIA, VIA valida los activos y el webhook, y la tienda muestra el canal conectado. Abrir la primera pantalla de Meta no satisface este criterio.

## Diferencias de contrato a tener presentes

- El código local de `src/App.jsx` envía `extras: { sessionInfoVersion: '3' }`; el enlace alojado observado incluye además `featureType: 'whatsapp_business_app_onboarding'`. No atribuir el error de login a esta diferencia sin reproducirlo.
- La guía de implementación sitúa `event` al nivel superior del objeto `WA_EMBEDDED_SIGNUP`; el código local inspeccionado lo lee de `data.data` cuando existe. Revisar especialmente cancelación/error y finalización al probar el callback.
- El código local registra con `/register` las rutas distintas de `cloud_api_existing`. Antes de ofrecer coexistencia con la app del celular, contrastar su contrato específico. No presentar una migración como coexistencia ni desconectar un número por ensayo.
- El árbol local y los repositorios separados desplegados no son necesariamente idénticos. Cualquier corrección debe partir de la versión desplegada verificada y preservar los ajustes funcionales existentes.

## Contraste con el código publicado

Base backend: `backend/main`, commit `6f4ddc6029918d9cfd679ec628d7cccf916c9918`, coincidente con el despliegue live de Render. Base frontend consultada: `frontend/main`, commit `9869283c0672fb088621d79a311f7e44ae2f0618`; los parámetros del SDK coinciden con los observados en producción, pero en esta auditoría no se verificó independientemente el hash del despliegue de Vercel.

Referencias de líneas relativas a esas revisiones Git, no necesariamente al árbol de trabajo actual:

| Área | Evidencia de código | Evaluación |
| --- | --- | --- |
| Autorización y credenciales | `server/routes/saas.js`, rutas de inicio/finalización; `server/services/saasControlPlane.js:1556`; `secretVault.js` | Rutas para propietario del tenant, canje de código en servidor, validación teléfono/WABA, suscripción de webhook y secreto cifrado por tenant. Base adecuada. |
| Enrutamiento | `server/routes/whatsapp.js:184` y `:238`; `server/services/toolRegistry.js:607` | Entrada por `phone_number_id`, salida con número/token del tenant. No se requiere un webhook distinto para cada tienda. |
| Callback del navegador | `src/App.jsx:453` | Lee `event` de `data.data`, aunque Meta lo entrega en el nivel superior. Cancelación/error pueden perderse; faltan ramas explícitas para los distintos eventos de finalización. |
| Coexistencia | `src/App.jsx:476`, `:4192`; `saasControlPlane.js:1634` | Mismo lanzamiento para las tres rutas y PIN/`register` para cualquier ruta distinta de Cloud API existente. No implementa correctamente el contrato de coexistencia. |
| Finalización con datos parciales | `src/App.jsx:434`; `saasControlPlane.js:1574` | Exige siempre código, WABA y teléfono. La guía actual de coexistencia muestra un evento con WABA solamente; hay que descubrir/validar el teléfono mediante Graph según ese contrato. |
| Exclusividad del número | `saasControlPlane.js:1688`; `server/db/migrations/001_initial_postgres_store.sql:53`; `whatsapp.js:245` | No se encontró rechazo de un número ya vinculado a otro tenant ni índice único sobre `phone_number_id`; el receptor usa la primera coincidencia. Riesgo a corregir; no es evidencia de una fuga ocurrida. |
| Negocio y sesión de vinculación | Inicio/finalización de `saasControlPlane.js`; `src/App.jsx:460` | No se persiste `business_id` en el binding ni se observó una correlación de intento de un solo uso. Añadir verificación del negocio y protección contra resultados mezclados entre pestañas/tenants. |
| Lotes y eventos de coexistencia | `server/routes/whatsapp.js:161–187` | Solo se toma el primer elemento de `entry`, `changes`, `messages`/`statuses`. No se encontraron manejadores `smb_message_echoes`/`smb_app_state_sync`. |
| Vigencia y preparación comercial | `saasControlPlane.js:1661–1729` | Existe renovación, pero si falta `expires_in` se asumen 60 días. Se marca conectado tras vincular, sin confirmar método de pago ni prueba de canal. Separar esos estados. |

La guía de coexistencia consultada, actualizada el 29 de octubre, exige omitir el registro del número ya registrado, manejar su evento de finalización y los webhooks adicionales. Para v4 utiliza `featureType: whatsapp_business_app_onboarding`; la misma guía indica que v5 activa esta capacidad por defecto. **Elegir y probar explícitamente una versión soportada**: `sessionInfoVersion: '3'` es la versión de información de sesión, no prueba que se esté usando Embedded Signup v3.

## Plan de cierre de brechas

### P0 — Habilitar autorización de clientes externos

1. Preparar la solicitud de acceso avanzado a `public_profile`, justificando el inicio de sesión para autorizar activos empresariales; adjuntar instrucciones y evidencia real según lo que solicite el formulario. Conservar los permisos WhatsApp ya aprobados.
2. Verificar la aprobación de acceso avanzado y probar desde VIA con una persona sin rol en la app. No usar como solución permanente agregar clientes como testers.
3. Contrastar la configuración OAuth con la guía oficial. OAuth de navegador integrado está desactivado, aunque la guía de Embedded Signup lo incluye; evaluar ese ajuste para el navegador soportado manteniendo HTTPS y redirecciones estrictas. No declararlo causa única del error.
4. Si persiste el rechazo, registrar hora, app/config, identificador de error de Meta cuando exista, navegador y cuenta externa frente a cuenta con rol. Escalar a Meta con datos depurados, sin tokens/PIN/códigos. No renovar tokens de WhatsApp para corregir un rechazo anterior al canje.

### P0 — Completar los tres caminos reales del producto

1. **Número nuevo:** identidad Meta, negocio del cliente, número apto, verificación, PIN cuando corresponda, suscripción de webhook y validación del alta.
2. **Cloud API existente:** selección/autorización de activos y comprobación de registro; tratar separadamente los números administrados por otro proveedor y sus restricciones de traslado.
3. **WhatsApp Business del celular:** coexistencia explícita, comprobación de elegibilidad, eventos específicos y omisión de `/register`; no pedir borrar la cuenta existente para superar un error del camino equivocado. Consultar `is_on_biz_app`/`platform_type` cuando aplique.
4. Corregir el parser de eventos del SDK, capturar negocio y activos; contemplar finalización solo con WABA, cancelación, error, código expirado y cierre del popup. Canjear el código dentro de su vigencia y completar cada intento de forma idempotente.

### P0 — Garantizar aislamiento y operación

1. Validar negocio, WABA y teléfono con el token autorizado, y correlacionarlos con el propietario, tenant e intento que inició el flujo.
2. Rechazar la asociación del mismo teléfono a dos tenants con protección atómica/persistente; revisar duplicados existentes antes de añadir una restricción. No imponer unicidad global a WABA si un negocio legítimamente gestiona varios números.
3. Procesar lotes completos de webhook conservando deduplicación y enrutamiento por número. Para coexistencia, procesar mensajes reflejados del tendero como tales, sin responderlos como si fueran mensajes del comprador.
4. Implementar sincronización inicial de contactos/historial conforme al consentimiento y contrato de coexistencia, dentro de la ventana de 24 horas que indica Meta. Mostrar progreso y fallos recuperables.

### P1 — Guiar al tendero y mantener el canal

1. Antes de abrir Meta, mostrar tienda activa, propósito de la autorización y diferencia entre proveedor y negocio cliente. Preguntar dónde usa hoy su número.
2. Mostrar estados separados: autorización, activos identificados, canal operativo, sincronización y facturación. Un error debe conservar el avance válido y ofrecer una acción concreta.
3. Guiar al método de pago del cliente en Meta; no prometer tarjeta/cobro de VIA ni confundirlo con el pago de la suscripción SaaS. No bloquear arbitrariamente operaciones gratuitas por inferir condiciones de facturación no verificadas.
4. Usar la vigencia real del token y el mecanismo de reconexión ya existente. No depender del token temporal de pruebas del administrador. Implementar tratamiento de revocación/desconexión y alertas por tienda.

## Criterios de aceptación antes de abrir el autoservicio

| Prueba | Resultado exigido |
| --- | --- |
| Cliente externo sin rol en la app | Abre autorización, elige su negocio y vuelve a VIA sin «Función no disponible». |
| Dos negocios/tenants independientes | Cada uno conserva sus activos y token; mensajes y pedidos llegan exclusivamente a su tienda. |
| Intento de asociar un teléfono ya vinculado | Rechazo claro, sin sobrescribir otra tienda; también ante dos solicitudes simultáneas. |
| Número nuevo / Cloud API / coexistencia | Cada camino ejecuta solo sus pasos aplicables; la app móvil se conserva en coexistencia. |
| Callback solo con WABA, cancelación y cierre | Descubrimiento validado o salida guiada; sin espera indefinida ni falso «conectado». |
| Reintento, código expirado, dos pestañas | Operación idempotente/correlacionada; ningún resultado termina en otro tenant. |
| Lotes, reintentos de Meta y mensajes del tendero | Ninguna pérdida por seleccionar solo el primer evento; sin respuestas duplicadas o bucles. |
| Cobro, revocación y renovación | El cliente sabe quién factura; el estado refleja la operación real y permite recuperar acceso. |

Estas pruebas están **pendientes**. La reproducción actual solo valida el inicio de VIA y el rechazo de Meta, no un alta E2E exitosa. La autonomía evita intervención habitual del administrador de VIA; no elimina los controles, elegibilidad ni acciones del titular exigidas por Meta.

## Referencias

- [Configuraciones de Facebook Login de la app](https://developers.facebook.com/apps/1094480476808501/business-login/configurations/?business_id=153671712161764)
- [Configuración de OAuth de la app](https://developers.facebook.com/apps/1094480476808501/business-login/settings/?business_id=153671712161764)
- [Implementación oficial de Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/) — consultada en navegador el 3 de noviembre de 2026.
- [Errores de Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors/)
- [Facebook Login para empresas — FAQ sobre acceso avanzado a public_profile](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business)
- [Alta de clientes como Tech Provider — token, webhook y método de pago del cliente](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/)
- [Coexistencia con WhatsApp Business App — finalización, registro y sincronización](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Permisos de la app auditada](https://developers.facebook.com/apps/1094480476808501/use_cases/customize/permissions/?use_case_enum=WHATSAPP_BUSINESS_MESSAGING&selected_tab=permissions&product_route=use_cases&business_id=153671712161764)

Este registro no contiene tokens, códigos de autorización, PINes ni números privados. No se modificó código funcional ni se creó una nueva app de Meta durante este diagnóstico.
