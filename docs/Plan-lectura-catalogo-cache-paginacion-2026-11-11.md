# Plan: lectura eficiente del catálogo por tenant

**Fecha:** 2026-11-11
**Estado:** fases 0–2 implementadas localmente; pendiente de validación en producción
**Alcance:** lectura del catálogo operativo desde PostgreSQL, contexto de pedido manual, búsqueda, caché, paginación, telemetría y validación de ancho de banda.

## 1. Objetivo

Eliminar la descarga repetida del catálogo completo en cada solicitud de contexto de pedido manual.

El comportamiento objetivo es:

```text
GET /conversations/:id/manual-order
  -> identifica tenant y catalogVersion
  -> reutiliza catálogo cacheado si la versión no cambió
  -> consulta solamente la página o los resultados solicitados
  -> devuelve 25–50 productos como máximo
```

La solución debe evitar que una consulta operativa de fecha, cantidad o búsqueda transfiera y procese un documento JSON de varios megabytes.

### Implementación 2026-11-11

Se aplicaron las fases 0–2 en el backend:

- `PostgresStore` consulta primero metadata de la versión publicada, sin leer `document`.
- `CatalogSearchService` conserva un LRU por tenant y versión, con promesa compartida para cargas concurrentes.
- La primera página manual está limitada a 25 filas (máximo configurable: 50); la respuesta incluye cursor, versión y conteos.
- La confirmación manual vuelve a consultar únicamente los SKU elegidos, no una página completa.
- Se añadieron métricas de hit/miss/wait/eviction, bytes del documento en cache miss y bytes de las respuestas manuales.
- Se agregó una ruta paginada para UI: `GET /api/tenants/:tenantId/catalog/products?query=&cursor=&limit=`.

No se modificaron el esquema ni la sincronización desde Google. PostgreSQL continúa siendo la fuente operativa del índice publicado; Google Drive queda fuera de la ruta de lectura manual cuando el tenant usa `catalog.readSource=postgres`.

## 2. Diagnóstico confirmado

### 2.1 Comportamiento anterior a las fases 0–2

La ruta actual es:

```text
GET /api/conversations/:id/manual-order
  -> ManualOrderService.context()
  -> ManualOrderService.catalog()
  -> tools.googleSheetsReadTable(... purpose: manual_order_catalog)
  -> PostgresStore.getPublishedCatalogKnowledgeIndex(tenantId)
  -> SELECT document FROM catalog_knowledge_indexes ... LIMIT 1
  -> Object.values(index.products)
  -> devuelve el catálogo completo
```

Hallazgos que motivaron el cambio:

1. La consulta a PostgreSQL se ejecuta en cada llamada a `context()` que necesita cargar productos.
2. La consulta filtra por `tenant_id`, por lo que obtiene una versión completa para el tenant solicitado.
3. No hay una caché de lectura que evite la consulta antes de ejecutar `getPublishedCatalogKnowledgeIndex()`.
4. `cache_policy: 'short_ttl'` se envía en el payload, pero no impide la lectura del documento completo.
5. Para `manual_order_catalog`, el límite se establece con `rows.length`, por lo que se devuelven los 2.000 productos.
6. La caché de `CatalogSearchService` se hidrata después de leer PostgreSQL; por tanto, actualmente no evita ese primer transporte y parseo por solicitud.
7. La sincronización del catálogo es `on_demand` por defecto. Esto controla cuándo se publica una versión, pero no cuántas veces se lee una versión ya publicada.
8. Si una conversación ya tiene una orden existente, `context()` puede devolver sin cargar el catálogo; el problema se concentra en contextos manuales nuevos o repetidos.

### 2.2 Comportamiento actual implementado localmente

Las fases 0–2 ya están aplicadas en el árbol de trabajo, pero todavía requieren despliegue y verificación de producción:

1. Cada solicitud consulta metadata de la versión publicada (`catalog_version`, hash, cantidad y fecha), pero no transporta `document` en esa consulta.
2. El documento JSON completo se carga solamente cuando ocurre un `cache miss`, un reinicio de instancia, una expulsión del LRU o un cambio de `catalogVersion`.
3. La caché actual está indexada por tenant en memoria y valida la versión contra metadata; no mantiene múltiples versiones simultáneas por tenant.
4. Dos cargas concurrentes de la misma versión comparten una promesa y no duplican la lectura física del documento.
5. El contexto manual devuelve 25 productos por defecto y acepta como máximo 50.
6. La confirmación solicita únicamente los SKU seleccionados, no una página completa ni los 2.000 productos.
7. Existe la ruta paginada `GET /api/tenants/:tenantId/catalog/products`.
8. La ruta de resumen independiente todavía no existe; la metadata se devuelve actualmente dentro de `manual-order` y `catalog/products`.

