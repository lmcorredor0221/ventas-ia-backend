# Diagnóstico de producción: conversación, latencia y precisión del catálogo

**Fecha del análisis:** 11 de noviembre de 2026 (America/Bogotá)
**Ambiente revisado:** producción de VIA, tienda `demo-de-tienda`
**Despliegue observado:** `eb9c95a52e04e5dd4e8ee396112056699f0110ec` — `feat: consolidate catalog and checkout runtime`
**Alcance:** diagnóstico de solo lectura. No se modificaron código, configuración, datos, catálogo ni servicios de producción.

## Resumen ejecutivo

La última conversación no quedó abandonada ni falló la entrega del webhook de Meta. El mensaje de WhatsApp se aceptó en **80 ms** y el agente comenzó a trabajar casi de inmediato. La respuesta que parecía ausente llegó **69,8 s** después de que el cliente eligió continuar sin tabaco.

La demora no fue una consulta lenta de PostgreSQL ni una lectura de Google Drive. La telemetría confirma que el catálogo se obtuvo de `postgres_catalog`, con `cacheHit: true`; por lo tanto, ni siquiera se descargó el documento del índice desde PostgreSQL durante ese turno. El cuello de botella fue el cálculo local y síncrono del buscador/grafo en la única instancia de Render:

- se buscaron cinco productos en el mismo turno;
- cada búsqueda recorrió los 3.000 productos y reconstruyó estructuras sobre **108.577 relaciones** del grafo;
- aunque el código usa `Promise.all`, el trabajo costoso es CPU síncrona en Node.js, por lo que las cinco búsquedas se ejecutaron en la práctica una detrás de otra;
- entre 04:13:30 y 04:14:00 UTC, la instancia utilizó entre **84 % y 93 %** de su límite de CPU de `0,15` CPU;
- los cinco cálculos de catálogo sumaron aproximadamente **65,9 s**. El envío final a WhatsApp tomó alrededor de 1 s.

El aumento del catálogo contribuye al problema: la versión publicada contiene 3.000 productos y 108.577 relaciones, frente a aproximadamente 2.000 productos y 74,6 mil relaciones en la versión anterior. Sin embargo, la causa raíz no es que PostgreSQL sea lento: es que el algoritmo actual vuelve a escanear y reconstruir estructuras de un índice grande dentro del hilo principal por cada producto solicitado.

## Evidencia de la conversación reconstruida

La conversación persistida fue `wa-606970d3`. Las horas siguientes están en UTC; entre paréntesis se indica la hora Colombia (UTC-5).

| UTC | Colombia | Actor | Evento | Tiempo observado |
| --- | --- | --- | --- | --- |
| 04:11:54 | 23:11:54 | Cliente | Saludo: «Buenas noches». | — |
| 04:11:57 | 23:11:57 | VIA | Saludo personalizado. | 3,5 s desde el mensaje |
| 04:12:18 | 23:12:18 | Cliente | Pedido de huevos, tabaco, Cifrut, brownie y Chocorramo. | — |
| 04:12:36 | 23:12:36 | VIA | Aplicó correctamente la restricción de tabaco y ofreció continuar con los demás productos. | 17,8 s |
| 04:12:58 | 23:12:58 | Cliente | Eligió «Continuar sin ellos». | — |
| 04:12:58.729 | 23:12:58.729 | Meta → VIA | `POST /webhooks/whatsapp` respondió `200` en 80 ms. | 80 ms |
| 04:13:00–04:14:07 | 23:13:00–23:14:07 | VIA | Ejecutó cinco recuperaciones de catálogo para el pedido restante. | 67,3 s acumulados |
| 04:14:08.766 | 23:14:08.766 | VIA | Envió la primera pregunta de selección: cubeta de huevos AAA. | 69,8 s desde la elección |
| 04:15:47–04:17:10 | 23:15:47–23:17:10 | Cliente / VIA | Seleccionó las cinco alternativas y VIA generó el resumen. | respuestas de 1,7 a 3,2 s |
| 04:17:37–04:18:06 | 23:17:37–23:18:06 | Cliente / VIA | Continuó, eligió Bre-B y confirmó el pedido. | flujo normal |
| 04:24:19 | 23:24:19 | VIA | Informó que el pedido iba en camino. | conversación cerrada |

La conversación terminó con estado `closed_dispatched`, etapa `closed`, pago Bre-B y pedido despachado. Es decir: hubo una espera anormalmente larga, no un silencio permanente ni una pérdida del flujo.

## Qué ocurrió durante los 70 segundos

### La recepción de Meta y la cola no fueron el origen

