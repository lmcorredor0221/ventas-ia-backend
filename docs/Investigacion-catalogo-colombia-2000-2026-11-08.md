# Investigación y ampliación del catálogo colombiano — 2026-11-08

## Resultado

Se añadió `server/data/colombiaCatalog2000.js`, una fuente determinista de 2.000 SKU:

- 300 referencias existentes conservadas en el mismo orden y con los mismos SKU.
- 1.700 referencias nuevas de investigación, con la estructura enriquecida ya usada por VIA.
- 2.000 SKU únicos.
- 17 campos canónicos preservados, incluyendo la bandera existente `permite_venta_por_valor`: `sku`, `nombre`, `categoria`, `marca`, `presentacion`, `precio`, `stock`, `aliases`, `activo`, `drive_file_id`, `descripcion`, `etiquetas`, `familia_producto`, `presentacion_normalizada`, `atributos_json`, `origen_catalogo`, `permite_venta_por_valor`.

Las 1.700 filas nuevas son de investigación y quedan deliberadamente `activo=false`, `precio=0`, `stock=0` y `drive_file_id=null`. No se deben publicar como inventario vendible hasta que el tenant sincronice precio, existencia y ficha real. Así se evita inventar precio, stock o evidencia documental y se conserva la compatibilidad con el importador actual.

## Distribución de las 1.700 incorporaciones

| Bloque | Referencias |
| --- | ---: |
| Granos y básicos, arroz, pastas, harinas, cereales, aceites, azúcar, sal, panela, café y chocolate | 230 |
| Lácteos y huevos | 130 |
| Carnes, pollo, pescado y congelados | 130 |
| Charcutería, embutidos y quesos | 100 |
| Frutas | 90 |
| Verduras, hortalizas y tubérculos | 120 |
| Panadería y repostería | 120 |
| Snacks, galletas y dulces | 120 |
| Bebidas, gaseosas, jugos, maltas, hidratantes y energizantes | 180 |
| Aseo del hogar | 180 |
| Aseo personal | 150 |
| Bebés | 80 |
| Mascotas | 70 |
| **Total incorporado** | **1.700** |

La distribución se diseñó para cubrir la canasta de consumo cotidiano y la amplitud observada en comercio de proximidad. No es un ranking de ventas: cuando no existe un ranking público comparable, se usa presencia comercial en surtidos de supermercado/marketplace como proxy, y se deja esa limitación explícita.

## Método y trazabilidad

1. Se revisó la estructura actual del fixture colombiano: `bogotaCatalogSeed.js` aporta 100 referencias y `colombiaCatalogExpansion.js` aporta 200; la semilla operativa local contiene además 20 referencias de demostración. No se cambió el runtime ni la lógica de interpretación posterior a `00329e4`.
2. Se conservaron las 300 referencias existentes. Antes de agregar, se comparó la identidad comercial normalizada `nombre + marca + presentación` y se evitó volver a insertar una misma identidad.
3. Las variantes se modelaron por familias con presentaciones explícitas; no se hace un producto cartesiano de todas las marcas y tamaños. Las frutas y verduras usan `Proveedor local` porque el canal suele venderlas por unidad/peso y no se debe inventar una marca.
4. Se enriquecieron aliases, tags, `productFamily`, `normalizedPresentation` y `attributes` mediante `enrichCatalogReference`, sin crear campos nuevos.
5. Las nuevas filas usan `catalogOrigin=colombia_market_research_2026_presence` para que el origen sea auditable.

## Lenguaje colombiano incorporado

Se incluyeron sinónimos y formas de pedido observadas en el corpus local de WhatsApp, entre ellas:

`cubeta de huevos`, `panal`, `huevos AAA`, `media libra`, `kilo`, `litro y medio`, `super mega litro`, `quesito`, `jamón de pernil`, `jamón de pierna`, `pechuga/pechan`, `panelas pastilladas`, `yojo yojo`, `cajita`, `act 2`, `ramitos`, `chocorramo/chocoramo`, `cfrut/cifrut`, `famila` y `paquete mediano`.