Por tanto, la optimización actual evita la descarga repetida del documento grande, pero todavía realiza una consulta ligera de metadata por solicitud. Esa consulta no debe confundirse con transferir nuevamente los 4,4 MB del índice.

## 3. Resultado objetivo

### 3.1 Lectura

- Una versión publicada se identifica por `tenantId + catalogVersion`.
- La aplicación no debe volver a cargar el documento completo si ya tiene esa versión en memoria.
- La primera carga del documento de una versión debe ocurrir como máximo una vez por instancia, salvo expiración, expulsión o invalidación explícita.
- La metadata de versión puede consultarse por solicitud hasta que exista una invalidación/evento de publicación confiable; esa consulta no debe incluir `document`.
- Las solicitudes posteriores deben reutilizar la versión cacheada.

### 3.2 Respuesta

- El endpoint manual no debe devolver automáticamente los 2.000 productos.
- La respuesta inicial debe devolver una página limitada, preferiblemente 25 o 50 productos.
- Las búsquedas deben recibir `query`, filtros y cursor/página.
- La respuesta debe incluir `catalogVersion`, `totalCount`, `nextCursor` y los productos de la página.
- La compatibilidad con el checkout debe conservar SKU, precio, inventario, presentación, atributos y modo de venta por peso.

### 3.3 Persistencia

Este plan no cambia todavía el proceso de sincronización desde Google ni la publicación de una nueva versión. Sí debe evitar que la lectura normal del catálogo se comporte como una descarga completa.

Como fase posterior, el índice JSON completo debe dividirse o normalizarse para que una modificación de pocos productos no reemplace todo el documento.

## 4. Diseño propuesto

### 4.1 Caché por tenant y versión

La intención lógica de la caché es:

```text
catalog:{tenantId}:{catalogVersion}
```

La implementación local mantiene una entrada por tenant y reemplaza la entrada cuando cambia la versión. Esto es equivalente para la versión activa y evita conservar varios índices grandes del mismo tenant.

La entrada debe contener:

```js
{
  tenantId,
  catalogVersion,
  sourceHash,
  products,
  searchIndex,
  loadedAt,
  lastAccessAt
}
```

Reglas:

1. Consultar metadata de versión sin seleccionar `document`.
2. Reutilizar el índice cacheado cuando la versión sea válida.
3. Si no hay versión conocida en caché, cargar solamente metadata del catálogo:

   ```sql
   SELECT catalog_version, source_hash, row_count, published_at
   FROM catalog_knowledge_indexes
   WHERE tenant_id = $1 AND status = 'published'
   ORDER BY published_at DESC NULLS LAST, created_at DESC
   LIMIT 1;
   ```

4. Cargar el documento completo únicamente cuando la versión no esté cacheada.
5. Invalidar o reemplazar la entrada cuando se publique una nueva versión.
6. No duplicar simultáneamente cargas para el mismo tenant; usar una promesa compartida por clave.
7. Aplicar un límite de memoria y una política LRU si hay varios tenants.
8. No usar una caché sin versión que pueda servir un catálogo viejo después de una publicación.

### 4.2 Búsqueda y paginación

La ruta manual debe separar tres operaciones:

```text
GET /api/conversations/:id/manual-order
  -> contexto, metadata y primera página

GET /api/tenants/:tenantId/catalog/products?query=&cursor=&limit=50
  -> búsqueda y página de productos

GET /api/tenants/:tenantId/catalog/summary
  -> catalogVersion, totalCount y publishedAt (fase futura)
```

La ruta de productos paginados ya está implementada localmente. La ruta `catalog/summary` queda como mejora posterior; no forma parte de las fases 0–2.

Si se decide mantener un único endpoint por compatibilidad, debe aceptar como mínimo:

```text
query
filters
limit <= 50
cursor
catalogVersion
```

Reglas de seguridad:

- Rechazar o recortar cualquier `limit` superior a 50.
- No permitir que `manual_order_catalog` convierta el límite en `rows.length`.
- No devolver vectores, relaciones del grafo ni metadata interna del índice al navegador.
- Mantener la respuesta del checkout separada de la estructura completa del índice.

