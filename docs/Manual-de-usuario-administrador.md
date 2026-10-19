# Manual del administrador de plataforma

Este manual corresponde a la cuenta que administra varias tiendas y la operación SaaS. El administrador ve funciones que no aparecen para el dueño ni para el operador.

## Acceso y alcance

Entra con la cuenta de administrador de plataforma. El menú agrega:

- **Centro de control**: clientes, estados, consumo, Motor IA y facturación.
- **Observabilidad**: eventos de WhatsApp, Mercado Pago e integraciones.

Las acciones sobre una tienda deben revisarse antes de ejecutarse porque pueden cambiar su acceso, conexión o cobro.

## Centro de control

### Motor IA

Revisa el proveedor, modelo, URL y límites operativos configurados para la plataforma. El motor es transversal: no se configura desde la tienda individual. Guarda cambios solo cuando tengas una configuración validada y una credencial protegida en el ambiente.

### Clientes

Selecciona una tienda para revisar:

- salud general;
- suscripción y acceso;
- Google y WhatsApp;
- consumo de mensajes y tokens;
- eventos recientes;
- errores o bloqueos.

Desde la ficha de la tienda puedes **Validar** o **Activar** cuando el proceso de puesta en marcha lo requiera. La activación no reemplaza la prueba real de WhatsApp y Google.

### Facturación

La pestaña **Facturación** permite consultar planes, embudo comercial y estado de pagos. Las acciones disponibles pueden incluir:

- ejecutar el trabajo de mantenimiento;
- sincronizar una tienda;
- crear una excepción temporal;
- aplicar o retirar un descuento;
- crear o editar un plan.

Documenta la razón de cada excepción o descuento. Revisa siempre el vencimiento y el efecto sobre el acceso de la tienda.

## Observabilidad

La vista registra eventos de WhatsApp y Mercado Pago con filtros por proveedor, estado y tienda. Para investigar un caso:

1. Filtra por la tienda o el proveedor.
2. Revisa si el evento fue procesado, duplicado, ignorado, rechazado o fallido.
3. Abre el evento para consultar hora, duración, identificador externo y conversación.
4. Lee el payload y los encabezados enmascarados; no solicites ni pegues secretos en tickets.
5. Compara el error con la conversación o el pedido afectado antes de reintentar.

El monitor permite agrupar por **Hora** o **Día** y muestra éxito, pico y errores.

## Puesta en marcha de una tienda

El recorrido recomendado es:

1. Confirmar la suscripción.
2. Confirmar que el dueño conectó Google.
3. Confirmar que la hoja de la tienda fue creada.
4. Revisar que el catálogo tenga productos y precios.
5. Confirmar la ruta de WhatsApp y sus permisos de Meta.
6. Validar el tenant.
7. Activar solo después de una conversación de prueba.

Si Meta todavía está pendiente a nivel global, la tienda debe ver un mensaje de preparación y no un botón que sugiera que la conexión ya está disponible.

## Límites y seguridad

- No copies API keys, tokens, PIN de Meta ni secretos en la documentación.
- No uses una cuenta de dueño para probar el acceso de otra tienda.
- Confirma el `tenantId` antes de validar, activar, sincronizar o modificar facturación.
- La ruta protegida debe devolver `401` sin sesión y `403` cuando la cuenta no tiene acceso a la tienda.
- Los datos enviados a observabilidad aparecen enmascarados; no intentes reconstruir secretos desde la interfaz.

## Diagnóstico rápido

| Síntoma | Revisión inicial |
| --- | --- |
| La tienda no ve pedidos | Revisar suscripción, activación, WhatsApp y `GET /api/ops/overview`. |
| Google aparece conectado pero no actualiza pedidos | Revisar el evento de sincronización y el acceso a la hoja `Pedidos`. |
| Meta no muestra el botón de conexión | Revisar el estado global del receptor/webhook y la configuración de Embedded Signup. |
| El proxy responde `200` pero una pantalla no carga datos | Comparar `/api/health`, la sesión y el tenant seleccionado. |
| Hay muchos eventos fallidos | Filtrar por proveedor y consultar primero el error más reciente y repetido. |
