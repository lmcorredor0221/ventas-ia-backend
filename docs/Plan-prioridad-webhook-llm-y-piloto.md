# Prioridad: webhook, LLM y piloto

Fecha: 2026-10-20

## Objetivo operativo

Un tendero debe poder conectar su propio WhatsApp Business desde el onboarding y recibir pedidos por el webhook de Ventas IA. El dato y la operación pertenecen al tenant: Meta entrega el mensaje al número de esa tienda, Ventas IA lo procesa y gestiona el pedido y el domicilio sin mezclar información entre clientes.

## Prioridad de latencia

1. Validar la firma de Meta y resolver el tenant por `phone_number_id`.
2. En una sola transacción PostgreSQL, guardar el mensaje entrante y crear una tarea durable de procesamiento.
3. Responder `200` a Meta inmediatamente.
4. Un worker separado procesa catálogo, LLM, cliente, pedido, WhatsApp y proyecciones de Google Sheets.
5. PostgreSQL es la fuente operativa; Sheets/Drive son proyecciones asíncronas reintentables.

El webhook no debe esperar a DeepSeek, al catálogo de Sheets, a Drive ni al envío de una respuesta por WhatsApp.

## Implementación

- `inbound_messages` persiste cada mensaje de WhatsApp con deduplicación por `message_id`.
- `integration_outbox` registra `whatsapp.inbound_processing`, `order.sheet_create` y `order.sheet_projection` con clave idempotente, bloqueo y reintento exponencial.
- `server/worker.js` inicia el consumidor; el proceso web no debe iniciar consumidores en producción.
- La creación y las transiciones de pedido persisten el pedido y su proyección de Sheets en la misma transacción PostgreSQL.
- Si Sheets está lento o caído, el pedido queda operativo con proyección pendiente. El tendero no pierde la acción ni recibe un falso error.
- Una transición a `dispatched` notifica al comprador que el pedido va en camino y cierra la conversación. Un mensaje posterior abre un caso nuevo, salvo una referencia explícita al pedido previo dentro de la ventana permitida.

## IA y lenguaje colombiano

El LLM conserva dos responsabilidades distintas:

- Interpretar lenguaje natural: intención, canasta, cantidades, marcas incompletas, presentaciones, errores y modismos colombianos.
- Redactar la respuesta final conforme al perfil de voz del tenant.

La lógica determinística queda limitada a hechos comprobados y reglas de seguridad: precios del catálogo, subtotal, disponibilidad, estado del pedido, identidad de la conversación, deduplicación y transición de estados. Nunca sustituye la comprensión del mensaje.

El perfil `tendero_colombiano` es el nombre canónico. `tendero_bogotano` se conserva como alias de compatibilidad. Ambos producen un tono cercano, respetuoso, breve y natural, con modismos moderados; no debe caricaturizar al cliente ni inventar disponibilidad.

Antes de enviar texto generado, el backend valida que se mantengan literalmente productos, precios, subtotal, pago, dirección y demás hechos obligatorios. Si falla el proveedor o la validación, se envía el texto factual de respaldo y se registra el evento de fallback.

## Interacciones de WhatsApp

- Los medios de pago se configuran por tenant; como mínimo `Efectivo`, `Tarjeta` y `Bre-B`.
- Cuando faltan medios de pago, se ofrecen botones (hasta tres opciones) o una lista de WhatsApp.
- Cada opción usa un identificador opaco y una oferta persistida con vencimiento. Solo puede consumirse una vez por el tenant y la conversación correctos.
- Las respuestas interactivas se normalizan desde el webhook y actualizan el borrador del pedido antes de volver a cotizar o pedir confirmación.
- Los botones no se usan para reemplazar texto abierto: el cliente conserva la posibilidad de corregir, agregar productos o describir una necesidad en lenguaje natural.

## Configuración de producción

En Render deben existir dos procesos a partir del mismo repositorio y las mismas variables protegidas:

| Proceso | Comando | Variables |
| --- | --- | --- |
| Web | `npm start` | `BACKGROUND_WORKERS_ENABLED=false`, `WHATSAPP_ASYNC_INBOUND_ENABLED=true`, `INTEGRATION_OUTBOX_ENABLED=true` |
| Worker | `npm run worker` | `BACKGROUND_WORKERS_ENABLED=true`, `WHATSAPP_ASYNC_INBOUND_ENABLED=true`, `INTEGRATION_OUTBOX_ENABLED=true` |

Además: `STORAGE_DRIVER=postgres`, `DATABASE_URL`, `DATABASE_SSL=require`, secretos Meta, Google y LLM. No se deben registrar tokens, teléfonos o payloads privados en Git ni en la documentación.

## Verificación antes del piloto

```powershell
npm run test:architecture
npm run test:backend
npm run test:postgres:local
```

La prueba PostgreSQL local usa solamente `127.0.0.1/ventas_ia_dev`, aplica migraciones y no puede apuntar a producción.

Prueba funcional mínima:

1. Crear o activar un tenant aislado.
2. Conectar Google y aprovisionar `Catalogo`, `Clientes` y `Pedidos`.
3. Completar Embedded Signup con el número propio de esa tienda.
4. Enviar una solicitud natural desde un número cliente autorizado.
5. Comprobar `200` del webhook, mensaje en `inbound_messages`, tarea de outbox, respuesta WhatsApp y pedido local.
6. Confirmar que la fila de Sheets aparece de manera asíncrona.
7. Marcar tomado, luego en camino; verificar aviso al cliente, cierre del pedido y nuevo caso ante un mensaje posterior.

## Riesgos abiertos

- La aprobación de permisos avanzados y del proveedor tecnológico en Meta es externa al código.
- Si un worker no está desplegado o las banderas no se configuran como arriba, el webhook puede encolar pero no procesar.
- La salud del worker y los elementos `retrying`/`failed` de la cola deben observarse antes de abrir tiendas reales.
