# Operación del catálogo por demanda

## Decisión

Google Sheets/Drive sigue siendo la fuente que el dueño administra. PostgreSQL
mantiene la versión operativa publicada para las conversaciones. La lectura del
catálogo durante un webhook no debe iniciar una sincronización ni depender de
Google: consulta la última versión publicada para ese tenant.

La publicación se ejecuta únicamente cuando el dueño solicita **Actualizar
catálogo** desde VIA, mediante:

```text
POST /api/saas/tenants/:tenantId/google/catalog/sync
```

La solicitud valida el acceso del tenant, lee el rango configurado, normaliza
los productos, reconstruye el índice semántico/grafo y publica una versión
atómica en PostgreSQL. Si falla, se conserva la versión anterior y la tienda
recibe el motivo para corregir Google o volver a intentar.

## Configuración

El modo seguro por defecto es:

```text
CATALOG_SYNC_MODE=on_demand
```

`CATALOG_SYNC_WORKER_ENABLED=true` ya no basta para activar un temporizador. Un
job programado solo se habilita explícitamente para una operación controlada
con:

```text
CATALOG_SYNC_MODE=scheduled
CATALOG_SYNC_WORKER_ENABLED=true
```

`CATALOG_AUTO_SYNC_ON_READ=false` es el valor predeterminado: leer o buscar el
catálogo no publica ni reconstruye el índice como efecto secundario. Solo una
compatibilidad temporal y explícita con `true` permite ese comportamiento.

En producción se debe dejar el primer valor y retirar cualquier intención de
sincronización periódica. La búsqueda automática sigue usando la versión
publicada en PostgreSQL; la búsqueda manual usa el catálogo operativo completo
del tenant y no limita el conjunto a 20 o 25 productos.

## Estado y concurrencia

VIA expone el estado en:

```text
GET /api/saas/tenants/:tenantId/google/catalog/sync/status
```

El estado incluye modo, sincronización en curso, última publicación e
información de la versión publicada. Las solicitudes concurrentes para el mismo
tenant reutilizan la misma operación; no se generan dos snapshots ni dos
reconstrucciones del grafo/vectorial.

## Procedimiento para el dueño

1. Editar y guardar el catálogo en la hoja de Google.
2. Abrir la configuración de la tienda en VIA.
3. Pulsar **Actualizar catálogo**.
4. Esperar el resultado publicado y revisar la versión, filas y hora.
5. Realizar la prueba de búsqueda o conversación.

Si no se actualiza, las conversaciones continúan usando la última versión
válida. Esto evita que un error temporal de Google o una hoja vacía degrade el
servicio de WhatsApp.
