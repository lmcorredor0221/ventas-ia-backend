# Operacion de Meta WhatsApp en produccion

## Separacion de responsabilidades

La plataforma usa una unica aplicacion de Meta para abrir la experiencia guiada de Embedded Signup y recibir webhooks. Esta configuracion es global y se guarda solo como secretos del backend:

- `META_APP_ID` identifica la aplicacion de Ventas IA.
- `META_APP_SECRET` firma el intercambio del codigo de autorizacion y los webhooks.
- `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` identifica la plantilla de registro insertado.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` valida una sola URL publica de webhooks.

Una tienda no recibe ni administra esos valores. Durante su propio flujo, el propietario entra a Meta, elige o crea su negocio y valida su numero. El backend guarda de forma aislada por tenant:

- Cuenta de WhatsApp Business y numero seleccionados.
- Token de acceso de ese tenant, cifrado en el vault.
- Fecha de emision y de vencimiento de su token.

Por tanto, renovar el acceso de una tienda nunca modifica la conexion de otra ni la clave de la aplicacion de Ventas IA.

## Vencimiento y renovacion

La configuracion de Embedded Signup usada por la plataforma emite tokens de acceso con vigencia esperada de 60 dias. Al finalizar el intercambio con Meta, el backend conserva `accessTokenIssuedAt` y `accessTokenExpiresAt`; usa `expires_in` si Meta lo entrega y, de lo contrario, aplica 60 dias.

La interfaz marca el acceso como vigente, proximo a vencer (14 dias o menos) o vencido. En los dos ultimos estados, el propietario ve **Renovar acceso con Meta**. El boton abre el mismo flujo seguro de Meta, actualiza solo el token de su tenant y mantiene su numero, WABA, catalogo, conversaciones y pedidos.

No existe renovacion silenciosa ni se solicita al usuario copiar un token. Meta es quien vuelve a autorizar el negocio y la plataforma sustituye el secreto anterior en el vault del tenant.

## Configuracion inicial de la plataforma

1. Registrar la plataforma Web `https://via.leanagentbuilder.com/` en Inicio de sesion con Facebook para empresas y mantener activos OAuth web y el SDK de JavaScript.
2. Crear una configuracion de WhatsApp Embedded Signup v4 de 60 dias en la app de Meta con `whatsapp_business_management` y `whatsapp_business_messaging`.
3. Lanzar Embedded Signup con su `config_id`, `response_type=code`, `override_default_response_type=true` y `extras: { setup: {} }`. La configuracion v4 define permisos y activos; no se debe forzar el parametro heredado `sessionInfoVersion`.
4. Configurar la URL HTTPS `https://ventas-ia-backend-free.onrender.com/webhooks/whatsapp` y verificarla con el mismo token almacenado en Render.
5. Suscribir el campo `messages` de WhatsApp Business Account; Meta tambien puede suscribir eventos de cuenta y plantillas.
6. Definir en Render `WHATSAPP_PROVIDER_MODE=live`, el App ID, App Secret, Config ID, URL publica y token de verificacion. Nunca se guardan en frontend ni en un tenant.
7. Mantener `WHATSAPP_GRAPH_API_VERSION=v26.0`, igual a la version de suscripcion confirmada por Meta.

## Estado de publicacion

La aplicacion global **Ventas IA Ops Store** quedo publicada el 16 de octubre de 2026. Meta confirma que esta disponible para el publico, por lo que los propietarios de tiendas ya no necesitan pertenecer a los roles de desarrollo de la app para abrir el flujo de autorizacion.

## Antes de abrir a todos los tenants

- Confirmar en Meta que la app continua publicada y que los permisos de WhatsApp requeridos siguen aprobados para produccion.
- Probar Embedded Signup con una tienda piloto y un numero real.
- Confirmar que el webhook recibe un mensaje entrante y que el backend lo asocia al `phone_number_id` del tenant correcto.
- Vigilar desde administracion de plataforma los fallos de webhook y los tokens proximos a vencer.