Estos términos viven en `aliases`/`tags` como evidencia para recuperación semántica. No se convierten en filtros, reglas determinísticas ni equivalencias obligatorias; DeepSeek conserva la responsabilidad de interpretar la intención y el motor recupera candidatos.

## Duplicados identificados

La base preservada ya contenía dos duplicados de identidad comercial, aunque con SKU distintos:

| Identidad normalizada | SKU conservados |
| --- | --- |
| Pan perro Bimbo · Bimbo · 6 und | `BOG-PAN-015`, `COL-148` |
| Pañales Winny etapa 4 · Winny · 30 und | `BOG-PER-099`, `COL-290` |

Se mantuvieron porque el criterio de identificación vigente es el SKU y la instrucción era conservar las 300 salvo inconsistencia verificada. Quedan documentados para una futura deduplicación comercial controlada, sin borrar referencias del fixture en este cambio.

## Fuentes consultadas y nivel de evidencia

- [DANE — nomenclatura IPC basada en COICOP](https://www.dane.gov.co/index.php/estadisticas-por-tema/precios-y-costos/indice-de-precios-al-consumidor-ipc/ipc-actualizacion-metodologica-2019/ipc-nomenclatura-basada-en-la-coicop): estructura oficial de divisiones, incluyendo alimentos y bebidas, productos del hogar, mascotas y cuidado personal.
- [DANE — ponderadores IPC](https://www.dane.gov.co/index.php/estadisticas-por-tema/precios-y-costos/indice-de-precios-al-consumidor-ipc/ipc-actualizacion-metodologica-2019/ipc-ponderadores): evidencia de peso relativo de alimentos y bebidas no alcohólicas y de los grupos de consumo del hogar.
- [Carulla — categorías de mercado](https://www.carulla.com/): presencia comercial y categorías visibles de despensa, lácteos/refrigerados, frutas/verduras, carnes, aseo hogar, aseo personal, bebidas y pasabocas.
- [Carulla — despensa](https://www.carulla.com/despensa): subcategorías visibles de galletas, café, chocolate/té, azúcar/panela, cereales, aceites/vinagres, granos, pastas, enlatados, salsas/especias y harinas.
- [Éxito — condiciones de mercado](https://www.exito.com/legales-del-dia): evidencia de operación de referencias de pollo, carne, pescado, delicatessen, frutas/verduras, panadería/repostería, despensa, mascotas, aseo y cuidado personal; también confirma que las referencias están sujetas a disponibilidad.
- Corpus local `.analysis/whatsapp-supermarket/Chat de WhatsApp con SuperMarket.txt`: evidencia de cómo pide un cliente real; se usó para aliases y regionalismos, no como ranking estadístico.

No se afirma que una referencia sea “la más vendida” cuando no existe un ranking público verificable. La etiqueta `presencia_retail` significa disponibilidad/presencia observada o compatible con surtido minorista, no participación de mercado.

## Validaciones realizadas

```powershell
node server/tests/catalog-colombia-2000.mjs
node server/tests/catalog-enriched-contract.mjs
node server/tests/amount-sale-catalog-contract.mjs
node server/tests/catalog-sync-worker.mjs
node server/tests/catalog-sync-failure-contract.mjs
```

La validación específica comprueba cantidad total, preservación de los primeros 300 SKU, unicidad, campos canónicos, normalización de presentaciones, enriquecimiento de aliases, que frutas/verduras/charcutería lleven `permite_venta_por_valor=TRUE` y que las filas nuevas permanezcan bloqueadas hasta sincronizar datos reales del tenant.

## Siguiente paso operativo

Para publicar las nuevas referencias en una tienda, el flujo correcto es importar el archivo al rango enriquecido actual (`A:Q`, por ejemplo `Catalogo!A1:Q2200`) o sincronizarlo desde el catálogo del tenant, completando precio, stock, activo y `drive_file_id` únicamente con datos reales. El archivo de investigación no cambia por sí solo el catálogo operativo ni la lógica conversacional establecida.

