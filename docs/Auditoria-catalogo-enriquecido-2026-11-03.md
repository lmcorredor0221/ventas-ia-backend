# Auditoría de descripción y atributos en el catálogo

Fecha: 2026-11-03. Alcance: revisión del código, historia Git y contratos locales. No se modificó ni desplegó código de aplicación ni se alteró el catálogo de producción durante esta revisión.

## Conclusión

El soporte enriquecido **sí fue implementado**. Está en el commit `0069a31bb92909a4d26d285272e071b0eb9e5909` (2026-10-21), mensaje `feat: harden tenant ordering and semantic resolution`, conservado en la rama `codex/backend-plan-payload-20261020`.

La comparación del remoto backend confirmó estas referencias:

- `refs/heads/codex/backend-plan-payload-20261020`: `eb1a56dce20fbbf546e02008ffd0abb67106a976`, descendiente del commit enriquecido.
- `refs/heads/main`: `7b263734820f2936b367d4f1995ef15ef07f6b0d`, documentación posterior al código `2276c4742ec88efbe237f6778ae626a45f40fb19`, cuyo despliegue fue comprobado en la corrección de Marcar tomado.

Los archivos comparados de `backend/main` no contienen ese contrato enriquecido. Es una diferencia entre las líneas de código conservadas; la implementación no se perdió del repositorio. Esta auditoría no demuestra por qué el proceso histórico de publicación dejó esa diferencia ni atribuye una causa de proceso sin evidencia.

## Comparación comprobada

| Capacidad | Rama enriquecida | backend/main revisado |
| --- | --- | --- |
| Importador CSV | 16 columnas | 10 columnas |
| Rango predeterminado de Sheets | A:P | A:J |
| Descripción, etiquetas y familia | Importa y lee; se usan en recuperación | No se importan ni se leen del catálogo |
| Presentación normalizada | Importa, lee y compara | No se importa ni se lee ese campo |
| Atributos JSON | Importa y conserva | Se omiten |
| Búsqueda de una propiedad que existe solo en atributos JSON | No implementada en el ranking inspeccionado | No implementada |

### Evidencia de código enriquecido

- `server/services/catalogImportService.js`: `CANONICAL_HEADERS`, alias de `atributos_json` (acepta `atributos`), validación JSON, `catalogRowsToSheetValues` y `catalogRowToProduct`.
- `server/services/googleWorkspaceService.js`: estructura `Catalogo!A1:P1000` de 16 columnas.
- `server/services/toolRegistry.js`: `readLiveCatalogRows`, `parseCatalogRows` y `rankRowsByQuery`. El ranking pondera nombre/marca, SKU/familia/alias y texto de categoría/presentación/descripción/etiquetas. No recorre el objeto `attributes`.
- `server/domain/semanticContracts.js`: conserva atributos del intérprete y productos candidatos; compara presentación y calificativos textuales. `candidateText` tampoco incluye el objeto `attributes`. Conservar el JSON no equivale a evaluar todas sus claves al resolver.
- `server/services/llmPlanner.js`: pide al intérprete un marco semántico con hipótesis y atributos; la extracción de atributos no demuestra por sí sola que la recuperación los aproveche.

## Validaciones ejecutadas

Tres contratos existentes pasaron localmente, con entorno de prueba, almacenamiento JSON temporal y sin credenciales de proveedores:

1. `server/tests/catalog-reference-300.mjs`.
2. `server/tests/catalog-retrieval-contract.mjs`.
3. `server/tests/catalog-import.mjs` (incluye una búsqueda contextual de lonchera).

Además se procesó el mismo CSV de 300 productos ya cargado en la demo con los dos importadores:

| Resultado | Enriquecido | backend/main |
| --- | ---: | ---: |
| Productos válidos | 300 | 300 |
| Columnas emitidas | 16 | 10 |
| Productos con descripción conservada | 300 | 0 |
| Productos con atributos conservados | 300 | 0 |
| Productos con presentación normalizada conservada | 300 | 0 |
| Productos con etiquetas conservadas | 300 | 0 |

Se probó también `ToolRegistry` con un lector de Sheets simulado en memoria y una bolsa de mercado ficticia. Su descripción contenía «biodegradable» y solo sus atributos JSON contenían `material: algodon`. No se hicieron solicitudes a Google, WhatsApp o DeepSeek.

| Lector/rango | Consulta biodegradable | Consulta algodon | JSON conservado |
| --- | ---: | ---: | --- |
| Enriquecido, A:P | 1 resultado | 0 resultados | Sí |
| Enriquecido, A:J explícito | 0 resultados | 0 resultados | No |
| backend/main, A:P | 0 resultados | 0 resultados | No |
| backend/main, A:J | 0 resultados | 0 resultados | No |

Estas son verificaciones locales del contrato y recuperación; no una nueva ejecución de los 40 casos con DeepSeek real ni una validación de conversación en producción.

## Brechas para una integración posterior

1. Recuperar selectivamente el contrato enriquecido sobre el backend actual, conservando las correcciones recientes de continuidad de precios, estado del pedido, persistencia y onboarding. No sustituir el backend completo por la rama antigua.
2. Migrar de forma controlada los rangos históricos A:J de cada tenant. Cambiar únicamente el rango por defecto no basta: el runtime pasa rangos explícitos y `readLiveCatalogRows` los respeta. Conservar los identificadores de las hojas y el aislamiento entre tenants.
3. Alinear importación, lectura, plantilla de hoja y limpieza de rangos. La importación enriquecida escribe A:P pero usa el rango persistido para limpiar; un rango antiguo podría dejar metadatos sobrantes al reducir filas.
4. Completar un contrato verificable para atributos estructurados usados en búsqueda/resolución. La implementación actual conserva el objeto, pero no garantiza recuperar ni comprobar propiedades presentes exclusivamente en él. Las medidas explícitas deben seguir verificándose y la evidencia insuficiente debe escalar según la política de negocio.
5. Validar lectura del catálogo vivo, búsqueda por descripción, propiedad solo en JSON, tenant antiguo A:J, compatibilidad con el encabezado `atributos`, precios, aislamiento y continuidad del pedido antes de publicar.

## Estado del catálogo demo

La operación anterior dejó 300 productos en la hoja de Demo De Tienda, con los campos ampliados guardados en K:P y respaldo local. Esta auditoría no añadió productos ni cambió precios, existencias o categorías. La descripción de esa operación debe entenderse como una limitación del backend publicado, no como ausencia de trabajo previo en el repositorio.
