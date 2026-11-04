# Confirmación de un pedido atendido por la tienda

## Problema y resultado

Abrir WhatsApp activaba `manual_active` y pausaba al agente, pero la conversación sólo ofrecía abrir WhatsApp o eliminarse. El tendero no podía registrar lo acordado como pedido ni entrar a alistamiento. Resolver una solicitud humana tampoco creaba un pedido: sólo trabajaba con pedidos ya existentes.

Ahora, en **Conversaciones → cliente → Acciones → Confirmar y alistar pedido**, el tendero revisa nombre, dirección, pago, productos del catálogo de su tenant, cantidades y subtotal. Debe declarar que el cliente aceptó esos datos. El pedido queda directamente en **Alistando** y abre **Pedidos y pendientes**, donde **Marcar en camino** utiliza el flujo existente de notificación y cierre.

El formulario precarga los datos estructurados disponibles. Los acuerdos hechos por texto libre en WhatsApp requieren revisión del tendero; no se inventan productos ni se infiere que el cliente aceptó una cotización. Registrar el pedido no envía un mensaje adicional al comprador ni reactiva al agente.

## Contrato y persistencia

- `GET /api/conversations/:id/manual-order`: contexto, catálogo y medios de pago de la tienda autorizada.
- `POST /api/conversations/:id/manual-order`: crea una sola orden por conversación. Roles owner/operator; sesión y CSRF existentes; el tenant y el actor salen del servidor.
- El servidor valida SKU, cantidades, existencias y precios del catálogo. Calcula el subtotal y rechaza cambios de precio frente a lo revisado en el formulario. No acepta un subtotal enviado por el navegador como fuente de verdad.
- Mantiene los controles de productos restringidos del canal. No admite productos libres para eludirlos.
- PostgreSQL guarda en una transacción el pedido, el vínculo a la conversación, las solicitudes humanas resueltas, un domicilio consumido y el outbox de Sheets. No espera escrituras en Google.
- El pedido utiliza una identidad estable por tenant y conversación. Reintentar o hacer doble clic devuelve el pedido existente sin volver a contar cupo ni reabrirlo después del despacho.
- La atención humana continúa pausando la IA. La conversación con pedido ya registrado no se cierra por inactividad durante el alistamiento.
- Al reiniciar se recuperan los contadores de uso de sus filas durables; un snapshot anterior no debe ocultar el domicilio recién confirmado.
- No requiere migraciones ni cambios de esquema.

## Verificación reproducible

Backend:

```powershell
npm run test:manual
npm run test:manual:postgres
npm run test:backend
npm run test:architecture
node server/tests/postgres-operational-restart.mjs
```

La prueba PostgreSQL sólo acepta `localhost/ventas_ia_dev` o `127.0.0.1/ventas_ia_dev`. Usa un esquema temporal con nombre aleatorio, lo elimina al terminar y bloquea HTTP externo. Valida API autenticada, CSRF, aislamiento entre tenants, precios, repetición, outbox, rollback forzado y recuperación después de reiniciar.

Prueba visual con navegador local y API real local:

1. Backend: `node server/tests/manual-order-ui-server.mjs` (puerto 3001 libre).
2. Frontend: `npm run dev -- --port 5177 --strictPort`.
3. Frontend: `python tests/verify_manual_order.py`.

La fixture es temporal, bloquea HTTP externo y no manda mensajes de WhatsApp. Verifica 390, 1440 y 320 px, selección de catálogo, total, declaración del cliente, guardado y aparición de Marcar en camino. Reiniciar la fixture antes de repetir la prueba.

## Alcance operativo

La entrega conserva el catálogo, las credenciales y los pedidos reales. No crea automáticamente el pedido mostrado en la captura: falta que el tendero revise los productos y el total acordados y lo confirme desde la nueva acción.
