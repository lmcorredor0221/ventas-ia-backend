# Plan: intérprete contextual y expansión de catálogo Colombia +200

**Fecha:** 20 de octubre de 2026
**Estado:** ejecución de desarrollo en curso; sin despliegue ni carga en tenants reales
**Alcance:** interpretación contextual de pedidos, búsqueda léxica enriquecida, validación de variantes y expansión de 200 referencias adicionales para el catálogo de pruebas de una tienda de barrio colombiana.

## Ejecución verificada el 21 de octubre de 2026

Se ejecutaron tres corridas locales E2E con PostgreSQL clonado, contrato de Meta simulado y DeepSeek real. La evidencia vigente es `test-results/e2e-local/20261021023351_238217d0/`: 40 casos ejecutados, 11 aprobados, 118 llamadas a DeepSeek, p95 de acuse del webhook de 26 ms y p95 de procesamiento de 7.440 ms. La fuente `ventas_ia_dev` terminó sin cambios y no hubo salida hacia Meta ni otras redes no permitidas.

Se corrigieron en desarrollo la selección léxica débil (`salmon` ya no permite planear `saltin`), la búsqueda por descripción/etiquetas/familia/presentación, la deduplicación de faltantes con typos y el reconocimiento de formatos como `x12`. La nueva compuerta no bloquea una referencia única sólo porque el planner pida aclarar su presentación.

El piloto autónomo sigue bloqueado. Los pendientes funcionales son: resolver variantes con una selección explícita sin escalar indebidamente; conservar íntegro el borrador a través de aclaración, pago y confirmación; y reemplazar aserciones E2E ligadas a SKU/nombres del catálogo de 100 muestras por aserciones semánticas que validen familia, presentación, precio, stock y ausencia de sustitución. El flujo de tendero sí quedó comprobado: tomar, alistar, marcar en camino, avisar al cliente, cerrar conversación y abrir una nueva ante otro mensaje.

**Decisión de alcance:** RAG, embeddings, búsqueda vectorial y ReAct quedan explícitamente aplazados. No se crearán tablas vectoriales, índices, agentes iterativos ni banderas de ejecución para esos enfoques durante este plan.

## Estado de ejecución al 20 de octubre de 2026

Se implementaron en desarrollo las bases de las fases B, F, G, A e I: contrato enriquecido de catálogo e importación compatible; referencia Colombia de 300 productos para E2E; búsqueda por descripción, etiquetas, familia y presentación; aislamiento de líneas de pedido; botones de pago y confirmación; aviso y cierre al despachar; y métricas separadas del planner y compositor con sus duraciones.

La referencia de 300 productos **no se carga automáticamente en ningún tenant**. La prueba E2E la inyecta solo en el tenant sombra dentro de un clon de la base PostgreSQL local, mediante `E2E_CATALOG_REFERENCE_FIXTURE=colombia300`.

La siguiente corrida real debe usar el archivo local `.env.e2e.local` con una URL de fuente explícita apuntando a PostgreSQL local y `DEEPSEEK_API_KEY`; el runner crea `ventas_ia_e2e_<runId>`, valida que la fuente no cambie y conserva evidencia por caso. No debe apuntarse a producción ni a un servicio de Meta real.

## 1. Decisión central

VIA no debe entrenar un modelo con precios, existencias ni surtido de las tiendas. Esos hechos son dinámicos, pertenecen a cada tenant y se consultan en la fuente autorizada de ese tenant.

La evolución recomendada es:

```text
mensaje del cliente
       |
       v
intérprete LLM estructurado y contextual
       |
       v
catálogo aislado por tenant + búsqueda léxica enriquecida
       |
       +--> hipótesis contextual con una única opción compatible --> cotización
       |
       +--> varias opciones / hipótesis ambigua --> aclaración u opciones
       |
       +--> sin candidata --> disponibilidad parcial o atención humana
       |
       v
compositor LLM con sobre de hechos --> WhatsApp
```

El LLM entiende el lenguaje, el contexto y la intención de presentación; el catálogo determina qué existe; el dominio determina qué se puede confirmar, cobrar, alistar o despachar. No se convierte `familiar` o `grande` en una medida fija nacional.

