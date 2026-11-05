# Revisión de expectativas E2E: conversaciones contextualizadas y aceptación de negocio

Fecha: 2026-11-04. Estado: instrumento implementado; 50 casos ejecutados, comparación acotada de 6 casos y auditoría completadas. Hay fallos confirmados y cobertura pendiente; no hay aprobación de liberación. Resultados en la sección 12.

Esta revisión respondió inicialmente a la instrucción de detener las correcciones y revisar primero qué significa que un caso sea exitoso. Tras el «adelante», se implementó el instrumento de prueba descrito al final. Los cambios locales anteriores de la aplicación se conservan, con `LLM_GROUNDING_ENABLED=false` por defecto. Esta continuación modifica pruebas y documentación, no añade correcciones al backend ni despliega.

## 1. Conclusión

El resultado anterior **40/40** acredita la matriz y las aserciones que se ejecutaron, pero no demuestra que VIA complete correctamente los escenarios reales de venta. La matriz mezcla contratos técnicos con frases literales, elecciones comerciales no expresadas por el cliente y un orden de preguntas preestablecido.

La nueva evaluación debe comprobar **comprensión, conservación del pedido, evidencia de catálogo, avance conversacional y resultado comercial**. El LLM puede elegir entre varias respuestas válidas; los precios, cantidades expresadas, consentimiento, aislamiento y escrituras deben cumplir invariantes verificables.

Tampoco procede convertir los **6/40** recientes en un éxito por cambiar expectativas. Hay fallos del instrumento de prueba, diferencias de conversación y defectos reales. Se deben registrar por separado, corregir el instrumento y ejecutar nuevamente ambos flujos contra la misma especificación revisada.

## 2. Evidencia revisada

| Fuente | Hallazgo verificable |
|---|---|
| [Fixtures actuales](../server/tests/fixtures/colombiaAgentScenarios.js) | Contienen **50** escenarios. El runner principal toma los primeros **40**. |
| Primeros 40 fixtures | **37 son de un solo turno**. Solo 04, 30 y 40 tienen varios turnos: 2, 3 y 3. Total: **45 mensajes del cliente** en el guion nominal. Solo dos buscan registrar un pedido. |
| [Runner E2E](../server/tests/e2e-local-deepseek-40.mjs) | Envía webhook firmado, usa PostgreSQL clonado, captura Graph y llama a DeepSeek real. Estas capacidades se conservan. El actor cliente sigue pasos estáticos y puede asumir que cualquier oferta interactiva es de pago. |
| [Análisis del chat SuperMarket](Analisis-interacciones-whatsapp-supermarket.md) | Documenta ráfagas, adiciones, correcciones, aclaraciones, pago separado y atención humana. Es evidencia de lenguaje y patrones; sus sesiones estimadas no equivalen a pedidos contables. Sus referencias históricas a productos restringidos no reemplazan la política vigente del canal. |
| [Evidencia anterior P9](Evidencia-P9-e2e-deepseek-2026-11-04.md) | Run `20261104152951_d4af6f21`: 40/40 y flujo del tendero aprobado bajo el oráculo anterior. |
| Run `test-results/grounding-e2e-final/20261104174118_beda0cd8` | 6/40 bajo ese mismo oráculo; 34 fallidos. En 17, los únicos fallos registrados son aserciones `options_*`. Esto requiere auditar la instrumentación y la pertinencia; no acredita automáticamente que las opciones sean correctas. El flujo del tendero quedó bloqueado porque los guiones no produjeron un pedido confirmado. |

Ambas corridas declaran `catalogSource=colombia300_reference`, 300 referencias. Las modificaciones posteriores de código no están verificadas por aquella corrida de 40; las pruebas focalizadas se reportan por separado.

### Catálogo de referencia para la revisión

Archivo: [colombiaCatalogExpansion.js](../server/data/colombiaCatalogExpansion.js), exportación `colombiaCatalogTestSeed300`.

SHA-256 de `JSON.stringify(colombiaCatalogTestSeed300)` al revisar: `b4b1f0d237e7a60cc3b003debe21c724d4f2ebc524396af40f83d52cc1305462`.

| Producto real del fixture | Presentación | Precio COP | Implicación para el caso |
|---|---|---:|---|
| Ponque Chocoramo / Chocoramo mini | 65 g / 35 g | 2.800 / 1.600 | «Chocorramo» sin más contexto puede requerir elegir variante. |
| Arepa boyacense | 5 unidades por paquete | 6.500 | «2 arepas» no autoriza asumir dos paquetes, es decir diez arepas. Aclarar la unidad de venta si no existe evidencia suficiente. |
| Arroz Diana / Arroz Diana familiar | 500 g / 1 kg | 3.200 / 6.200 | «Arroz» no determina marca; «Arroz Diana» tampoco determina tamaño. |
| Shampoo Savital sachet / Acondicionador Savital sachet | 18 ml / 18 ml | 1.200 / 1.200 | «Savital en sobrecito» permite recuperar ambos; no autoriza elegir shampoo ni inventar que se pidió una bebida. |
| Pan tajado Bimbo blanco / Pan tajado Bimbo grande | 500 g / 680 g | 7.600 / 9.800 | Evaluar presentación y descripción antes de resolver; solicitar tamaño si el contexto no distingue. |
| Leche entera Alquería bolsa / Colanta bolsa | 1 L / 1 L | 4.700 / 4.800 | «Una leche entera» mantiene cantidad 1 y marca pendiente; pedir pago antes de aclararla es un fallo. |

Los valores anteriores pertenecen al fixture, no son una afirmación sobre precios de producción. Cada corrida debe guardar su catálogo, configuración de la tienda y hash. Las referencias añadidas por un caso no pueden contaminar otro ni otro tenant.

## 3. Problemas del instrumento de evaluación

