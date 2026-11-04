# Actualización del catálogo de Demo De Tienda

Fecha: 2026-11-03. Operación autorizada por el usuario para actualizar el catálogo de producción de la tienda demo con los productos del repositorio.

## Alcance y resultado

- Tenant: `demo-de-tienda`, cuenta `ventasiaopsstore@gmail.com`.
- Hoja existente: [Ventas IA Operacion - Demo De Tienda](https://docs.google.com/spreadsheets/d/1QpR44qdL4EEpLgIPEZwoTLb43hnGjWVUObAsK3PfAZc/edit), pestaña `Catalogo` (gid `1653596043`).
- Fuente: `colombiaCatalogTestSeed300`, en `server/data/colombiaCatalogExpansion.js`, con 100 productos base y 200 adicionales. Son **300 productos exactos**, no más de 300.
- Catálogo anterior: 100 productos. Catálogo final: 300 productos activos, SKU únicos, precios positivos y presentación y descripción presentes.
- Se importó mediante la interfaz autenticada de VIA. `POST /api/saas/tenants/demo-de-tienda/google/catalog/import` devolvió HTTP 200, estado `imported`, fuente `google_sheets_live`, 300 filas importadas, 300 activas, cero errores y cero advertencias.
- Los precios y existencias de los 100 productos originales coincidían con los de la referencia antes de importar.
- Los identificadores Drive ficticios de las referencias de prueba se dejaron vacíos; no se vincularon archivos inexistentes.
- Se conservó el mismo archivo de Google Sheets. No se modificaron otras tiendas ni las pestañas de clientes, pedidos o configuración.

## Campos y verificación

El importador publicado acepta las primeras diez columnas: SKU, nombre, categoría, marca, presentación, precio, stock, aliases, activo y drive_file_id. Las seis columnas adicionales se incorporaron a la misma pestaña por Google Sheets, en K:P: descripción, etiquetas, familia_producto, presentación_normalizada, atributos y origen_catalogo.

Después de la escritura se volvió a leer A1:P302. La comparación estricta de los 300 registros y sus 16 columnas con el archivo fuente pasó sin diferencias, con cero SKU duplicados. Se aplicó ajuste de texto a K1:P301 para facilitar la lectura.

Referencia de precios: Coca-Cola (`BOG-BEB-044`) COP 7.200 y Ponqué Chocoramo (`BOG-PAN-019`) COP 2.800; suma COP 10.000. Esto valida los datos, no representa una nueva prueba de conversación o pedido.

## Limitación del backend publicado

La versión publicada lee el catálogo A:J y no consume todavía los campos ampliados K:P. Las descripciones y atributos sí quedaron conservados en la hoja, pero no se puede afirmar que el agente los use en la búsqueda. Un ajuste posterior debe alinear importación, lectura y contrato de búsqueda antes de validar ese comportamiento. Esta operación no modificó ni desplegó código del backend o frontend.

Revisión posterior del repositorio: ese soporte enriquecido sí existe en el commit `0069a31` de la rama `codex/backend-plan-payload-20261020`; no está en los archivos de `backend/main` revisados. La descripción se usa en recuperación en esa versión, pero los atributos JSON no se incorporan todavía al ranking general y los rangos históricos A:J requieren tratamiento. Ver `docs/Auditoria-catalogo-enriquecido-2026-11-03.md` para comparación y pruebas.

## Evidencia y respaldo local

En `docs/evidencias/auditoria-preparacion-20261103/`:

- `catalogo-demo-antes-300.tsv`: respaldo previo de la pestaña.
- `catalogo-demo-300.csv` y `catalogo-demo-300.json`: referencia completa importada.
- `catalogo-demo-300-importado.tsv`: lectura posterior a la importación de VIA.
- `catalogo-demo-300-verificado.tsv`: lectura final con las 16 columnas comprobadas.
- `demo-catalogo-300-importado.png`: confirmación visible de VIA.

Los precios y existencias son datos del catálogo de pruebas solicitado para la demo; no constituyen inventario comercial verificado de una tienda real.