## 2. Punto de partida comprobado

El agente actual sigue un patrón **planner-orchestrator de dos etapas**:

1. DeepSeek devuelve un plan JSON con intención, `candidateItems`, cantidad, presentación, campos faltantes, confianza, `toolPlan` y estrategia de respuesta.
2. El runtime llama herramientas permitidas, principalmente la lectura de `Catalogo`, y aplica reglas de dominio antes de construir el pedido.
3. Un segundo llamado LLM redacta la respuesta sobre hechos ya validados; los mensajes determinísticos son contingencia segura.

Hay dos brechas relevantes:

- La búsqueda vigente puntúa SKU, nombre, categoría y alias, pero no la descripción ni atributos de producto.
- La selección de una referencia aún puede aceptar una coincidencia aproximada demasiado débil; la E2E demostró sustituciones incorrectas de artículos.

La corrida E2E real con DeepSeek dejó 13 de 40 casos aprobados. Por ello el primer trabajo funcional es enriquecer el catálogo y mejorar la decisión contextual entre variantes, sin introducir RAG ni ReAct.

## 3. Decisión contextual de presentación

### Principio

La presentación se resuelve como una **hipótesis heurística contextual**, no como una tabla rígida ni como una conversión universal. El intérprete conserva el texto del cliente, identifica qué está pidiendo y explica la certeza de su hipótesis.

Ejemplos de hipótesis:

| Mensaje | Hipótesis del intérprete | Fuerza |
| --- | --- | --- |
| `Coca de 3 litros` | volumen explícito de `3000 ml` | alta |
| `una Coca familiar` | bebida para compartir; tamaño no fijado | media |
| `una Coca personal` | bebida para consumo individual; tamaño no fijado | media |
| `un yogur familiar` | formato para compartir dentro de la familia de yogures | media |
| `arroz grande` | formato mayor relativo entre los arroces disponibles | media/baja |
| `medio kilo de arroz` | peso explícito de `500 g` | alta |

La normalización de unidades solo vuelve comparables expresiones equivalentes (`3 L`, `3 litros`, `3000 ml`; `500 g`, `500 gr`, `medio kilo`). No decide cuál SKU comprar.

### Heurística contextual

Para cada candidato del mismo tenant se ponderan, sin transformar una sola señal en verdad absoluta:

1. La coincidencia con el nombre, marca, alias y categoría inferidos.
2. La presentación explícita solicitada, cuando exista.
3. La posición relativa del tamaño dentro de la familia disponible en esa tienda: no en un catálogo nacional abstracto.
4. La señal de ocasión: `para compartir`, `para la casa`, `onces`, `para mí`, `lonchera`, `grande`, `familiar`.
5. El contexto ya confirmado de la conversación: marca, sabor, preferencia previa, cantidad y presupuesto.
6. Las convenciones configurables del tendero para su surtido, solo como una señal más.

