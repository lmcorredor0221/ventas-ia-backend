# Matriz de pruebas del agente comercial Colombia

Actualizado: 2026-10-11.

## Objetivo

Validar que el agente comercial de Ventas IA razona como tendero colombiano por WhatsApp, consulta herramientas antes de afirmar disponibilidad, entiende modismos, corrige errores probables, guia al usuario cuando no sabe que pedir y escala a humano cuando corresponde.

Esta matriz cierra el pendiente `P0-07` del plan consolidado.

## Alcance

La suite cubre 50 escenarios conversacionales bogotanos y reales, con 57 pasos ejecutables sobre el backend local.

Archivos fuente:

- `server/tests/colombia-scenarios.mjs`
- `server/tests/codex-cli-scenarios.mjs`
- `server/tests/deepseek-real-scenarios.mjs`
- `server/tests/fixtures/colombiaAgentScenarios.js`
- `server/data/colombiaProducts.js`
- `server/services/llmPlanner.js`

Comando de ejecucion:

```bash
npm run test:colombia
```

Resultado esperado:

```text
Colombia agent scenario tests passed (57 steps, 50 scenarios)
```

## Modos de ejecucion recomendados

| Comando | Uso | Costo externo |
| --- | --- | --- |
| `npm run test:colombia` | Regresion rapida completa con simulador local `codex` | No consume DeepSeek |
| `npm run test:codex-cli` | Subconjunto critico con Codex CLI simulando DeepSeek | No consume DeepSeek; usa Codex CLI |
| `npm run test:deepseek-real` | Validacion final de subconjunto con proveedor real | Consume DeepSeek |

La recomendacion operativa es ajustar prompts, barandas y casos con `test:colombia` y `test:codex-cli`. DeepSeek real queda para control de calidad puntual antes de cerrar una ronda o antes de piloto.

## Principios que valida la matriz

1. **Inferencia primero, no alias exacto.** El agente debe formular hipotesis de producto desde el lenguaje del cliente y luego validar con herramientas.
2. **Herramientas antes de afirmar.** Para pedidos y consultas de catalogo debe planear `google_sheets_read_table`.
3. **Cliente por WhatsApp.** El identificador operativo del cliente es `wa_id`; si es nuevo y pide domicilio, se solicita nombre y direccion.
4. **Canasta completa.** Si el cliente menciona varios productos, el agente no debe quedarse con el primero.
5. **Ambiguedad transversal.** Si hay varias presentaciones o falta cantidad, debe preguntar.
6. **Disponibilidad parcial.** Si parte de la lista no aparece, responde lo encontrado y marca lo no encontrado.
7. **Escalamiento prudente.** Descuentos, pagos confirmados, imagenes o solicitud explicita de humano van a apoyo humano o aprobacion.
8. **Tono colombiano sobrio.** Cercano, breve y claro; no exagera confianza ni inventa stock.

## Contrato tecnico minimo

Cada ejecucion debe cumplir:

- `plan.schemaVersion = ventas-ia-llm-plan.v2`
- `plan.executionMode = codex_simulated_deepseek`
- `plan.simulatedBy = codex`
- `plan.reasoningMode = shopkeeper_guided_sale`
- `plan.customerUnderstanding.rawNeed` presente
- `plan.responseStrategy` presente
- `plan.toolPlan` presente
- `plan.reasoningNotes` con trazabilidad de auditoria
- Para `catalog_query` y `delivery_order`, `candidateItems` existe y se planea consulta a catalogo.

## Catalogo base de prueba

| SKU | Producto | Categoria | Alias relevantes |
| --- | --- | --- | --- |
| AND-CHO-01 | Chocoramo | snacks | chocorramo, chocorramos, chocoramos, chocramos |
| AND-CIF-GRA | Cifrut granadilla | bebidas | cifrut de granadilla, cifru granadilla, cifru granadila |
| AND-HIT-MAN | Jugo Hit mango | bebidas | hit mango, jugos hit |
| AND-CAF-PRE-250 | Cafe premium tostado 250g | cafe | cafe tostado premium, cafe premium |
| AND-CAF-MOL-500 | Cafe molido tradicional 500g | cafe | cafe molido, cafe tradicional |
| AND-AGU-CRI-600 | Agua Cristal sin gas 600ml | bebidas | agua cristal, agua sin gas |
| AND-COC-400 | Coca-Cola 400ml | bebidas | coca cola, cocacola, gaseosa |
| AND-PAP-MAR-LIM | Papas Margarita limon | snacks | papas margarita, papitas |
| AND-GAL-FES-CHO | Galletas Festival chocolate | snacks | festival, galletas festival |
| AND-ARE-BOY | Arepa boyacense | panaderia | arepa, arepas |
| AND-PAN-BIM | Pan tajado Bimbo | panaderia | pan, pan tajado, bimbo |
| AND-LEC-ALQ-1L | Leche Alqueria entera 1L | lacteos | leche alqueria, bolsa de leche |
| AND-YOG-ALP-FRE | Yogurt Alpina fresa | lacteos | yogur alpina, yogurt de fresa |
| AND-QUE-CAM-250 | Queso campesino 250g | lacteos | queso campesino, queso |
| AND-ARR-DIA-500 | Arroz Diana 500g | despensa | arroz diana, arroz |
| AND-ACE-PRE-500 | Aceite Premier 500ml | despensa | aceite premier, aceite |
| AND-HUE-AA-12 | Huevos AA x12 | despensa | huevos, docena de huevos |
| AND-JAB-REY | Jabon Rey barra | aseo | jabon rey, jabon azul |
| AND-PAP-FAM-4 | Papel higienico Familia x4 | aseo | papel higienico, papel de bano |
| AND-SHA-SAV-SAC | Shampoo Savital sachet | aseo | savital, sachet de shampoo |

