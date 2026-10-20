# Plan consolidado: webhook, conversación LLM y piloto WhatsApp

**Fecha:** 20 de octubre de 2026  
**Estado:** ejecución de código y contratos completada; pendiente de migración y activación controlada en producción.  
**Alcance:** recepción de mensajes de Meta, conversación por WhatsApp, pedidos, PostgreSQL, Google Sheets, observabilidad y preparación del piloto multitenant.

## 1. Decisión de arquitectura

La prioridad operativa es la comunicación confiable con el cliente final. Meta no debe esperar a que terminen una llamada al LLM, una consulta de catálogo ni una operación de Google Sheets.

El flujo objetivo es:

```text
Meta -> verificar y deduplicar -> PostgreSQL (mensaje + trabajo durable) -> HTTP 200
                                                               |
                                                               v
                                              worker de conversación y pedidos
                                                               |
                  +----------------------+---------------------+--------------------+
                  |                      |                                          |
                  v                      v                                          v
             consulta catálogo       LLM interpreta y redacta                 PostgreSQL pedido
                  |                      |                                          |
                  +----------------------+---------------------+--------------------+
                                                               |
                                                               v
                                                   WhatsApp y outbox de Sheets
```

La respuesta `HTTP 200` confirma a Meta que Ventas IA recibió el evento. No es todavía la respuesta conversacional al comprador. La respuesta al comprador la envía el worker una vez que entiende el mensaje, consulta datos válidos y compone la contestación.

## 2. Qué debe hacer el LLM y qué no

No se propone reemplazar la conversación por respuestas rígidas. El LLM debe ser el responsable de interpretar el lenguaje natural del cliente y de redactar la respuesta con la voz configurada por cada tienda.

### Responsabilidad del LLM

- Interpretar modismos, errores de escritura, marcas incompletas, cantidades, presentaciones y pedidos por valor.
- Entender correcciones posteriores, por ejemplo cambio de cantidad, dirección, pago o producto.
- Detectar cuándo faltan datos y formular una pregunta natural y breve.
- Redactar el mensaje final conforme a la personalidad, idioma y contexto de la tienda.
- Pedir ayuda humana cuando la certeza sea baja o la situación sea sensible.

### Responsabilidad determinística del dominio

"Determinístico" no debe significar "plantilla visible al cliente". Significa que hay hechos que no se pueden improvisar:

- SKU, nombre oficial, precio, disponibilidad y total salen del catálogo validado.
- La forma de pago sale de los métodos habilitados por el tenant.
- El pedido se confirma, alista, despacha y cierra solo mediante transiciones válidas.
- Un mismo `message_id` de Meta no puede crear dos conversaciones, pedidos ni cargos.
- Un mensaje de estado de entrega no puede volver a invocar al agente.

El worker construirá un **sobre de hechos** con esos datos. El LLM redactará sobre ese sobre, sin inventar precios, stock, descuentos, direcciones, estados ni promesas de entrega. Un validador rechazará una salida que contradiga los hechos y pedirá una nueva redacción o aplicará un fallback seguro.

Las plantillas actuales quedarán solo como contingencia cuando el LLM no esté disponible, para mensajes transaccionales críticos o para avisar una escalación humana. También deben respetar el perfil de voz del tenant.

## 3. Hallazgos comprobados

