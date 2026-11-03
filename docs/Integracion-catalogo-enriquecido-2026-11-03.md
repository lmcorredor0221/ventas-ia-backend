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

## Límites

- Las inferencias libres del modelo pueden seguir necesitando aclaración humana. Esta entrega no incorpora RAG, ReAct ni el refactor completo del intérprete/resolutor histórico.
- Los atributos explícitos usan claves y valores del catálogo; no existe una ontología universal de sinónimos de atributos. Las equivalencias contextuales corresponden al LLM y a evidencia de la tienda.
- Mayor contexto puede aumentar tokens del modelo; esta validación no mide latencia ni costo de una nueva sesión con DeepSeek real.
- Los CSV importados sustituyen el catálogo, no agregan parcialmente filas; una columna omitida queda vacía.
