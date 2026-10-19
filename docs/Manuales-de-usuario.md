# Manuales de usuario de Ventas IA

Esta carpeta reúne las instrucciones de uso de la plataforma publicada en `via.leanagentbuilder.com`.

Para el equipo técnico, la revisión profunda de la app, el agente y sus integraciones está en [Arquitectura profunda de la app y del agente](./Arquitectura-profunda-app-y-agente.md).

## Elige el manual

- [Manual del dueño de tienda](Manual-de-usuario-tendero.md): configuración inicial y trabajo diario para tiendas de barrio, panaderías, minimercados y droguerías.
- [Manual del operador](Manual-de-usuario-operador.md): atención de pedidos, conversaciones y coordinación de preparación y entrega.
- [Manual del administrador de plataforma](Manual-de-usuario-administrador.md): clientes, planes, consumo, integraciones y eventos técnicos.

## Qué hace la plataforma

Ventas IA recibe conversaciones de WhatsApp, consulta los productos autorizados por la tienda y organiza los pedidos para que una persona pueda revisarlos, prepararlos y entregarlos. La tienda conserva la decisión final sobre existencias, precios, tiempos y aceptación del pedido.

El recorrido visible de un pedido es:

`Mensaje recibido → Asistente atendiendo → Pedido confirmado → Pedido por tomar → Alistando pedido → Pedido en camino → Pedido entregado`

Un pedido rechazado queda como `Pedido cancelado`. Cada cambio de etapa se guarda en la plataforma y, cuando Google está conectado, también se intenta actualizar la fila correspondiente de `Pedidos`.

## Regla rápida de uso

1. Empieza en **Hoy** para entender qué necesita atención.
2. Abre **Pedidos y pendientes** para actuar.
3. Usa **Tienda viva** para ubicar visualmente los casos y abrir el pedido exacto.
4. Usa **Conversaciones** cuando necesites leer el intercambio o responder al cliente.
5. Si la tienda todavía no está lista, entra a **Poner en marcha** y sigue el siguiente paso recomendado.

## Ayuda y límites

Si una pantalla muestra un aviso de conexión, conserva el pedido y revisa la integración indicada antes de continuar. La plataforma no inventa precios, existencias ni estados de entrega. Marcar un pedido como entregado tampoco envía automáticamente un mensaje de WhatsApp al cliente; el contacto manual se realiza desde la conversación.