1. El webhook de WhatsApp espera hoy `runtime.processInbound`. Ese camino incluye planificación, catálogo, Google y envío de WhatsApp antes de devolver la respuesta a Meta. Es la principal causa de latencia y riesgo de reintento.
2. La creación inicial del pedido llama a Google Sheets antes de persistir el pedido localmente. La escritura debe cambiar a PostgreSQL primero y una proyección asíncrona después.
3. Ya existe una outbox de integraciones, pero es opcional y no cubre todavía toda la creación inicial del pedido. La configuración de ejemplo la deja desactivada.
4. Los eventos de estado de entrega ya se ignoran antes de llegar al agente. Esa corrección evita bucles conversacionales.
5. Al marcar un pedido como `dispatched`, la conversación se cierra y el siguiente mensaje debe iniciar un caso nuevo, salvo una continuación explícita dentro de la ventana configurada.
6. El trabajo previo de lenguaje colombiano sí existe: hay investigación de modismos, escenarios de prueba y una instrucción genérica al planner para interpretar expresiones locales. Sin embargo, el proveedor LLM devuelve un plan JSON, no el mensaje que verá el cliente. Después de planificar, los caminos normales de catálogo, cotización y aclaración usan `buildCatalogReply`, `buildMultiCatalogReply` y `buildOrderReply` en `agentRuntime`. Esas funciones generan textos fijos, generalmente neutros. Solo el camino de escalación humana incorpora hoy un "Claro, veci" fijo.
7. `agentPolicy.tone` se guarda y el planner lo lee, pero no se inyecta en el prompt principal del proveedor. Por eso el perfil técnico heredado `tendero_bogotano`, entendido en el producto como una voz de tendero colombiano, no cambia de forma consistente ni la interpretación ni la respuesta final.
8. Las pruebas colombianas comprueban principalmente intención, canasta y campos faltantes. Deben añadir aserciones sobre la voz de la respuesta final y ejecutarse también contra el proveedor LLM real, no solo con el simulador.
9. La observabilidad actual no permite ver con claridad, por mensaje, si se usó el proveedor LLM, el modelo configurado o un fallback.
10. Una instancia gratuita que se suspende no es adecuada para un piloto de atención conversacional. Puede añadir una demora de arranque significativa aun cuando el código sea correcto.

## 4. Principios no negociables

1. **PostgreSQL es la fuente de verdad operativa.** Guarda eventos entrantes, conversaciones, pedidos, tareas humanas, mensajes salientes y estado de sincronización.
2. **Sheets es una integración del tenant, no una dependencia del acuse a Meta.** Puede servir para administrar o proyectar catálogo y pedidos, pero su indisponibilidad no borra ni duplica datos operativos.
3. **El procesamiento debe ser idempotente.** La misma entrega de Meta se procesa una sola vez de forma efectiva.
4. **Un worker durable ejecuta efectos externos.** No se usará un `Promise` desligado dentro del servidor web como sustituto de una cola.
5. **La voz pertenece al tenant.** El perfil no se comparte entre tiendas y se aplica a la interpretación y a la redacción.
6. **El LLM no inventa hechos comerciales.** Puede expresarlos con naturalidad, pero no cambiarlos.
7. **Toda falla es visible.** El tendero ve si el mensaje, la sincronización o una acción humana requieren atención.

## 5. Plan de ejecución priorizado

### P0. Acuse durable e inmediato a Meta

**Objetivo:** responder a Meta después de una persistencia mínima y segura, sin esperar servicios lentos.

1. Crear una unidad de trabajo PostgreSQL para recibir el webhook:
   - validar firma y resolver `tenantId` por `phone_number_id`;
   - reclamar atómicamente `message_id`;
   - guardar el mensaje normalizado y su correlación;
   - crear un trabajo `process_inbound_message`;
   - confirmar la transacción;
   - devolver `HTTP 200`.
2. Añadir estados para el trabajo: `queued`, `processing`, `completed`, `retrying`, `failed` y `dead_letter`.
3. Ejecutar un worker separado del servicio HTTP, con bloqueo o claim atómico, reintentos exponenciales y cierre ordenado.
4. Mantener los estados de entrega como eventos ignorados por el agente y registrar solo la auditoría necesaria.
5. Medir `webhook_ack_ms`, duplicados, profundidad de cola, antigüedad del trabajo y fallos por proveedor.

**Archivos de partida:**

- `server/routes/whatsapp.js`
- `server/services/agentRuntime.js`
- `server/store/postgresStore.js`
- `server/services/integrationOutbox.js`
- nueva migración y servicio de cola durable

**Aceptación:** el `p95` del acuse de webhook es inferior a un segundo sin depender de DeepSeek, Google ni Graph API de salida. Un evento repetido no provoca una segunda ejecución efectiva.