| Problema actual | Riesgo | Expectativa corregida |
|---|---|---|
| Exigir frases como «Stock actual», «cómo prefieres pagar» o «No encontré una coincidencia clara» | Rechazar respuestas correctas redactadas naturalmente. | Verificar el contenido y la acción: disponibilidad fundada, aclaración útil, siguiente paso, ausencia de afirmaciones falsas. Reservar texto exacto para contratos públicos que lo requieran, no para prosa del LLM. |
| Casos 01, 23 y 32 esperan pago en el primer mensaje | Premiar un cierre anticipado. | Aceptar aclarar, consolidar o invitar a agregar según el contexto. No ofrecer un cierre con variantes o cantidades pendientes. |
| Caso 35 exige Diana/Premier sin que el cliente las mencione | Premiar una selección inventada. | Conservar arroz, aceite y huevos; recuperar opciones reales y aclarar marcas/tamaños/cantidades. |
| Resolver «2 arepas» como dos paquetes de cinco | Dar por correcto un error de unidad comercial. | Distinguir unidades físicas, cantidad de empaques y presentación; no multiplicar paquetes sin autorización suficiente. |
| Inferir intención por coincidencia exacta con un único enum | Confundir una variación interna con un fallo de negocio. | Evaluar los efectos. Una consulta no debe generar compra ni pago; una solicitud de compra debe conservar todos sus componentes aunque aún explore variantes. |
| `options.mustMatchAny` usa coincidencia de alguna opción | Una opción pertinente puede ocultar otras incorrectas. | **Toda** opción presentada debe ser pertinente y verificable, o estar identificada como alternativa que requiere consentimiento. |
| Filtro del evaluador dependiente de `decision=catalog_option_proposed` | Reportar `[]` aunque se hayan enviado opciones reales con otro estado semántico. | Normalizar eventos por contrato versionado, conservar `resolutionStatus` y cotejar opciones con el payload realmente enviado. No contar resultados de búsqueda que no se ofrecieron. |
| Respuesta evaluada puede caer en el último mensaje del historial cuando no hay nuevo outbound | Ocultar silencio o usar una respuesta vieja. | Exigir un outbound nuevo asociado a los mensajes consumidos, o una supresión justificada por un turno posterior que finalmente los atiende. |
| Eventos de toda la conversación se reutilizan en cada paso | Aprobar trazas viejas, duplicar tokens o asociar mal la latencia. | Correlación por tenant, conversación, lote, `messageId`, revisión y `providerRequestId` cuando esté disponible. |
| El chequeo de subtotal persistido acepta cualquier número ≥ 0 | Un pedido en cero puede aprobar. | Igualdad exacta con cantidades autorizadas × precios de SKU y versión de catálogo, más cargos/descuentos permitidos y explícitos. No usar el total generado por el mismo componente como oráculo. |
| La comprobación de importes compara conjuntos de valores, no SKU/precio/cantidad | Dos precios intercambiados pueden pasar. | Validación por línea de pedido, subtotal, cargos y total; cotejar conversación, PostgreSQL y escritura asíncrona. |
| El cliente simulado busca pago en cualquier botón del paso 2 de 30/40 | Falla al recibir una oferta de presentación legítima. | Responder al tipo de oferta y a su versión. Elegir productos con preferencias fijadas antes de ejecutar; luego pago y confirmación cuando correspondan. |
| El tendero se prueba sobre el primer pedido confirmado | Ocultar fallos en otras variantes de cierre. | Cada caso declarado de ciclo completo debe terminar con su flujo operativo y sus invariantes. |

**La telemetría de costos también necesita conciliación:** el run anterior informa 181 solicitudes de red y 95 llamadas con tokens; el de grounding informa 225 y 141. No se asume que son métricas equivalentes ni que los tokens registrados representan todo lo facturado. Se deben explicar reintentos, llamadas adicionales y captura por etapa antes de comparar costos completos.

## 4. Qué se exige y qué se permite variar

### Invariantes obligatorios

1. Ningún producto, precio, disponibilidad, presentación, descuento o fecha de entrega puede inventarse. Las hipótesis del intérprete son revisables frente al texto original y al catálogo.
2. Conservar cada necesidad del cliente como resuelta, pendiente, retirada explícitamente o escalada. No perder una línea porque otra sea ambigua.
3. No sustituir marca, sabor o medida explícita sin consentimiento. No confundir el contenido del empaque con el número de empaques.
4. Mantener nombre, dirección y pago comunicados; cambiar solo lo que el cliente rectifica. Separar preferencia de pago de un pago verificado.
5. Consultas y recomendaciones no crean pedidos confirmados. Un «sí» solo confirma aquello a lo que responde en contexto.
6. Confirmar una cotización vigente y completa, con aceptación del cliente, una sola vez. Recalcular y reconfirmar tras una modificación relevante.
7. La incertidumbre semántica que puede aclararse con opciones reales permite diálogo. Ausencia de producto, falta de stock, baja evidencia persistente o decisión comercial no autorizada requieren escalamiento; no sustitución automática.
8. Atención manual conserva el contexto, detiene respuestas automáticas que compitan con el humano y permite al tendero completar el pedido por el flujo autorizado.
9. Aislamiento por tenant, idempotencia, vigencia de ofertas y control de concurrencia son obligatorios. Las políticas configuradas del negocio/canal no se flexibilizan para aprobar una prueba.
10. «En camino» debe producir la notificación y el cierre operativo acordados, sin duplicados; un nuevo pedido posterior no reutiliza accidentalmente la canasta cerrada. El acuse técnico de Meta no prueba entrega real al teléfono.

### Variación conversacional legítima

