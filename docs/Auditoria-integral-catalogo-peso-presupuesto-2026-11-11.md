# Auditoría integral del catálogo demo: peso, presupuesto y publicación

Fecha: 2026-11-11. Tienda: `demo-de-tienda`. Fuente operativa observada: hoja `Catalogo!A1:Q2001` de [Google Sheets](https://docs.google.com/spreadsheets/d/1QpR44qdL4EEpLgIPEZwoTLb43hnGjWVUObAsK3PfAZc/edit). Copia de auditoría: `artifacts/catalogo-demo-prod-snapshot-2026-11-11.csv`.

## Resultado del barrido

Se analizaron las 2.000 filas activas y 2.000 SKU únicos. El CSV demo existente coincide con la copia de Google en precio, stock, estado, bandera por valor y atributos. La consulta agregada a `products` en Supabase también coincide: cero precios/stock en cero, 319 banderas por valor y cero contratos por peso. Son datos demo: los precios estimados y el stock 50 no representan mediciones verificadas de un negocio real.

La ampliación anterior conservó 300 SKU y añadió 1.700; esta auditoría no creó SKU nuevos. Hay dos pares heredados de identidad comercial duplicada con SKU distintos, documentados en `docs/Investigacion-catalogo-colombia-2000-2026-11-08.md` (pan perro Bimbo y pañales Winny etapa 4). Se conservaron para respetar el identificador vigente; no hay SKU repetidos. Las referencias de investigación se seleccionaron como aproximación de surtido y presencia comercial, no como ranking público de ventas por SKU. Las fuentes previas incluyen nomenclatura y ponderadores del IPC de DANE, categorías visibles de Carulla y Éxito, y un corpus local de solicitudes de WhatsApp; para precios mayoristas se consultó DANE SIPSA. Esto no convierte los precios demo en cotizaciones minoristas verificadas.

| Clasificación por SKU | Cantidad | Decisión |
| --- | ---: | --- |
| Presentación fija o fraccionamiento no demostrado | 1.695 | Conservar modo existente |
| Otra presentación medida (500 g, 2 kg, 5 kg) | 166 | Revisar si empaque cerrado o porción del mismo granel; evitar duplicar inventario |
| Pieza entera o producto formado | 10 | Revisar individualmente; incluye pollo entero y hamburguesa de res |
| Referencia por unidad fresca | 65 | Revisar peso físico variable antes de habilitar gramos |
| Producto fresco de 1 kg con precio base y stock interpretable | 64 | Preparado localmente para venta fraccionada |

Las 64 referencias preparadas son 17 de carnes/pollo/pescado, 20 frutas y 27 verduras. Su lista exacta, precio original y nuevo `atributos_json` están en `artifacts/catalogo-demo-peso-delta-2026-11-11.json`. El barrido completo, con motivos por SKU, está en `artifacts/catalogo-demo-clasificacion-comercial-2026-11-11.json`. La clasificación se basó en nombre, marca, categoría, presentación y atributos, no solo en la categoría. Un peso declarado en el empaque **no** habilita por sí solo el corte a granel. Ninguno de los quesos de marca empacados ni de los 109 productos de carnes frías de presentación fija recibió un contrato de peso. La bandera de presupuesto de carnes frías se preservó.

Distribución de las 2.000 referencias por la categoría original del CSV (sin reagrupar etiquetas):

| Categoría | SKU | Categoría | SKU |
| --- | ---: | --- | ---: |
| Granos y basicos | 242 | Aseo hogar | 215 |
| Bebidas | 188 | Aseo personal | 182 |
| Lacteos | 151 | Snacks | 143 |
| Panaderia | 135 | Carnes y congelados | 130 |
| Verduras | 120 | Carnes frias | 109 |
| Frutas | 90 | Bebes | 88 |
| Mascotas | 78 | Gaseosas | 18 |
| Salsas y condimentos | 14 | Jugos | 11 |
| Dulces y chocolates | 10 | Galletas | 9 |
| Cafe y chocolate | 8 | Harinas | 6 |
| Basicos despensa | 6 | Ponques y paquetes | 5 |
| Pastas | 5 | Energizantes | 5 |
| Enlatados | 5 | Huevos | 4 |
| Cereales | 4 | Hidratantes | 4 |
| Aceites y cocina | 3 | Dulces y postres | 2 |
| Maltas | 2 | Comidas rapidas | 2 |
| Te listo | 2 | Cafe | 2 |
| Bebidas lacteas | 1 | Despensa | 1 |

El usuario confirmó que `stock=50` de las referencias frescas de 1 kg significa **50 kg a granel**. En las 64 filas locales se conservó `stock=50` y se expresó esa misma existencia como `commerce.weight.stockGrams=50000`; también se conservó `precio` y se usó como `pricePerKg`. No se suman 50 unidades y 50 kg: son dos representaciones del mismo inventario demo y requieren actualizaciones coherentes si se venden ambos modos. El código vigente comprueba disponibilidad, pero la auditoría no encontró decremento automático del stock del catálogo al confirmar un pedido. Por ello, este inventario no debe tratarse como una reserva transaccional real.

Se fijaron `minGrams=50` e `incrementGrams=50` para el demo. Son reglas operativas de prueba, no evidencia de que cada producto físico pueda fraccionarse así. Pollo entero y hamburguesa de res quedaron fuera por no acreditar fraccionamiento exacto. Otras piezas enteras y alternativas empacadas siguen pendientes de confirmación comercial por SKU.

En la columna `Q` se añadieron 17 banderas por valor para esas carnes/pescados a granel, llevando el total local de 319 a 336. Frutas, verduras y charcutería mantienen sus banderas existentes. La compra por valor actual registra el importe solicitado; **no calcula automáticamente gramos ni reserva existencias en gramos**. No se activó venta por peso para productos fijos para compensar esa limitación.

## Contrato y compatibilidad

No se añadieron columnas. El CSV auditado `artifacts/catalogo-colombia-2000-demo-peso-auditado.csv` conserva 17 encabezados y 2.000 SKU. Solo cambian `atributos_json` en 64 filas y `permite_venta_por_valor` en 17 de ellas. Se conserva el resto del JSON, los precios, `stock`, estados e identificadores. La importación acepta el archivo sin errores.

El intérprete entrega `requestedWeight` y `budgetAmount` como datos estructurados; la búsqueda recupera candidatos y la selección comprueba capacidad comercial. La conversión operativa usa 1 lb colombiana = 500 g y 1 arroba = 12.500 g. Para peso, el precio es `round(pricePerKg × gramos / 1000)` y se contrasta con `stockGrams`, mínimo e incremento. La bandera de presupuesto permanece independiente. Esto mantiene a DeepSeek como intérprete de la frase y no agrega reglas rígidas al lenguaje natural.

Se corrigió localmente `normalizeProduct` en `server/services/catalogKnowledgeIndex.js` para conservar `allowsSaleByAmount` en el producto indexado; antes la perdía. La consulta directa a producción mostró **319** banderas en `products.payload` y **0** en `catalog_knowledge_indexes.document.products`. En modo de lectura PostgreSQL esta divergencia puede impedir la venta por presupuesto aunque la fila de producto la permita. El índice local corregido conserva las 336 banderas. El grafo local representa los 64 productos por peso con un nodo `modalidad_venta:peso` y una relación por SKU, sin transformar `commerce` en `[object Object]`.

## Pruebas locales

Pasaron `catalog-import`, `catalog-knowledge-index`, `catalog-sync-worker`, `catalog-postgres-source`, `weight-sale-catalog-contract` y `order-quantity-reconciliation`. `scripts/verify-demo-catalog-commerce.mjs` construyó un índice desde el CSV auditado y probó nueve frases, entre ellas «media libra de banano criollo» (250 g, 1.125 COP), «dos kilos de papa pastusa» (2.000 g, 5.800 COP), «250 gramos de carne molida» (250 g, 8.000 COP), «una arroba de banano» (12.500 g, disponible con 50 kg), «$5.000 de banano» y «$10.000 de carne molida» (ambas banderas por valor). Una Coca-Cola de 400 ml, un queso Colanta de 250 g y un jamón empacado de 200 g permanecieron sin venta por peso. Estas pruebas emulan la salida estructurada del intérprete; no ejecutan DeepSeek en vivo.

El índice local auditado tiene 2.000 productos, 2.000 vectores, 2.661 nodos y 74.616 relaciones; el JSON serializado ocupa 23.721.538 bytes. El archivo delta para las 64 referencias ocupa 28.461 bytes. Estos son tamaños locales, no consumo real de red ni recursos de Render.

Para la actualización incremental de Google Sheets se generaron `artifacts/catalogo-demo-sheets-apply-2026-11-11.json` y `artifacts/catalogo-demo-sheets-rollback-2026-11-11.json`. Cada uno contiene 81 solicitudes `updateCells`: 64 celdas de la columna O y 17 de la Q. El cuerpo compacto de aplicación ocupa 30.102 bytes. Se comprobó de nuevo el orden y el contenido de las 2.000 filas antes de aplicar el delta.

`scripts/publish-demo-weight-catalog-direct.mjs` valida los 2.000 SKU, el proyecto PostgreSQL de destino, la exportación reciente de Google y el commit del runtime antes de escribir. Su opción `--publish` se ejecutó desde este equipo y reutilizó `PostgresStore.persistCatalogSnapshot` para escribir en una transacción. Una repetición de la misma operación detecta la versión ya publicada y verifica el estado sin volver a escribir.

## Publicación productiva y reversión

El 11 de noviembre se aisló el soporte de peso del resto del árbol local en la rama `codex/catalog-weight-runtime`. Se publicó el commit `563608f3fcd228afe48236f3d24510c589729ff2` en `main` del backend y se desplegó manualmente el servicio VIA `srv-db7sqqmq1p3s73elv1eg` como `dep-dbqd7j3ncjis73a0ie90` (`live`). Los endpoints `/health` directo y por el proxy de VIA respondieron HTTP 200. No se publicaron los cambios locales ajenos al catálogo. La prueba antigua `backend-smoke` y el primer escenario de `colombia-scenarios` siguen fallando en `c9d5c16` y en la rama nueva con la misma expectativa de `payment_method`; el cambio no introduce esas fallas previas. Pasaron `npm run test:catalog`, `npm run test:checkout`, el contrato de peso, la conciliación de unidades y la actualización estructurada de líneas.

La hoja `Catalogo` se exportó de nuevo y coincidió en las 2.000 filas con la copia previa. En la sesión autenticada de `ventasiaopsstore@gmail.com` se actualizaron únicamente 64 celdas `O` (`atributos_json`) y 17 celdas `Q` (`permite_venta_por_valor`). La exportación posterior coincidió fila por fila con `artifacts/catalogo-colombia-2000-demo-peso-auditado.csv`: 2.000 SKU únicos, 64 contratos de peso y 336 banderas de venta por valor. El archivo de esa exportación quedó en `artifacts/catalogo-demo-current-after-sheet.csv`.

La conexión PostgreSQL de producción se tomó de la variable protegida existente de Render y se entregó a un proceso local por `127.0.0.1`, sin imprimirla ni guardarla en archivo. No se usó Render para transformar o sincronizar el catálogo. El preflight directo confirmó el proyecto Supabase `mmcxphpstxjugxjrdffb`, 2.000 productos y un índice publicado. La primera ejecución se detuvo antes de escribir al hallar una representación heredada de `driveFileId`: cadena vacía en 1.700 payloads productivos y `null` en el importador CSV. El publicador se ajustó para preservar ese valor existente al persistir y escribir únicamente los 64 SKU auditados. El índice se construyó localmente desde el CSV canónico.

`PostgresStore.persistCatalogSnapshot` publicó en una transacción la versión `bdd93f903da921f20512`; la anterior `6e93b66411cb7383c8d2` quedó retenida para reversión. La copia local previa de las 64 filas afectadas y del identificador de índice está en `artifacts/catalogo-demo-prod-before-peso-1794430686380.json` (112.869 bytes). La copia anterior de la hoja y el lote inverso están en `artifacts/catalogo-demo-prod-snapshot-2026-11-11.csv` y `artifacts/catalogo-demo-sheets-rollback-2026-11-11.json`. No se ejecutó rollback.

Una lectura directa posterior confirmó: 2.000 productos, 336 banderas por valor y 64 por peso en `products`; 2.000 productos, 2.000 vectores, 2.661 nodos, 74.616 relaciones, 336 banderas por valor y 64 contratos por peso en `catalog_knowledge_indexes.document`; un nodo `modalidad_venta:peso` con 64 relaciones. Repetir el publicador devolvió `already-published`, sin nueva escritura. La persistencia tardó 49.765 ms; el documento de índice enviado desde este equipo se estimó en 23.721.613 bytes y el número de solicitudes de sincronización a Render fue cero. Las 81 celdas de Google se modificaron desde el navegador interno porque el conector de Google de este chat todavía usa otra cuenta y responde 403.

La búsqueda local sobre el mismo índice canónico verificó nueve expresiones colombianas de peso, presupuesto y presentaciones fijas. No se ejecutó una conversación real con DeepSeek ni un pedido WhatsApp de producción. En lectura `postgres`, `ToolRegistry.googleSheetsReadTable` solicita el índice publicado a PostgreSQL y lo hidrata antes de buscar; esa ruta quedó respaldada por el índice y las relaciones productivas verificadas. La aplicación actual lee el documento completo del índice en esa ruta, una limitación de ancho de banda de lectura preexistente que merece optimización separada.

La reversión requiere restaurar las 81 celdas de Google con el lote inverso, restaurar los 64 payloads respaldados y volver a marcar como `published` la versión anterior del índice en una transacción. El despliegue del backend puede revertirse al deploy `dep-dbp4ebh42hec73bi26kg` si fuera necesario. Es importante revertir Google y PostgreSQL de forma coordinada para evitar que una sincronización posterior reintroduzca el delta.

Fuentes de contraste de mercado y límites de los precios: [DANE SIPSA](https://www.dane.gov.co/index.php/estadisticas-por-tema/agropecuario/sistema-de-informacion-de-precios-sipsa/componente-precios-mayoristas) publica precios mayoristas por producto y plaza; esos valores no sustituyen precios minoristas por SKU. La auditoría previa de precios está en `docs/Auditoria-precios-stock-peso-demo-2026-11-11.md` y enumera 72 precios planos entre distintos conteos, 48 presentaciones sospechosas y dos desviaciones minoristas; no se alteraron precios en este trabajo.
