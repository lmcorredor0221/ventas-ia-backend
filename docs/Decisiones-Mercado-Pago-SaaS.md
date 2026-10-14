# Decisiones Mercado Pago para Ventas IA SaaS

Actualizado: 2026-10-10.

## Decision aprobada

Ventas IA usara Mercado Pago para cobrar la suscripcion mensual automatica de la plataforma.

Esta decision aplica solo al cobro del SaaS. No reemplaza los medios de pago que cada tienda usa con sus compradores finales para domicilios, como efectivo, datafono, transferencia, Nequi u otros.

La plataforma dejara disponible la capacidad de periodo de prueba, configurable desde administracion, pero el valor inicial del producto sera: periodo de prueba desactivado por defecto.

El periodo de gracia por cobro fallido sera parametrizable desde administracion. El valor inicial sera de 5 dias.

Durante el periodo de gracia el agente seguira operando normalmente, pero la interfaz mostrara avisos progresivos. Al vencer la gracia, la plataforma suspende automaticamente la operacion.

El owner de la tienda podra cancelar la suscripcion desde la microapp. La cancelacion sera autoservicio, con confirmacion explicita y acceso vigente hasta el final del periodo ya pagado.

La primera version comercial tendra un solo plan activo. La arquitectura debe permitir configurar varios planes desde administracion y activar o desactivar cada plan sin despliegue.

Los cambios de plan tendran reglas distintas segun direccion: los downgrades aplican hasta el siguiente ciclo de facturacion; los upgrades aplican de inmediato. No habra devoluciones por cambios de plan.

El cambio de plan sera mixto: el owner podra hacer upgrades autoservicio; los downgrades requeriran confirmacion fuerte y aplicaran al siguiente ciclo. El administrador podra ejecutar ambos con auditoria.

Cuando una tienda quede suspendida o cancelada, se separa el acceso al historial de la operacion del agente. El agente se bloquea, pero el acceso al historial sigue reglas de retencion y reactivacion.

La reactivacion sera autoservicio con validacion segun antiguedad y causa del estado.

La plataforma enviara notificaciones de facturacion dentro de la microapp, por WhatsApp al owner cuando este configurado, y en el Centro de control para administradores. No se usara email en la primera version.

La facturacion mensual seguira el aniversario de suscripcion de cada cliente. Si un cliente se activa el dia 12, sus renovaciones se cobraran los dias 12 de cada mes.

Los limites del plan se reiniciaran con el mismo ciclo de facturacion por aniversario de cada cliente.

Al llegar al 100% del limite de domicilios, la plataforma no debe apagar toda la tienda. Debe bloquear nuevos domicilios confirmados, mantener conversaciones basicas y ofrecer upgrade inmediato o excepcion administrativa auditada.

El plan inicial manejara dos limites: domicilios como limite comercial principal e interacciones como politica de uso justo para controlar costos operativos.

La primera version no cobrara excedentes automaticos. Al superar limites, el camino sera upgrade de plan o excepcion administrativa auditada.

La plataforma permitira descuentos manuales por cliente desde administracion. No habra cupones publicos en la primera version.

La microapp mostrara historial de pagos y referencias/comprobantes de Mercado Pago cuando esten disponibles. La factura fiscal propia queda fuera del alcance inicial.

Las comisiones de Mercado Pago se incluiran dentro del precio comercial. El cliente vera un precio final unico, sin cargo separado por comision.

El administrador tendra una accion manual para sincronizar el estado de una suscripcion con Mercado Pago por cliente, con auditoria y control de uso.

El administrador podra otorgar excepciones temporales de acceso aunque Mercado Pago no este activo. La excepcion no modifica el estado real de la suscripcion y debe tener motivo, vencimiento y auditoria.

Ademas de webhooks y sincronizacion manual, la plataforma tendra jobs automaticos de reconciliacion con Mercado Pago.

El onboarding se dividira en diagnostico inicial antes del pago y configuracion completa despues de suscripcion activa.

El diagnostico inicial de WhatsApp sera liviano y solo clasificara la ruta del cliente. La conexion real de WhatsApp se hara despues de suscripcion activa.

Antes del pago solo se usara Google Sign-In para identidad. Los permisos Drive/Sheets se pediran despues de suscripcion activa.

