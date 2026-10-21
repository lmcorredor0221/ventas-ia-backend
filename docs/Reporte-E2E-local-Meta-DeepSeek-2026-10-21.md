# Reporte E2E local: Meta simulada y DeepSeek real

**Fecha:** 21 de octubre de 2026
**Evidencia:** `test-results/e2e-local/20261021023351_238217d0/`
**Ámbito:** desarrollo local. No hubo despliegue, cambios a producción ni envío de mensajes reales.

## Resultado

| Control | Resultado |
| --- | --- |
| Escenarios oficiales ejecutados | 40/40 |
| Escenarios aprobados por la matriz actual | 11/40 |
| Llamadas DeepSeek reales | 118 |
| p95 acuse del webhook | 26 ms |
| p95 procesamiento asíncrono | 7.440 ms |
| Fuente PostgreSQL local sin cambios | Sí |
| Contratos Meta simulados | 5/5 aprobados |
| Red externa no permitida | Ninguna |
| Listo para piloto autónomo | No |

La fuente fue `ventas_ia_dev` en loopback, usada sólo para obtener un clon lógico. Cada caso se ejecutó sobre un tenant sombra con catálogo de referencia de 300 productos. El simulador verificó challenge, firma HMAC, deduplicación, resolución de tenant por `phone_number_id` y payloads Graph, sin contactar a Meta.

## Qué funciona

1. DeepSeek se usó mediante `provider_api`; no hubo respuestas simuladas ni fallbacks de LLM en la corrida.
2. El webhook acusa antes de procesar la conversación y cumple el objetivo de menos de un segundo.
3. El flujo del tendero quedó validado: toma el pedido, pasa a alistando, lo marca en camino, envía exactamente un aviso al cliente, cierra la conversación y un mensaje posterior abre una conversación nueva.
4. La búsqueda evita una sustitución peligrosa: `salmon` no debe convertirse en `Saltin` por una similitud ortográfica débil.
5. Los mensajes de categoría y las opciones de pago conservan nombre, presentación, precio y stock del catálogo del tenant sombra.

## Hallazgos que bloquean el piloto

### P0: el borrador no conserva siempre todas las líneas durante las aclaraciones

En escenarios de variantes o typos, una respuesta posterior puede conservar una línea resuelta y degradar otra a texto, o llegar a subtotal cero al atravesar pago y confirmación. Se debe garantizar que una aclaración fusione cada `rawItemId` con el borrador anterior y que pago/confirmación no reemplacen líneas, subtotal ni dirección ya validados.

### P0: la decisión de variantes todavía necesita una interacción completa

El agente reconoce correctamente que `arroz Diana`, `aceite Premier` o `chocoramo` pueden tener varias presentaciones, pero el flujo de selección no siempre transforma esa lista en una respuesta interactiva consumible y luego en una línea de pedido. El comportamiento correcto es: mostrar opciones reales, registrar la elección y sólo entonces recalcular subtotal, pago y confirmación.

### P1: la matriz E2E aún compara nombres de la semilla histórica

Varias respuestas son comercialmente válidas con el catálogo de 300 referencias, pero la aserción exige nombres o tamaños de la semilla inicial de 100. Por ejemplo, una consulta genérica de bebidas puede ofrecer Agua Cristal o Aloe; la prueba debe verificar que las opciones pertenezcan a la necesidad, estén activas, tengan precio/stock y no contengan una sustitución incompatible. Esto no se debe resolver forzando los SKU de prueba en el runtime.

### P1: recomendaciones necesitan diversidad orientada a la ocasión

La recuperación ya utiliza nombre, marca, alias, descripción, etiquetas, familia y presentación. Falta una política de diversidad para que una recomendación de onces, lonchera o desayuno no devuelva cuatro variantes muy cercanas y priorice un conjunto útil de dos a cuatro opciones del tenant.

## Siguiente ciclo de desarrollo

1. Introducir ofertas interactivas de variante, con idempotencia, vencimiento y validación de conversación/tenant.
2. Persistir el borrador por `rawItemId` durante aclaración, pago y confirmación; añadir contratos para subtotal distinto de cero cuando haya líneas resueltas.
3. Cambiar la matriz E2E a expectativas semánticas: familia de producto, presentación explícita, precio, stock, subtotal, campos faltantes, interacción y ausencia de sustitución. Mantener coincidencias exactas sólo cuando el cliente nombra una marca/SKU/presentación concreta.
4. Añadir selección diversa por ocasión y presupuesto sin convertir `familiar`, `grande` o `personal` en reglas nacionales fijas.
5. Repetir los 40 casos y exigir que la matriz semántica, los contratos Meta, DeepSeek real, aislamiento PostgreSQL y el flujo del tendero aprueben antes de declarar el piloto listo.