- Reconocer el saludo y los productos en una sola respuesta si llegaron juntos.
- Preguntar una variante antes de una cantidad, o combinar preguntas relacionadas si resulta claro.
- Proponer un conjunto corto de opciones pertinentes, sin obligar a mostrar todas las referencias del inventario.
- Invitar a agregar o ajustar cuando el cliente parece seguir armando el pedido. Omitir esa invitación si ya dijo que terminó; no repetirla tras cada dato.
- Guardar un medio de pago aportado espontáneamente durante la selección de productos. Esto no habilita por sí solo el cierre.
- Consultar o abrir un borrador provisional según el contexto, manteniendo pendientes y sin convertir alternativas («arroz o huevos») en una compra de ambos.
- Resolver con una búsqueda o pedir una reformulación. Una segunda llamada no es un requisito de éxito si la evidencia ya es suficiente.

Las preferencias de redacción se evalúan como experiencia. Las invariantes se comprueban con aserciones reproducibles; eso no convierte la interpretación productiva en reglas de palabras clave.

## 5. Matriz revisada de los 40 casos

Se conservan los identificadores para comparar versiones. La columna «continuación» forma parte del caso ampliado propuesto: el actor cliente responde a la pregunta real, no dispara siempre la misma frase en el mismo paso. Las elecciones finales se fijan antes de la corrida y no se inventan para acomodarse a la respuesta del agente.