La investigación de marcas colombianas refuerza este enfoque: [Coca-Cola ofrece múltiples formatos para compartir](https://www.coca-cola.com/co/es/legal/tyc-promo-vasos-futbol), incluyendo 1.5 L, 2 L, 2.25 L, 2.5 L y 3 L; [Postobón presenta HIT de 1 L como familiar](https://www.postobon.com/sites/default/files/informe_de_sostenibilidad_postobon_2023.pdf); y [Alpina denomina familiares formatos de yogur de 500 g y 1.000 g](https://alpina.com/cultura-alpinista/sedes). Por tanto, no habrá una regla global como `familiar = 3 L` ni `grande = 500 g`.

`Personal` tampoco se convierte a un volumen fijo. En `Coca personal` significa normalmente consumo individual; en `aseo personal` describe una categoría, no el tamaño; y en otras familias puede no ser una señal comercial útil. La heurística usa la familia, el sustantivo cercano, la ocasión (`para mí`, `para llevar`) y las opciones reales de la tienda. Si hay dos referencias personales plausibles, por ejemplo 400 ml y 600 ml, VIA presenta ambas antes de agregarlas al pedido.

### Salida segura de la heurística

La heurística puede recomendar una referencia solo cuando la evidencia contextual favorece a una única opción disponible con una diferencia clara frente a las demás. Cuando dos variantes continúan siendo razonables, VIA presenta botones o lista con nombre, tamaño y precio; no elige por el cliente.

La única compuerta estricta ocurre al crear una línea de pedido: debe existir un SKU activo, con stock, precio y una hipótesis sin ambigüedad material. La compuerta no decide qué significa `familiar`; solo evita confirmar algo que el contexto no permitió distinguir.

## 4. Fases de implementación

### Fase A — Contrato de recuperación y telemetría

**Objetivo:** saber por qué una referencia fue propuesta, descartada o confirmada.

1. Registrar por candidato: `tenantId`, consulta cruda, consulta normalizada, fuente de coincidencia, puntaje, atributos comparados y decisión final.
2. Medir `candidate_recall_at_3`, `exact_sku_match_rate`, `wrong_auto_selection_rate`, `clarification_rate`, `handoff_rate`, latencia y tokens por mensaje.
3. Correlacionar el uso de planner y compositor con `traceId`, conversación y pedido; una llamada al proveedor no puede quedar sin uso o resultado trazable.
4. Declarar una política de confianza: solo se selecciona automáticamente un producto si supera el umbral y no hay otra candidata cercana incompatible.

**Aceptación:** para cada ítem pedido se puede explicar qué buscó el agente, cuáles fueron las tres candidatas principales y por qué eligió, preguntó o escaló.

### Fase B — Modelo de catálogo enriquecido

**Objetivo:** que la recuperación tenga información suficiente sin mezclar datos entre tiendas.

Se ampliará el contrato de `Catalogo` sin romper las diez columnas existentes. Las nuevas columnas se agregan a la derecha:

| Campo nuevo | Uso |
| --- | --- |
| `descripcion` | Ingredientes, uso, sabor, tipo y contexto comercial. |
| `etiquetas` | Términos de búsqueda como `onces`, `lonchera`, `sin azucar`, `aseo`, `rapido`. |
| `familia_producto` | Agrupa variantes equivalentes, por ejemplo `coca_cola_original`. |
| `presentacion_normalizada` | Valor comparable de la presentación, por ejemplo `1500 ml`, `500 g` o `12 und`; conserva `presentacion` como el texto visible original. |
| `rol_presentacion` | No es una verdad fija ni una columna obligatoria del catálogo. Es una hipótesis efímera del intérprete para una solicitud concreta, calculada desde el mensaje, la presentación y las variantes que esa tienda tiene disponibles. |
| `atributos_json` | Sabor, volumen, unidad, tipo, restricción de edad y otras dimensiones verificables. |
| `origen_catalogo` | `tenant`, `base_referencia` o `importado_csv`; no modifica la propiedad del dato. |

El catálogo operativo conservará precio, stock, activo y disponibilidad propios de cada tenant. La expansión Colombia +200 solo propone nombres, marcas, presentación, descripción y alias; no impone inventario ni valores de venta.

#### Aislamiento obligatorio por tenant

La referencia de 300 productos es una fuente de semillas para los escenarios de prueba, no un catálogo compartido en operación. Cada consulta y cada mutación debe llevar el `tenantId` resuelto desde la conexión de WhatsApp y limitarse a ese tenant. Un producto, alias, precio, disponibilidad, archivo de Drive, pedido o conversación de una tienda no puede ser visible ni utilizable por otra. Las pruebas crearán copias aisladas por escenario y tenant; nunca reutilizarán el inventario operativo de otra tienda.

**Aceptación:** un archivo antiguo de diez columnas sigue funcionando; uno enriquecido permite buscar por descripción, marca, presentación visible, presentación normalizada, etiqueta y alias. La respuesta siempre muestra la presentación visible configurada por el tendero.

#### Contrato de búsqueda enriquecido

Cada búsqueda debe recibir el mensaje crudo y una hipótesis del intérprete (`producto`, `marca`, `categoría`, `ocasión`, `presentación explícita` o `preferencia de tamaño`). No recibe una etiqueta fija de `rol_presentacion`. Para cada candidato debe devolver, como mínimo:

```text
sku, nombre, categoria, marca,
presentacion, presentacion_normalizada, atributos_json,
descripcion, etiquetas, familia_producto, aliases,
precio, stock, activo, origen_catalogo
```

`descripcion` y `presentacion` son campos de recuperación obligatorios en el contrato enriquecido. La descripción permite relacionar necesidades y usos con una referencia existente; la presentación visible y normalizada permiten contrastar el contexto con medidas comparables. Con esos resultados, el intérprete formula una hipótesis por turno, por ejemplo `para compartir` o `uso individual`; esa hipótesis se puede confirmar, refutar o dejar ambigua según las variantes disponibles. Precio y stock no se usan para inferir el significado del mensaje: solo restringen los candidatos que se pueden ofrecer.

### Fase C — Recuperación contextual y heurística

**Objetivo:** reducir sustituciones falsas sin perder comprensión de modismos y errores de escritura.

La búsqueda se ordenará así:

1. SKU, código de barras o alias exacto normalizado.
2. Nombre, marca y presentación compatibles.
3. Coincidencia léxica sobre nombre, alias, categoría, descripción, etiquetas, presentación visible y presentación normalizada; tildes y puntuación normalizadas.
4. Extracción de unidades y de intención de presentación por el intérprete: tamaño explícito, formato para compartir, formato individual, tamaño relativo, ocasión y presupuesto.
5. Ponderación contextual contra candidatos de la misma familia y del mismo tenant: volumen, peso, unidades, sabor, tipo, marca, conversación y convenciones de la tienda.
6. Decisión:
   - una única opción claramente favorecida: se puede cotizar;
   - varias variantes razonables: se presentan hasta tres opciones validadas;
   - señal contextual insuficiente: se pregunta, no se agrega al pedido;
   - producto ausente: se informa con claridad y se ofrece alternativa solo si pertenece a la misma familia o necesidad.

No se incorpora búsqueda vectorial, embeddings ni RAG en esta fase. Para 200 a 500 referencias por tienda, la búsqueda léxica enriquecida y la heurística de presentación son más explicables, rápidas y suficientes para validar el comportamiento.

**Aceptación:** ningún escenario E2E puede confirmar Cifrut como Chocoramo, papel higiénico como papas ni una presentación distinta sin una elección explícita del cliente.

### Fase D — Intérprete y voz colombiana

**Objetivo:** que DeepSeek comprenda la forma de hablar sin convertirla en una regla comercial débil.

1. Separar en la política del tenant:
   - léxico regional para interpretar: `me regala`, `onces`, `tinto`, `gaseosa`, `datafono`, abreviaciones y typos frecuentes;
   - voz de salida: cercanía, formalidad, longitud y expresiones moderadas.
2. Mantener `rawName` del cliente y producir hipótesis `catalogQuery`, atributos requeridos y confianza.
3. Entregar al compositor solo el sobre de hechos: candidatos elegibles, total, campos faltantes, pago y siguiente acción.
4. Validar que la respuesta no omita preguntas obligatorias ni agregue dinero, stock, productos o estados no validados.
5. Retirar progresivamente filtros codificados de marcas y productos del camino principal; se convierten en datos de alias y pruebas, no en excepciones de código.

**Aceptación:** una frase con modismo o typo conserva la intención; el tono puede variar por tenant, pero la canasta y los hechos comerciales no cambian.

### Fase E — Retroalimentación y regresión

**Objetivo:** mejorar la heurística sin aprendizaje implícito ni arquitectura nueva.

1. Registrar hipótesis del intérprete, candidatos, atributos comparados, selección del cliente y correcciones del tendero.
2. Convertir los desacuerdos en escenarios de regresión E2E, aliases revisados o ajustes de la política de interpretación.
3. Revisar semanalmente falsos positivos de presentación: familiar, grande, personal, surtido, económico y por presupuesto.
4. Mantener los cambios de prompts, aliases y convenciones versionados y aprobados; no hay actualización automática del comportamiento con conversaciones en vivo.
5. Fine-tuning, RAG y ReAct quedan fuera de este ciclo y requieren una decisión de producto posterior.

### Fase F — Integridad de líneas y datos obligatorios

**Objetivo:** impedir que una coincidencia de un producto contamine otro artículo del mismo pedido o que se confirme un pedido incompleto.

1. Asignar un identificador estable a cada necesidad extraída del mensaje (`rawItemId`) y conservar su texto, cantidad, presentación y candidatos propios durante toda la conversación.
2. Resolver y puntuar candidatos por `rawItemId`; un SKU puede aparecer dos veces solamente si el cliente lo pidió dos veces o lo eligió explícitamente para ambas líneas.
3. Tratar las medidas explícitas como restricción fuerte de la hipótesis: `3 L`, `medio kilo`, `x12` o un sabor indicado no se sustituyen por otra variante.
4. Mantener un registro de campos faltantes por línea. Mientras falte cantidad, presentación o identificación de producto, VIA no calcula un subtotal definitivo, no ofrece pago y no solicita confirmación.
5. Recalcular el subtotal solo desde las líneas resueltas del borrador y verificar que sea la suma de `cantidad x precio` antes de mostrarlo o persistirlo.

**Aceptación:** ningún pedido multítem asigna Chocoramo a una solicitud de Cifrut, papel higiénico a papas, ni reutiliza un candidato entre líneas sin evidencia explícita. Un pedido incompleto solo pregunta por el dato faltante de su línea.

### Fase G — Máquina de estados, pagos y cierre operativo

**Objetivo:** que la conversación lleve al cliente por un flujo único, recuperable e idempotente hasta el cierre del domicilio.

1. Declarar estados explícitos del borrador: `resolviendo_productos`, `esperando_cantidad_o_variante`, `esperando_nombre`, `esperando_direccion`, `esperando_pago`, `esperando_confirmacion`, `confirmado`, `tomado`, `alistando`, `en_camino` y `cerrado`.
2. Permitir que un perfil conocido complete datos solo cuando son vigentes y el cliente no los corrige; el estado siguiente se determina por el único dato realmente faltante.
3. Normalizar la configuración de pago por `id` canónico, deduplicar antes de generar la oferta y conservar el nombre visible definido por el tenant. Efectivo, Tarjeta y Bre-B son valores iniciales, no una lista cerrada.
4. Persistir cada botón u opción con su conversación, versión de borrador y vencimiento. `Confirmar pedido`, `Ajustar pedido` y `Hablar con la tienda` deben ser acciones idempotentes, consumibles una vez y validadas contra el tenant y el estado vigente.
5. Al marcar `en_camino`, persistir la transición, encolar el aviso al cliente y cerrar la conversación de manera coherente. Un reintento no puede mandar dos avisos ni reabrir el pedido; un mensaje posterior debe iniciar una conversación nueva.

**Aceptación:** no se pide pago dos veces, Bre-B no aparece duplicado, no se confirma sin pago elegido y el despacho genera exactamente un aviso “va en camino”, deja el pedido cerrado y abre un nuevo caso ante el siguiente mensaje.

### Fase H — Consulta de catálogo, ausencia y recomendaciones

**Objetivo:** diferenciar pedir un producto, explorar una categoría y pedir una recomendación sin inventar alternativas.

1. Clasificar la intención como `pedido_especifico`, `consulta_categoria`, `recomendacion_por_ocasion` o `producto_ausente` antes de formar la respuesta.
2. Para categoría u ocasión, mostrar de dos a cuatro opciones disponibles y pertinentes con nombre, presentación, precio y razón breve de pertinencia; no convertir la exploración en un pedido.
3. Para producto ausente, informar que no está disponible. Solo ofrecer sustitutos cuando el tenant los haya marcado como compatibles o pertenezcan a la misma familia de necesidad; nunca sugerir aceite o arroz ante atún por semejanza débil.
4. Separar las fichas internas de Drive de la respuesta comercial. Sus textos sirven de apoyo operativo, pero no se concatenan al WhatsApp del cliente.

**Aceptación:** una consulta de jugos, aseo, onces, lonchera, algo frío o desayuno rápido devuelve opciones pertinentes; una ausencia no produce sustituciones sin relación.

### Fase I — Rendimiento, tolerancia a fallo y observabilidad

**Objetivo:** mantener el acuse de Meta rápido y hacer visible el tiempo y costo de cada decisión posterior.

1. Mantener el acuse del webhook desacoplado del procesamiento, con `p95` inferior a un segundo para mensajes válidos.
2. Medir por mensaje: cola, planificación DeepSeek, búsqueda, composición, persistencia, envío, reintentos y tiempo hasta la primera respuesta saliente. Establecer y validar un objetivo de `p95` de procesamiento completo de diez segundos en desarrollo; ajustar el umbral con evidencia de cargas reales antes del piloto.
3. Registrar separadamente tokens y costo estimado de planner y compositor, número de llamadas al proveedor, fallback, timeout y causa de cada reintento.
4. Limitar la ejecución normal a un plan y una composición por mensaje; si el proveedor falla, crear un evento observable y una respuesta de atención segura, nunca una confirmación inventada.
5. Correlacionar todo con `traceId`, `messageId`, conversación, pedido y outbox para que una falla se pueda reproducir desde la evidencia E2E.

**Aceptación:** la E2E muestra tiempos y tokens completos por paso, no hay llamadas LLM sin correlación y ningún timeout puede dejar un pedido parcialmente confirmado.

## 5. Catálogo de pruebas Colombia: 200 referencias adicionales

### Alcance honesto

No existe una fuente pública que publique un ranking verificable de los 200 SKU exactos más vendidos de todas las tiendas colombianas. La lista debe llamarse **Expansión Colombia +200 para pruebas**, no “ranking nacional certificado”.

La selección se apoya en evidencia de categorías del canal: Kantar identifica como categorías principales en tienda de barrio gaseosas, leche líquida, snacks, café, carnes frías, pan empacado, arroz, pastas, crema dental y aguas; también señala crecimiento de lava loza, aceite, papel higiénico, pañales, yogurt y alimento para mascotas. El estudio 2025 de Kantar destaca galletas dulces, café, leche y detergente en polvo. Los datos de NielsenIQ reportados en 2026 concentran buena parte de la venta en bebidas y alimentos, y señalan alta presencia de Coca-Cola y Colgate en canal tradicional.

Fuentes de curaduría:

- [Kantar: categorías de compra en tiendas de barrio](https://www.kantar.com/latin-america/Inspiracion/Retail/2022-CO-Todos-los-hogares-siguen-visitando-tiendas-de-barrio)
- [Kantar: tendencias de FMCG en Colombia](https://www.kantar.com/latin-america/Inspiracion/Consumidor/2025/Bienes-de-consumo-masivo-en-Colombia-muestra-signos-de-recuperacion)
- [NielsenIQ, cobertura de canal tradicional, citado por P&M](https://www.revistapym.com.co/articulos/consumidor/88956/nielseniq-revelo-el-estudio-y-los-premios-full-view-2025)
- [Panorama NIQ de tiendas de barrio, citado por La República](https://www.larepublica.co/empresas/tienda-de-barrio-lidera-las-ventas-de-consumo-masivo-entre-jugadores-de-retail-4469659)

### Composición

El repositorio ya tiene 100 referencias de demostración en `server/data/bogotaCatalogSeed.js`. El objetivo es agregar **200 referencias candidatas adicionales** para disponer de **300 referencias de prueba en total**. Las 100 referencias enumeradas inicialmente son el primer bloque de la expansión, no el objetivo completo. Todas requieren que el entorno de prueba valide precio, stock, actividad y, cuando aplique, la marca disponible en su zona.

| Bloque adicional | Referencias | Ejemplos de familias |
| --- | ---: | --- |
| Bebidas y listas para tomar | 35 | gaseosas, agua, té, jugos, hidratantes, maltas y energizantes |
| Lácteos, panadería y carnes frías | 30 | leche, yogurt, queso, margarina, pan y embutidos |
| Despensa y cocina | 40 | arroz, granos, harinas, pastas, aceites, salsas y condimentos |
| Snacks, galletas y dulces | 30 | pasabocas, galletas, chocolatinas y chicles |
| Aseo de hogar | 25 | detergentes, lavaloza, desinfectantes, papel y bolsas |
| Cuidado personal | 25 | higiene oral, cabello, protección femenina y afeitado |
| Bebé y mascotas | 15 | pañales, toallitas, compotas, concentrados y arena |
| **Total adicional / total de prueba** | **200 / 300** | |

### Referencias candidatas 101–300

La lista detallada de 101–200 es el primer bloque ya curado. Antes de cargar datos, se completará el segundo bloque 201–300 con la misma ficha por producto: SKU estable, nombre, categoría, marca, presentación visible, presentación normalizada, descripción, etiquetas, familia, aliases, precio y stock de prueba. Ninguna referencia se cargará como inventario real de un tenant.

| Rango | Categoría | Referencias candidatas |
| --- | --- | --- |
| 101–110 | Gaseosas y agua | Coca-Cola Zero 400 ml; Coca-Cola Sin Azúcar 1.5 L; Sprite 400 ml; Fanta naranja 400 ml; Bretaña 400 ml; Uva Postobón 400 ml; Colombiana 1.5 L; Manzana Postobón 1.5 L; Agua Cristal con gas 600 ml; Agua Brisa 1.5 L. |
| 111–120 | Bebidas listas | H2OH! limón 600 ml; Mr Tea limón 500 ml; Mr Tea durazno 500 ml; Jugo Hit tropical 500 ml; Cifrut naranja 250 ml; Gatorade tropical 500 ml; Gatorade naranja 500 ml; Electrolit uva 625 ml; Vive100 naranja 240 ml; Pony Malta 1 L. |
| 121–128 | Lácteos | Leche Colanta deslactosada 1 L; Leche Alquería chocolate 1 L; Avena Alpina original 1 L; Yogurt Alpina durazno 150 g; Kumis Alpina 1 L; Queso doble crema Colanta 250 g; Queso tajado Colanta 200 g; Margarina La Fina 250 g. |
| 129–136 | Panadería y carnes frías | Arepa de maíz blanca x5; Pan hamburguesa integral x6; Pan perro x6; Tortilla de trigo x8; Salchichón Zenú 250 g; Chorizo Zenú x5; Jamón Zenú 250 g; Queso para sándwich Alpina 200 g. |
| 137–146 | Granos y harinas | Arroz Diana 1 kg; Arroz Roa 500 g; Frijol cargamanto 500 g; Frijol rojo 500 g; Maíz pira 500 g; Garbanzo 1 kg; Harina Doñarepa blanca 1 kg; Harina PAN amarilla 1 kg; Avena Quaker 500 g; Maizena 380 g. |
| 147–156 | Pastas y cocina | Pasta Doria conchitas 250 g; Pasta La Muñeca spaghetti 250 g; Fideos Doria 250 g; Aceite Premier 1 L; Azúcar Manuelita 1 kg; Sal Refisal 1 kg; Panela pulverizada 500 g; Salsa de tomate Fruco 400 g; Mayonesa Fruco 400 g; Caldo Knorr gallina x8. |
| 157–160 | Condimentos y despensa | Mostaza Fruco 400 g; Salsa BBQ Fruco 200 g; Café Sello Rojo 500 g; Chocolate Corona 500 g. |
| 161–170 | Snacks | Papas Margarita pollo 105 g; Papas Super Ricas natural 90 g; Doritos Dinamita 90 g; Tostacos BBQ 80 g; Maizitos 90 g; Cheese Tris 45 g; Choclitos BBQ 80 g; De Todito limón 110 g; Mani confitado 50 g; Platanitos limón 80 g. |
| 171–175 | Galletas y dulces | Galletas Festival vainilla; Galletas Chokis 120 g; Galletas Ducales integral; Chocolatina Jumbo 50 g; Trident hierbabuena. |
| 176–182 | Aseo de hogar | Detergente Dersa 400 g; Detergente Rindex 400 g; Lavaloza LozaCrem 450 g; Fabuloso lavanda 900 ml; Limpido floral 1 L; Esponjilla Brillo x3; Papel higiénico Familia x12. |
| 183–189 | Aseo y desechables | Toalla de cocina Familia x1; Bolsas basura medianas x10; Guantes de aseo; Ambientador Glade 360 ml; Insecticida Raid 360 ml; Jabón para ropa en barra Varela; Suavizante Suavitel 900 ml. |
| 190–196 | Cuidado personal | Shampoo Savital sachet; Acondicionador Savital sachet; Shampoo Ego 400 ml; Desodorante Rexona 50 g; Cuchillas Prestobarba x2; Protectores diarios Nosotras x15; Pañitos húmedos Pequeñín x50. |
| 197–200 | Bebé y mascotas | Pañales Winny etapa 3 x30; Compota Alpina manzana 113 g; Cat Chow adulto 500 g; Arena para gato 2 kg. |

Las bebidas alcohólicas y el tabaco pueden ser importantes comercialmente, pero quedan fuera de esta base habilitada para venta autónoma hasta definir verificación de edad, política del tenant, restricciones locales y handoff obligatorio. No se incorporarán por defecto para pedidos automatizados.

### Proceso de carga seguro

1. Crear una plantilla CSV enriquecida para los 200 productos con `precio`, `stock` y `activo` vacíos o desactivados por defecto en modo real.
2. Cargarla como borrador del tenant; nunca limpiar ni reemplazar el catálogo actual sin que el dueño el confirme.
3. Mostrar una revisión: duplicados probables, variantes semejantes, campos obligatorios, edad restringida y conflictos de alias.
4. Activar solo las referencias que el tendero vende y a las que asigne precio y stock.
5. Para demo local se permiten precios y stock de prueba claramente identificados como tales; no son precios de mercado ni se proyectan a tenants reales.

## 6. Matriz de pruebas y salida

Además de los 40 casos E2E existentes, se añadirán casos para:

- typos regionales: `chocorramo`, `calchichon`, `coca litro y medio`, `yogur`;
- comparación de variantes: regular/cero, sabor, tamaño y marca;
- consultas de necesidad: `algo para las onces`, `algo para la sed`, `lonchera`;
- producto ausente y alternativa de la misma familia;
- múltiples productos con cantidades distintas;
- selección del cliente desde lista interactiva;
- corrección posterior de dirección, producto, cantidad o pago;
- interpretación contextual de `familiar`, `personal`, `grande`, `para compartir`, `para mí`, `medio kilo` y tamaños explícitos;
- pedido multítem con referencias similares, una referencia repetida intencionalmente y una referencia incompatible;
- cantidad, presentación, nombre, dirección y pago faltantes por separado; subtotal y confirmación bloqueados hasta completarlos;
- deduplicación de métodos de pago, confirmación mediante botones, ajuste, conversación con tendero y reintentos de opciones vencidas;
- transición `tomado` → `alistando` → `en_camino`, un único aviso al cliente, cierre y nuevo pedido posterior;
- producto ausente sin sustituto, categoría, ocasión y recomendaciones con opciones pertinentes;
- presupuestos de latencia, timeout, reintento, tokens y composición de respuesta;
- aislamiento: ningún alias, historial, convención ni candidato de un tenant aparece en otro.

La promoción de cada fase exige ejecutar la E2E local con DeepSeek real, conservar artefactos por caso, no alterar la base fuente de desarrollo y aprobar una revisión humana de los falsos positivos.

## 7. Orden recomendado

1. Fases F y G: corregir los bloqueantes P0 de integridad por línea, confirmación, despacho, cierre y nueva conversación.
2. Fase B: columnas enriquecidas, importador compatible y catálogo referencia como borrador.
3. Fase C: recuperación contextual y pruebas de selección por variante.
4. Fase H: respuestas de categoría, ausencia y recomendación pertinentes.
5. Fase D: separación entre léxico regional y voz del tenant.
6. Fases A e I: trazabilidad, presupuesto de latencia, tokens y tolerancia a fallos.
7. Fase E: retroalimentación revisada y regresión E2E hasta cumplir los criterios de salida.

La condición para pasar a una tienda real no es tener RAG ni ReAct: es que el agente actual interprete el contexto colombiano, coteje opciones reales del tenant y no convierta una hipótesis incierta en un pedido erróneo.
