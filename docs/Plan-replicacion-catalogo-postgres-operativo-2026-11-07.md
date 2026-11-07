# Plan de replicación operativa del catálogo en PostgreSQL

**Fecha:** 2026-11-07
**Estado:** Fase inicial implementada localmente; worker y publicación atómica preparados detrás de banderas; pendiente backfill, shadow y despliegue controlado.
**Alcance:** catálogo por tenant, sincronización desde Google Sheets/Drive, índice de relaciones, búsqueda operativa, consistencia, observabilidad y rollback.

## 1. Decisión

Google Sheets/Drive continúa siendo la fuente administrativa del catálogo. PostgreSQL será la fuente operativa publicada para las conversaciones y la edición manual de pedidos.

El flujo objetivo es:

```text
Google Sheets/Drive
  → sincronización por tenant
  → validación y normalización
  → comparación por SKU y huella de fila
  → productos + versión publicada
  → grafo/índice de búsqueda
  → DeepSeek interpreta la solicitud
  → PostgreSQL recupera candidatos reales
```

El catálogo no se enviará completo al prompt del sistema. DeepSeek seguirá interpretando intención, familia, presentación, cantidad y atributos; PostgreSQL y el índice de relaciones devolverán la evidencia real.

## 2. Diagnóstico confirmado

La implementación anterior ya tenía tablas `products`, `drive_files` y `catalog_knowledge_indexes`, pero el webhook todavía hacía lo siguiente:

1. leer Google Sheets durante la conversación;
2. reconstruir el índice en el proceso;
3. persistir la proyección del catálogo antes de responder;
4. buscar sobre las filas recién obtenidas.

Esto generaba acoplamiento, latencia y una ventana de inconsistencia. Además, el runtime podía enviar el campo legado `googleSheets.range` mientras la interfaz actualizaba `googleSheets.catalogRange`.

La captura de producción —Coca-Cola y Chocorramo sin coincidencia— es compatible con una lectura del rango equivocado, una proyección incompleta o un índice construido con cero filas. El grafo no puede recuperar un producto que no llegó a su fuente de datos.

## 3. Cambios ejecutados en esta fase

- Se creó un resolver único de rango efectivo: `catalogRange`, con `range` solamente como fallback de migración.
- Se agregó `CATALOG_READ_SOURCE=google|postgres|shadow`, con valor predeterminado `google` para no alterar producción; el administrador puede sobreescribirlo por tenant mediante `config.catalog.readSource`.
- El modo PostgreSQL puede cargar la última versión publicada del índice desde `catalog_knowledge_indexes`.
- La proyección PostgreSQL puede operar de forma incremental cuando `POSTGRES_INCREMENTAL_PERSISTENCE_ENABLED=true`.
- Se preparó `CatalogSyncWorker` para sincronizar por tenant fuera del webhook; permanece desactivado salvo `CATALOG_SYNC_WORKER_ENABLED=true`.
- El worker usa `persistCatalogSnapshot` para publicar productos, archivos e índice en una transacción; si falla, conserva la versión anterior.
- Las respuestas de catálogo incluyen fuente, versión, rango efectivo, conteo de filas e información de recuperación.
- La telemetría debe diferenciar lectura de Google, lectura PostgreSQL, sincronización, candidatos directos, grafo y semántica.

## 4. Fuente y versiones

Cada tenant debe tener una única versión publicada identificada por:

- `tenant_id`;
- `catalog_version`;
- `source_ref`;
- `source_range`;
- `source_hash`;
- `row_count`;
- `status`;
- `published_at`.

La nueva versión solo se publica después de validar filas, SKU, precios, stock, estructura y relaciones. Si falla, se conserva la última versión válida.

## 5. Sincronización

Se soportarán tres activadores:

1. actualización explícita desde la interfaz;
2. revisión periódica de la referencia y fecha de modificación del archivo;
3. sincronización bajo demanda cuando la versión publicada no exista o esté vencida.

La lectura de la hoja puede ser completa para obtener una fotografía consistente, pero la escritura en PostgreSQL debe comparar por SKU y huella de fila. Solo se actualizan filas nuevas o modificadas y se retiran las que desaparecieron de la fuente validada.