Antes del pago se pediran solo datos minimos del comercio: nombre comercial y ciudad. Los datos operativos completos se completaran despues de suscripcion activa.

El checkout de Mercado Pago se abrira mediante redireccion externa en la primera version. La experiencia embebida queda como mejora futura.

Si el cliente abandona el checkout, la suscripcion queda en `pending_payment` con recuperacion durante 7 dias.

El Centro de control incluira un embudo basico de conversion desde cuenta creada hasta tienda activada.

El sistema guardara motivos de abandono o bloqueo del onboarding, combinando deteccion automatica y nota manual opcional del administrador.

## Modelo definido

- Tipo de cobro: suscripcion automatica mensual.
- Proveedor: Mercado Pago.
- Integracion tecnica objetivo: API de Suscripciones.
- Recurso principal esperado: `preapproval`.
- Plan reutilizable esperado: `preapproval_plan`, si se confirma que conviene manejar un plan base comun.
- Activacion: solo por webhook verificado y consulta de estado contra Mercado Pago.
- Retorno del usuario: informativo; no activa por si solo la plataforma.

## Evidencia revisada

La documentacion oficial de Mercado Pago Colombia indica que la API de Suscripciones permite crear y gestionar cobros recurrentes automaticos, definir frecuencia y monto, y que Mercado Pago gestiona cobros y reintentos si un pago es rechazado.

Referencias:

- https://www.mercadopago.com.co/developers/es/reference/online-payments/subscriptions/overview
- https://www.mercadopago.com.co/developers/es/docs/subscriptions/overview
- https://www.mercadopago.com.co/developers/es/docs/subscriptions/subscription-management
- https://www.mercadopago.com.co/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/authorized-payments

## Experiencia del cliente

1. El cliente crea su cuenta en Ventas IA con Google.
2. La plataforma ejecuta un diagnostico inicial gratis: Google disponible, ruta WhatsApp, datos minimos y viabilidad.
3. La plataforma muestra el plan mensual disponible.
4. El cliente inicia la suscripcion.
5. Ventas IA crea o reutiliza la suscripcion en Mercado Pago.
6. El cliente es redirigido a Mercado Pago.
7. El cliente completa el primer pago en Mercado Pago.
8. Mercado Pago redirige al cliente a la microapp.
9. La microapp muestra estado de validacion.
10. El backend confirma el pago mediante webhook y consulta de estado.
11. Si la suscripcion queda activa, se habilita la configuracion completa: Google OAuth operativo, aprovisionamiento, WhatsApp y prueba guiada.

## Experiencia del administrador

El Centro de control debe permitir:

- Habilitar o deshabilitar periodo de prueba para nuevos clientes.
- Definir duracion del periodo de prueba cuando este habilitado.
- Definir dias de gracia por cobro fallido. Valor inicial: 5 dias.
- Crear, editar, activar y desactivar planes comerciales.
- Definir cual plan queda disponible para nuevos clientes.
- Cambiar el plan de una tienda respetando reglas de upgrade/downgrade.
- Ver clientes con suscripcion activa, pendiente, vencida, pausada o cancelada.
- Ver fecha del ultimo pago.
- Ver proxima fecha de cobro.
- Ver plan contratado.
- Ver estado de webhooks de Mercado Pago.
- Sincronizar manualmente el estado con Mercado Pago.
- Reenviar link de suscripcion o recuperacion cuando aplique.
- Pausar, cancelar o reactivar una suscripcion si el modelo operativo lo permite.
- Auditar cambios manuales sobre estados de pago.

## Estados internos recomendados

| Estado interno | Significado | Efecto en plataforma |
| --- | --- | --- |
| `pending_payment` | Suscripcion creada, primer pago no confirmado | No habilita operacion |
| `trial` | Periodo de prueba activo, si administracion lo habilita | Habilita onboarding/operacion limitada segun politica |
| `active` | Suscripcion vigente | Habilita onboarding/operacion |
| `past_due` | Cobro rechazado o pendiente de reintento | Mantiene acceso limitado segun periodo de gracia |
| `grace_period` | Ventana definida por la plataforma antes de suspender. Valor inicial: 5 dias | Opera normal con avisos progresivos |
| `paused` | Suscripcion pausada | Bloquea agente y operaciones nuevas |
| `suspended` | Acceso suspendido por falta de pago o decision admin | Bloquea agente; permite acceso restringido a facturacion, configuracion basica y reactivacion |
| `cancelled` | Suscripcion cancelada | Bloquea renovacion automatica y operacion al final del periodo; permite solo lectura por 30 dias |

