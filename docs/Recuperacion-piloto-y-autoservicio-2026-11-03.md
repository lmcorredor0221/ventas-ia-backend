# Recuperación del piloto y preparación de autoservicio — 2026-11-03

## Alcance

Se conserva la versión productiva `6f4ddc6` y se incorporan las correcciones de alta de WhatsApp y recuperación de Google. No se migra el teléfono comprador, no se purgan pedidos/conversaciones y no se modifica la solicitud Meta en curso.

- Piloto: `test-local`, Test Local, cuenta Google `lmcorredor@gmail.com`.
- Número de tienda de ensayo: `+1 555-202-4079`, phone ID `1299193049952421`.
- Comprador de ensayo: `+57 3219450893`.
- Demo De Tienda (`ventasiaopsstore@gmail.com`) es otro tenant.

## Incidente confirmado

La conversación de Test Local mostró el mensaje «Para un domicilio, regalas por favor un chocorramo y coca cola 400», a las 12:13 del 3 de noviembre. Coincide con `google_sheets_customer_profile_lookup` y el `invalid_grant` de Render a las 12:13:43. La renovación de Google falló antes del LLM; no era prueba de suspensión del número de Meta.

Google se reconectó el 3 de noviembre a las 17:41:39 UTC, conservando carpeta/hoja. La autorización devuelta conserva un alcance anterior de Sheets; no se revocaron permisos existentes. La prueba real con una autorización nueva que contenga exclusivamente `drive.file` sigue siendo un criterio del piloto externo.

## Google Cloud

Proyecto `ventas-ia-piloto-lmcorredor`:

- Página principal, privacidad y términos completados con las páginas públicas de VIA.
- Audiencia externa publicada **En producción**, con aprobación explícita del titular.
- Retirado de la declaración el alcance general `spreadsheets`. Nuevas autorizaciones del backend solicitan identidad básica y `drive.file`; Sheets admite este último para archivos de la aplicación.
- Centro de verificación: **no se requiere verificación de acceso a datos**, pues no hay permisos sensibles/restringidos. La verificación de marca continúa separada; no se declara realizada.
- Publicar no revive tokens inválidos. La reconexión inicial ocurrió antes de publicar: se necesita una autorización nueva en Producción y seguimiento más de siete días.

Fuentes: https://developers.google.com/workspace/sheets/api/scopes y https://developers.google.com/identity/protocols/oauth2#expiration.

## Cambios de software y configuración

- Google `invalid_grant` se convierte en `reconnect_required`, conservando archivos y mostrando reconexión en la interfaz. El comprador recibe un aviso de atención por la tienda si WhatsApp está operativo; no se inventa disponibilidad ni precio.
- La caché de acceso Google se invalida al reemplazar la conexión. Errores transitorios no revocan credenciales.
- Recepción asíncrona exige consumidor de cola activo. Render: `WHATSAPP_ASYNC_INBOUND_ENABLED=true` e `INTEGRATION_OUTBOX_ENABLED=true`, guardados para el despliegue.
- Proyección Sheets reconcilia por ID de pedido antes de anexar; usa el estado actual de PostgreSQL al reproducir eventos antiguos.
- Reintentos no duplican la burbuja entrante con el mismo ID de Meta. Esto no constituye garantía de envío exactamente una vez ante un resultado HTTP desconocido.
- Embedded Signup distingue número nuevo, Cloud API existente y coexistencia; valida actor/tenant/activos, reserva teléfono en PostgreSQL y permite reanudar fases sin reutilizar el código OAuth.
- Coexistencia importa historial cerrado y trata el eco móvil como intervención humana. El número nuevo pide PIN; coexistencia no registra de nuevo ni pide ese PIN.
- El acceso externo depende también de `META_FACEBOOK_LOGIN_ADVANCED_ACCESS_APPROVED`; no activarlo antes de la aprobación real de `public_profile`.

## Preflight productivo

Supabase correcto: `mmcxphpstxjugxjrdffb`.

- Sin teléfonos duplicados entre tenants antes de migración 014.
- Bandeja de entrada durable vacía.
- Ocho trabajos históricos pendientes de Test Local: seis `order.sheet_projection` y dos `order.sheet_create`, del 20 de octubre. Ninguno es una respuesta de WhatsApp; se pueden procesar con reconciliación por ID/estado actual.
- Comprobar resultados después del despliegue; no descartar errores ni borrar trabajos por defecto.

## Validación local

PASS: `test:backend`, `test:architecture`, `test:whatsapp-onboarding`, `test:google-recovery`, `test:whatsapp-postgres` (PostgreSQL local real, esquema temporal, sin alterar runtime de desarrollo), Google live contract con permiso `drive.file`, cuatro pruebas frontend Embedded Signup y compilación Vite de 1.681 módulos. Sin nueva ejecución de los 40 casos con DeepSeek real.

## Criterios todavía abiertos

1. Registrar hashes publicados y comprobar salud, migración 014 y colas productivas.
2. Validar el token Meta realmente usado por Test Local. La fecha persistida observada antes del despliegue aún era 20 de octubre; el botón no mostró una confirmación suficiente. No afirmar renovación sin evidencia.
3. Renovar consentimiento Google ya en Producción y probar la hoja existente; confirmar permiso mínimo con un tenant nuevo.
4. Completar campos `history`, `smb_app_state_sync`, `smb_message_echoes` después del despliegue del receptor y confirmar consentimiento de coexistencia.
5. Resolver verificación de marca Google cuando corresponda. La publicación y la verificación de marca son distintas.
6. Meta: `public_profile` sigue en revisión; WhatsApp messaging/management aprobados. No cancelar ni reenviar por reparar la demo.
7. Matriz real de alta con dos negocios independientes y persona sin rol en la app: callback, WABA/número, facturación del cliente, envío/recepción y revocación.
8. Mantener un único escritor. Bloqueo de onboarding en memoria y consumidor serial no justifican todavía múltiples réplicas. Render Free conserva riesgo de arranque frío.

No se declara listo el autoservicio externo solo por un popup, una aprobación aislada o un HTTP 200.