- El webhook fue reconocido en 80 ms; por tanto, Meta no estuvo esperando una respuesta lenta de VIA.
- El agente inició el procesamiento inmediatamente después de la interacción.
- El registro de outbox muestra `queueAgeMs: 71833`, pero los eventos de catálogo ocupan precisamente ese mismo intervalo. No hay evidencia de 71 s de espera inactiva en una cola: el worker estuvo ocupado en cálculos del catálogo.
- Durante el bloqueo aparecieron escrituras de telemetría encoladas con esperas de 12,6 s y 13,8 s y una respuesta `503` en una consulta de la interfaz. Son efectos del hilo Node bloqueado, no la causa primaria de la demora del pedido.

### El catálogo sí se consultó desde PostgreSQL, no desde Google Drive

Hay dos nombres que hoy inducen a confusión:

1. La herramienta sigue llamándose internamente `google_sheets_read_table`.
2. Los campos históricos como `sourceRange` conservan el rango de la hoja de origen.

Pero para los cinco llamados lentos la telemetría registra de forma explícita:

- `source: "postgres_catalog"`;
- `cacheHit: true`;
- `cacheLoadWait: false`;
- `payloadBytes: 0`;
- `sourceRowCount: 3000`;
- versión `3f9420ee57ae9075079c`.

Esto demuestra que la ruta operativa usó el índice publicado en PostgreSQL que ya estaba en memoria. No hubo lectura de Google Sheets ni Google Drive dentro de este turno de pedido. Google continúa siendo el origen administrativo para sincronizar/actualizar el catálogo y puede intervenir en perfiles o proyecciones configuradas para ello, pero no explica esta latencia de búsqueda.

La consulta de metadatos del índice publicada en PostgreSQL se midió con `EXPLAIN (ANALYZE, BUFFERS)` y tomó **0,129 ms** de ejecución, sin lecturas de bloque. No es una medición de la búsqueda en aplicación: confirma que la recuperación del metadato publicado no es el cuello de botella. Además, el `cacheHit` prueba que ese metadato y el documento no se volvieron a cargar en la ruta lenta.

## Evidencia de rendimiento del buscador

La búsqueda de cinco productos arrancó aproximadamente al mismo tiempo, pero finalizó de forma secuencial:

| Consulta interpretada | Búsqueda de catálogo | Candidatos directos | Candidatos del grafo | Resultado devuelto |
| --- | ---: | ---: | ---: | ---: |
| `huevos AAA cubeta` | 13,981 s | 24 | 35 | 25 |
| `Chocorramo` | 12,401 s | 9 | 259 | 25 |
| `Cifrut naranja` | 13,262 s | 52 | 219 | 25 |
| `brownie Mamai arequipe` | 14,198 s | 18 | 79 | 25 |
| `Cifrut granadilla` | 12,091 s | 13 | 219 | 25 |

El total de esos cálculos es 65,9 s, coherente con los 69,8 s percibidos por el cliente después de incluir persistencia y el envío de WhatsApp.

El servicio de Render tenía una sola instancia y un límite de 0,15 CPU. Durante la parte pesada de la búsqueda:

| UTC | CPU usada | Límite | Utilización aproximada |
| --- | ---: | ---: | ---: |
| 04:13:30 | 0,1399 | 0,15 | 93 % |
| 04:14:00 | 0,1261 | 0,15 | 84 % |

La memoria se mantuvo alrededor de 422 MB sobre un límite de 537 MB (aprox. 79 %). No hubo evidencia de OOM, pero el margen es reducido para un índice en memoria y trabajo adicional de grafos.

## Causa raíz de la latencia

La causa confirmada se ubica en la ruta de recuperación, no en la red ni en PostgreSQL:

1. `server/services/agentRuntime.js` construye una búsqueda por cada producto identificado y las agrupa con `Promise.all`.
2. Cada llamada llega a `server/services/toolRegistry.js`, que aun con índice cacheado materializa una copia de los productos (`Object.values(index.products).map(...)`) y luego busca cada resultado por SKU dentro de esa copia.
3. `server/services/catalogKnowledgeIndex.js` recorre todos los productos compatibles para la evidencia directa.
4. En la misma función, `graphCandidateEvidence` vuelve a construir `nodesById`, `reverseRelations` y `alternativesByProduct`, recorriendo las 108.577 relaciones por cada consulta.
5. `relationEvidence` vuelve a filtrar todas las relaciones para los resultados finales.