## Modismos cubiertos

| Expresion | Interpretacion esperada |
| --- | --- |
| me regala / me regalas | Formula cortes de compra; no significa gratis |
| veci / vecino / vecina | Trato cercano de tienda de barrio |
| parce | Vocativo informal; no altera intencion comercial |
| de napa | Posible extra, descuento o cortesia |
| pa / pa las onces / pa la sed | Forma coloquial de "para"; puede indicar ocasion o categoria |

## Grupos de cobertura

| Grupo | Escenarios | Riesgo que cubre |
| --- | ---: | --- |
| Pedido claro | 5 | Canasta directa, subtotal, confirmacion |
| Pedido parcial o con faltantes | 4 | Cantidades faltantes, presentacion ambigua |
| Cliente nuevo | 3 | Solicitud de nombre, direccion y guardado en cliente |
| Flujo completo | 3 | Conversacion multi-turno, confirmacion y escritura de pedido |
| Consulta producto concreto | 3 | Disponibilidad/precio sin crear pedido prematuro |
| Consulta ambigua o similares | 3 | Inferencia heuristica y productos relacionados |
| Categoria o recomendacion guiada | 10 | Usuario no sabe producto exacto o pide por ocasion |
| Producto impreciso | 5 | Marca incompleta, presentacion o categoria probable |
| Producto no disponible | 1 | Respuesta prudente y revision humana si no hay coincidencia clara |
| Operacion sensible/escalamiento | 3 | Descuentos, pago confirmado y humano |
| Chat real SuperMarket | 10 | Rafagas, pago tardio, correcciones, multimedia, reclamos y cierre |

## Matriz ejecutable

