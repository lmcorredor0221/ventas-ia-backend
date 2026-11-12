# Auditoría de catálogo demo: precios, existencias y venta por peso

**Fecha de revisión:** 2026-11-11. **Tienda:** `demo-de-tienda`.

## Estado comprobado directamente

Se exportó la pestaña `Catalogo` de la [hoja operativa de Google](https://docs.google.com/spreadsheets/d/1QpR44qdL4EEpLgIPEZwoTLb43hnGjWVUObAsK3PfAZc/edit) con la cuenta de la tienda. La copia de auditoría está en `artifacts/catalogo-demo-prod-snapshot-2026-11-11.csv`. El importador vigente la acepta sin errores, con 17 columnas canónicas y 2.000 SKU únicos.

En el SQL Editor del proyecto de producción `mmcxphpstxjugxjrdffb`, una consulta directa de solo lectura sobre `public.products` con `tenant_id='demo-de-tienda'` devolvió 2.000 productos, 0 precios en cero, 0 existencias en cero, 2.000 activos, 319 habilitados para venta por valor y 0 habilitados por peso. Las sumas de `price` (25.877.700 COP) y `stock` (92.204), y las 1.701 filas con `stock=50`, coinciden exactamente con la copia de Google. Los 1.700 productos incorporados tienen stock demo de 50; hay otra referencia histórica con el mismo stock.

El archivo `artifacts/catalogo-colombia-2000.csv` mantiene 1.700 precios y existencias en cero porque es la fuente **de investigación**, separada por diseño del catálogo demo operativo. El archivo `artifacts/catalogo-colombia-2000-demo-activo.csv` coincide, SKU por SKU, con la hoja en precio, stock, activo, bandera de venta por valor y atributos JSON. Regenerar la fuente de investigación no debe publicarla por accidente.

No se efectuó ninguna escritura en Google ni en PostgreSQL: no había ceros operativos que corregir. La sincronización mostrada en VIA sigue siendo la del 9 de noviembre, versión `6e93b66411cb7383c8d2`.

## Calidad del precio y de las referencias

El precio previo de los 1.700 SKU se estimó por categoría y presentación. **No es un promedio de venta observado por cada SKU**, y el stock 50 es inventario ficticio de la demo, no una medición de existencias físicas. El código de esa estimación asigna el mismo precio a presentaciones incompatibles en ciertos grupos. El análisis reproducible `scripts/audit-demo-catalog-prices.mjs` detectó 72 filas de familias con distintos conteos de unidades y precio idéntico, 48 presentaciones que requieren verificar el producto físico y 2 desviaciones mayores de 25 % frente a referencias minoristas comparables. La lista de SKU está en `artifacts/catalogo-demo-auditoria-2026-11-11.json`.

Ejemplos: `CO-RES-0231` describe leche entera Alquería de 100 g a 7.000 COP, y `CO-RES-0236` describe la misma leche de 1 L también a 7.000 COP. Varias salchichas de 1, 2, 4 y 6 unidades tienen 500 COP por paquete. Una leche líquida medida en gramos podría ser un producto distinto (leche en polvo); debe verificarse antes de corregirla. La venta por valor de frutas, verduras y carnes frías permanece habilitada en las 319 referencias correspondientes.

Fuentes de contraste consultadas:

- [DANE SIPSA, boletín semanal 2026](https://www.dane.gov.co/index.php/estadisticas-por-tema/agropecuario/sistema-de-informacion-de-precios-sipsa/mayoristas-boletin-semanal-1/boletin-mayorista-semanal-2026) y [geovisor SIPSA](https://geoportal.dane.gov.co/geovisores/territorio/precios-mayoristas-sipsa/): precios **mayoristas** agroalimentarios por mercado, que no equivalen al precio minorista de un SKU empacado.
- [Éxito, Coca-Cola original 600 ml](https://www.exito.com/gaseosa-coca-cola-pet-600-ml-409900/p): 4.200 COP observados, frente a 2.700 COP en `CO-RES-1042`.
- [Éxito, surtido Colanta](https://www.exito.com/coleccion/30058): leche entera pasteurizada 1.000 ml a 4.490 COP observados, frente a 7.000 COP en `CO-RES-0242`. La equivalencia exacta de tipo de empaque debe confirmarse.
- [Éxito, carne molida de res](https://www.exito.com/carne-molida-973-am-789430/p): 45.350 COP/kg observados; útil para contrastar la categoría, no para trasladar ese precio a otro corte.
- [Droguerías Cafam, pañales Winny](https://www.drogueriascafam.com.co/mamas-y-bebes/panales-y-panitos/etapas-3-4-5-y-6): precio por unidad para la paca de etapa 3 de 30 unidades, ejemplo de comparación por presentación exacta.

Los precios en línea dependen de ciudad, fecha, promociones y empaque. Estas observaciones no constituyen una media nacional de los 1.700 SKU ni justifican reemplazar automáticamente todos los precios. Antes de un cambio masivo se requiere validar la existencia comercial de cada combinación de marca, producto y presentación, y registrar una referencia minorista comparable o un precio provisto por el tendero.

## Solicitud por peso en VIA

El intérprete emite `requestedWeight:{amount,unit}` cuando el cliente dice, por ejemplo, “media libra” o “250 gramos”; admite `g`, `kg`, `lb` y `arroba`. La búsqueda conserva candidatos que acepten peso. `quoteWeightSale` convierte 1 libra en 500 g y calcula `round(pricePerKg * gramos / 1000)`. Compara los gramos solicitados con inventario, mínimo e incremento. El checkout conserva el peso solicitado y el precio por kg para detectar cambios de precio posteriores. La bandera `permite_venta_por_valor` sigue siendo independiente: “$5.000 de queso” es presupuesto, no un peso inferido.

Para vender un SKU realmente fraccionable por peso se debe **conservar** el contenido actual de la columna `atributos_json` y añadir dentro del objeto:

```json
"commerce": {
  "saleModes": ["weight"],
  "weight": {
    "pricePerKg": 0,
    "stockGrams": 0,
    "minGrams": 0,
    "incrementGrams": 0
  }
}
```

Los ceros anteriores son marcadores explicativos, **no valores importables**. `pricePerKg`, `minGrams` e `incrementGrams` deben ser enteros positivos; `stockGrams` puede ser cero únicamente si no hay disponibilidad. Además, el SKU activo debe conservar `precio` positivo (el checkout también lo exige), y el campo `stock` debe seguir siendo coherente con la presentación cerrada si esa modalidad se ofrece. No se debe deducir `stockGrams` de `stock=50` de los paquetes existentes ni activar automáticamente un jamón tajado o una bolsa de 1 kg como producto al corte.

El contrato de peso existe solo en cambios **locales aún no publicados** (`server/domain/catalogCommerce.js` no está en el commit actual `c9d5c16`). Por tanto, antes de registrar esos atributos en la hoja operativa debe publicarse y verificar el runtime compatible. Después, la sincronización normal desde Google a PostgreSQL debe reconstruir el índice semántico y sus relaciones; una actualización directa de `products` por SQL sin reconstrucción dejaría el catálogo y el índice desalineados. En esta revisión no se modificó la lógica conversacional ni el checkout.

## Validaciones ejecutadas

- `validateCatalogCsv` de la exportación de Google: válido, 2.000 filas, 17 encabezados, 0 errores, 0 SKU duplicados.
- Comparación por SKU entre hoja y CSV demo local: 0 diferencias en precio, stock, activo, bandera por valor y atributos JSON.
- Consulta agregada directa en PostgreSQL: coincide con la exportación de Google.
- `node server/tests/weight-sale-catalog-contract.mjs` y `node server/tests/catalog-import.mjs`: correctos.

## Preparación local para pruebas de peso

Se generó `artifacts/catalogo-colombia-2000-demo-peso-pruebas.csv` mediante `scripts/prepare-demo-weight-catalog.mjs`. Conserva las 2.000 filas, las 17 columnas, todos los precios y el stock anterior. **Solo modifica `atributos_json` de tres SKU de la tienda demo**: banano criollo de 1 kg (`CO-RES-0593`), papa pastusa de 1 kg (`CO-RES-0683`) y carne molida de res de 1 kg (`CO-RES-0406`). Mantiene `measure` y añade `commerce.saleModes=["weight"]`, `pricePerKg` igual al precio demo de la presentación de 1 kg, mínimo e incremento de 50 g, y existencias simuladas en gramos de 12.000, 25.000 y 10.000 respectivamente. Esas cifras permiten probar cotización y falta de existencias, pero no representan inventario real del tendero.

La importación CSV, el contrato de peso y el contrato del sincronizador pasan. La búsqueda sobre el índice construido localmente recupera los tres SKU y cotiza media libra como 250 g a 1.125, 725 y 8.000 COP respectivamente. Con el código local actual, la versión del índice cambia de `b1ea6bf74c24bf5d80f2` para el CSV demo sin peso a `2ed9bf95eb4db7b1d8c1` para el CSV de pruebas; permanece en 2.000 vectores y 2.000 productos, y pasa de 2.660 a 2.661 nodos y de 74.552 a 74.555 relaciones. La versión productiva observada antes de esta preparación era `6e93b66411cb7383c8d2`; los identificadores locales dependen del código y de la fuente efectiva usados al publicar, por lo que no deben cargarse manualmente en producción.

El grafo local ahora representa el contrato comercial con un nodo explícito `modalidad_venta:peso` y una relación por cada uno de los tres SKU, en vez de un nodo genérico `commerce:[object Object]`. Los atributos completos, incluidos los gramos de existencia, permanecen en el producto indexado. Esta corrección solo toca la construcción del índice; no cambia la interpretación de DeepSeek ni el checkout.

Render confirma que el despliegue vivo del backend usa el commit `c9d5c16` del 9 de noviembre. El módulo `server/domain/catalogCommerce.js` todavía no está en ese commit; además, el árbol de trabajo contiene cambios de otras funciones mezclados con el soporte de peso. Por ello, **el runtime compatible debe aislarse y publicarse antes de la sincronización productiva de estos tres SKU**.

La publicación correcta debe actualizar la hoja Google de la tienda y ejecutar el sincronizador de VIA, que invoca `buildCatalogKnowledgeIndex` y `persistCatalogSnapshot`. Este último actualiza las filas de `products` y el documento de `catalog_knowledge_indexes` en **una transacción PostgreSQL**. Una sentencia `UPDATE products` desde el SQL Editor de Supabase por sí sola no reconstruye vectores ni grafo y será revertida por la siguiente sincronización desde Google. Se puede verificar el resultado directamente en Supabase con consultas a ambos objetos después de que el runtime compatible esté desplegado. El CSV de pruebas **no se cargó** en Google ni en Supabase durante esta preparación.

Consulta de verificación posterior en el SQL Editor de Supabase:

```sql
SELECT catalog_version, status, row_count, node_count, relation_count, vector_count,
       document->'products'->'CO-RES-0593'->'attributes'->'commerce' AS banano_commerce
FROM catalog_knowledge_indexes
WHERE tenant_id = 'demo-de-tienda' AND status = 'published';

SELECT sku, payload->'attributes'->'commerce' AS commerce
FROM products
WHERE tenant_id = 'demo-de-tienda'
  AND sku IN ('CO-RES-0593', 'CO-RES-0683', 'CO-RES-0406')
ORDER BY sku;
```