### P1. Pedido en PostgreSQL y proyección asíncrona a Sheets

**Objetivo:** ninguna caída de Google impide guardar o operar un pedido válido.

1. Al confirmar una canasta, guardar en una única transacción: pedido, líneas, conversación, evento de auditoría y eventos de outbox.
2. Encolar por separado:
   - proyección de pedido a Sheets;
   - actualización de perfil cuando corresponda;
   - mensaje de confirmación o cambio de estado por WhatsApp.
3. Persistir claves de idempotencia y el identificador devuelto por cada proveedor externo.
4. Exponer `pending`, `synced`, `retrying` o `failed` para cada proyección, sin revertir el pedido interno por una indisponibilidad temporal de Sheets.
5. Mantener una réplica operativa del catálogo en PostgreSQL. Sheets puede seguir siendo la herramienta de administración del tenant, pero las búsquedas conversacionales no deben depender de su latencia en cada mensaje.

**Aceptación:** un pedido confirmado existe en PostgreSQL antes de intentar Sheets; una caída de Sheets deja el pedido disponible para el tendero y genera un reintento trazable.

### P2. LLM conversacional con voz por tenant

**Objetivo:** que el cliente sienta que conversa con la tienda, no con una plantilla, sin perder precisión comercial.

1. Definir una política de voz versionada por tenant:
   - perfil visible `tendero_colombiano`; se conservará `tendero_bogotano` como identificador compatible mientras se migra la configuración existente;
   - idioma y registro;
   - cercanía y formalidad;
   - expresiones permitidas, moderadas y prohibidas;
   - longitud objetivo y forma de pedir confirmación;
   - reglas para usar modismos colombianos solo cuando encajen con el mensaje y sin convertir cada respuesta en una caricatura.
2. Incluir la política en el prompt de planificación y crear un compositor LLM de respuesta final separado del planner.
3. Entregar al compositor solo el sobre de hechos validado: productos encontrados, alternativas, precios, subtotal, datos faltantes, pago disponible, dirección conocida, estado y siguiente acción.
4. Validar la respuesta antes de enviarla:
   - no introducir montos, productos, descuentos o estados inexistentes;
   - no omitir una pregunta obligatoria;
   - no confirmar un pedido pendiente;
   - no usar el nombre o dirección de otra conversación o tenant.
5. Aplicar el mismo perfil de voz a los fallbacks determinísticos, manteniendo el mensaje claro y breve.
6. Añadir una pantalla de configuración de voz por tenant con vista previa y pruebas de frases reales antes de activarla.
7. Retirar `buildCatalogReply`, `buildMultiCatalogReply` y `buildOrderReply` del camino normal de envío. Se conservarán como fallback transaccional, nunca como el redactor principal cuando el LLM está sano.
8. Añadir pruebas de voz a los escenarios colombianos: el mismo pedido debe conservar hechos idénticos y cambiar solo la forma de expresarlos según el perfil del tenant. Las pruebas deben verificar que se interpretan frases como `me regala`, `veci`, `pa las onces`, `datafono` y correcciones en contexto.

**Ejemplo esperado:** ante “veci, mándeme dos cocas y algo para la lonchera”, el LLM interpreta la intención y responde con una forma colombiana cercana y natural, por ejemplo reconociendo el pedido y preguntando la presentación necesaria. El catálogo decide cuáles Coca-Cola y productos de lonchera existen, cuáles cuestan y qué aclaración hace falta.

**Aceptación:** pruebas con modismos colombianos, errores de escritura, pedidos ambiguos y cambios posteriores producen mensajes naturales, pero los importes y los artículos coinciden exactamente con el sobre de hechos.

### P2B. Interacciones guiadas de WhatsApp

**Objetivo:** reducir fricción en decisiones cerradas sin reemplazar la conversación natural ni permitir acciones ambiguas.

