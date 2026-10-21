# Brief comercial - Micro app Ventas IA

Actualizado: 2026-10-13.

## Resumen ejecutivo

**Ventas IA** es una micro app SaaS para tiendas, minimercados y comercios que venden por WhatsApp y atienden pedidos a domicilio. La plataforma conecta un agente comercial con WhatsApp, Google Drive/Sheets, control humano, facturacion por suscripcion y un tablero visual de operacion.

Su propuesta central es simple: **ayudar a una tienda a responder mejor por WhatsApp, consultar su catalogo, armar pedidos, pedir datos faltantes, registrar clientes/pedidos y escalar al tendero cuando la decision requiere criterio humano**.

La experiencia no se plantea como un chatbot aislado, sino como una operacion completa:

`WhatsApp -> Agente IA -> Catalogo Google Sheets -> Respuesta al cliente -> Pedido -> Handoff humano -> Preparacion y entrega`

## Problema que resuelve

Muchas tiendas venden por WhatsApp de forma manual. Eso genera:

- Respuestas lentas cuando hay muchos mensajes.
- Pedidos incompletos porque faltan cantidades, direccion o presentacion.
- Dificultad para consultar stock, precios o catalogo rapidamente.
- Perdida de trazabilidad sobre que pidio el cliente, que se confirmo y quien debe preparar.
- Dependencia total del tendero para mensajes repetitivos.
- Cero visibilidad historica sobre conversaciones, errores, uso, pagos y actividad.

Ventas IA busca reducir esa carga operativa sin quitar al humano del proceso cuando su criterio es necesario.

## Propuesta de valor

La micro app convierte WhatsApp en una operacion comercial asistida por IA:

- Atiende conversaciones con lenguaje natural.
- Entiende modismos colombianos y escritura informal.
- Consulta catalogo, stock y clientes en Google Sheets.
- Arma canastas de pedido y detecta faltantes.
- Pide nombre y direccion cuando el cliente es nuevo.
- No inventa disponibilidad: consulta herramientas antes de afirmar.
- Escala a humano cuando hay ambiguedad, producto no encontrado, imagen, reclamo, pago o pedido listo para preparar.
- Registra pedidos confirmados para que el tendero los aliste y entregue.
- Permite al administrador controlar clientes, pagos, uso y errores desde un centro de control.

## Cliente ideal

### Primer mercado recomendado

- Tiendas de barrio.
- Minimercados.
- Supermercados de barrio.
- Licoreras y tiendas mixtas.
- Panaderias o comercios con pedidos por WhatsApp.
- Comercios pequenos que ya usan Google Sheets o pueden adoptarlo facilmente.

### Perfil operativo

- Reciben pedidos por WhatsApp.
- Manejan catalogo y precios cambiantes.
- Necesitan al tendero para preparar y entregar.
- No tienen equipo tecnico.
- Buscan una solucion guiada, autoservicio y de bajo costo operativo.

## Como funciona

### 1. Suscripcion

El cliente se suscribe mensualmente a la plataforma mediante Mercado Pago. El valor cubre el uso de la micro app, el agente, los tableros y la operacion SaaS.

Importante: el costo de WhatsApp Business/Meta Cloud API lo paga cada cliente directamente a Meta o al proveedor correspondiente.

### 2. Autenticacion

El cliente entra con Google. La plataforma usa autenticacion con sesion segura, roles y aislamiento por tienda.

### 3. Conexion Google

Desde el onboarding, el usuario autoriza Drive y Sheets. Luego la plataforma crea o configura la estructura operativa del cliente en su propio entorno Google:

- Carpeta de la tienda.
- Google Sheet operativo.
- Pestaña de `Catalogo`.
- Pestaña de `Clientes`.
- Pestaña de `Pedidos`.
- Pestaña de `Configuracion`.

La tienda mantiene sus datos en su Google. La plataforma guarda referencias y permisos, no reemplaza el control del cliente sobre su informacion.

### 4. Configuracion WhatsApp

El onboarding guia tres rutas:

- El cliente ya tiene WhatsApp Cloud API.
- El cliente usa WhatsApp Business App y necesita guia.
- El cliente empieza desde cero.

Cuando hay credenciales Meta y URL publica, la plataforma puede recibir webhooks, enrutar mensajes por `phoneNumberId` y enviar respuestas por WhatsApp.

### 5. Agente comercial

El agente recibe mensajes, identifica al cliente por el numero de WhatsApp, consulta su perfil en Google Sheets y usa DeepSeek como motor IA global de la plataforma.

El razonamiento esperado no es deterministico por reglas fijas. El agente trabaja como un tendero:

- Interpreta intencion.
- Formula hipotesis de productos.
- Busca similares en catalogo.
- Pregunta si falta cantidad, presentacion o direccion.
- Responde disponibilidad parcial.
- Escala a humano si no puede inferir con seguridad.

### 6. Handoff humano

Cuando el agente necesita apoyo, crea una solicitud humana. El tendero puede:

- Ver el contexto.
- Abrir la conversacion.
- Responder desde la plataforma.
- Responder por WhatsApp cuando aplique.
- Marcar un pedido como tomado/preparado.
- Rechazar o resolver solicitudes.

Cuando el cliente confirma un pedido, el sistema lo registra y lo sube a humano para preparacion y entrega.

### 7. Operacion visual

La app incluye una pantalla llamada **Tienda viva**, una representacion visual tipo gemelo digital gamificado donde las conversaciones, zonas y casos criticos se muestran como actividad operativa.

El objetivo es que el usuario pueda entender rapidamente:

- Que conversaciones estan activas.
- Que pedidos avanzan.
- Donde hay bloqueos.
- Que casos requieren apoyo humano.
- Que procesos estan agrupados por zona.

## Modulos principales

### Resumen operativo

Vista rapida de la tienda: conversaciones activas, aprobaciones pendientes, conexiones, primera respuesta y uso del plan.

### Tienda viva

Mapa operativo con zonas, personajes, alertas, niveles de detalle, foco por zona, casos relacionados y acceso a conversaciones.

### Conversaciones

Bandeja de conversaciones supervisables con vista de listado y detalle. Permite revisar el historial, abrir WhatsApp y resolver casos asociados.

### Aprobaciones

Bandeja de decisiones humanas: productos ambiguos, imagenes, pagos, reclamos, descuentos, pedidos listos para preparar y casos bloqueados.

### Onboarding

Activacion guiada paso a paso: pago, Google, aprovisionamiento Drive/Sheets, WhatsApp y prueba operativa.

### Configuracion

Parametros por tienda: Google, WhatsApp, politica del agente, horarios, rangos de Sheets y conexiones operativas.

### Centro de control

Consola para administrador de la plataforma. Permite revisar clientes, pagos, consumo, Motor IA, errores, estado de Google/WhatsApp, planes y excepciones.

### Observabilidad

Vista tecnica separada para investigar eventos de conexion, webhooks, errores, latencias, duplicados y fallas por tienda/proveedor.

## Ventajas competitivas

### 1. Pensada para tiendas reales, no solo para demos

El agente fue probado con escenarios colombianos: pedidos claros, productos mal escritos, clientes nuevos, categorias, recomendaciones, correcciones, pago tardio, imagenes, reclamos y conversaciones por rafagas.

### 2. DeepSeek centralizado

El LLM es administrado por la plataforma. Los clientes no tienen que configurar su propio modelo. El consumo se mide por tienda para control comercial y operativo.

### 3. Google del cliente como fuente operativa

Cada cliente conserva su informacion en su propio Google Drive/Sheets. Esto reduce friccion, facilita adopcion y evita obligar a la tienda a usar un ERP complejo desde el primer dia.

### 4. Multi-tenant desde el diseno

La arquitectura separa clientes, configuraciones, Google, WhatsApp, suscripciones, uso y eventos por tenant.

### 5. Humano en el loop

La plataforma no pretende automatizar decisiones sensibles sin control. Los casos inciertos o finales operativos suben al tendero.

### 6. Observabilidad y auditoria

