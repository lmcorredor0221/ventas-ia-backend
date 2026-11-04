# Respuestas a compradores con nombre de usuario de WhatsApp

## Causa comprobada

El 3 de noviembre de 2026, a las 18:50 Colombia, el webhook de Demo De Tienda recibió «Hola , quiero hacer un pedido» con `messages[].from_user_id` y `contacts[].user_id`, sin `from` ni `wa_id`. El intérprete DeepSeek respondió en 1,5 segundos, pero la normalización descartó el identificador. El envío terminó en HTTP 400: `The parameter to is required`.

La integración anterior suponía que todos los compradores compartían su teléfono. No fue un vencimiento del token ni un fallo del LLM.

## Corrección

- Conservar el identificador BSUID completo cuando Meta no comparte el teléfono; asociar el contacto por identificador, sin comparar campos ausentes.
- Enviar BSUID mediante `recipient` y números tradicionales mediante `to`, para texto, botones, listas y plantillas.
- Reconocer el identificador en estados de entrega, contactos sincronizados y mensajes del tendero.
- Rechazar mensajes sin identidad antes de crear una conversación o invocar el agente; conservar el evento para diagnóstico y permitir procesar el resto del lote.
- Mantener separación por tenant. No derivar números telefónicos a partir de BSUIDs ni cambiar permisos de Meta.

## Verificación

`node server/tests/whatsapp-bsuid-contract.mjs` reproduce el formato del incidente con identificadores ficticios. Antes de la corrección falla por `waId === undefined`; después verifica destinatario, contacto correcto, todos los formatos de salida, continuidad, separación de tenants, intervención humana y rechazo de destinatario ausente.

También se ejecutaron `npm run test:backend`, `whatsapp-live-contract.mjs` y `whatsapp-batch-coexistence.mjs`. Son pruebas locales de contrato; la aceptación real de Meta debe comprobarse después del despliegue.

Referencia oficial verificada en el navegador: [Meta: Business-scoped user IDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids), actualización del 23 de octubre de 2026.

## Alcance pendiente

Este cambio restablece recepción y respuesta para BSUID. No implementa aún la migración completa de identidad cuando el comprador cambia de número (`user_changed_user_id`), ni convierte un BSUID en un enlace telefónico `wa.me`. Esas funciones requieren sus propios contratos y no deben inferir el teléfono.