| Nº / escenario | Resultado de negocio y siguientes acciones admisibles | Continuación y evidencia exigida |
|---|---|---|
| 01 — 3 chocorramos + 2 Cifrut | Recuperar ambas necesidades y cantidades. Aclarar la presentación del Chocoramo si persiste ambigüedad; no exigir pago inmediato. | El comprador elige 65 g y confirma que termina. Con el fixture: 3 × 2.800 + 2 × 1.800 = 12.000 en productos. Datos/pago y confirmación posteriores. |
| 02 — 3 chocorramos + Cifrut sin cantidad | Mantener 3 y cantidad pendiente de Cifrut; aclarar presentación y cantidad, en orden contextual. | Elegir 65 g y aportar 2 Cifrut. No inferir 1 Cifrut; no repetir la cantidad ya dada. |
| 03 — cliente nuevo, 2 arepas | Reconocer compra y domicilio. Resolver si quiere unidades o paquetes de cinco; conservar nombre/dirección como pendientes. | El comprador aclara que desea 2 paquetes. Solo entonces pueden cotizarse 13.000; recolectar datos antes del cierre. |
| 04 — completa nombre/dirección | Incorporar Laura y dirección al pedido activo, sin perder productos ni cantidad; no volver a pedirlos ni repetir una invitación sin avance. | Continuar desde la aclaración comercial de 03, aportar pago y cierre. Perfil/borrador deben conservar los datos; el perfil no significa pedido confirmado. |
| 05 — café tostado premium | Informar opción disponible y precio reales; explorar cantidad si pasa a compra. «Stock actual» literal no es obligatorio. | El comprador pregunta precio o elige cantidad; no convertir consulta inicial en compra. |
| 06 — «café bueno» | Ofrecer opciones justificadas por atributos, o preguntar uso/preferencia. «Bueno» no identifica un SKU. | Elegir entre opciones reales; no exigir los dos nombres históricos ni una cualidad premium inexistente. |
| 07 — jugos | Proponer alternativas reales y pertinentes, con sabor/presentación/precio; no agregar las opciones a la canasta. | Elegir sabor y cantidad. Todas las opciones deben pertenecer al tenant y cumplir disponibilidad. |
| 08 — «algo pa la sed» | Interpretar una recomendación de bebida, ofrecer opciones útiles o aclarar preferencia. Diversidad es deseable, no razón para ofrecer productos ajenos. | El comprador pide agua o jugo; conservar la elección sin asumir marca ni tamaño. |
| 09 — mecato para onces | Recomendar alimentos pertinentes; no excluir lácteos por una lista arbitraria si el contexto y catálogo los justifican. | Elegir un producto. No pedir pago por una simple recomendación. |
| 10 — mercado, arroz/aceite/o huevos | Conservar que pueden ser alternativas, no tres compras confirmadas. Explorar productos y cantidades. | El comprador especifica cuáles quiere. Evaluar AND/OR contextual y ausencia de adiciones no autorizadas. |
| 11 — papel y jabón para aseo | Distinguir familia y uso; no asumir detergente corporal, ropa o loza cuando importa. | Resolver tipo/tamaño mediante opciones reales, manteniendo ambas necesidades. |
| 12 — onces | Ofrecer alimentos apropiados basados en catálogo; panadería no es la única categoría admisible. | Elegir y completar cantidades; no penalizar una opción pertinente por su etiqueta de categoría. |
| 13 — jamón, queso y pan | Conservar los tres componentes; preguntar variantes sin sustituir ni omitir uno. Una pregunta puede tratar primero el jamón. | Responder marca/tamaño y completar queso/pan. El resultado debe cubrir las tres necesidades, no solo contener «encontré». |
| 14 — antojo dulce | Ofrecer alimentos dulces evidenciados en descripción/atributos; no escoger salados por score. | Elegir una alternativa; toda opción ofrecida debe satisfacer o explicar la preferencia. |
| 15 — desayuno rápido | Recomendar según ocasión y disponibilidad, con una aclaración si es útil; no afirmar que la tienda prepara comida si no está documentado. | Comprar una recomendación o terminar la consulta. Ambas salidas son legítimas y deben predefinirse como ramas. |
| 16 — algo frío | Distinguir bebida refrigerable de disponibilidad realmente refrigerada. No afirmar «frío» si el catálogo no lo acredita. | Con atributo de temperatura, recomendar; sin él, aclarar/validar con la tienda esa condición. |
| 17 — presupuesto de 5.000 | Opciones o combinación que respeten el presupuesto expresado; diferenciar alternativas de suma de productos. | Selección de una opción o combo; total de productos elegido ≤ 5.000, salvo ampliación autorizada. Separar costo de entrega si existe. |
| 18 — gaseosa pequeña | Interpretar tamaño relativo con contexto y presentaciones reales; no fijar universalmente «pequeña = X ml». | Mostrar tamaños plausibles o preguntar; una elección explícita resuelve la medida. |
| 19 — leche de bolsa | Recuperar presentación de bolsa; consultar entera/deslactosada/marca si afecta la selección. | Cliente elige tipo y marca; no aceptar leche de caja como equivalente sin consentimiento. |
| 20 — papel para baño | Inferir papel higiénico y recuperar tamaños/marcas pertinentes; no seleccionar cantidad de rollos sin evidencia. | Elegir paquete y cantidad. |
| 21 — jabón para ropa | Respetar uso de lavado de ropa; preguntar barra/líquido/polvo cuando sea relevante. | Elegir presentación y cantidad; no ofrecer jabón corporal como coincidencia. |
| 22 — arroz, aceite y leche entera | Conservar tres necesidades con el tipo «entera»; resolver variantes por contexto, sin exigir un enum interno único. | Completar las tres selecciones y cantidades, con adición/retiro opcional predefinido. |
| 23 — papel Familia x4 + 2 Rey 250 g | Resolver referencias explícitas; diferenciar 1 paquete de cuatro rollos y 2 barras. | Preguntar si desea agregar solo si no cerró la colección; subtotal verificable, luego pago/confirmación. |
| 24 — yogurt Alpina fresa + Festival | No asumir vaso de 150 g frente a presentación familiar. Mantener Festival mientras aclara yogurt. | Elegir presentación; aclarar entrega si aún no se indicó. |
| 25 — Savital en sobrecito | Buscar marca y sachet; distinguir shampoo/acondicionador. Una hipótesis errónea del intérprete no es una restricción del cliente. | Elegir tipo; no presentar botella de 180 ml como sobre ni una bebida inventada. |
| 26 — precio de Chocoramo | Responder precios ligados a sus presentaciones, o aclararlas. No agregar al carrito. | Cliente elige o finaliza consulta; no exigir una cantidad para informar precio. |
| 27 — lonchera infantil | Ofrecer productos pertinentes sin atribuir beneficios de salud no documentados; permitir variedad útil. | Responder preferencias conocidas y elegir. No usar solo la palabra «galleta» como certificado de pertinencia. |
| 28 — salmón ausente | Buscar, distinguir ausencia de evidencia de indisponibilidad confirmada e informar/escalar sin sustitución. | Tendero recibe solicitud original y contexto. No prometer que habrá stock o tiempo de respuesta garantizado. |
| 29 — Coca-Cola sin tamaño, cliente nuevo | Mostrar diferencias pertinentes (tamaño/tipo), conservar cantidad 1 y datos de entrega pendientes. | Elegir una SKU real; no usar la referencia extra del fixture como respuesta obligatoria ni ignorar otras válidas. |
| 30 — Agua Cristal y «dale, hágale» | Completar canasta y pago; interpretar el cierre según la pregunta previa. Si aún no hubo cotización completa, «dale» no confirma automáticamente. | Cliente responde la invitación si apareció, recibe resumen y acepta. Un pedido de 2.200, sin cargos extras del fixture, una sola escritura; tendero toma, despacha y cierra. |
| 31 — tintico | Distinguir deseo de café preparado de compra de café empacado; preguntar cuando el catálogo no permite resolverlo. | No prometer bebida preparada si solo hay café molido. Continuar con el formato que el cliente acepte. |
| 32 — Diana, Premier, huevos x12 | Conservar 1 de cada referencia y aclarar tamaños de arroz/aceite; `x12` es presentación, no 12 paquetes. | Elegir tamaños; solo después consolidar y ofrecer pago si falta. |
| 33 — «chocramos» y «cifru granadila» | Interpretar errores como hipótesis, comprobar catálogo y mantener cantidades 2 y 1. | Aclarar presentación pendiente y cotizar con SKU real. No exigir que el texto del borrador se escriba exactamente igual al nombre canónico. |
| 34 — Chocoramo y agua, sin cantidades | Conservar dos necesidades, medidas explícitas y cantidades desconocidas. Puede aclarar primero variante. | Cliente aporta cantidades; no inferir una unidad por defecto ni perder un producto. |
| 35 — arroz, aceite y huevos AA x12 | No inventar Diana/Premier ni cantidad 1. Distinguir paquete x12 de unidades solicitadas. | Preguntar marcas/tamaños/cantidades; el estado debe conservar las tres necesidades y sus pendientes. |
| 36 — lácteos, leche o queso | Tratar la consulta y alternativas correctamente; ofrecer lo pertinente sin comprar ambos automáticamente. | Cliente elige leche, queso o ambos explícitamente. |
| 37 — descuento | Interpretar solicitud y aplicar política autorizada; si excede delegación, solicitar decisión humana. | Aprobación/rechazo deja evidencia; nunca inventar descuento ni modificar total antes de autorización. |
| 38 — «ya transferí» | Reconocer declaración de pago; iniciar validación humana y responder al cliente. | Sin pago acreditado ni pedido nuevo por la declaración. El estado y notificación deben ser visibles. |
| 39 — pide persona | Handoff con historial, pendientes y acuse comprensible. | Intervención del tendero sin respuestas automáticas simultáneas; continuidad o cierre explícitos. |
| 40 — Bimbo, Bre-B y confirmación | Aclarar tamaño si procede, conservar preferencia Bre-B como preferencia y confirmar cotización vigente. | Elegir 500 g: 7.600 en productos. Un pedido, una tarea de alistamiento, transición a en camino, notificación y cierre; mensaje posterior comienza una necesidad nueva. |

Las cifras de ejemplo solo se usan una vez que el cliente simulado ha elegido esas referencias. No se impone ese resultado a un diálogo todavía ambiguo.