Cada conversacion puede dejar trazabilidad: mensaje recibido, plan del motor IA, herramientas usadas, respuesta, evento, pedido y handoff humano.

### 7. SaaS con cobro recurrente

El modelo contempla suscripcion mensual, planes administrables, periodo de prueba configurable, gracia, cancelacion, reactivacion, descuentos, excepciones y conciliacion con Mercado Pago.

### 8. Experiencia premium

La interfaz separa negocio, operacion y tecnica:

- Tienda viva para operacion diaria.
- Centro de control para administrar clientes.
- Observabilidad para investigar fallas.
- Onboarding guiado para activar sin soporte tecnico pesado.

## Alcance funcional actual del repo

### Implementado localmente

- Backend Node/Express.
- Frontend React/Vite.
- Persistencia JSON local y adaptador PostgreSQL.
- Autenticacion Google contract-first con roles y CSRF.
- Control multi-tenant.
- Motor IA global con DeepSeek, simulacion Codex y fallback estructurado.
- Planner con contrato `ventas-ia-llm-plan.v2`.
- Herramientas Google Sheets/Drive.
- Lectura de catalogo, clientes y pedidos.
- Escritura de clientes y pedidos.
- Handoff humano.
- Envio WhatsApp outbound por contrato Graph API.
- Webhook WhatsApp con resolucion por numero.
- Mercado Pago contract-first para suscripciones.
- Centro de control admin.
- Observabilidad de webhooks/eventos.
- Onboarding premium.
- Tienda viva gamificada con LOD, foco por zona, agrupacion y experiencia movil.
- Matriz de 50 escenarios conversacionales colombianos.
- Pruebas backend, Google live contract, WhatsApp contract, DeepSeek provider y escenarios Colombia.

### Validado localmente

- `npm run test:backend`.
- Escenarios Colombia: 57 pasos / 50 escenarios.
- Contratos LLM provider.
- Auth smoke.
- Google live contract.
- WhatsApp live contract.
- Build frontend.
- Google OAuth/Sheets live en entorno local para tenant piloto.
- Agente + Google Sheets live sin publicar, con simulacion controlada de DeepSeek.

### Requiere publicacion/credenciales reales para piloto publico

- URL HTTPS publica.
- Redirect URI publico de Google OAuth.
- Webhook WhatsApp real verificado por Meta.
- Envio WhatsApp live con numero productivo.
- Webhook Mercado Pago real con firma.
- Prueba end-to-end publica: pago, Google, WhatsApp, agente, pedido y handoff humano.
- Secret manager administrado.
- Alertas productivas y politica de retencion.

## Modelo comercial sugerido

### Modalidad

Suscripcion mensual SaaS.

### Plan inicial

Un plan activo inicial, con capacidad de configurar varios planes desde administracion.

### Limites base definidos

- Hasta 400 domicilios por ciclo como promesa comercial del Plan Basico.
- Aproximadamente 2.700 llamadas reales al agente IA como referencia del costo interno objetivo de US$3.
- Hasta 5.000 interacciones tecnicas solo como limite superior de proteccion, no como equivalencia comercial de 400 domicilios.

### Facturacion

- Mercado Pago para suscripcion automatica mensual.
- Fecha de cobro por aniversario de suscripcion.
- Periodo de prueba configurable, apagado por defecto.
- Periodo de gracia parametrizable, inicialmente 5 dias.
- Sin devoluciones por downgrade.
- Upgrade inmediato.
- Downgrade al siguiente ciclo.

### Costos externos

El cliente paga aparte su WhatsApp Business/Meta. La plataforma cobra por el uso de Ventas IA.

## Mensaje comercial corto

Ventas IA ayuda a tiendas de barrio y comercios con domicilio a atender WhatsApp con un agente inteligente conectado a su catalogo en Google Sheets. El agente entiende pedidos en lenguaje natural, consulta productos, pide datos faltantes, arma canastas, registra clientes y pedidos, y escala al tendero cuando necesita criterio humano. Todo se administra desde una micro app con onboarding guiado, tablero operativo, tienda viva, conversaciones supervisables, aprobaciones humanas, control de pagos y observabilidad.

