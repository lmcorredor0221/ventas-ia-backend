# Integración del catálogo enriquecido

Fecha: 2026-11-03. Base de producción: `7abeb5cfd49d8525454a24cffd066de8628b052a`.
Rama de trabajo: `codex/enriched-catalog-release-20261103`.

## Qué se recupera y completa

Se recupera selectivamente el contrato de catálogo de `0069a31`, conservado en la rama histórica `codex/backend-plan-payload-20261020`. No se reemplaza el backend actual ni se publica esa rama histórica completa.

- CSV, plantilla de Sheets y lector: 16 columnas A:P. Las seis adicionales son `descripcion`, `etiquetas`, `familia_producto`, `presentacion_normalizada`, `atributos_json` y `origen_catalogo`. También se acepta el encabezado `atributos` que usa la demo.
- Catálogos anteriores: los CSV de diez columnas siguen siendo válidos. Los rangos persistidos A:H/A:J se amplían al leer, conservando archivo, pestaña y filas. No se requiere migración de esquema PostgreSQL ni reconectar Google.
- Importación: escribe y limpia las 16 columnas del catálogo, conserva la pestaña configurada y amplía filas si hace falta. Una sustitución por un CSV antiguo deja vacía la metadata anterior, evitando atributos asociados a productos equivocados. La revisión de importación invalida la caché de lectura.
- Búsqueda: recupera candidatos por nombre, marca, alias, descripción, presentación, familia, etiquetas y valores de atributos JSON. Nombre/marca tienen mayor peso que menciones secundarias. Se recuperan también las regresiones históricas sobre el catálogo de 300 productos.
- Filtros: `query`, `sku`, categoría y `attributes` se combinan; el SKU es exacto. Un atributo explícito incompatible o ausente no se ignora aunque el LLM sugiera un SKU. Se conserva la escalación humana existente ante falta de evidencia.
- LLM: recibe metadata del tenant y debe interpretar modismos y contexto. No se añadió una equivalencia fija entre «personal», «grande» o «familiar» y un tamaño. La recuperación textual no sustituye al modelo ni garantiza por sí sola una interpretación correcta.
- Aislamiento: cada consulta usa el catálogo y las credenciales del tenant. El catálogo de referencia de 300 productos se incorpora como fixture de pruebas, sin sembrarlo automáticamente en otros tenants.
- PostgreSQL conserva el objeto de producto en `payload`; `listProducts` recupera ese payload. No se alteran tablas ni columnas.

Se mantienen las correcciones de totalización, continuidad de cotización, acciones del tendero, mensajería interactiva, persistencia y restricciones del canal.

## Validación local realizada

Node 24.22.1. Sin mensajes reales de WhatsApp ni llamadas a DeepSeek real.

| Comando | Resultado |
| --- | --- |
| `npm run test:catalog` | 4 scripts correctos: importación, metadata y lectura, runtime con atributos, recuperación sobre 300 productos |
| `npm run test:backend` | 11 scripts correctos; incluye 60 pasos / 50 escenarios Colombia, precios, concurrencia, proveedor, Google, WhatsApp, registro integrado y restricciones |
| `npm run test:architecture` | 7 scripts correctos: estados, configuración, outbox, concurrencia, escritura PostgreSQL y checkout |
| `git diff --check` | Sin errores |

La nueva prueba falló antes del cambio porque `description` desaparecía al importar. Tras el cambio comprueba búsquedas exclusivamente por descripción, etiquetas y atributos; filtros combinados; incompatibilidad con un SKU sugerido; booleanos; precio; aislamiento; lectura A:J histórica; limpieza e invalidación tras importación.

La prueba del proveedor inspecciona el cuerpo enviado al endpoint DeepSeek mediante una respuesta simulada: demuestra que la metadata llega al contrato del modelo. No equivale a repetir los 40 casos E2E con DeepSeek real ni a una conversación real en producción.

## Despliegue y comprobación

Servicio objetivo: `ventas-ia-backend-free`, `srv-db7sqqmq1p3s73elv1eg`, repositorio `lmcorredor0221/ventas-ia-backend`, rama `main`. Despliegue manual por SHA, pues autodeploy está desactivado. Se comprobarán estado live, salud y una lectura de catálogo en la demo, sin emitir WhatsApp ni modificar su hoja.

Demo: `demo-de-tienda`, hoja `1QpR44qdL4EEpLgIPEZwoTLb43hnGjWVUObAsK3PfAZc`. Los 300 productos y metadata ya estaban cargados. La verificación debe recuperar descripción y atributos y mantener Coca-Cola 1.5 L + Chocoramo = COP 10.000.

### Resultado comprobado en producción

- Código publicado en `backend/main`: `6c9c10616e210c1b7dd2e01b6bae5f9f206152a4`.
- Render: despliegue `dep-dbl5ghc9v7es73c9si60`, estado **live**, finalizado 2026-11-03 21:55:55 UTC (16:55:55 Colombia).
- `/health/ready`: HTTP 200, producción, PostgreSQL, WhatsApp live, sin advertencias ni errores. `/api/health` a través de VIA: HTTP 200.
- Lectura autenticada de `google_sheets_read_table` para `demo-de-tienda`: HTTP 200, `source=google_sheets_live`, **300 filas, 300 con descripción y 300 con atributos**.
- `BOG-BEB-044`: Coca-Cola original, 1.5 L, COP 7.200. `BOG-PAN-019`: Ponque Chocoramo, 65 g, COP 2.800. Suma comprobada: **COP 10.000**.
- Búsqueda `query="pruebas locales"`, texto de descripción: 102 resultados.
- `sku=BOG-BEB-044` con `attributes.measure={canonicalAmount:1500,canonicalUnit:"ml"}`: un resultado, COP 7.200.
- Mismo SKU con `canonicalAmount:500`: cero resultados. No se ignora el atributo incompatible.

Se usó la sesión existente de VIA y su protección CSRF. El primer intento sin encabezado CSRF recibió 403; la comprobación se completó siguiendo el mecanismo normal de la aplicación. No se cambiaron permisos ni se expusieron tokens. Estas consultas actualizan la caché operativa y la traza de prueba; no escribieron la hoja, crearon pedidos ni enviaron WhatsApp.

El frontend no requirió cambios ni un nuevo despliegue para esta entrega. El commit documental posterior solo registra esta comprobación; el código ejecutado sigue siendo `6c9c106`.

## Límites

- Las inferencias libres del modelo pueden seguir necesitando aclaración humana. Esta entrega no incorpora RAG, ReAct ni el refactor completo del intérprete/resolutor histórico.
- Los atributos explícitos usan claves y valores del catálogo; no existe una ontología universal de sinónimos de atributos. Las equivalencias contextuales corresponden al LLM y a evidencia de la tienda.
- Mayor contexto puede aumentar tokens del modelo; esta validación no mide latencia ni costo de una nueva sesión con DeepSeek real.
- Los CSV importados sustituyen el catálogo, no agregan parcialmente filas; una columna omitida queda vacía.