## Regla de activacion

La URL de retorno de Mercado Pago nunca debe activar un tenant por si sola.

La activacion requiere:

1. Evento recibido de Mercado Pago.
2. Firma o validacion configurada segun el mecanismo disponible.
3. Consulta al objeto real de Mercado Pago.
4. Persistencia del estado en PostgreSQL.
5. Auditoria del cambio de estado.

## Politica de gracia por cobro fallido

Valor inicial: 5 dias, parametrizable desde administracion.

Comportamiento:

- Dia 1 a 3: la tienda opera normal y se muestran avisos suaves al owner.
- Dia 4 a 5: la tienda opera normal y se muestran avisos fuertes al owner.
- Dia 6: la plataforma suspende automaticamente la operacion si el pago sigue sin confirmarse.

Durante la gracia no se debe ocultar el problema al administrador ni al owner de la tienda. El agente puede seguir respondiendo, pero el Centro de control debe marcar el cliente como riesgo de pago.

## Politica de cancelacion

La cancelacion sera autoservicio desde la microapp para usuarios owner.

Flujo recomendado:

1. El owner entra a Facturacion.
2. La plataforma muestra el estado de la suscripcion, proxima fecha de cobro y plan actual.
3. El owner selecciona cancelar.
4. La plataforma explica que se perdera al finalizar el periodo: agente activo, automatizacion WhatsApp, acceso operativo y nuevas respuestas.
5. La plataforma ofrece alternativa de pausa o contacto con soporte, si esta disponible.
6. Si el owner confirma, el backend cancela la suscripcion en Mercado Pago.
7. La tienda mantiene acceso hasta el final del periodo ya pagado.
8. Al terminar el periodo, el estado pasa a `cancelled` o `suspended`, segun politica final de acceso historico.

La cancelacion debe generar auditoria y quedar visible para el administrador.

## Politica de planes

La primera version tendra un solo plan activo para simplificar el piloto.

Reglas:

- La plataforma debe soportar varios planes en la configuracion interna.
- El administrador puede activar o desactivar planes.
- Solo los planes activos deben aparecer para nuevos clientes.
- Un plan inactivo no debe afectar suscripciones existentes sin una migracion explicita.
- Cada plan debe tener nombre, precio, periodicidad, limites, moneda, estado y referencia de Mercado Pago.
- El plan inicial recomendado sigue siendo el plan mensual base de 1.000 domicilios.

Esta decision evita rehacer arquitectura cuando se agreguen planes futuros, pero mantiene simple la venta inicial.

## Politica de cambio de plan

Reglas aprobadas:

- Modelo de permisos: mixto.
- El owner puede hacer upgrade autoservicio desde la microapp.
- El owner puede solicitar/confirmar downgrade con confirmacion fuerte.
- El administrador puede ejecutar upgrades y downgrades con auditoria.
- Downgrade: aplica al siguiente ciclo de facturacion.
- Upgrade: aplica de inmediato.
- No existen devoluciones por cambios de plan.
- Todo cambio debe quedar auditado.
- El cliente debe ver claramente desde cuando aplica el nuevo plan.
- Si Mercado Pago requiere modificar suscripcion o crear una nueva segun el tipo de plan, el backend debe conservar la trazabilidad entre el tenant, el plan interno y la referencia externa.

Para el piloto, aunque solo exista un plan activo, la arquitectura debe quedar lista para aplicar estas reglas cuando se habiliten planes adicionales.

## Politica de acceso, historial y retencion

Reglas aprobadas:

- Suspendido por pago o decision administrativa:
  - El agente no responde WhatsApp.
  - No se procesan nuevos pedidos automaticos.
  - El owner puede entrar a facturacion, configuracion basica y reactivacion.
  - El Centro de control debe mostrar el motivo de suspension.

