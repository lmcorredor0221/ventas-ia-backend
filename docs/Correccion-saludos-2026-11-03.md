# Saludos enviados a búsqueda de catálogo

## Evidencia y causa

La captura del 3 de noviembre muestra «Buenas» seguido de «No encontre una coincidencia clara en el catalogo…» y luego «Hola veci» sin respuesta visible. El primer texto corresponde al fallback de `AgentRuntime.handleCatalogQuery`.

En la versión desplegada `6c9c106`, el contrato del planner solo enumeraba intenciones comerciales. `normalizeProviderIntent` convertía cualquier intención desconocida (incluso greeting) en `catalog_query`, y el runtime enviaba todo lo restante a búsqueda. La regresión local reprodujo exactamente `catalog_query` cuando el proveedor devolvía `greeting`.

Se encontró además un error en `validateComposedReply`: `extractMoneyTokens` devuelve un Set, pero se invocaba `.some()` como si fuera un array. Eso podía descartar respuestas válidas del compositor y activar el respaldo determinístico.

No se recuperó la traza de producción del segundo mensaje «Hola veci». La captura no demuestra si quedó en cola, entró en atención humana o falló durante el procesamiento. No atribuirlo al token ni afirmar entrega posterior sin evidencia. Los logs stdout de Render consultados no contienen la traza conversacional.

## Cambio

- El LLM distingue semánticamente un saludo puro mediante `greeting`; no hay una lista de palabras para clasificar mensajes en producción.
- La misma llamada genera `greetingReply` con idioma y tono configurados por tenant, incluido `tendero_colombiano`. No se añade otra llamada de composición para saludar.
- Un saludo acompañado de productos, domicilio, modificaciones o un reclamo conserva su intención comercial correspondiente.
- El runtime responde sin buscar productos, crear pedidos o escalar por falta de coincidencias. Conserva carrito, subtotal, pago, campos pendientes y etapa existentes.
- La atención humana ya abierta y el modo manual siguen teniendo prioridad; este cambio no reanuda automáticamente una conversación retenida por la tienda.
- Una salida contradictoria `greeting` con candidatos de producto no elimina esos productos. Las restricciones comerciales continúan vigentes.
- Se corrige la iteración del Set y se comprueba que el validador admita redacción válida y rechace montos inventados.

## Validación

`npm run test:backend`: 12 scripts aprobados, incluyendo nueva regresión, continuidad de precios, concurrencia, fallos, 50 escenarios colombianos/60 pasos, autenticación y contratos Google/WhatsApp.

`npm run test:catalog`: 4 scripts aprobados. `npm run test:architecture`: 7 scripts aprobados.

Se ejecutaron dos rondas reales de DeepSeek (`deepseek-chat`), seis situaciones por ronda: saludos «Buenas», «Hola veci», saludo conversacional, saludo con producto, solicitud de domicilio sin productos y saludo con carrito activo. La segunda utilizó el catálogo de referencia de 300 productos. En ambas, la salida de WhatsApp y la persistencia fueron locales/simuladas: no se enviaron mensajes reales ni se modificó producción para probar.

| Caso con catálogo de 300 | Resultado | Duración del LLM |
| --- | --- | --- |
| Buenas | greeting; invita a contar qué necesita | 2627 ms |
| Hola veci | greeting; respuesta cercana | 2361 ms |
| Muy buenas, ¿cómo va todo por allá? | greeting; contesta e invita a continuar | 2440 ms |
| Hola veci, regálame una Coca-Cola de 1.5 L para domicilio | delivery_order; subtotal $7.200 | 2498 ms |
| Buenas noches para un domicilio | delivery_order; solicita datos/productos pendientes | 2499 ms |
| Hola veci con carrito activo | greeting; carrito y etapa intactos | No registrado en el resumen |

Ejemplo real: «¡Hola, vecino! Bienvenido a la tienda. Cuénteme qué necesita y con gusto le colaboro.» No es una plantilla fija; es la salida observada del modelo.

Repetir la regresión: `npm run test:greeting`. Para DeepSeek real, proporcionar `DEEPSEEK_API_KEY` en el entorno y `VIA_GREETING_REAL_LLM=1`; agregar `VIA_GREETING_CATALOG_300=1` para el catálogo completo. El test bloquea llamadas de red distintas del endpoint DeepSeek, usa WhatsApp mock y JSON temporal.

## Observabilidad y límites

Nuevo evento `agent.greeting.replied`, correlacionado por conversación/traceId, además de `llm.plan.created`, llamadas a herramientas y eventos de entrega existentes.

Las cinco llamadas detalladas con 300 productos usaron aproximadamente 47.500 tokens de entrada cada una porque el planner existente incluye todo el catálogo. Es una oportunidad de optimización separada; esta corrección no cambia la arquitectura de recuperación. Los 2,36–2,63 segundos son tiempo del proveedor en la prueba local, no latencia E2E de producción.

Tras desplegar, validar un nuevo saludo desde el comprador y comprobar `greeting`, `agent.greeting.replied` y entrega de Meta. No reenviar automáticamente mensajes anteriores: podrían duplicar respuestas.

## Publicación verificada

- Código: `43733d08bd0e2a6efd128997e97853b332509d5b`, incorporado a `backend/main`.
- Render: `dep-dbl6f6nf3r2c73dnc5q0`, estado `live` desde 2026-11-03 23:01:50 UTC (18:01:50 Colombia).
- `/health/ready`: `ok:true`, producción, PostgreSQL y WhatsApp live, sin errores ni advertencias.
- `https://via.leanagentbuilder.com/api/health`: `ok:true` a las 23:02:21 UTC.
- Pendiente de observación: entrega de un saludo nuevo por WhatsApp real. No se envió ningún mensaje al comprador durante esta validación.