### 4.3 Fuente de consulta

En una primera fase se puede usar el índice ya cargado en memoria para buscar y paginar. Si la cantidad de tenants o productos crece, migrar la consulta a tablas normalizadas:

```text
catalog_products
catalog_relations
catalog_search_documents
catalog_versions
```

La tabla `catalog_knowledge_indexes.document` quedaría como respaldo, bootstrap o versión publicada, no como respuesta directa para cada solicitud web.

## 5. Plan por fases

### Fase 0 — Línea base y protección — implementada localmente

**Objetivo:** medir el comportamiento actual antes de modificarlo.

Tareas:

- Registrar `tenantId`, ruta, operación, `catalogVersion`, `sourceRowCount`, `returnedRowCount` y duración.
- Añadir `payloadBytes` al documento leído desde PostgreSQL.
- Añadir `responseBytes` al endpoint HTTP.
- Registrar `cacheHit`, `cacheMiss`, `cacheLoadWait` y `cacheEviction`.
- Añadir un límite temporal de seguridad para no devolver más de 50 filas en nuevas rutas.
- Crear una alerta si una respuesta de catálogo supera 1 MB.

Entregable: línea base de lecturas por tenant, llamadas por hora, bytes y filas devueltas.

### Fase 1 — Caché de índice publicada — implementada localmente

**Objetivo:** impedir la lectura repetida del documento completo en la misma instancia.

Tareas:

1. Extraer la carga del índice a un componente dedicado, por ejemplo `CatalogIndexCache`.
2. Consultar metadata de versión antes de cargar el documento.
3. Implementar promesas compartidas por tenant/version para evitar cargas concurrentes.
4. Hidratar `CatalogSearchService` una sola vez por versión.
5. Invalidar la caché desde `catalogSearchService.sync()` después de publicar una versión nueva.
6. Añadir métricas de hit/miss y bytes cargados.

Criterio de salida:

- Diez solicitudes consecutivas del mismo tenant y versión producen una sola carga del documento completo por instancia.
- Una nueva `catalogVersion` produce exactamente una nueva carga.
- Un reinicio puede volver a cargar una vez, pero no cada solicitud posterior.

### Fase 2 — Respuesta paginada del pedido manual — implementada localmente

**Objetivo:** que la aplicación y el navegador no reciban 2.000 productos por defecto.

Tareas:

1. Cambiar el límite manual a 25 o 50.
2. Implementar `query` y filtros sobre el índice cacheado.
3. Implementar cursor estable basado en `catalogVersion` y SKU o una clave equivalente.
4. Devolver `totalCount`, `returnedCount`, `nextCursor` y `catalogVersion`.
5. Actualizar el frontend para buscar en servidor y solicitar páginas adicionales.
6. Mantener la selección de productos y el checkout por SKU, sin depender de que todo el catálogo esté descargado.

Criterio de salida:

- La primera respuesta contiene como máximo 50 productos.
- Una búsqueda específica devuelve únicamente coincidencias relevantes.
- El checkout funciona aunque el producto seleccionado no esté en la primera página.

### Fase 3 — Separación de metadata y documento grande

**Objetivo:** evitar cargar el JSON completo solo para conocer fecha, versión o cantidad.

Tareas:

- Crear o utilizar columnas/tabla de metadata de catálogo.
- Cambiar las pantallas que solo necesitan fecha, estado o cantidad para consultar metadata.
- Mantener `document` fuera de esas consultas.
- Excluir `relations`, `searchDocuments` y vectores de las respuestas públicas.

Criterio de salida:

- Las consultas de fecha, versión y cantidad leen únicamente metadata.
- Ninguna pantalla administrativa que no necesite productos solicita el documento completo.

### Fase 4 — Persistencia incremental del índice

**Objetivo:** que una modificación pequeña no publique ni transporte nuevamente todo el índice.

Tareas:

- Identificar productos modificados por `sourceHash` o versión de fila.
- Persistir productos, relaciones y documentos de búsqueda por clave.
- Mantener una tabla de versiones y estado de publicación.
- Publicar una versión atómica mediante metadata, sin reemplazar todo el documento cuando no sea necesario.
- Conservar una ruta de rollback a la versión anterior.

Esta fase es independiente de la caché y la paginación, pero completa la solución de raíz.