- Cancelado voluntariamente:
  - La tienda conserva acceso de solo lectura durante 30 dias despues del fin del periodo pagado.
  - No se ejecutan nuevas automatizaciones.
  - El owner puede consultar historial, estado de cuenta y opciones de reactivacion.

- Despues de 30 dias cancelado:
  - Se desactiva el acceso operativo del cliente.
  - El administrador conserva auditoria minima para soporte, conciliacion y cumplimiento.

- Google Drive/Sheets del cliente:
  - No se eliminan automaticamente.
  - Son recursos del cliente y permanecen en su cuenta Google.
  - La plataforma puede dejar de sincronizar o usar esos recursos si la suscripcion no esta activa.

Esta politica evita perdida abrupta de informacion, facilita reactivaciones y reduce riesgos de soporte.

## Politica de reactivacion

Reglas aprobadas:

- Tenant suspendido por pago:
  - La reactivacion ocurre automaticamente cuando se confirma el pago.
  - El backend debe sincronizar Mercado Pago, registrar auditoria y desbloquear operacion.

- Tenant cancelado dentro de los primeros 30 dias:
  - Puede reactivarse por autoservicio.
  - Conserva configuracion, historial, referencias Google y referencias WhatsApp.
  - Antes de operar, se ejecuta una validacion rapida de suscripcion, Google, WhatsApp, catalogo y cuota.

- Tenant cancelado despues de 30 dias:
  - Puede reactivarse por autoservicio.
  - Debe ejecutar validacion completa antes de operar.
  - La plataforma debe confirmar que Google, WhatsApp, catalogo, configuracion y permisos siguen vigentes.

- Administrador:
  - Puede apoyar o forzar reactivacion solo con auditoria.
  - No debe omitir validaciones criticas de seguridad, pago, Google y WhatsApp.

La reactivacion no debe crear un tenant nuevo si el comercio ya existe. Debe reutilizar el tenant y mantener trazabilidad historica.

## Politica de notificaciones de facturacion

Canales aprobados:

- Microapp: obligatorio.
- WhatsApp al owner: habilitado/configurable.
- Centro de control administrador: obligatorio.
- Email: excluido en la primera version.

Eventos minimos a notificar:

- Suscripcion creada.
- Primer pago pendiente.
- Pago confirmado.
- Proximo cobro.
- Cobro fallido.
- Inicio de periodo de gracia.
- Aviso fuerte antes de suspension.
- Suspension.
- Reactivacion.
- Cancelacion solicitada.
- Cancelacion efectiva al final del periodo.
- Cambio de plan.

Reglas:

- Las notificaciones dentro de la microapp deben ser visibles para el owner.
- Las alertas del Centro de control deben permitir filtrar clientes en riesgo de pago.
- WhatsApp al owner debe poder activarse o desactivarse por configuracion.
- No se debe usar email como canal de facturacion en la primera version.

## Politica de fecha de cobro

Regla aprobada:

- El cobro mensual se realizara por aniversario de suscripcion.
- La fecha base sera la fecha de activacion/suscripcion confirmada del cliente.
- No habra fecha fija global de corte en la primera version.
- Esto evita prorrateos iniciales y hace mas clara la promesa comercial.

Ejemplo:

- Cliente A se suscribe el 12 de noviembre: se cobra cada dia 12.
- Cliente B se suscribe el 28 de noviembre: se cobra cada dia 28.

Si mas adelante se requiere facturacion por corte fijo, debe manejarse como una mejora de administracion y no como regla inicial.

## Politica de ciclo de consumo

Regla aprobada:

- Los limites del plan se reinician con el ciclo de facturacion del cliente.
- El ciclo de consumo no usa mes calendario.
- Si el cliente se suscribe el dia 12, su consumo corre del dia 12 al dia 11 del siguiente mes.
- Domicilios, interacciones, tokens, herramientas y alertas de consumo deben medirse contra ese ciclo.

Ejemplo:

- Plan: 1.000 domicilios incluidos.
- Cliente activado el 12 de noviembre.
- Ciclo activo: 12 de noviembre al 11 de diciembre.
- El 12 de diciembre se reinicia el contador.

Esto evita confusiones comerciales y alinea pago, cuota y suspension.

## Politica de limite de consumo

Reglas aprobadas:

