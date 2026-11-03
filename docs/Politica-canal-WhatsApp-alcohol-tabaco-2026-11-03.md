# Restricción de alcohol y tabaco en pedidos por WhatsApp

Fecha: 3 de noviembre de 2026.

## Decisión y mensaje al cliente

VIA informa que la restricción corresponde al canal. No indica que el impedimento se limite al bot ni abre una tarea comercial para completar la venta restringida.

> Por las políticas de WhatsApp, no podemos gestionar pedidos de alcohol o tabaco por este canal. Para otras consultas, puedes contactar directamente con la tienda.

La referencia a la tienda es para atención general. No se incorporan enlaces, teléfonos ni instrucciones para completar estas compras fuera del flujo.

Fundamento: [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/), consultada el 3 de noviembre de 2026, actualización publicada del 23 de septiembre de 2026. Las secciones 4 y 5 distinguen las restricciones de comercio de las excepciones condicionadas para mensajería sobre determinados sectores. Esas excepciones no habilitan el flujo de pedidos de VIA para estos productos.

## Comportamiento implementado

- El planner recibe instrucciones de interpretar contexto, marcas y errores de escritura. Devuelve evidencia estructurada en `commercePolicy`; no se agrega una llamada independiente al modelo.
- La política del canal se comprueba antes de cotizar, al resolver el catálogo, al aclarar, al confirmar y en la herramienta de escritura de pedidos.
- Los productos conocidos como restringidos se excluyen de los resultados comerciales y alternativas del catálogo. La búsqueda y validación utilizan únicamente los productos del tenant correspondiente.
- Ante una solicitud restringida se envía el aviso fijo. El compositor de respuestas no puede reformularlo como una oferta de venta o de escalamiento comercial.
- En un pedido mixto se conservan los productos permitidos, sin reutilizar el subtotal previo. Se ofrecen «Continuar sin ellos» y «Cancelar solicitud». Continuar vuelve a cotizar y requiere otra confirmación; no registra el pedido inmediatamente.
- Se conservan los datos de cliente expresamente proporcionados para continuar con los artículos permitidos.
- Un producto incierto queda pendiente de aclaración, sin precio ni confirmación. No desaparece silenciosamente del borrador. Una aclaración que identifique un producto permitido devuelve el flujo a la validación de catálogo.
- Se comprueba que «gel de limpieza sin alcohol» no se interprete como bebida ni se retire de la canasta por la expresión «sin alcohol». Las eliminaciones expresas de productos continúan funcionando.
- Se emite `whatsapp.commerce.restricted` con tenant, conversación, traceId, categorías y cantidades de productos restringidos, inciertos y conservados. El evento diferencia en su detalle la restricción de la necesidad de aclaración.

## Código y alcance

Rama local: `codex/whatsapp-channel-policy-20261103`.

Worktree de implementación:

`C:/Users/Messi/.codex/worktrees/via-meta-autoservicio-20261103/backend`

Base: `7b263734820f2936b367d4f1995ef15ef07f6b0d`, sobre la línea del backend que incorpora las correcciones recientes de subtotal y «Marcar tomado». No se sustituyó por la rama antigua del workspace MicroApp.

Archivos principales:
- `server/domain/whatsappCommercePolicy.js`: aviso, normalización de evidencia, clasificación de catálogo y bloqueo de escritura.
- `server/services/llmPlanner.js`: contrato e instrucciones compartidas para el proveedor y el simulador CLI.
- `server/services/agentRuntime.js`: decisión, continuación de productos permitidos y protección de confirmaciones.
- `server/services/toolRegistry.js`: filtro del catálogo y validación antes de persistir.
- `server/tests/whatsapp-commerce-policy.mjs`: regresiones locales; incluida en `test:backend`.
- `server/tests/llm-provider.mjs`: conservación de la evidencia del proveedor durante normalización.

No hay migraciones de base de datos, cambios de frontend, actualización del catálogo de producción ni mensajes reales enviados.

## Validación ejecutada

Node 24.22.1; almacenamiento temporal JSON y WhatsApp simulado.

1. Se reprodujo primero el defecto: una solicitud de tabaco se cotizaba y podía pedir confirmación.
2. La nueva regresión verifica restricción conocida, evidencia semántica, intento de handoff, ambigüedad, pedido mixto, botones, confirmación antigua, nueva cotización, pedido permitido final, contexto no alcohólico, bloqueo de escritura y separación entre tenants.
3. Pasó `test:backend`: smoke, continuidad de cotización, concurrencia, contrato de fallos, 50 escenarios Colombia / 60 pasos, contrato LLM, autenticación, contratos Google, WhatsApp y Embedded Signup, y la nueva política.
4. Pasó `test:architecture`: estados, configuración, outbox, concurrencia, contratos de escritura PostgreSQL y checkout.
5. Tras ajustar la conservación de productos inciertos y la expresión «sin alcohol», se repitieron y pasaron la regresión de política y la de continuidad de cotización.
6. `git diff --check` sin errores.

Comando dedicado: `npm run test:whatsapp-commerce`, desde el worktree del backend.

## Límites y estado de entrega

La validación descrita arriba corresponde a las pruebas previas a la publicación. El usuario autorizó commit, push y despliegue el 3 de noviembre de 2026. El destino verificado es `ventas-ia-backend-free` (`srv-db7sqqmq1p3s73elv1eg`), repositorio `ventas-ia-backend`, rama `main`, con Auto-Deploy desactivado. La publicación se acredita por el commit del despliegue Live y por las respuestas de `/health` y `/health/ready`, no únicamente por el push.

Las pruebas reproducen decisiones del proveedor y simulan sus respuestas HTTP: validan contratos y controles, no demuestran la precisión lingüística de DeepSeek real. La clasificación de todas las marcas, expresiones y productos posibles requiere una evaluación adicional con el proveedor real. El catálogo aporta controles complementarios sobre categorías y nombres conocidos; no reemplaza la interpretación contextual.

No se auditó ni modificó en esta tarea todo el comportamiento de los operadores humanos. El bloqueo evita que el flujo automático cree una tarea comercial por una restricción detectada; no certifica el contenido de cada mensaje que un operador pudiera escribir manualmente.