## 6. Incluir las conversaciones reales ya disponibles

Los casos 41–50 **ya existen** y no deben relegarse a una validación opcional: cubren precisamente varias fallas observadas en producción. Reportar `40 base + 10 reales`, sin denominarlos «40/40» si se ejecutan 50.

| Caso existente | Expectativa a alinear |
|---|---|
| 41 — saludo/apertura de domicilio | Saludar y ofrecer ayuda; no buscar un producto inexistente ni inventar carrito. |
| 42 — tarjeta débito | Guardar preferencia, conservar carrito y aclaraciones; no dar el pago por recibido. |
| 43 — «sin el agua» | Retirar solo el agua del pedido correcto, recalcular y preservar lo demás. |
| 44 — agregar queso | Conservar pan y sumar queso con cantidad/presentación; no abrir otro pedido ni reemplazar todo el carrito. |
| 45 — pedido por 5.000 de «calchichon» | No interpretar 5.000 unidades. Validar si la tienda vende por valor/peso; escalar si falta contrato comercial. |
| 46 — imagen | Usar la capacidad realmente disponible; si no hay interpretación visual, handoff con adjunto y sin inventar contenido. |
| 47 — reclamo de faltante | Vincular reclamo/contexto, no crear nueva compra del producto mencionado. |
| 48 — comprobante | Validar pago por el procedimiento autorizado; no aprobarlo por texto ni por imagen. |
| 49 — disponibilidad parcial | Mantener líneas encontradas y pendientes; no cotizar ni sustituir la ausente como resuelta. |
| 50 — «sí veci, solo eso» | Mismo texto en dos contextos: después de «¿algo más?» termina colección; después de cotización completa puede confirmar. |

Añadir variantes explícitas a la campaña, con identificadores separados y sin inflar el número de escenarios base: ráfaga SuperMarket, respuesta tardía a una oferta, doble clic/duplicado Meta, stock/precio cambiado tras cotizar, cruce de tenants, timeout de Google/LLM, mensaje recibido durante composición y toma manual concurrente.

## 7. Reproducción de SuperMarket como caso de aceptación principal

Secuencia del comprador: saludo/apertura → nombre → dirección → «una leche entera» → «un pan tajado» → «medio de queso tajado» → respuesta sobre marca → preferencia de pago → cierre/confirmación según la pregunta.

Variantes de ejecución:

1. **Serial:** cada mensaje llega después de la respuesta del agente.
2. **Ráfaga:** pan y queso llegan mientras se interpreta/busca la leche. Una respuesta final vigente debe integrar los mensajes pendientes o mantenerlos claramente pendientes; no emitir una pregunta ya resuelta por la ráfaga.
3. **Respuesta tardía:** llega «Colanta» después de añadir pan/queso. Resuelve la leche, no reemplaza la canasta por Colanta ni interpreta una marca como nombre del cliente.
4. **Atención manual:** falta el queso requerido o stock. El tendero recibe cantidades, productos, opciones y datos; puede completar y confirmar el pedido sin reconstruirlo desde cero.

Se espera una leche de la marca finalmente elegida y un pan de la presentación aceptada. «Medio de queso» requiere evidencia para inferir 500 g; si persiste ambigüedad se pregunta. No se fija el total de la conversación histórica como esperado: el total sale del catálogo de la corrida y las cantidades finalmente aceptadas.

Está permitido reconocer un pago que el comprador aporta temprano. No está permitido pedir que lo seleccione como si la canasta estuviera consolidada mientras las referencias siguen ambiguas. La invitación a agregar se formula cuando aporta valor contextual; no tras cada mensaje ni después de que el cliente ya cerró la colección.

## 8. Diseño del cliente simulado y del evaluador

### Ficha del escenario

Cada caso debe definir, antes de ejecutarse:

- texto inicial y mensajes parciales posibles;
- identidad y perfil del cliente, con datos sintéticos;
- objetivo y preferencias privadas del comprador (marca/tamaño/cantidad, presupuesto, si quiere seguir agregando);
- referencias aceptables y alternativas prohibidas basadas en el snapshot del catálogo;
- información conocida, incierta y que debe preguntar el agente;
- ramas de respuesta del comprador y condiciones de terminación;
- invariantes por turno y resultado final;
- severidad de cada incumplimiento y evidencia necesaria.

### Actor cliente

Lee la pregunta efectivamente enviada. Puede responder a una selección de producto, cantidad, entrega, pago o confirmación, usando las preferencias predefinidas. No conoce el estado privado del runtime para ayudarle artificialmente, no corrige errores silenciosamente y no elige una referencia distinta para hacer pasar la prueba.

Los botones se validan por su tipo, identificador, contenido y versión. Si no aparece una opción que corresponda a la necesidad, el caso falla o pide aclaración según su rama prevista. No se convierte cualquier oferta en una oferta de pago.

Se admiten varias rutas hacia un mismo resultado. Un límite de turnos/tiempo es un control del ensayo, no una regla de conversación productiva. Una repetición puede ser válida si el cliente no respondió; repetir sin reconocer información recién aportada debe señalarse.

### Evaluador independiente

1. **Asserts de negocio y contrato:** determinísticos, separados del componente probado. Comparan SKU, hechos, cantidades, estado, autorizaciones, eventos, idempotencia y persistencia.
2. **Revisión semántica:** rúbrica para pertinencia, conservación del significado y pregunta contextual. Puede apoyarse en un LLM evaluador, identificado y contabilizado aparte; no puede aprobar por sí solo importes, consentimientos ni aislamiento. Casos ambiguos requieren revisión humana.
3. **Experiencia:** claridad, concisión, repeticiones, número de turnos, opciones útiles y tono por tenant. Variaciones de estilo no son fallos técnicos P0.