`Promise.all` no paraleliza este trabajo porque esos recorridos no ceden el control al event loop: son operaciones síncronas de CPU. La primera búsqueda bloquea el proceso, después la siguiente, y así sucesivamente. El efecto es casi lineal respecto a la cantidad de productos solicitados dentro del mismo mensaje.

### Relación con el catálogo de 3.000 productos

El aumento sí es un factor contributivo:

- el índice actual tiene 3.000 productos, 4.647 nodos y 108.577 relaciones;
- el índice anterior documentado tenía aproximadamente 2.000 productos y 74.552 relaciones;
- las relaciones crecieron alrededor de 46 %, en parte porque las relaciones de alternativa se generan por pares dentro de cada familia.

No obstante, la degradación no se resuelve solo bajando el número de filas. El patrón de recorridos completos por producto solicitado seguirá escalando de forma deficiente con cualquier catálogo mediano si se mantienen la reconstrucción por consulta y el trabajo síncrono en la única instancia.

## Diagnóstico de precisión

### Lo confirmado

La conversación analizada terminó seleccionando referencias presentes en el catálogo: huevos, Cifrut de granadilla, Cifrut de naranja, brownie de arequipe y Ponqué Chocoramo. Por tanto, esta traza no demuestra una selección final incorrecta por sí sola.

Sí muestra señales técnicas que explican por qué en otras pruebas pueden entrar referencias poco pertinentes:

- La evidencia directa admite una coincidencia léxica siempre que el puntaje sea al menos `2.25` y exista alguna evidencia léxica.
- El vector registrado es `deterministic_lexical_fingerprint`; no es una incrustación semántica externa. En los cinco llamados `semanticCandidateCount` fue `0`.
- La expansión del grafo obtuvo hasta 259 candidatos para una sola consulta (`Chocorramo`) y 219 para las de Cifrut.
- Los atributos inferidos por el intérprete llegan como `retrievalHints` blandos: ayudan a puntuar, pero no garantizan cobertura de los atributos explícitos del cliente.
- El orden final es por `matchScore` y luego por `stock`; cuando los puntajes son cercanos, la existencia puede romper el empate aunque no represente mejor la intención del cliente.

### Causa probable de resultados poco precisos

El motor mezcla evidencia de texto, huellas léxicas y relaciones de grafo, pero no conserva una medida explícita de **cobertura de atributos críticos** en el resultado final. Por ejemplo, marca, sabor, presentación, tamaño o variedad pueden ser evidencia positiva, sin que la ausencia de uno de los atributos expresados reduzca de manera suficiente la elegibilidad.

Esto no debe corregirse con filtros rígidos que descarten opciones útiles. El ajuste recomendado es de ranking y explicación de evidencia: ponderar primero los atributos expresados por el cliente y exigir que cada opción enviada exponga por qué es compatible o qué ambigüedad permanece. Cuando falta un atributo crítico, debe mostrarse como alternativa para elegir, no como selección automática.

## Diagnóstico de los textos de opciones

Los títulos de WhatsApp están limitados a 24 caracteres. La implementación actual:

- elimina tokens comunes de los nombres entre candidatos;
- compacta algunas palabras;
- concatena nombre/marca y presentación;
- trunca el texto excedente con `...`.

La conversación lo evidenció con etiquetas como `Avicola loca... · #L164`, `Cifrut granad... · 1.5 L` y `Mama-ia 70 g A... · 70 g`. Aunque la selección utiliza un identificador opaco y seguro, el cliente pierde precisamente la marca, sabor o variante que necesitaba comparar.

El problema no es que se abrevie: es que hoy se abrevia antes de identificar cuál atributo diferencia una opción de otra. En algunos casos además se repite información de presentación en nombre y sufijo, desperdiciando el límite.

## Correcciones recomendadas, en orden de prioridad

No se aplicaron como parte de este diagnóstico.

### P0 — Recuperar respuesta en segundos

1. **Precalcular las adyacencias del grafo al publicar el índice.** Persistir o hidratar una vez `nodesById`, relaciones inversas y alternativas por producto. La búsqueda no debe reconstruirlas por consulta.
2. **Evitar escaneos completos repetidos.** Crear estructuras de recuperación por token/familia/marca/categoría y usar conjuntos candidatos acotados antes de puntuar. Mantener un fallback controlado para consultas de baja evidencia.
3. **Eliminar copias y búsquedas lineales innecesarias en `toolRegistry`.** Devolver la referencia indexada o un `Map<sku, producto>` en vez de materializar 3.000 objetos y hacer `rows.find(...)` por cada resultado.
4. **Procesar múltiples líneas con un plan de recuperación compartido.** Reutilizar las estructuras de índice y limitar la expansión de grafo por línea; `Promise.all` no aporta concurrencia para CPU síncrona.
5. **Aislar la CPU pesada.** Tras las optimizaciones anteriores, ejecutar el ranking/grafo en un worker thread o separar un worker de catálogo si la medición sigue superando el presupuesto. Escalar la instancia de Render puede aliviar, pero por sí solo no arregla la complejidad ni el bloqueo del event loop.

