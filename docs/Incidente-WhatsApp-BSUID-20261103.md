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

También pasaron `npm run test:backend`, `whatsapp-live-contract.mjs` y `whatsapp-batch-coexistence.mjs`. Son pruebas locales de contrato.

### Validación real en producción

- Backend `a1cd7830f3822d2341f59a95ae9e56d7c99c482f`, despliegue Render `dep-dbl7bg5bedkc738821sg`: Live el 3 de noviembre a las 19:01:59 Colombia.
- Después de comprobar que no existía respuesta al comprador, se recuperó una sola vez el mensaje pendiente mediante el endpoint autenticado del agente, con el identificador completo recibido por el webhook original. La conversación correctamente identificada es `wa-adbe2075`.
- El agente respondió a las 19:02:36: «Claro, te ayudo con el domicilio. Para continuar necesito tu nombre, la direccion del domicilio y que productos quieres pedir.»
- Meta aceptó el envío y devolvió estados `sent` y `delivered`; la confirmación de entrega se recibió a las 19:02:41 Colombia. DeepSeek utilizó su integración real.
- Se conservó el registro original degradado para diagnóstico; no se purgaron pedidos ni conversaciones. Esta recuperación no acredita todavía un pedido completo del nuevo comprador.
- El frontend impide construir enlaces telefónicos `wa.me` a partir de un BSUID. Su compilación de producción pasó.

### Continuación real y segundo hallazgo

El comprador continuó por el mismo BSUID: nombre, dirección y leche entera recibieron respuestas en aproximadamente 3–4 segundos, con dos alternativas y precios del catálogo. A las 19:04:54 el mensaje «un panta tajado» produjo `Unterminated string in JSON` al interpretar la respuesta de DeepSeek. Se activó el relevo humano y los mensajes posteriores se guardaron. El evento anterior no conservaba `finish_reason`, por lo que no prueba por sí solo si hubo truncamiento por tokens o JSON mal formado.

La recuperación ahora regenera la salida estructurada una sola vez ante JSON inválido/incompleto o `finish_reason=length`, con hasta 1.800 tokens de salida por defecto (`LLM_JSON_RETRY_MAX_TOKENS`) en ese intento excepcional. Conserva el límite temporal total del plan, la canasta y el relevo humano si tampoco se obtiene una interpretación completa. No reintenta credenciales inválidas, ni ejecuta JSON parcial ni sustituye al LLM por un parser de productos. La telemetría conserva razones de terminación, intentos y consumo agregado; el contador de llamadas incluye el reintento.

`server/tests/llm-json-recovery.mjs` falló antes del cambio y después verificó recuperación, conservación de productos, uso de ambos intentos, límite de dos llamadas, plazo total, 401 sin reintento y vía normal de una sola llamada. Pasó de nuevo toda la suite `test:backend`.

El tendero retomó la conversación desde el celular. Su eco contenía teléfono y BSUID juntos. El receptor ahora prioriza una conversación activa conocida por ese BSUID para no abrir otro cliente ni dejar respondiendo al agente al mismo tiempo. El contrato de coexistencia prueba ese formato doble. No se reenviaron mensajes del pedido mientras el tendero lo atendía.

La corrección adicional quedó Live en Render con `da2fb38373790a46cc2156968f7c947144894188`, despliegue `dep-dbl7gvgm7kps739gq7r0`, el 3 de noviembre a las 19:13:20 Colombia. El guard del frontend (`d636614`) quedó Ready en Vercel, despliegue `dpl_2uHvehGNdjUeBKQPR5WybEoBmRPA`, alias `via.leanagentbuilder.com`.

También se hizo una prueba local contra DeepSeek real, con almacenamiento temporal y sin enviar WhatsApp: contexto de leche entera más «un panta tajado». El modelo conservó la leche e interpretó «pan tajado» en 2.449 ms, 2.317 tokens de entrada y 368 de salida, `finish_reason=stop`, sin relevo humano. En esta ejecución no necesitó reintento; la recuperación ante salida truncada se validó mediante el contrato controlado. El primer intento local había fallado por conectividad del equipo, antes de obtener salida del proveedor.

Referencia oficial verificada en el navegador: [Meta: Business-scoped user IDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids), actualización del 23 de octubre de 2026.

## Alcance pendiente

Este cambio restablece recepción y respuesta para BSUID. No implementa aún la migración completa de identidad cuando el comprador cambia de número (`user_changed_user_id`), ni convierte un BSUID en un enlace telefónico `wa.me`. Esas funciones requieren sus propios contratos y no deben inferir el teléfono.