El evaluador no debe copiar reglas del backend ni considerar el `reasoningSummary` como prueba de que la acción fue correcta. Se contrasta lo que ocurrió: mensaje enviado, borrador, catálogo, pedido y tarea humana.

## 9. Métricas y criterios de aceptación propuestos

| Dimensión | Criterio |
|---|---|
| Integridad comercial y privacidad | Cero SKU inventadas/ajenas, precios erróneos, cantidades agregadas sin evidencia, escrituras duplicadas, confirmaciones sin consentimiento o cobros declarados verificados sin control. |
| Memoria | Todas las necesidades conservadas hasta resolución, retiro explícito o handoff; sin pérdida ni duplicación de líneas. |
| Progreso | Los casos de compra alcanzan pedido correcto o escalamiento esperado. Una respuesta inicial agradable no cierra un caso de compra. |
| Escalamiento | Motivo y contexto íntegros, capacidad del tendero para continuar; cero falsos éxitos por escalar todos los pedidos. Separar escalamiento esperado del evitable. |
| Opciones | Todas pertinentes y reales; preguntar lo necesario sin exigir una marca/tamaño elegidos por el test sin base en el cliente. |
| Conversación | Distinguir saludo, consulta, compra, aclaración, adición, retiro, cierre de colección, confirmación y reclamo por contexto. |
| Rendimiento local | Conservar inicialmente objetivos de acuse p95 < 1 s y procesamiento p95 ≤ 10 s. Medir además recepción → nuevo outbound; reportar cold start, fallos y concurrencia aparte. Son objetivos de prueba, no una garantía de producción. |
| Tokens/llamadas | Conciliar solicitudes reales y registros de uso por etapa, sin duplicar eventos de plan e interpretación. Comparar solo campañas equivalentes. |
| Variabilidad | Ejecutar versiones previa y nueva sobre el mismo catálogo/configuración; repetir al menos tres veces los escenarios críticos, sin elegir solo la mejor corrida. |
| Publicación | Todos los escenarios críticos completos aprobados; discrepancias de oráculo resueltas, no omitidas. Calidad/latencia se presentan separadas de integridad. |

Clasificar cada resultado como: **aprobado**, **fallo funcional**, **fallo de contrato/seguridad**, **fallo de integración**, **fallo del evaluador**, **expectativa pendiente de definición** o **bloqueado por infraestructura**. Un caso sin evidencia suficiente no cuenta como aprobado. El umbral anterior `38/40` no puede ocultar un defecto crítico en los restantes.

## 10. Cambios propuestos para la siguiente etapa

La siguiente tabla conserva el alcance propuesto. El estado real de la implementación y sus límites se detallan en la sección 11.

| Archivo | Acción propuesta |
|---|---|
| `server/tests/fixtures/colombiaAgentScenarios.js` | Conservar IDs y textos originales como corpus. Versionar expectativas; eliminar selección de marcas no pedidas y frases obligatorias. No perder la línea base histórica. |
| `server/tests/fixtures/contextualAcceptanceScenarios.js` — nuevo | Definir 40 casos base + 10 reales, preferencias privadas del comprador, ramas admisibles, snapshot de hechos y resultados de negocio. |
| `server/tests/helpers/contextualCustomerActor.js` — nuevo | Responder al contenido/oferta real con las preferencias de la ficha, sin acceso al estado interno para forzar éxito. |
| `server/tests/helpers/businessOutcomeAssertions.js` — nuevo | Validar carrito, precios por línea, total, preservación, autorización, handoff y transiciones con un oráculo independiente. |
| `server/tests/e2e-local-deepseek-40.mjs` | Selección explícita de campaña y casos; mantener compatibilidad con la matriz histórica. Correlación de eventos por turno, outbound nuevo obligatorio, actor contextual, tendero por cada ciclo completo y clasificación correcta de fallos. |
| `server/tests/grounding-deepseek.mjs` | Revisar también sus expectativas: no aprobar dos paquetes de arepas por el solo texto «2 arepas». Usarlo como prueba focalizada, sin presentarlo como sustituto del E2E. |
| `docs/Plan-pruebas-E2E-local-Meta-DeepSeek-40-casos.md` | Incorporar esta especificación como aceptación v2 y exigir la regresión real 41–50 para evaluar preparación del piloto. |
| Propuesta del planner y evidencia | Vincular campaña, versión de expectativas, revisión del código, catálogo y resultados. No renombrar una corrida antigua como si hubiera usado v2. |

Orden de trabajo: cerrar esta especificación → implementar evaluador/actores → probar el propio evaluador con resultados deliberadamente incorrectos → ejecutar línea base previa y versión nueva en condiciones equivalentes → clasificar fallos → corregir backend solo donde la evidencia lo justifique.

No se necesita desplegar, modificar el catálogo de producción ni cambiar la base fuente para esta revisión. El siguiente paso es alinear el instrumento de evaluación antes de continuar con correcciones del agente.

## 11. Implementación autorizada de la aceptación v2

Se conservó el corpus histórico sin cambios y se añadió una campaña versionada de **50 escenarios: 18 compras, 22 consultas, 9 escalamientos y 1 apertura**. Las preferencias privadas del comprador se fijan antes de la corrida; el sistema bajo prueba solo las recibe cuando el cliente las expresa. Las consultas prueban consultas completas y no se contabilizan como domicilios exitosos.

### Instrumentación implementada