| # | ID | Grupo | Cliente | Entrada principal | Intent esperado | Validacion clave |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `pedido_claro_con_cliente_conocido` | Pedido claro | Conocido | 3 chocorramos y 2 cifrut de granadilla | `delivery_order` | Canasta con Chocoramo y Cifrut; sin faltantes |
| 2 | `pedido_claro_con_cantidad_faltante` | Pedido parcial | Conocido | 3 chocorramos y cifrut | `delivery_order` | Pregunta cantidad de Cifrut |
| 3 | `cliente_nuevo_domicilio_pide_nombre_direccion` | Cliente nuevo | Nuevo | 2 arepas para domicilio | `delivery_order` | Pide nombre y direccion |
| 4 | `cliente_nuevo_completa_datos` | Cliente nuevo / flujo guiado | Nuevo | Pedido y luego datos personales | `delivery_order` -> `order_clarification` | Guarda nombre/direccion y cotiza |
| 5 | `disponibilidad_producto_premium` | Consulta producto | Conocido | cafe tostado premium | `catalog_query` | Sugiere cafe premium y pregunta cantidad |
| 6 | `consulta_cafe_generica_infiere_similares` | Consulta ambigua | Conocido | cafe bueno | `catalog_query` | Lista cafe premium y cafe molido |
| 7 | `categoria_jugos` | Categoria | Conocido | que jugos tiene | `catalog_query` | Lista Cifrut y Jugo Hit |
| 8 | `categoria_algo_para_la_sed` | Recomendacion | Conocido | algo pa la sed | `catalog_query` | Recomienda bebidas |
| 9 | `categoria_mecato_onces` | Recomendacion | Conocido | mecato pa las onces | `catalog_query` | Recomienda snacks |
| 10 | `categoria_mercado` | Categoria | Conocido | mercado: arroz, aceite, huevos | `catalog_query` | Lista despensa |
| 11 | `categoria_aseo` | Categoria | Conocido | aseo, papel y jabon | `catalog_query` | Lista aseo |
| 12 | `categoria_onces_panaderia` | Categoria | Conocido | pa las onces | `catalog_query` | Lista panaderia |
| 13 | `consulta_combo_jamon_queso_pan_parcial` | Disponibilidad parcial | Conocido | jamon, queso y pan | `catalog_query` | Encuentra queso/pan y reporta jamon no encontrado |
| 14 | `indeciso_antojo_dulce` | Usuario indeciso | Conocido | antojo dulce | `catalog_query` | Recomienda dulces/snacks |
| 15 | `indeciso_desayuno_rapido` | Usuario indeciso | Conocido | desayuno rapido | `catalog_query` | Recomienda arepa/pan |
| 16 | `indeciso_algo_frio_para_tomar` | Usuario indeciso | Conocido | frio para tomar | `catalog_query` | Recomienda bebidas frias |
| 17 | `indeciso_presupuesto_bajo` | Usuario indeciso | Conocido | cinco mil pesos | `catalog_query` | Interpreta presupuesto, no unidades |
| 18 | `producto_impreciso_gaseosa` | Producto impreciso | Conocido | gaseosa pequena | `catalog_query` | Sugiere Coca-Cola 400ml |
| 19 | `producto_impreciso_leche_bolsa` | Producto impreciso | Conocido | leche de bolsa | `catalog_query` | Encuentra leche relacionada |
| 20 | `producto_impreciso_papel_bano` | Producto impreciso | Conocido | papel para el bano | `catalog_query` | Encuentra papel higienico |
| 21 | `producto_impreciso_jabon_ropa` | Producto impreciso | Conocido | jabon para lavar ropa | `catalog_query` | Encuentra Jabon Rey |
| 22 | `mercado_basico_con_lista_parcial` | Lista de productos | Conocido | arroz, aceite, leche | `catalog_query` | Conserva lista completa |
| 23 | `pedido_claro_aseo_domicilio` | Pedido claro | Conocido | papel higienico y jabon rey | `delivery_order` | Canasta aseo completa |
| 24 | `pedido_claro_sin_domicilio` | Pedido claro | Conocido | yogurt y galletas | `delivery_order` | Subtotal sin forzar domicilio |
| 25 | `producto_impreciso_savital_sobre` | Producto impreciso | Conocido | savital en sobrecito | `catalog_query` | Encuentra sachet |
| 26 | `consulta_precio_chocoramo` | Consulta producto | Conocido | precio Chocoramo | `catalog_query` | Informa precio y pregunta cantidad |
| 27 | `indeciso_lonchera_nino` | Usuario indeciso | Conocido | lonchera de un nino | `catalog_query` | Recomienda productos apropiados |
| 28 | `producto_no_catalogado_atun` | No disponible | Conocido | atun | `catalog_query` | No inventa, requiere revision |
| 29 | `cliente_nuevo_coca_domicilio` | Cliente nuevo / ambiguedad | Nuevo | coca cola para domicilio | `delivery_order` | Pide nombre, direccion y presentacion |
| 30 | `pedido_confirmado_dale_hagale` | Flujo completo | Conocido | agua y luego "dale" | `delivery_order` -> `order_confirmation` | Registra pedido y handoff |
| 31 | `consulta_tintico_cafe` | Consulta ambigua | Conocido | tintico, que cafe tiene | `catalog_query` | Infere cafe y lista opciones |
| 32 | `pedido_claro_despensa_domicilio` | Pedido claro | Conocido | arroz, aceite, huevos | `delivery_order` | Canasta despensa completa |
| 33 | `pedido_con_typos_colombianos` | Errores ortograficos | Conocido | chocramos, cifru granadila | `delivery_order` | Corrige a Chocoramo y Cifrut |
| 34 | `pedido_sin_cantidades_debe_preguntar` | Pedido parcial | Conocido | chocoramo y agua | `delivery_order` | Pregunta cantidades |
| 35 | `pedido_despensa_sin_cantidades` | Lista parcial | Conocido | arroz, aceite, huevos | `delivery_order` | Pregunta cantidades por item |
| 36 | `consulta_lacteos` | Categoria | Conocido | lacteos, leche o queso | `catalog_query` | Lista leche, queso y yogurt |
| 37 | `descuento_escala_aprobacion` | Operacion sensible | Conocido | rebajita por varias cosas | `discount_request` | Solicita aprobacion |
| 38 | `pago_requiere_aprobacion` | Operacion sensible | Conocido | transferencia y comprobante | `payment_confirmation` | No registra pago sin aprobacion |
| 39 | `pide_humano` | Escalamiento humano | Conocido | hablar con una persona | `human_handoff` | Escala a asesor |
| 40 | `pedido_confirmado_handoff_operaciones` | Flujo completo | Conocido | pan tajado y confirmacion | `delivery_order` -> `order_confirmation` | Registra pedido y handoff operativo |
| 41 | `real_supermarket_saludo_solo_domicilio` | Chat real | Conocido | saludo sin productos | `delivery_order` | Pregunta productos sin cerrar pedido |
| 42 | `real_supermarket_pago_tarjeta_es_preferencia` | Chat real | Conocido | pedido y pago con tarjeta | `delivery_order` -> `order_clarification` | Registra preferencia, no pago confirmado |
| 43 | `real_supermarket_correccion_sin_producto` | Chat real | Conocido | pedido y "sin el agua" | `delivery_order` -> `order_clarification` | Remueve item de canasta |
| 44 | `real_supermarket_agrega_producto_a_canasta` | Chat real | Conocido | pedido y "agregame queso" | `delivery_order` -> `delivery_order` | Conserva canasta previa y suma item |
| 45 | `real_supermarket_valor_calchichon_coca` | Chat real | Conocido | valor por producto y presentacion | `delivery_order` | Infere salchichon y Coca-Cola 350 |
| 46 | `real_supermarket_foto_producto_handoff` | Chat real | Conocido | imagen sin texto | `catalog_query` + handoff | Escala multimedia |
| 47 | `real_supermarket_reclamo_faltante_handoff` | Chat real | Conocido | reclamo por faltante | `human_handoff` | Escala reclamo humano |
| 48 | `real_supermarket_comprobante_pago_aprobacion` | Chat real | Conocido | comprobante de pago | `payment_confirmation` | Requiere aprobacion |
| 49 | `real_supermarket_no_hay_ponque_escalamiento` | Chat real | Conocido | canasta parcial con producto ausente | `delivery_order` | Cotiza parcial y escala faltante |
| 50 | `real_supermarket_confirmacion_solo_eso` | Chat real | Conocido | "solo eso" | `delivery_order` -> `order_confirmation` | Cierra pedido y handoff |