Los mensajes interactivos son una mejora recomendada para una conversación de compra. Los botones de respuesta rápida sirven para pocas alternativas mutuamente excluyentes; las listas sirven cuando el tenant habilita más opciones. WhatsApp devuelve la selección al webhook como un mensaje `interactive`, por lo que el sistema puede registrar una elección inequívoca sin pedir al cliente que la escriba otra vez. Meta permite botones de respuesta en los mensajes interactivos de sesión y también botones rápidos dentro de plantillas aprobadas. Las respuestas libres siguen siendo necesarias y deben funcionar siempre.

#### Casos de uso iniciales

| Momento | Control recomendado | Acción al seleccionar |
| --- | --- | --- |
| Forma de pago | Botones si hay hasta tres métodos; lista si hay más | Guarda la preferencia de pago del pedido actual, no confirma un pago. |
| Cotización completa | `Confirmar pedido`, `Ajustar pedido`, `Hablar con la tienda` | Confirma solo con la primera opción; las otras mantienen o escalan la conversación. |
| Productos o presentaciones equivalentes | Lista de alternativas validadas por catálogo | Añade la referencia exacta elegida al borrador. |
| Pregunta final | `Agregar algo más`, `Eso es todo` | Continúa el borrador o presenta confirmación. |
| Dirección conocida | Lista de direcciones ya guardadas | Vincula una dirección existente al pedido, sin exponer datos de otro tenant. |

No se usarán botones para capturar nombre, dirección nueva, instrucciones de entrega, productos libres, reclamos ni preguntas que requieran explicación. En esos casos el LLM debe mantener el diálogo abierto en texto natural.

#### Reglas técnicas

1. El LLM puede recomendar que una decisión cerrada se presente como control interactivo, pero no define el efecto de negocio ni construye identificadores arbitrarios.
2. El backend crea una `interaction_offer` persistida con tenant, conversación, pedido o borrador, opciones permitidas, vencimiento y versión.
3. Cada botón o fila usa un identificador opaco que referencia esa oferta. No incluye precio, dirección, teléfono ni acción de negocio directamente.
4. Al recibir `button_reply` o `list_reply`, el webhook normaliza el identificador y el worker valida tenant, conversación, vigencia, versión e idempotencia antes de ejecutar la transición.
5. Una selección repetida, vencida o perteneciente a otro pedido no puede confirmar, cobrar ni modificar nada; se informa al cliente y se ofrece continuar por texto.
6. Toda interacción conserva una alternativa de texto. El cliente puede escribir "tarjeta", "quiero cambiar" o una instrucción nueva en lugar de pulsar un control.
7. Los mensajes interactivos libres se usan solo durante la ventana de atención iniciada por el usuario. Fuera de esa ventana, se utilizarán únicamente plantillas aprobadas por Meta, incluidas plantillas con botones rápidos cuando aplique.
8. En la outbox, un mensaje interactivo es un tipo de salida propio, con payload, oferta y resultado del proveedor trazables; no se enviará de nuevo por un reintento sin una clave de idempotencia.

#### Brecha actual y trabajo concreto

Hoy `buildWhatsAppMessagePayload` solo construye mensajes de tipo `text` o `template`. El normalizador del webhook tampoco extrae `button_reply` ni `list_reply`; trataría el mensaje interactivo como texto vacío. Antes de habilitar la interfaz se debe:

1. Extender la herramienta `whatsapp_business_messaging` y el constructor de payload para `interactive.button` e `interactive.list`.
2. Extender `normalizeWhatsAppPayload` para conservar tipo, identificador, título, descripción y contexto del mensaje interactivo.
3. Crear la persistencia y el servicio de `interaction_offer` con consumo atómico de cada selección.
4. Incorporar la elección al borrador del pedido y pedir al LLM solo la siguiente respuesta natural, basada en hechos actualizados.
5. Añadir una configuración por tenant para métodos de pago, controles habilitados y textos de cada opción.
6. Probar clic válido, clic repetido, botón vencido, botón de otra conversación, mensaje escrito en vez de clic y respuesta fuera de la ventana de atención.