- `fixtures/contextualAcceptanceScenarios.js`: identifica los 50 escenarios originales, conserva sus mensajes iniciales y define resultados, preferencias, cantidades, presentación, presupuesto, ediciones y límites de turnos. Caso 35 no obliga a seleccionar marcas antes de preguntarlas; casos 03/04 requieren aclarar paquetes de arepas.
- `helpers/contextualCustomerActor.js`: comprador con DeepSeek real que solo ve la conversación pública y sus preferencias; decide cuándo aclarar, terminar colección o confirmar. El driver emite una aceptación inequívoca únicamente después de validar la cotización vigente. «Dale, hágale» y «Sí veci, solo eso» son estímulos de regresión, no reglas añadidas al agente productivo.
- `helpers/businessOutcomeAssertions.js`: oráculo independiente por SKU, cantidad, precio unitario, línea, subtotal, presupuesto, destinatario, datos de entrega y consentimiento. No importa calculadoras ni resolutores de producción.
- `helpers/contextualScenarioRunner.js`: turnos adaptativos, respuestas Graph nuevas obligatorias, eventos nuevos por turno, pedido persistido y tendero por cada compra que logre confirmarse. Detecta agotamiento de turnos en vez de aprobar una conversación incompleta.
- `contextual-acceptance-contract.mjs`: controles positivos y mutaciones deliberadas: cero, precios intercambiados, SKU ajena, pérdida/cambio de cantidad, tenant equivocado, pedido oculto al puntero, duplicados, datos de cliente incorrectos, consentimiento viejo, opción inventada, presupuesto y error de extracción del juez.
- Runner existente: campaña histórica `legacy40` preservada; selección `E2E_CAMPAIGN=contextual50`, `E2E_CASE_IDS` por número o ID; manifiesto con hash de fuentes/catálogo y flag; captura de usage directamente en cada respuesta DeepSeek. Comprador/juez se contabilizan por separado de VIA.
- PostgreSQL: antes de iniciar workers se marcan como excluidos los trabajos heredados **en el clon desechable**. Se guarda `excluded-copied-jobs.json`. La fuente local no se modifica; el runner coteja su huella antes/después.

El juez semántico puede equivocarse. Una extracción sin cita verificable o una conclusión dudosa se clasifica como `needs_review`, no como precio erróneo probado. La inferencia semántica del juez no sustituye las comprobaciones aritméticas ni demuestra por sí sola cumplimiento de negocio.

### Reproducción

1. Ejecutar `npm run test:acceptance:contract`.
2. Configurar `E2E_SOURCE_DATABASE_URL` con PostgreSQL **local**, `DEEPSEEK_API_KEY` en el entorno privado, sin `LLM_SIMULATOR`. No guardar credenciales en evidencias.
3. Ejecutar `npm run test:e2e:contextual`. Usa las 300 referencias, Meta interceptado, presupuesto predeterminado de 1.200 solicitudes reales y el flag que se suministre en el entorno. El comando no habilita grounding por sí solo.
4. Para una muestra: `E2E_CASE_IDS=1,3,25,30,43,50`. Para comparar: ejecutar la misma selección primero con `LLM_GROUNDING_ENABLED=true` y después `false`, en directorios distintos mediante `E2E_RESULT_DIR`.
5. Revisar `case-report.md/json`, `graph-outbound.json`, `events.json`, `database-snapshot.json`, `provider-requests.json`, `baseline-source.json` y `summary.json`. Los eventos de la app y las solicitudes de red son métricas distintas; la suma de tokens operativos se obtiene del rol `application` del proveedor, indicando solicitudes sin usage.

Las primeras corridas de calibración del evaluador se conservan como tales: `contextual-smoke/20261104181407_cba6bb75` fue abortada por trabajos heredados; `contextual-smoke/20261104181602_531e4f26` permitió detectar problemas del juez y un caso real de duplicación; `contextual-v2-grounding/20261104182027_53b5c2a3` fue abortada para incorporar la auditoría independiente. **No son porcentajes de aceptación definitivos.**

### Límites explícitos

- No se ejecuta el navegador del tendero: se ejercitan las mismas rutas HTTP para tomar y despachar. Una aprobación E2E de API no prueba UX móvil.
- Google permanece desconectado en el tenant sombra; se valida estado local/outbox disponible, no una escritura real en Sheets ni latencia de Google.
- El snapshot de catálogo corresponde al fixture local, no acredita coincidencia con el catálogo de producción.
- No se declara preparación del piloto por una sola corrida. Faltan tres repeticiones de los 16 escenarios críticos y las variantes explícitas de ráfaga SuperMarket, ofertas tardías, cambio de precio/stock, aislamiento con dos tenants, timeouts y atención manual concurrente.
- La presencia de una tarea humana y su contexto no demuestra que el tendero pueda resolver todas las excepciones desde la UI. Debe validarse esa continuidad específica además del flujo tomar/despachar.
- En consultas y escalamientos la evaluación semántica conserva revisión humana para desacuerdos; no convertirla en certeza automática.

## 12. Resultado de la ejecución y cierre de esta etapa

Se ejecutó `20261104182259_3869c026` con grounding activo: **50 escenarios, 182 turnos y nueve pedidos creados**, todos con la secuencia HTTP del tendero aprobada. El resultado automático original fue 25/50; **no se adopta como porcentaje final de calidad**. La auditoría de los 50 diálogos encontró falsos aprobados y falsos fallos.

La comparación `20261104185929_4ebc724b` ejecutó los casos 01, 03, 25, 30, 43 y 50 con el flag desactivado, sobre el mismo hash de fuentes y catálogo. No es un checkout de una versión histórica ni una comparación estadística completa. También contiene limitaciones del actor que impiden atribuir cada diferencia al backend.

La segunda lectura `evaluation-v2.1` conserva los originales y añade un reporte por caso con hashes, evidencias y consumo del juez. En la campaña completa detecta de forma independiente **11 casos con cantidades/importes excedidos, cinco con tareas pendientes duplicadas y dos con silencio**; estas categorías pueden solaparse. El caso 25 sigue siendo falso aprobado por el juez y queda objetado por la auditoría manual.