- Plan inicial:
  - 1.000 domicilios incluidos por ciclo.
  - 5.000 interacciones del agente incluidas por ciclo.
- La plataforma debe avisar al 80%, 90% y 100% de uso del limite.
- Al 100% del limite de domicilios:
  - Se bloquean nuevos domicilios confirmados por el agente.
  - Se mantienen conversaciones basicas y consultas que no creen nuevos domicilios.
  - Se muestra al owner una opcion de upgrade inmediato.
  - El administrador puede otorgar una excepcion temporal auditada.
- Al 100% del limite de interacciones:
  - Se considera limite de uso justo.
  - La plataforma debe mostrar aviso fuerte al owner y al administrador.
  - El sistema puede reducir automatizaciones no criticas o exigir upgrade segun configuracion del plan.
  - No debe generar devoluciones ni extender automaticamente el ciclo.
- No habra cobro automatico de excedentes en la primera version.
- Para continuar por encima del limite, el cliente debe hacer upgrade o recibir una excepcion administrativa auditada.
- El bloqueo no debe borrar historial ni cerrar conversaciones existentes.
- El Centro de control debe marcar el cliente como limite alcanzado.

Esta regla protege el limite comercial sin cortar abruptamente la relacion con los compradores finales de la tienda.

## Politica de descuentos

Reglas aprobadas:

- Los descuentos seran manuales desde administracion.
- No habra cupones publicos en la primera version.
- Cada descuento debe tener:
  - Cliente/tenant asociado.
  - Porcentaje o valor.
  - Fecha de inicio.
  - Fecha de vencimiento.
  - Motivo comercial.
  - Usuario administrador que lo aprobo.
  - Auditoria.
- El descuento debe mostrarse claramente al administrador y al owner en la vista de facturacion.
- Al vencer el descuento, la suscripcion debe volver al precio normal del plan.
- Si Mercado Pago no permite ajustar dinamicamente el descuento como se necesita, la plataforma debe conservar el descuento interno y sincronizarlo con el modelo de cobro que se defina para el plan.

Casos esperados:

- Cliente piloto con 20% por 3 meses.
- Primer mes con descuento comercial.
- Cliente estrategico con precio especial temporal.

## Politica de comprobantes e historial de pago

Alcance aprobado para primera version:

- El owner puede ver historial de pagos desde la microapp.
- El administrador puede ver historial de pagos por cliente desde el Centro de control.
- Cada registro debe mostrar:
  - Estado del pago.
  - Fecha.
  - Valor.
  - Moneda.
  - Plan.
  - ID externo de Mercado Pago.
  - Suscripcion asociada.
  - Link o referencia al comprobante de Mercado Pago cuando este disponible.
- No se promete factura fiscal propia en la primera version.
- Si mas adelante se requiere facturacion fiscal, debe tratarse como modulo aparte.

Esta politica reduce soporte sin asumir obligaciones contables no definidas.

## Politica de comisiones Mercado Pago

Regla aprobada:

- El cliente ve un precio final unico.
- No se muestra una comision separada de Mercado Pago.
- La plataforma calcula precio, margen y rentabilidad considerando las comisiones del proveedor de pago.
- Si las comisiones cambian, el ajuste se maneja en el modelo comercial o en futuros planes, no como recargo visible automatico.

Esta decision simplifica la venta y evita friccion en checkout.

## Politica de sincronizacion manual

Regla aprobada:

- El Centro de control debe incluir una accion "Sincronizar Mercado Pago" por cliente.
- Solo usuarios administradores de la plataforma pueden ejecutarla.
- La accion consulta Mercado Pago y actualiza el estado local si corresponde.
- Toda sincronizacion debe guardar auditoria:
  - Usuario que la ejecuto.
  - Tenant afectado.
  - Estado anterior.
  - Estado consultado en Mercado Pago.
  - Estado final local.
  - Fecha y resultado.
- Debe existir control de uso o rate limit para evitar abuso.
- La accion no debe permitir marcar manualmente un pago como aprobado sin evidencia del proveedor.

Caso de uso principal: cliente reporta que ya pago, pero la plataforma aun aparece pendiente o suspendida.

## Politica de excepciones manuales de acceso

Regla aprobada:

- Solo administradores de la plataforma pueden crear excepciones.
- La excepcion es temporal.
- La excepcion debe tener fecha de vencimiento obligatoria.
- La excepcion debe tener motivo obligatorio.
- La excepcion debe quedar auditada.
- La excepcion debe aparecer claramente en Centro de control.
- No modifica el estado real de Mercado Pago.
- No debe marcar pagos como aprobados.
- Al vencer, la plataforma vuelve a aplicar el estado real de suscripcion.

Casos esperados:

- Error temporal de Mercado Pago.
- Cliente estrategico en piloto.
- Pago en revision.
- Acuerdo comercial aprobado.

La excepcion permite operar sin romper la trazabilidad financiera.

## Politica de reconciliacion automatica

Regla aprobada:

- La plataforma debe ejecutar reconciliacion diaria contra Mercado Pago.
- Para estados sensibles como `pending_payment`, `past_due`, `grace_period` y `suspended`, puede ejecutar reintentos mas frecuentes.
- La reconciliacion debe consultar el estado real del proveedor.
- Si detecta pago confirmado, debe actualizar estado local, registrar auditoria y reactivar si corresponde.
- Si detecta cancelacion, pausa o falta de pago, debe aplicar la politica local correspondiente.
- Cada ejecucion debe registrar resultado y errores en observabilidad.
- La reconciliacion no reemplaza los webhooks; los complementa.
- La reconciliacion no reemplaza la sincronizacion manual; reduce su necesidad.

Frecuencia inicial recomendada:

- Job diario para todas las suscripciones.
- Job cada 2 a 4 horas para suscripciones pendientes, vencidas o en gracia.

## Politica de onboarding y momento de cobro

Regla aprobada:

- Antes del pago:
  - Crear cuenta con Google.
  - Capturar nombre comercial y ciudad.
  - Ejecutar diagnostico inicial gratis.
  - Validar ruta de Google, WhatsApp y datos minimos.
  - Explicar requisitos y alcance.
  - Mostrar plan y precio.

- Despues de suscripcion activa:
  - Ejecutar OAuth Google operativo.
  - Aprovisionar Drive/Sheets.
  - Configurar WhatsApp.
  - Ejecutar prueba guiada.
  - Activar agente.

El diagnostico previo debe ser liviano. La configuracion pesada y la operacion real requieren suscripcion activa o excepcion administrativa.

## Diagnostico inicial de Google

Antes del pago:

- Usar Google Sign-In para identificar al usuario.
- Crear o recuperar usuario y tenant preliminar.
- Confirmar correo, nombre y dominio si aplica.
- No pedir permisos Drive/Sheets.
- No crear carpetas ni hojas.
- No guardar refresh tokens de Google operativo.

Despues de suscripcion activa:

- Ejecutar OAuth Drive/Sheets.
- Solicitar scopes operativos minimos.
- Guardar refresh token cifrado como referencia.
- Crear o recuperar estructura Drive/Sheets.
- Validar `Catalogo`, `Clientes`, `Pedidos` y `Configuracion`.

Esta separacion evita pedir permisos sensibles antes de que el cliente pague y mantiene claro el consentimiento.

## Datos del comercio por etapa

Antes del pago:

- Nombre comercial de la tienda.
- Ciudad.

Despues de suscripcion activa:

- Direccion.
- Horarios.
- Zonas de domicilio.
- Medios de pago aceptados.
- Reglas del agente.
- Politicas de escalamiento humano.
- Catalogo.
- Datos de WhatsApp.
- Datos operativos en Google Sheets.

La captura previa al pago debe ser corta. Su objetivo es personalizar el diagnostico y el checkout, no completar toda la operacion.

## Politica de checkout

Regla aprobada:

- Primera version: checkout por redireccion externa a Mercado Pago.
- La microapp debe mostrar claramente que el usuario sera enviado a Mercado Pago.
- Al volver, la microapp debe mostrar "validando pago" hasta confirmar webhook/sync.
- La redireccion de retorno no activa por si sola el tenant.
- Checkout embebido queda como mejora futura, no como requisito del piloto.

Esta decision reduce riesgo tecnico y usa el flujo mas estable para suscripciones.

## Politica de checkout abandonado

Regla aprobada:

- Si el cliente inicia checkout y no paga, el tenant queda en `pending_payment`.
- La microapp debe mostrar "Pago pendiente".
- La microapp debe ofrecer accion "Continuar pago".
- El Centro de control debe mostrar el cliente como prospecto pendiente.
- El intento se mantiene recuperable durante 7 dias.
- Despues de 7 dias:
  - Se marca como expirado, o
  - Se regenera un nuevo checkout si el cliente intenta continuar.
- No se habilita configuracion completa ni agente mientras no exista suscripcion activa o excepcion administrativa.

Esto permite recuperar ventas sin activar operacion antes del pago.

## Politica de embudo de conversion

Regla aprobada:

El administrador debe poder ver un embudo basico de conversion del onboarding comercial.

Etapas minimas:

1. Cuenta creada.
2. Diagnostico iniciado.
3. Diagnostico completado.
4. Checkout iniciado.
5. Pago confirmado.
6. Google conectado.
7. WhatsApp diagnosticado/configurado.
8. Tienda activada.

El embudo debe permitir:

- Ver totales por etapa.
- Identificar clientes/prospectos atascados.
- Filtrar por fecha.
- Ver abandono de checkout.
- Ver activaciones incompletas despues de pago.
- Abrir el detalle del cliente desde la etapa.

El objetivo es responder: cuantos llegan, donde se caen y a quienes hay que contactar.

## Politica de motivos de abandono o bloqueo

Regla aprobada:

- El sistema debe registrar motivos de abandono o bloqueo durante onboarding y facturacion.
- Los motivos pueden ser automaticos o manuales.
- El administrador puede agregar una nota opcional.

Motivos automaticos sugeridos:

- Pago no completado.
- Pago rechazado.
- Checkout abandonado.
- No tiene WhatsApp Business.
- No sabe que tipo de WhatsApp tiene.
- No quiere conectar Google.
- Google OAuth fallido.
- Aprovisionamiento Google fallido.
- Catalogo incompleto.
- WhatsApp pendiente.
- Precio objetado.
- Esperando decision del dueno.

Uso esperado:

- Ver motivos agregados en el embudo.
- Filtrar prospectos por motivo.
- Priorizar acciones comerciales o de soporte.
- Identificar fricciones repetidas del producto.

La nota manual del administrador debe quedar auditada si afecta decisiones comerciales o de acceso.

## Diagnostico inicial de WhatsApp

Antes del pago, la plataforma solo debe clasificar la situacion del cliente:

- Ya tiene WhatsApp Business Cloud API.
- Tiene WhatsApp Business App.
- Solo tiene WhatsApp normal.
- No sabe que tiene.

Preguntas sugeridas:

- Tienes un numero exclusivo para la tienda?
- Usas WhatsApp Business App?
- Ya tienes cuenta Meta Business o Cloud API?
- Quieres conservar el numero actual o usar uno nuevo?

Resultado esperado:

- Ruta A: conectar Cloud API existente.
- Ruta B: guiar desde WhatsApp Business App.
- Ruta C: empezar desde cero.
- Ruta D: necesita guia asistida.

Restricciones:

- No pedir tokens antes del pago.
- No configurar webhooks antes del pago.
- No prometer activacion inmediata si el cliente no tiene requisitos Meta/WhatsApp listos.
- Mostrar con claridad que WhatsApp Business y costos Meta son responsabilidad del cliente.


## Riesgos y controles

| Riesgo | Control |
| --- | --- |
| Usuario vuelve por `back_url` sin pago real | Mostrar "validando pago" y esperar webhook/sync |
| Webhook repetido | Idempotencia por evento y objeto externo |
| Cobro rechazado | Usar estados `past_due` y `grace_period` antes de suspender |
| Mercado Pago no entrega evento esperado | Job de sincronizacion periodica por suscripcion |
| Cambio manual del admin sin trazabilidad | Registrar auditoria obligatoria |
| Confusion con pagos de domicilios | Copy claro: la suscripcion cubre uso de plataforma; WhatsApp y pagos de tienda son externos |

## Pendientes de definicion

- Duracion del periodo de prueba cuando el administrador lo habilite.
- Politica de suspension: inmediata, despues de reintentos de Mercado Pago o despues del periodo de gracia propio.