**Aceptación:** el cliente puede confirmar, cambiar pago o elegir una alternativa con una pulsación; cada selección se aplica una sola vez, aparece auditada en la conversación y conserva el mismo aislamiento por tenant que un mensaje de texto.

### P3. Observabilidad de conversación y operación

**Objetivo:** distinguir con evidencia una conversación procesada por LLM de un fallback y poder depurar un incidente en minutos.

1. Registrar por mensaje: `traceId`, tenant, conversación, trabajo, proveedor, modelo, modo de ejecución, latencia, uso, fallback y motivo.
2. Registrar por salida: mensaje generado, versión de política de voz, sobre de hechos, resultado de validación y respuesta del proveedor WhatsApp.
3. Mostrar en la consola el estado de la cola y fallos accionables sin exponer tokens, prompts completos ni datos sensibles innecesarios.
4. Alertar por acumulación de cola, tasa de fallback, fallos de Sheets, tiempo de respuesta y errores de envío.

**Aceptación:** desde una conversación se puede responder: qué recibió Meta, qué modelo procesó el caso, qué datos validó, qué mensaje se envió y qué integración necesita reintento.

### P4. Infraestructura y validación del piloto

**Objetivo:** que el piloto no dependa de una instancia suspendible ni de pruebas manuales aisladas.

1. Ejecutar web y worker en procesos independientes y persistentes.
2. Habilitar outbox solo después de validar adaptadores y migraciones en un tenant de prueba.
3. Incorporar pruebas de concurrencia contra PostgreSQL real, no solo memoria o JSON.
4. Ejecutar la matriz de prueba:
   - mismo webhook recibido dos veces;
   - LLM lento o no disponible;
   - Google Sheets no disponible;
   - dos operadores actuando sobre el mismo pedido;
   - pedido, alistamiento, despacho, cierre y nuevo pedido posterior;
   - tonos distintos en dos tenants aislados;
   - mensajes de entrega de Meta sin nueva conversación;
   - catálogo ambiguo, producto ausente, cambio de dirección y forma de pago.
5. Usar el número de prueba de Meta solo para validar el flujo técnico. La alta real de cada tienda seguirá siendo independiente mediante Embedded Signup cuando Meta apruebe los permisos avanzados.

## 6. Estrategia de despliegue sin duplicar mensajes

1. Crear migraciones y worker con el procesamiento asíncrono desactivado por feature flag.
2. Activar persistencia y telemetría en modo sombra, sin enviar una segunda respuesta al cliente.
3. Comparar resultados del flujo actual y del worker para mensajes de prueba.
4. Activar el worker para `Test Local` y validar deduplicación, pedido, Sheets y WhatsApp.
5. Activar gradualmente para el resto de tenants.
6. Retirar el camino síncrono solo cuando las métricas y la recuperación de trabajos estén comprobadas.

## 7. Definición de listo para piloto

El piloto con una tienda real puede abrirse cuando se cumplan todos estos puntos:

- Meta recibe un acuse rápido y verificable para cada webhook válido.
- Todo mensaje entrante queda guardado y correlacionado antes del procesamiento conversacional.
- El cliente recibe una respuesta con el tono configurado para su tienda, o un fallback claro si el proveedor LLM falla.
- Un pedido confirmado se guarda primero en PostgreSQL y no se duplica ante reintentos.
- Sheets refleja el pedido de manera asíncrona, con reintento y estado visible.
- El tendero puede alistar, marcar en camino y cerrar; el cliente recibe el aviso de despacho y un mensaje posterior abre un caso nuevo.
- La consola permite identificar, por conversación, el proveedor LLM, el fallback y cualquier sincronización pendiente.
- El servicio web y el worker no dependen de una suspensión automática incompatible con la atención del cliente.

## 8. Relación con documentos existentes

Este documento precisa y prioriza el trabajo descrito en:

- [Plan de cierre de hallazgos de arquitectura](./Plan-cierre-hallazgos-arquitectura.md)
- [Arquitectura y funcionamiento real](./Arquitectura-y-funcionamiento-real-Ventas-IA.md)
- [Checklist de piloto](./Checklist-piloto-produccion.md)