### Fase 5 — Validación de producción

**Objetivo:** comprobar que el consumo de ancho de banda quedó controlado.

Durante 24–48 horas medir:

- MB de salida por hora.
- MB por ruta HTTP.
- MB por tenant.
- Lecturas completas del índice.
- Cache hit ratio.
- Filas promedio por respuesta.
- P95 de latencia del contexto manual.
- Número de publicaciones de catálogo.
- Bytes de escrituras incrementales.

Comparar contra la línea base y revisar especialmente las ventanas de mayor actividad.

## 6. Archivos candidatos a modificar

- `server/services/manualOrderService.js`
  - separar contexto, metadata y página de productos;
  - evitar cargar el catálogo completo por defecto.

- `server/services/toolRegistry.js`
  - eliminar el comportamiento que usa `rows.length` como límite manual;
  - integrar la caché antes de consultar el documento completo;
  - registrar bytes y filas.

- `server/store/postgresStore.js`
  - añadir consulta de metadata;
  - mantener la lectura completa solo para cache miss;
  - preparar repositorios paginados o normalizados.

- `server/services/catalogSearchService.js`
  - exponer búsqueda paginada;
  - invalidar y versionar la caché.

- `server/routes/api.js`
  - ampliar el endpoint existente o crear rutas de catálogo paginado.

- Frontend que consume `/manual-order`
  - cambiar filtrado local completo por búsqueda/paginación remota.

- Pruebas de contratos y documentación operativa.

## 7. Pruebas requeridas

### Caché

- Primera lectura: `cacheMiss` y una consulta completa.
- Segunda lectura: `cacheHit` y cero consultas completas adicionales.
- Dos solicitudes concurrentes: una sola carga física.
- Nueva versión: invalidación y una nueva carga.
- Reinicio: recarga controlada una vez.

### Paginación

- `limit` omitido: máximo 50.
- `limit=2000`: rechazar o recortar a 50.
- Búsqueda por SKU, nombre, categoría y atributos.
- Cursor inválido o de otra versión.
- Producto seleccionado en una página posterior.
- Producto desactualizado entre búsqueda y confirmación.

### Compatibilidad operativa

- Pedido manual nuevo.
- Conversación con orden existente.
- Venta por peso.
- Inventario y precio.
- Dos tenants con catálogos diferentes.
- Catálogo no publicado.
- Publicación concurrente mientras se consulta.
- Reinicio de la instancia durante una consulta.

## 8. Rollout y rollback

### Rollout

1. Desplegar las fases 0–2 ya implementadas localmente.
2. Validar caché, búsqueda, paginación y checkout en producción.
3. Activar por tenant piloto si la configuración de flags lo permite.
4. Activar para todos los tenants.
5. Retirar definitivamente el comportamiento que devuelve el catálogo completo.

### Rollback

La bandera debe permitir volver temporalmente a la lectura anterior, pero con:

- límite máximo de seguridad;
- registro de bytes;
- alerta por respuestas grandes;
- sin reactivar sincronización automática del catálogo.

El rollback no debe restaurar snapshots globales ni persistencia completa de `app_state`.

## 9. Criterios de aceptación

La implementación local de las fases 0–2 se considerará lista para producción cuando:

- una misma versión de catálogo no se lea completa en cada solicitud;
- el contexto manual devuelva como máximo 50 productos por respuesta;
- una consulta de metadata no cargue `document`;
- el frontend pueda buscar y paginar sin descargar los 2.000 productos;
- el checkout conserve sus datos y validaciones actuales;
- los logs muestren bytes por operación y ruta;
- el consumo de salida disminuya sustancialmente durante una prueba equivalente;
- una nueva versión se refleje sin servir datos viejos;
- no se creen snapshots globales como efecto secundario de leer el catálogo.

La validación de producción todavía está pendiente. Los contratos locales ejecutados hasta ahora cubren caché versionada, concurrencia, paginación, cursor obsoleto, búsqueda y recarga por nueva versión.

## 10. Decisión pendiente después de la optimización

No se recomienda migrar de proveedor antes de ejecutar las fases 0–2. La transferencia actual es consecuencia de un contrato de lectura demasiado amplio, no una necesidad funcional del catálogo.

Después de medir 24–48 horas con caché y paginación, se podrá comparar el consumo real contra el límite del proveedor y decidir si todavía conviene migrar a una infraestructura con tráfico incluido.