## Decision operativa para piloto

Iniciar con un plan mensual automatico y un unico plan comercial base.

El periodo de prueba queda desactivado por defecto. La administracion podra habilitarlo mas adelante sin cambiar la arquitectura.

El periodo de gracia inicial por cobro fallido sera de 5 dias y debera poder modificarse desde administracion.

Durante la gracia, el agente opera normalmente con avisos progresivos. Al dia siguiente del vencimiento de la gracia, se suspende automaticamente si no hay pago confirmado.

La cancelacion sera autoservicio desde la microapp, con confirmacion y acceso hasta el final del periodo ya pagado.

La primera version comercial tendra un solo plan activo. El administrador podra crear varios planes y activar o desactivar su disponibilidad.

Los downgrades aplicaran al siguiente ciclo de facturacion; los upgrades aplicaran de inmediato. No habra devoluciones.

El owner podra hacer upgrades autoservicio. Los downgrades requeriran confirmacion fuerte y aplicaran al siguiente ciclo. El administrador podra hacer ambos cambios con auditoria.

Los tenants suspendidos conservan acceso restringido para facturacion, configuracion basica y reactivacion. Los tenants cancelados conservan solo lectura por 30 dias. No se eliminan automaticamente recursos del Google Drive del cliente.

La reactivacion sera autoservicio: suspendidos por pago se reactivan al confirmar pago; cancelados dentro de 30 dias conservan configuracion con validacion rapida; cancelados despues de 30 dias requieren validacion completa.

Las notificaciones de facturacion se haran por microapp, WhatsApp configurable al owner y Centro de control administrador. Email queda fuera de la primera version.

El cobro mensual se hara por aniversario de suscripcion de cada cliente, no por una fecha fija global.

Los limites del plan se reiniciaran con ese mismo ciclo de facturacion por aniversario.

Al alcanzar el 100% del limite de domicilios, se bloquean nuevos domicilios confirmados, pero se mantienen conversaciones basicas. El owner puede hacer upgrade inmediato y el administrador puede dar excepcion temporal auditada.

El plan inicial tendra 1.000 domicilios y 5.000 interacciones por ciclo. Las interacciones operan como uso justo para controlar costos.

No habra excedentes pagados automaticos en la primera version. Al superar limites, se ofrece upgrade o excepcion administrativa auditada.

Se permitiran descuentos manuales por cliente desde administracion, con vencimiento, motivo y auditoria. No habra cupones publicos inicialmente.

El owner podra ver historial de pagos y referencia/comprobante de Mercado Pago cuando este disponible. Factura fiscal propia queda fuera del alcance inicial.

El precio mostrado al cliente sera final y unico. Las comisiones de Mercado Pago quedan incluidas en el modelo comercial de la plataforma.

El administrador podra sincronizar manualmente el estado de Mercado Pago por cliente desde Centro de control, siempre con auditoria.

El administrador podra crear excepciones temporales de acceso con motivo, vencimiento y auditoria. La excepcion no cambia el estado real de Mercado Pago.

La plataforma ejecutara reconciliacion automatica diaria con Mercado Pago y reintentos mas frecuentes para estados pendientes, vencidos o en gracia.

El onboarding tendra diagnostico inicial gratis antes del pago y configuracion completa solo despues de suscripcion activa.

Antes del pago, WhatsApp solo se diagnostica y clasifica por ruta. La conexion real ocurre despues de suscripcion activa.

Antes del pago, Google solo se usa para identidad. OAuth Drive/Sheets y aprovisionamiento ocurren despues de suscripcion activa.

Antes del pago se captura nombre comercial y ciudad. Datos operativos completos se solicitan despues de suscripcion activa.

El checkout sera por redireccion externa a Mercado Pago en la primera version. El checkout embebido queda como mejora futura.

Si el checkout se abandona, queda en `pending_payment` con recuperacion por 7 dias y boton para continuar pago.

El Centro de control tendra embudo basico desde cuenta creada hasta tienda activada.

El onboarding guardara motivos automaticos de abandono/bloqueo y permitira nota manual opcional del administrador.

Mantener un fallback administrativo: reenviar link, sincronizar estado manualmente y marcar excepciones auditadas durante el piloto.