**Criterio de aceptación propuesto:** una solicitud de cinco productos debe producir la primera pregunta u oferta en menos de 5 s en p95 bajo catálogo de 3.000 productos, y no debe bloquear endpoints de la interfaz ni escrituras operativas.

### P1 — Aumentar precisión sin rigidizar la conversación

1. Añadir al resultado de búsqueda una matriz de evidencia por atributo: marca, familia, sabor/variante, presentación, unidad, peso/volumen y categoría.
2. Penalizar de forma gradual —no filtrar de forma absoluta— los candidatos que omiten atributos explícitos de alta importancia.
3. Distinguir `candidato compatible`, `candidato preferido` y `ambigüedad pendiente`. Solo el segundo puede consolidarse sin pregunta; los demás deben alimentar una lista de opciones.
4. Instrumentar el ranking por candidato: score desglosado, atributos cubiertos, atributos ausentes, tipo de relación y motivo de inclusión. Así se podrá demostrar por qué una referencia llegó a la lista.
5. Hacer que los tests de regresión incluyan solicitudes con marca, sabor y presentación explícitos y comprueben que una referencia incompatible no puede ocupar el primer lugar solo por stock.

### P1 — Hacer las opciones legibles en WhatsApp

1. Construir primero una lista de atributos diferenciadores entre las opciones: variante/sabor, marca y presentación.
2. Reservar el título de 24 caracteres para el mínimo distintivo legible, por ejemplo `Cifrut · Granadilla` o `Mamai · Arequipe`.
3. Colocar presentación, precio y disponibilidad en la descripción de hasta 72 caracteres, por ejemplo `1.5 L · $2.700 · 50 disponibles`.
4. Eliminar solo los tokens redundantes después de confirmar que el título conserva al menos un atributo diferenciador.
5. Mantener el ID opaco actual para la selección; el rediseño de texto no debe cambiar la resolución de la opción elegida.

### P2 — Corregir observabilidad heredada

1. Renombrar la telemetría y el contrato interno de `google_sheets_read_table` a un nombre neutral de catálogo, sin romper compatibilidad de las llamadas existentes.
2. Separar métricas: `catalog.index_load`, `catalog.candidate_generation`, `catalog.graph_expansion`, `catalog.rank`, `catalog.label_format` y `catalog.whatsapp_send`.
3. Registrar `eventLoopLag`, CPU por fase, tamaños de los conjuntos candidatos y número de relaciones recorridas.
4. Conservar `source: postgres_catalog` como campo obligatorio. Así una futura alerta no confundirá la ruta operativa con Google.

## Validación propuesta antes de publicar correcciones

1. Copia aislada del índice publicado de `demo-de-tienda` con 3.000 productos y 108.577 relaciones.
2. Repetir el turno de cinco productos de esta conversación y medir cada fase.
3. Casos de precisión: marca/sabor/presentación explícitos, errores ortográficos, familia amplia y múltiples variantes.
4. Pruebas de texto de listas con límite real de WhatsApp: títulos de máximo 24 caracteres y descripciones de máximo 72, sin perder el atributo que diferencia cada opción.
5. Prueba de carga de cinco y diez líneas en un mensaje, verificando que las llamadas HTTP de la interfaz y las escrituras de eventos no queden bloqueadas.
6. Comparar p50/p95 antes y después, y verificar que el webhook mantenga su respuesta rápida.

## Conclusión

La hipótesis de que el crecimiento del catálogo deterioró la experiencia es válida, pero la causa exacta no es un PostgreSQL lento ni una dependencia de Google Drive por mensaje. PostgreSQL ya es la fuente operativa de este turno y entregó un índice cacheado. La demora proviene de recorrer repetidamente un grafo grande y todos los productos en CPU dentro del proceso Node limitado de Render.

La recuperación del rendimiento requiere optimizar la estructura de recuperación y evitar trabajo repetido; la mejora de precisión requiere que el ranking conserve y evalúe los atributos expresados; y la claridad de las listas requiere decidir qué atributo diferencia cada opción antes de abreviar. Son tres correcciones compatibles y focalizadas, sin cambiar el flujo conversacional que sí completó correctamente esta conversación.
