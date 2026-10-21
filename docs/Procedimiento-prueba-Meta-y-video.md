# Procedimiento: prueba de Meta y video de App Review

## Proposito

Este procedimiento sirve para demostrar a Meta el funcionamiento real de Ventas IA sin confundir el canal de prueba de la aplicacion con el WhatsApp de una tienda real. Tambien define que informacion pertenece a la plataforma y cual pertenece a cada tenant.

No guardar tokens, codigos SMS, PINes, documentos de identidad ni numeros personales en este archivo, en capturas ni en Git.

## Modelo que no se debe mezclar

| Elemento | Alcance | Regla |
| --- | --- | --- |
| App de Meta `Ventas IA Ops Store` | Global de Ventas IA | Hay una sola app de Meta, no una por tenant. |
| Verificacion de proveedor y permisos avanzados | Global de Ventas IA | La completa Centro de Innovacion Visual SAS como titular de la plataforma. |
| Webhook HTTPS y secreto de la app | Global de Ventas IA | Reciben eventos para todas las tiendas; el backend los enruta por `phone_number_id`. |
| WABA, `phone_number_id` y token operativo | Por tenant | Cada tienda autoriza sus propios activos mediante Embedded Signup. Nunca se reutilizan entre tenants. |
| Numero de prueba de Meta | Demo global aislada | Solo se vincula a la tienda de demostracion; no es el numero de un cliente real. |
| Numero que envia el pedido de prueba | Cliente de demostracion | Es un destinatario autorizado de Meta. No se registra, no se migra y no se convierte en numero de tienda. |

## Recursos de demostracion actuales

- App de Meta: `Ventas IA Ops Store` (`1094480476808501`).
- Numero de prueba de Meta que representa a la tienda demo: `+1 (555) 202-4079`.
- Tenant de demostracion en Ventas IA: `Test Local`.
- Cliente de prueba: usar el numero autorizado en Meta, pero no anotarlo en Git ni en la evidencia publica.

El numero de prueba es un recurso de la app de Meta. Que el token venza no elimina el numero, la WABA ni el avance de los pasos de prueba.

## Comprobacion antes de grabar

1. Entrar a Meta Developers con la cuenta administradora de la app.
2. Abrir `Ventas IA Ops Store` -> `Conectar en WhatsApp` -> `Paso 1. Pruebalo`.
3. Confirmar que estan en verde estos dos hitos:
   - `Solicita un numero de prueba de WhatsApp`.
   - `Envia un mensaje desde tu numero de prueba`.
4. Abrir `https://via.leanagentbuilder.com` e iniciar sesion en el tenant `Test Local`.
5. Verificar que el catalogo de la demo esta disponible y que el canal WhatsApp de esa tienda esta operativo.
6. Desde el numero de cliente autorizado, enviar un pedido corto al numero de prueba de Meta.
7. Confirmar en Ventas IA que se crea una sola conversacion, se consulta el catalogo y se genera la respuesta.

Si los dos hitos de Meta siguen en verde, la configuracion de prueba no se perdio. No crear una nueva app, no agregar un numero nuevo y no iniciar migracion para resolver un problema de token o de respuesta.

## Renovar el token de prueba

El token de prueba es temporal. Esta es la unica renovacion manual aceptable para la demo:

1. Abrir el mismo `Paso 1. Pruebalo` de la app de Meta existente.
2. Generar un token nuevo solo para el numero de prueba.
3. Guardarlo exclusivamente en el secreto seguro asociado al tenant `Test Local` en el runtime de produccion.
4. No pegarlo en el repositorio, `.env.example`, documentos, capturas ni mensajes.
5. Ejecutar un unico mensaje de prueba desde el cliente autorizado y comprobar la respuesta en Ventas IA.

Diagnostico rapido:

| Sintoma | Significado probable | Accion correcta |
| --- | --- | --- |
| Meta conserva los dos hitos verdes | El recurso de prueba existe | Continuar con la comprobacion de token y webhook. |
| El mensaje entra a Ventas IA pero no sale respuesta | Token de prueba vencido o secreto del tenant demo no actualizado | Renovar el token de prueba y actualizar solo el secreto de `Test Local`. |
| El mensaje no llega a Ventas IA | Webhook, suscripcion o mapeo del `phone_number_id` al tenant demo | Revisar observabilidad y el binding de `Test Local`; no registrar otro numero. |
| Una tienda real no ve `Conectar con Meta` | Los permisos avanzados globales aun no estan aprobados o configurados | Resolver App Review; el tenant no debe buscar tokens ni identificadores. |

## Guion del video para Meta

El video debe mostrar la experiencia de la aplicacion, no el panel de administracion de Meta ni secretos.

1. Abrir Ventas IA e iniciar sesion con la cuenta de revision o demo.
2. Mostrar que el tenant de demo tiene su catalogo y su canal aislados.
3. En WhatsApp, enviar un pedido desde el cliente autorizado al numero de prueba de Meta.
4. Volver a Ventas IA y mostrar una unica conversacion entrante para esa tienda.
5. Mostrar que el agente interpreta el pedido, consulta el catalogo de la tienda y responde por WhatsApp.
6. Mostrar el pedido creado y el siguiente paso operativo, sin exponer tokens, numeros personales ni datos reales de terceros.
7. Cerrar el video explicando que, tras la aprobacion, cada nueva tienda realiza su propia autorizacion de Meta desde `Conectar con Meta`; Ventas IA no crea una app nueva por tienda ni comparte sus credenciales.

Antes de cargarlo a Meta, comprobar que la grabacion no contiene el token, una pantalla de Render, identificadores de secretos, codigos de verificacion o datos personales no necesarios.

## Flujo real despues de la aprobacion

1. El propietario crea o selecciona su tienda en Ventas IA.
2. Conecta su Google Drive y se crea su catalogo aislado.
3. En `Conectar con Meta`, inicia sesion en la ventana segura de Meta.
4. Selecciona o crea su negocio, WABA y numero; verifica el numero por SMS o llamada dentro de Meta.
5. La plataforma intercambia el codigo de autorizacion, valida que el numero pertenece a la WABA, suscribe el webhook y guarda la referencia del token para ese tenant.
6. Un mensaje entrante contiene el `phone_number_id`; el webhook lo usa para encontrar solamente a la tienda titular del numero.
7. Cuando el token del tenant requiera renovacion, el propietario vuelve a autorizar desde la conexion de su propia tienda. Esa renovacion no afecta ningun otro tenant.

## Reglas de seguridad y recuperacion

- No marcar `META_WHATSAPP_ADVANCED_ACCESS_APPROVED=true` hasta confirmar que Meta concedio los permisos avanzados solicitados.
- No usar el numero de cliente de prueba como numero de negocio, ni terminar su alta de produccion.
- No borrar el numero de prueba, la WABA de prueba ni el tenant `Test Local` para solucionar fallas de catalogo, agente o token.
- No completar el asistente de `Agregar numero nuevo` salvo que se vaya a incorporar intencionalmente el numero real de una tienda despues de la aprobacion.
- Conservar como evidencia solo capturas de los dos hitos verdes de Meta, el video funcional y registros de webhook sin secretos.
- Toda prueba de salida debe confirmar que se mantiene una sola conversacion por cliente y tenant; varias conversaciones por cada respuesta indican un defecto del runtime, no una condicion de Meta.

## Criterio de cierre para App Review

La evidencia esta lista cuando:

- Meta registra las llamadas reales de prueba para los permisos requeridos.
- El video muestra mensaje entrante, consulta de catalogo y respuesta desde Ventas IA.
- La cuenta de revision puede entrar a una tienda de demostracion sin una barrera de pago.
- No se exponen secretos y no se mezclan datos del tenant demo con los de un cliente real.
- Tras la aprobacion, se prueba Embedded Signup con una tienda distinta de la demo y se valida su aislamiento.
