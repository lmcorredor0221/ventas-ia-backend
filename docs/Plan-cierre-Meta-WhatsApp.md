# Plan de cierre: piloto WhatsApp por tienda

Fecha de contraste: 19 de octubre de 2026. App Meta: Ventas IA Ops Store (`1094480476808501`). Este plan se basa en la interfaz actual de Meta y en el codigo de `ventas-ia-frontend` y `ventas-ia-backend`, no en una suposicion de que la aprobacion ya existe.

## Diagnostico confirmado

| Frente | Evidencia observada | Estado real |
| --- | --- | --- |
| Negocio y publicacion | Meta muestra verificacion al 100 % y app publicada. | Completado; no equivale a aprobar permisos avanzados. |
| Solicitud de App Review | [Solicitud en Meta](https://developers.facebook.com/apps/1094480476808501/app-review/submissions/?submission_id=1096579776598571&business_id=153671712161764): boton "Enviar para revision" deshabilitado; la revision figura "No enviada". | Borrador. El texto anterior de onboarding ("Meta esta revisando") era incorrecto. |
| Configuracion de la app | La ficha basica confirma dominio, URLs publicas de privacidad/terminos/eliminacion, categoria e icono ya cargado. El contacto de revision sigue mostrado como `luislisim@hotmail.com`. | Falta decidir y, si corresponde, actualizar el destinatario de alertas antes del envio. |
| Uso permitido | Meta indica 0 %. Para `whatsapp_business_messaging` y `whatsapp_business_management` pide descripcion del uso, video de la experiencia, llamadas reales de prueba a Graph API y certificacion. La interfaz marca **0 de 1** llamada requerida para cada permiso. `public_profile` tambien figura en la solicitud. | Descripciones funcionales guardadas como borrador; faltan videos, llamadas y certificaciones. Revisar si `public_profile` es necesario. |
| Tratamiento de datos | El borrador registra como responsable a Centro de Innovacion Visual SAS (Colombia), y como encargados pertinentes a Supabase (EE. UU./Singapur), Render (EE. UU.) y DeepSeek (China). El titular confirmo que no recibio solicitudes oficiales de datos que afecten la seguridad nacional en los ultimos 12 meses. | Datos guardados; aun requieren la certificacion final del titular al enviar la solicitud. |
| Instrucciones para revisores | Meta indica 0 %. Pide acceso a la app, pasos de prueba, uso de Facebook Login y, si hay barrera de pago, acceso de prueba valido un ano. | Falta cuenta/entorno de revision y recorrido reproducible. |
| Politica publica | `/privacidad` abre sin autenticacion, pero aun dice que el operador, soporte y contacto deben completarse antes de publicar. | Se corrigio en codigo con operador y correo confirmados por el titular; falta desplegar y verificar en produccion. La exactitud integral de la politica requiere revision legal. |
| Conexion por tenant | El backend intercambia el codigo de Embedded Signup, valida WABA/numero, suscribe el webhook, registra el numero y guarda el token en una referencia separada por tienda. `canAutomate` depende de configuracion, webhook HTTPS y `META_WHATSAPP_ADVANCED_ACCESS_APPROVED=true`. | Implementacion presente; contrato simulado pasa. No hay prueba de alta real de una nueva tienda aprobada por Meta. |

## Avance de esta ejecucion

- Las descripciones de uso real de `whatsapp_business_messaging` y `whatsapp_business_management` quedaron guardadas en el borrador de Meta. Esto no completa la seccion: siguen pendientes los videos, las llamadas reales y las declaraciones de uso permitido.
- El operador y el correo de privacidad/eliminacion fueron confirmados por el titular como Centro de Innovacion Visual SAS y `lmcorredor@gmail.com`. El cambio esta implementado en el frontend; requiere despliegue y comprobacion publica. La politica completa sigue sujeta a revision juridica.
- La ficha basica de Meta muestra la opcion "Reemplazar icono de la app", evidencia de que el icono ya esta cargado. Se conserva `docs/meta-review/ventas-ia-icon.png` como respaldo aprobado por el titular; no hace falta volver a subirlo salvo que Meta lo rechace.
- Se completo el borrador de tratamiento de datos con las respuestas factuales confirmadas por el titular. No se incluyeron servicios que no procesan mensajes de Meta en el flujo real.
- El contrato de backend y el build de frontend pasan. La puerta de seguridad para Embedded Signup sigue cerrada; ningun cambio de este plan habilita el registro por si solo.

## Ejecucion y orden

1. **Verdad de estado en producto (codigo).** Separar `not_submitted`, `in_review`, `changes_requested` y `approved` en la respuesta de onboarding. Mantener `META_WHATSAPP_ADVANCED_ACCESS_APPROVED` como unico habilitador del registro; jamas activarlo por estar la app publicada o el negocio verificado. Probar el contrato de bloqueo, construir frontend y desplegar ambas piezas. Al enviar la solicitud, configurar `META_WHATSAPP_APP_REVIEW_STATUS=in_review`; si Meta pide cambios, `changes_requested`; cambiar el indicador de aprobacion solo tras constatar los dos permisos avanzados concedidos. Responsable: plataforma.
2. **Ficha publica y app de Meta.** Sustituir el aviso provisional de privacidad por operador y canal confirmados, verificar `/privacidad` y `/eliminar-datos` en navegador anonimo, aportar icono cuadrado aprobado por la marca, y actualizar el contacto principal de Meta si corresponde. Responsable: titular/plataforma. Criterio: configuracion de la app al 100 %.
3. **Evidencia funcional.** Preparar un negocio y numero de prueba bajo control del titular, ejecutar llamadas reales de `whatsapp_business_management` (por ejemplo lectura de WABA/numeros y suscripcion) y `whatsapp_business_messaging` (mensaje de prueba), registrar hora/resultado sin tokens, y grabar video del flujo desde login hasta mensaje entrante/saliente. Los tests con mocks del repo no sustituyen estas llamadas. Responsable: plataforma. Criterio: Meta reconoce llamadas y acepta los videos.
4. **Uso permitido.** Describir solo lo que el codigo hace: alta autorizada de la tienda, vinculacion de su WABA y numero, recepcion de webhooks, respuesta a consultas/pedidos y escalamiento humano. No afirmar que el SaaS crea una app de Meta por tienda. Examinar `public_profile`: conservarlo solo si el flujo de Facebook Login de la app lo necesita; si no, quitarlo de la solicitud. Responsable: plataforma/titular. Criterio: seccion al 100 %.
5. **Tratamiento de datos.** Confirmar con el titular la entidad responsable y el inventario real de encargados con acceso a datos de Meta. Evaluar Render, Supabase, Vercel, proveedor LLM y servicios Google segun el flujo efectivo; no declarar automaticamente que todos acceden. Confirmar historico de solicitudes de autoridades y las politicas realmente implementadas. Responsable: titular, con revision legal/privacidad. Criterio: respuestas documentadas y coherentes con la politica publica.
6. **Acceso del revisor.** Proveer instrucciones exactas para entrar a `https://via.leanagentbuilder.com/`, una cuenta de prueba sin datos reales ni secretos compartidos, tienda/numero de prueba y recorrido reproducible. Resolver la barrera de suscripcion mediante acceso de revision valido por el plazo que pide Meta. Responsable: plataforma. Criterio: un tercero puede repetir el flujo sin ayuda.
7. **Envio, aprobacion y piloto.** Revisar todas las declaraciones y enviar solo con autorizacion del titular. Tras aprobacion explicita de ambos permisos, actualizar el flag en Render; validar webhook, Embedded Signup, alta de un tenant nuevo, token aislado y renovacion, recepcion/respuesta de mensajes, aislamiento de otro tenant y rollback. Responsable: plataforma. Criterio: piloto real completado con dos tiendas sin cruzar credenciales ni conversaciones.

## Bloqueos actuales y regla de seguridad

- No se debe decir a los clientes que Meta ya revisa: la solicitud esta **sin enviar**.
- No cambiar `META_WHATSAPP_ADVANCED_ACCESS_APPROVED` a `true` para abrir el boton antes de la aprobacion real.
- No inventar respuestas legales, historico de solicitudes a autoridades, credenciales de revisores ni llamadas a Meta; una prueba local con `fetch` simulado no es evidencia de App Review.
- No reutilizar la verificacion de Centro de Innovacion Visual SAS como si cada tenant debiera repetir el registro de proveedor tecnologico. Cada tienda autoriza su propio negocio, WABA y numero durante Embedded Signup cuando la plataforma este habilitada.
- La app de Meta dispone de un numero de prueba, pero no habia token generado ni destinatario seleccionado al revisar "Paso 1. Pruebalo". Generar el token y enviar un mensaje real requiere una cuenta/numero de prueba autorizado y no debe publicarse el token en el repo ni en este documento.

## Referencias de implementacion

- Backend: `server/services/saasControlPlane.js` (`whatsappOnboardingForTenant`, `startWhatsAppEmbeddedSignup`, `completeWhatsAppEmbeddedSignup`).
- Mensajeria: `server/services/toolRegistry.js` (`whatsappBusinessMessaging`) y rutas de webhooks.
- Frontend: `src/App.jsx` (`OnboardingView`, `WhatsAppActivationWizard`, `PrivacyNotice`).
- Contrato: `server/tests/whatsapp-embedded-signup-contract.mjs`.