El p95 local fue **4.256 ms para el acuse** y **12.070 ms desde recepción al primer envío simulado**, entre los 180 turnos con respuesta. No se cumplieron los objetivos de latencia. La huella de PostgreSQL fuente se mantuvo; no se enviaron mensajes reales ni se desplegó.

Evidencia:

- [Informe consolidado con los 50 casos y comparación](Evidencia-aceptacion-contextual-v2-2026-11-04.md).
- [Auditoría manual: fallos demostrados y desacuerdos](Auditoria-manual-aceptacion-contextual-2026-11-04.md).

### Instrumento 2.1: qué cambió después de observar las corridas

| Componente | Ajuste y validación |
|---|---|
| Juez | Recibe todos los campos del catálogo, distingue pago elegido de pago recibido y exige citas. Se ejecutó sobre las 56 conversaciones guardadas, sin volver a ejecutar VIA. Sigue siendo revisable, no una autoridad de aprobación. |
| Oráculo de negocio | Calcula desde el borrador y precios del catálogo; no suma alternativas ni convierte una cantidad inventada por el juez en error de VIA. Incluye importes por valor, topes por necesidad y unicidad de tareas. Controles positivos y mutaciones pasan. |
| Comprador | Puede usar entrega/pago acordados previamente; no exige repetir todo en una frase, no transforma la política de pago en preguntas técnicas y debe citar el importe vigente sin inventar fragmentos. Se ejecutó una comprobación adicional de cuatro casos; detalle abajo. |
| Clasificación | Un actor bloqueado no significa pedido incorrecto. Un error del juez tampoco oculta una duplicación comprobada ni un silencio. Una apertura sin terminal queda para revisión. |
| Manifiesto | Las futuras corridas registran `acceptanceVersion: 2.1.0`. Los manifiestos 2.0 existentes permanecen intactos. |

Los botones de selección/pago sí se ejercitaron. La aceptación final se emitió por texto para probar las expresiones de regresión; falta una variante que complete la compra pulsando el botón de confirmación. La política esperada del caso 46 debe distinguir pedir una transcripción de escalar la foto, sin exigir una frase literal.

Comprobación del actor corregido: `20261104191214_0d415b43`, casos 23, 29, 40 y 50, 74 solicitudes DeepSeek incluyendo aplicación/comprador/juez. **23, 29 y 50 ya crean pedidos y no quedan bloqueados por citas ni abandono del comprador.** El 40 reproduce una duplicación y acaba sin compra. En 50 se prueba la confirmación «Sí veci, solo eso», pero no el otro uso de la misma expresión como fin de colección. El juez continúa emitiendo objeciones incorrectas, por ejemplo exigir pago en efectivo recibido antes de registrar el pedido. No se considera un 4/4; tampoco su 0/4 automático demuestra cuatro fallos comerciales. Se conserva el detalle en el informe consolidado.

Comandos de auditoría: `node scripts/e2e/rejudge-contextual-evidence.mjs <run-activo> <run-apagado>` y `node scripts/e2e/summarize-contextual-acceptance.mjs <run-activo> <run-apagado>`. El primero consume DeepSeek, rechaza otras salidas de red y crea una evaluación separada; no sobreescribe una existente. El segundo solo lee evidencias y genera el informe Markdown.

La siguiente implementación del backend debe abordar primero identidad/cantidad de las líneas y confirmaciones con necesidades pendientes, después preguntas intercaladas, handoff y latencias. Conservar como controles los casos que sí resolvieron errores de escritura, opciones de catálogo y retiro de un producto. No continuar ajustando el agente para satisfacer frases de prueba.

## 13. Expectativas adicionales: costo y mínimo de domicilio por tienda

Revisión documental del 2026-11-04, posterior a la corrección de canasta. El usuario requiere dos parámetros independientes por tenant: tarifa de entrega y subtotal mínimo de productos para domicilio. El diseño, archivos afectados, decisiones LLM y matriz de pruebas se incorporan en la [sección 14 del plan de descomposición](Propuesta-descomposicion-planner-grounding-llm-2026-11-04.md#14-ampliación-revisada-precios-domicilio-mínimo-y-pago-por-texto).

Antes de nuevas ejecuciones de aceptación de esa funcionalidad:

1. Separar en fixtures, comprador, juez y oráculo **subtotal de productos, tarifa y total a pagar**. El mínimo se evalúa sobre productos; no se suma como cargo ni se alcanza agregando la tarifa.
2. Declarar explícitamente tarifa y mínimo cero cuando el caso espera entrega gratuita y sin mínimo. No interpretar configuración ausente como cero; añadir variantes de condiciones desconocidas y revisión humana.
3. Mantener los casos históricos y sus resultados intactos. La expectativa anterior de «sin cargos extras del fixture» (por ejemplo caso 30) describe esas corridas, no demuestra que VIA tenga una política de entrega implementada.
4. Repetir la misma canasta bajo políticas distintas de dos tenants. Verificar autorización y ausencia de contaminación tanto en configuración como en cotización, pedido y mensajes.
5. Bajo mínimo: evaluar coherencia de la elección LLM entre acompañar la colección, invitar a agregar o escalar según historial y presupuesto. No imponer una frase o un único siguiente paso a todos los casos. Sí impedir crear el domicilio fuera de condiciones sin autorización humana válida.
6. Probar elección de pago por texto, preguntas de precio y domicilio intercaladas, cambio de política durante confirmación, rechazo de ofertas atrasadas y resolución humana seguida de aceptación del comprador.
7. Verificar desglose en PostgreSQL, tarea del tendero, UI y proyección Sheets, además de la respuesta pública. El oráculo calcula importes por separado del código productivo.

Estado: expectativas documentadas; fixtures y ejecutores todavía no adaptados a esta ampliación. No se cambia la versión del instrumento ni se atribuyen resultados de las corridas anteriores a estas nuevas capacidades.