## Pitch de 30 segundos

Ventas IA es una micro app SaaS para tiendas que venden por WhatsApp. Conecta un agente IA con el Google Sheets del negocio para responder consultas, validar catalogo, armar pedidos, pedir direccion, registrar clientes y subir al tendero los casos que requieren preparacion o decision humana. El cliente se suscribe por Mercado Pago, conecta Google y WhatsApp en un onboarding guiado, y opera desde una interfaz visual tipo tienda viva con control de conversaciones, aprobaciones y salud del negocio.

## Pitch de 2 minutos

Hoy muchas tiendas venden por WhatsApp, pero todo depende de que alguien lea, recuerde precios, confirme stock, pida direccion, arme el pedido y lo entregue. Ventas IA automatiza esa primera capa comercial sin sacar al tendero del proceso.

El cliente escribe por WhatsApp como lo haria normalmente: "Buenas, para un domicilio, me regalas 3 chocorramos y una gaseosa". El agente identifica el numero, busca si el cliente existe en Google Sheets, interpreta el pedido, consulta catalogo, valida cantidades y presentaciones, responde con claridad y pide lo que falte. Si el cliente confirma, registra el pedido y lo sube a humano para preparacion y entrega.

La tienda no necesita un ERP complejo. Sus datos viven en su propio Google Drive/Sheets: catalogo, clientes y pedidos. La plataforma se encarga del agente, la integracion, la medicion de uso, las aprobaciones y la experiencia visual.

Para el administrador de la plataforma, Ventas IA funciona como un SaaS: suscripcion mensual por Mercado Pago, control de clientes, consumo, pagos, errores, estado de Google/WhatsApp y Motor IA centralizado con DeepSeek.

La diferencia es que no es solo un chatbot. Es una operacion supervisable: conversaciones, tienda viva, aprobaciones humanas, observabilidad y trazabilidad.

## Diferenciadores para vender

- No reemplaza al tendero: lo libera de lo repetitivo y lo llama cuando hay que decidir.
- Usa Google Sheets, una herramienta familiar para negocios pequenos.
- El agente esta entrenado conceptualmente para lenguaje colombiano y tienda de barrio.
- Soporta pedidos incompletos, productos ambiguos y disponibilidad parcial.
- Tiene una experiencia visual que permite entender la operacion sin ser tecnico.
- El administrador puede ver pagos, uso, clientes, errores y estado por tienda.
- Es multi-cliente desde la arquitectura.
- DeepSeek se administra globalmente, reduciendo configuracion por cliente.

## Limites comerciales que deben decirse con claridad

- WhatsApp Business/Meta no esta incluido en el precio de la plataforma; lo paga y administra cada cliente.
- Para operar WhatsApp real se necesita URL publica, numero/Business Manager, `phoneNumberId`, token y webhook verificado.
- Mercado Pago real requiere credenciales, plan/preapproval y webhook publico.
- Google Drive/Sheets real requiere autorizacion OAuth del cliente.
- Las integraciones productivas deben probarse con credenciales reales antes de prometer piloto publico.
- La IA no debe confirmar pagos, descuentos, imagenes o reclamos sin control humano.

## Alcance recomendado para primer piloto

### Incluido

- Una tienda piloto.
- Catalogo en Google Sheets.
- Clientes y pedidos en Google Sheets.
- WhatsApp conectado si el cliente ya tiene Meta Cloud API o se completa el alta guiada.
- Agente con DeepSeek global.
- Pedidos a domicilio.
- Handoff humano para preparacion/entrega.
- Tablero de conversaciones, aprobaciones y resumen operativo.
- Control de suscripcion y uso.

### No incluir al inicio

- Campanas masivas de WhatsApp.
- Email marketing.
- ERP contable.
- Integracion con inventario de terceros.
- Pagos de domicilios dentro de la conversacion.
- Factura electronica.
- Automatizacion completa de preparacion/logistica.

## Frase posicionamiento

**Ventas IA convierte el WhatsApp de una tienda en una operacion comercial inteligente, supervisable y conectada a su propio Google Sheets.**