La sincronización debe ejecutarse en segundo plano, nunca dentro del webhook de WhatsApp. El worker implementado realiza una revisión periódica completa y aprovecha la huella/versionado del índice para no republicar si el catálogo no cambió. La detección fina por fecha de modificación de Drive y el delta por fila quedan como optimización posterior; no se deben activar sin validar primero la paridad.

## 6. Publicación atómica

La proyección de productos y el índice derivado deben compartir la misma versión lógica. El proceso recomendado es:

```text
staging
  → validar
  → construir relaciones e índice
  → persistir productos e índice
  → publicar puntero de versión
```

Durante el proceso, las conversaciones continúan usando la versión anterior. El worker implementado lee y normaliza sin persistir, construye el índice y luego ejecuta la publicación de productos + archivos + índice en `persistCatalogSnapshot`. No se debe publicar una proyección parcial.

## 7. Búsqueda y grafo

Se reutilizan `CatalogSearchService`, `catalogKnowledgeIndex` y `CatalogResolutionService`.

El LLM entrega una hipótesis estructurada. El índice devuelve candidatos reales respetando los atributos explícitos. Por ejemplo, `Coca-Cola 1.5 L` puede devolver Original y Zero, pero no 400 ml ni 3 L.

El grafo sigue siendo genérico y por tenant: familias, productos, marcas, categorías, presentaciones, sabores, atributos y alternativas. No se añaden reglas específicas por marca.

## 8. Resiliencia

- Google no disponible: consultar la última versión PostgreSQL válida y marcarla como posiblemente desactualizada.
- Estructura inválida: rechazar la sincronización y conservar la versión anterior.
- SKU duplicado: fallar validación con detalle para el administrador.
- Error de índice: no cambiar el puntero publicado.
- Concurrencia: un lock por tenant evita dos sincronizaciones simultáneas.
- Rollback: `CATALOG_READ_SOURCE=google` devuelve temporalmente la consulta a Google.

## 9. Despliegue gradual

1. **Google:** comportamiento actual, pero con rango canónico y telemetría ampliada.
2. **Shadow:** se consultan Google y PostgreSQL; se comparan resultados sin cambiar la respuesta.
3. **PostgreSQL por tenant:** se activa solo después de comprobar paridad.
4. **PostgreSQL general:** se activa cuando los tenants piloto cumplan los criterios.

## 10. Criterios de aceptación

- El rango efectivo usado coincide con el que el tenant guardó.
- La réplica conserva SKU, nombre, descripción, presentación, atributos, precio, stock y disponibilidad.
- No hay duplicados por `(tenant_id, sku)`.
- Una falla de Google no produce falsamente “producto inexistente” si existe una versión PostgreSQL válida.
- Coca-Cola 1.5 L y Chocorramo recuperan sus opciones reales.
- La consulta operativa de catálogo no hace una lectura de Google ni una escritura completa de PostgreSQL durante el webhook.
- p95 de búsqueda local inferior a 300 ms, medido por separado de DeepSeek y Meta.
- La sincronización es idempotente y deja evidencia de filas leídas, modificadas, eliminadas y publicadas.
- Los pedidos conservan el precio y la versión del catálogo usados al confirmar.

## 11. Pendiente antes de activar en producción

- Ejecutar backfill del tenant demo.
- Comparar filas Google/PostgreSQL por SKU y hash.
- Validar en PostgreSQL real la migración 015 y `persistCatalogSnapshot` con una actualización, una eliminación y un SKU nuevo.
- Ejecutar modo shadow.
- Verificar manualmente Coca-Cola 1.5 L, Chocorramo, variantes y productos nuevos.
- Activar PostgreSQL por tenant (`config.catalog.readSource=postgres`) y conservar rollback.

## 12. Ejecución local realizada

Se añadieron contratos locales para comprobar que:

- el modo PostgreSQL no consulta Google durante la conversación;
- el rango canónico `catalogRange` prevalece sobre el campo legado `range`;
- el worker no persiste durante la lectura, construye el índice y entrega una única instantánea para publicación;
- la telemetría registra fuente, versión, filas, candidatos directos, grafo y semántica.

También se expuso `POST /api/saas/tenants/:tenantId/google/catalog/sync` para que el propietario solicite una sincronización explícita. El endpoint reutiliza el mismo lock por tenant y la misma publicación atómica del worker periódico.

La bandera `CATALOG_READ_SOURCE` continúa en `google` por defecto. Esta implementación no cambia producción ni hace backfill automáticamente.