## Trazabilidad esperada por caso

Cada caso debe poder mostrar:

1. Mensaje entrante y `wa_id`.
2. Perfil de cliente encontrado o ausencia de perfil.
3. Plan del motor IA simulado por Codex/DeepSeek.
4. `candidateItems` con producto crudo, hipotesis de catalogo y confianza.
5. `toolPlan` con herramientas a consultar.
6. Resultado de catalogo o razon de no coincidencia.
7. Canasta o respuesta guiada.
8. Campos faltantes, si aplica.
9. Mensaje final al cliente.
10. Escritura en cliente/pedido o escalamiento humano cuando aplique.

## Criterios de aprobacion

La matriz se considera verde si:

- Los 50 escenarios pasan.
- Hay exactamente 20 productos base.
- La suite reporta 57 pasos conversacionales.
- Ningun caso de consulta inventa stock fuera del catalogo.
- Los casos de domicilio para cliente nuevo piden nombre y direccion.
- Los casos con cantidad faltante preguntan antes de cerrar pedido.
- Los casos de presentacion ambigua preguntan variedad/tamano.
- Los casos sensibles no escriben datos finales sin aprobacion.
- Los pedidos confirmados escriben pedido y generan handoff.

## Como agregar nuevos casos

1. Agregar el escenario en `server/tests/fixtures/colombiaAgentScenarios.js`.
2. Clasificarlo con `level`.
3. Definir si el cliente es `known` o `new`.
4. Especificar `expect.intent`.
5. Agregar `missingFields`, `replyIncludes`, `orderItems`, `savedProfile` u `orderId` segun aplique.
6. Si requiere un producto nuevo solo para el caso, usar `extraProducts`.
7. Ejecutar `npm run test:colombia`.
8. Actualizar esta matriz si el caso representa una nueva clase de riesgo.

## Deuda consciente

- La suite principal simula DeepSeek con Codex para regresion rapida; `npm run test:codex-cli` ejecuta un subconjunto critico con Codex CLI y deja `test-results-codex-cli-scenarios.json`; `npm run test:deepseek-real` ejecuta un subconjunto con proveedor real y deja `test-results-deepseek-real-scenarios.json`.
- El catalogo base tiene 20 productos; para piloto debe probarse con catalogos reales de cada tienda.
- La evaluacion de tono es parcial por fragmentos de respuesta; podria ampliarse con rubricas de calidad.
- Casos con imagenes reales, audio o comprobantes adjuntos deben agregarse cuando WhatsApp live este disponible.
