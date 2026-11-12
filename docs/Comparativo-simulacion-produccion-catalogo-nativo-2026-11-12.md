# Comparativo: conversación de producción vs. catálogo nativo PostgreSQL

Fecha: 2026-11-12
Alcance: reproducción aislada y de solo lectura de la última conversación completa de producción de la tienda demo. No se enviaron mensajes a WhatsApp ni se escribieron datos en Supabase o en Google Drive.

## Condiciones comparables

La conversación original solicitaba una cubeta de huevos AAA, varios Cifrut de dos sabores, un brownie de arequipe, varios Chocoramo y un producto de tabaco. Este último queda fuera del pedido por la política comercial de WhatsApp. Se conservaron el orden de los mensajes, las cantidades, las selecciones y el medio de pago.

La réplica ejecutó:

- DeepSeek real para interpretación y respuesta.
- El mismo catálogo publicado en producción: 3.000 filas, versión `3f9420ee57ae9075079c` y el mismo `sourceHash`.
- PostgreSQL temporal local con la proyección nativa de productos y relaciones.
- Canal WhatsApp simulado: las respuestas se capturaron, sin entrega externa.
- Un perfil de cliente sintético con los mismos datos funcionales que la sesión de producción (nombre y dirección ya conocidos); no se copió información personal.

La única adaptación necesaria fue simular la respuesta de perfil del cliente: hoy el runtime consulta Google Sheets para ese perfil antes de entrar al flujo. No se simuló ni se leyó Google Drive para el catálogo.

## Resultado del flujo

| Etapa | Producción anterior | Réplica nativa | Resultado |
| --- | --- | --- | --- |
| Saludo | Respondió correctamente | 1,82 s | Equivalente |
| Interpretación inicial + política de tabaco | Aplicó la restricción y ofreció continuar | 14,32 s; misma restricción y botones | Equivalente |
| Continuar sin producto restringido | ~69,8 s antes de presentar la primera lista | 1,10 s | Mejoró 98,4 % en esta etapa |
| Selección de huevo | Opción de cubeta disponible | 0,24 s | Correcto |
| Selección Cifrut granadilla | Alternativa 1,5 L disponible | 0,22 s | Correcto |
| Selección Cifrut naranja | Alternativa 1,5 L disponible | 0,20 s | Correcto |
| Selección brownie | Brownie Mama-ia de arequipe disponible | 0,19 s | Correcto |
| Selección Chocoramo | Ponqué Chocoramo 65 g disponible | 1,67 s y luego resumen | Correcto |
| Continuar pedido | Pidió forma de pago | 0,20 s | Correcto |
| Medio de pago | Mostró resumen final y acciones | 1,42 s | Correcto |
| Confirmación | Registro de pedido y respuesta final | 3,01 s | Correcto |

El pedido final conservó las cinco líneas seleccionadas, sus cantidades y un subtotal de COP 53.893. La reproducción también mantuvo las acciones conversacionales esperadas: continuar, pago, confirmar, ajustar y hablar con la tienda.

## Telemetría comparada

### Comportamiento anterior observado en producción

Después de elegir “Continuar sin ellos”, la traza original hizo cinco lecturas de Google Sheets de catálogo en serie. Cada una terminó aproximadamente entre 11 y 15 segundos después de la anterior. La última completó cerca de los 69,8 segundos y fue seguida por `catalog.reconciliation.fallback` debido a un acceso a `map` sobre un valor indefinido.

Ese tramo explicó tanto la demora percibida como el riesgo de una lista incompleta o de que se escalara la conversación sin necesidad.

### Comportamiento de la réplica nativa

| Métrica | Resultado |
| --- | ---: |
| Búsquedas nativas | 5 |
| Duración de cada búsqueda | 358–512 ms |
| Promedio de búsqueda nativa | 426 ms |
| Candidatos máximos devueltos por búsqueda | 25 |
| Datos del catálogo transferidos al backend | 0 bytes de catálogo completo |
| Datos de candidatos transferidos | 28–30 KB por búsqueda |
| Errores de búsqueda, reconciliación o flujo | 0 |
| Llamadas de DeepSeek para interpretación | 2 |
| Tiempo total de esas llamadas | 15,28 s |

Las cinco recuperaciones trabajan con candidatos acotados; no hidratan ni recorren las 3.000 filas en Render. La mayor parte del tiempo inicial restante corresponde a DeepSeek, no a PostgreSQL.

## Productos y opciones recuperadas

La ruta nueva encontró todas las referencias elegidas en la conversación original:

- Huevos AA rojos familiar, cubeta de 30 unidades.
- Cifrut granadilla 1,5 L.
- Cifrut naranja 1,5 L.
- Brownie Mama-ia 70 g de arequipe.
- Ponqué Chocoramo 65 g.

Las listas mostraron las variantes necesarias para decidir. También apareció una observación de calidad: al final de las listas de Cifrut se incluyó una variante del sabor opuesto. No bloqueó la compra ni alteró la selección, pero revela que la fase de relaciones semánticas conserva candidatos de familia demasiado amplios en posiciones bajas. Es una mejora de ranking/precisión pendiente, no un fallo de disponibilidad ni una regresión de latencia.

La abreviación de las filas mantiene presentación y precio, pero en nombres largos como Mama-ia deja poco espacio para la variante. Conviene ajustar la prioridad del texto corto para conservar primero marca + sabor/variante y luego presentación.

## Hallazgos

1. La consulta nativa de PostgreSQL resuelve la causa principal de la espera extrema: reemplaza lecturas seriales a Google Sheets por candidatos acotados, simultáneos y locales a la base.
2. La reproducción no registró el `fallback` de reconciliación presente en producción.
3. La búsqueda escalonada permanece: recupera evidencia directa y por relaciones; no se redujo a coincidencia exacta ni se cargó el catálogo completo en el prompt.
4. DeepSeek sigue interpretando la intención y la solicitud; PostgreSQL solamente recupera candidatos y relaciones para fundamentar la selección.
5. Aún existe una dependencia operacional separada de Google Sheets para buscar el perfil del cliente. No afecta el catálogo nativo cuando Google está conectado, pero una desconexión de Google puede seguir bloquear la conversación antes de consultar el catálogo. Debe tratarse como una dependencia de perfil/checkout, no como una dependencia de búsqueda de productos.
6. La comparación no mide una red productiva real ni el tiempo de cola de Render. Sí mide el cambio de ruta de catálogo con el mismo conjunto publicado y confirma que la carga de 3.000 productos ya no cruza desde PostgreSQL al proceso de Render.

## Conclusión

La nueva implementación mejora de forma verificable el tramo crítico de recuperación de catálogo: la etapa equivalente bajó de alrededor de 70 segundos a 1,10 segundos en la réplica aislada, sin perder las opciones, la selección progresiva, el checkout ni la confirmación.

Antes de declarar el cambio listo para producción deben verificarse en una prueba controlada de producción: la telemetría `catalog.native_search`, la ausencia de `google_sheets_read_table` durante una consulta de productos y la ausencia de `catalog.reconciliation.fallback`. La mejora de precisión de resultados relacionados y la independencia del perfil de cliente respecto a Google son trabajos separados del objetivo principal de esta réplica.