Ante conflicto, este plan prevalece para el camino crítico de WhatsApp: primero recepción durable y acuse a Meta; después procesamiento LLM y efectos externos.

## 9. Ejecución realizada el 20 de octubre de 2026

### Implementado y cubierto por pruebas

- Se agregó la migración `011_inbound_messages_and_interactions.sql`, con persistencia de mensajes entrantes y ofertas de interacción por tenant.
- El webhook puede operar de manera asíncrona mediante `WHATSAPP_ASYNC_INBOUND_ENABLED=true`: persiste el mensaje y el trabajo de outbox en una misma unidad, deduplica por `message_id` y devuelve `HTTP 200` sin esperar catálogo, LLM, Sheets ni WhatsApp saliente.
- Se creó `npm run worker`. El proceso worker reclama trabajos con bloqueo, recupera leases vencidos, aplica backoff y lleva mensajes entrantes a `dead_letter` al agotar los intentos configurados.
- La creación de pedidos guarda primero el pedido y su evento de proyección en la outbox. La escritura de `Pedidos` en Sheets ocurre desde el worker y no revierte un pedido si Google está lento o caído.
- El compositor LLM recibe un sobre de hechos comerciales validados y la voz del tenant. `tendero_bogotano` se migra de forma compatible a `tendero_colombiano`; los textos determinísticos solo son fallback seguro.
- Cada tenant puede elegir la voz y administrar sus métodos de pago. La base inicial incluye Efectivo, Tarjeta y Bre-B, y el propietario puede añadir, desactivar o renombrar métodos.
- WhatsApp soporta botones y listas para decisiones cerradas. Las ofertas son persistidas, tienen vencimiento y se consumen una sola vez; una respuesta repetida o ajena al tenant no modifica el pedido.
- Las suites de backend, arquitectura, contratos de WhatsApp, Google y configuración de permisos pasan localmente. La corrida real de DeepSeek para seis pasos colombianos seleccionados también pasó (6/6 intenciones).

### Despliegue obligatorio antes de activar el piloto

1. Aplicar la migración `server/db/migrations/011_inbound_messages_and_interactions.sql` en la base PostgreSQL de producción.
2. Crear un servicio Render separado con el mismo repositorio y comando `npm run worker`. Debe compartir `DATABASE_URL`, secretos de Meta, Google y LLM con el servicio web.
3. En el servicio web configurar `BACKGROUND_WORKERS_ENABLED=false`, `INTEGRATION_OUTBOX_ENABLED=true` y, inicialmente, `WHATSAPP_ASYNC_INBOUND_ENABLED=false`.
4. En el worker configurar `BACKGROUND_WORKERS_ENABLED=true`, `INTEGRATION_OUTBOX_ENABLED=true` e `INTEGRATION_OUTBOX_MAX_ATTEMPTS=8`.
5. Tras verificar que el worker está vivo y puede reclamar una entrada de prueba, activar `WHATSAPP_ASYNC_INBOUND_ENABLED=true` también en el servicio web. Nunca se activa ese flag sin un worker persistente.
6. Validar con `Test Local`: acuse rápido de Meta, un mensaje duplicado, catálogo, selección de pago, pedido, caída simulada de Sheets, reintento, despacho, cierre y un mensaje posterior que abra un caso nuevo.
7. Revisar en observabilidad cualquier trabajo `failed` o mensaje `dead_letter` antes de abrir el flujo a una tienda real.
8. Ejecutar `npm run test:postgres:local` contra PostgreSQL local antes del corte. La instancia local documentada por el repositorio usa la base de desarrollo `ventas_ia_dev`; el comando toma la URL de la configuración local y rechaza host o base distintos de `127.0.0.1`/`ventas_ia_dev`. La URL concreta se mantiene en la configuración local, no en este plan ni en producción. La primera ejecución del 20 de octubre de 2026 confirmó conexión, migraciones y persistencia; cualquier fallo posterior debe tratarse como fallo de contrato, no como ausencia de una base local.
