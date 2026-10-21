# Plan: separacion del interprete, resolutor de catalogo y pruebas E2E semanticas

**Fecha:** 20 de octubre de 2026
**Estado:** ejecutado y validado en desarrollo local el 21 de octubre de 2026. No autoriza despliegue, cambios en produccion, envio de mensajes reales ni carga del catalogo de referencia en tenants operativos.
**Relacionado:** `docs/Plan-mejora-interprete-y-catalogo-200.md` y `docs/Plan-pruebas-E2E-local-Meta-DeepSeek-40-casos.md`.

## Registro de ejecucion local

La implementacion se verifico con la corrida `20261021055411_3c9799ea`, cuya evidencia esta en `test-results/e2e-semantic/20261021055411_3c9799ea/`.

- 40 de 40 escenarios aprobados con DeepSeek real (`provider_api`), Meta simulada y Graph interceptado; no se enviaron mensajes reales.
- PostgreSQL fuente local sin cambios; cada caso uso el clon efimero y el tenant sombra de la corrida.
- p95 de acuse del webhook: 29 ms. p95 de procesamiento completo: 4268 ms.
- 95 llamadas LLM: 83.839 tokens en total, 2.096 por caso en promedio; interprete 38.167 y compositor 45.672.
- Se verificaron ofertas de variante y pago, aislamiento por tenant, `rawItemId`, subtotal, confirmacion, tendero, aviso unico de despacho, cierre y apertura de una nueva conversacion.
- El runner conserva evidencias saneadas por caso y clasifica futuros fallos como `interpretation`, `retrieval`, `resolution`, `state`, `composition`, `contract` o `infrastructure`.

**Limite de esta validacion:** confirma los contratos locales y la preparacion tecnica para un piloto controlado; la aprobacion de Meta, el alta de numeros reales y cualquier despliegue siguen siendo actividades separadas.

## 1. Problema que se quiere resolver

El flujo actual tiene planner LLM, runtime, herramientas y compositor LLM, pero el planner todavia concentra demasiada responsabilidad: interpreta el lenguaje, propone productos, pide herramientas, deduce faltantes y participa indirectamente en el avance del pedido. El runtime intenta corregir despues esa salida con filtros y reglas particulares.

Eso produce dos riesgos:

1. Un ajuste para un typo, una marca o una categoria concreta cambia la salida de otros pedidos.
2. No siempre se puede saber si un fallo es de comprension, recuperacion, resolucion de variante, maquina de estados o redaccion.

La meta no es crear un enjambre de agentes. Es convertir el flujo en una tuberia con responsabilidades, contratos y propietarios de estado explicitos.

## 2. Principios de diseno

1. **El LLM interpreta; no confirma hechos comerciales.** Puede proponer hipotesis de producto, typo, ocasion, cantidad y presentacion. No puede fijar SKU, precio, stock, subtotal, disponibilidad ni estado de pedido.
2. **El catalogo del tenant decide que existe.** Cada consulta queda limitada al tenant resuelto por la conexion de WhatsApp.
3. **Una variante solo se selecciona con evidencia.** Si hay varias candidatas plausibles, VIA presenta opciones interactivas; no escoge una por comodidad.
4. **El orquestador es el unico escritor del pedido.** Solo el dominio puede crear lineas resueltas, subtotal, pago, confirmacion y transiciones.
5. **El compositor solo redacta hechos cerrados.** No agrega productos, dinero, stock, compromisos ni estados.
6. **Las reglas deterministicas protegen invariantes, no reemplazan la comprension.** Idempotencia, tenant, stock, precio, pago y transiciones son deterministas. Modismos, typos, ocasion, presentacion y ambiguedad se interpretan de forma contextual.
7. **No hay aprendizaje automatico desde conversaciones en vivo.** Los desacuerdos generan evidencia para aliases, etiquetas, prompts y pruebas versionadas tras revision humana.

## 3. Arquitectura objetivo

```text
Webhook Meta simulado o real
        |
        v
1. Ingreso y deduplicacion
        |
        v
2. Interprete LLM -> SemanticFrame
        |
        v
3. Recuperador de catalogo por tenant -> CandidateSet
        |
        v
4. Resolutor de producto y variante -> ResolutionSet
        |
        v
5. Orquestador de conversacion y pedido -> OrderDraft / oferta interactiva
        |
        v
6. Compositor LLM con ReplyFacts cerrados
        |
        v
7. Outbox WhatsApp y acciones del tendero
```

No se introduce RAG, embeddings, busqueda vectorial, ReAct ni un segundo agente autonomo en este ciclo. Para catalogos de cientos de referencias, la recuperacion lexica enriquecida y explicable es suficiente para validar el producto.

## 4. Contratos entre etapas

### 4.1 `SemanticFrame.v1`: salida del interprete LLM

El planner actual se reemplazara gradualmente por un interprete semantico. Conserva el texto original y expresa incertidumbre, pero no incluye `toolPlan`, `skuHint`, precio, stock, subtotal ni una eleccion final de producto.

```json
{
  "schemaVersion": "semantic-frame.v1",
  "intent": "delivery_order",
  "conversationAct": "new_request",
  "delivery": true,
  "customerDelta": {
    "name": null,
    "address": null,
    "paymentPreference": null
  },
  "items": [
    {
      "rawItemId": "turn-17:item-1",
      "rawText": "dos chocramos",
      "productHypothesis": "chocoramo",
      "brandHint": null,
      "quantity": 2,
      "budgetAmount": null,
      "presentationSignal": null,
      "occasion": null,
      "attributes": {},
      "confidence": 0.88,
      "ambiguity": null
    }
  ],
  "missingCustomerFields": [],
  "confidence": 0.88
}
```

Reglas del contrato:

- Cada necesidad mencionada genera un `rawItemId` estable. Se conserva hasta que se quite explicitamente del pedido o se cierre la conversacion.
- `rawText` nunca se reescribe; `productHypothesis` es una propuesta explicable del LLM.
- `presentationSignal` puede ser `personal`, `familiar`, `grande`, `para_compartir` o una medida explicita, pero no equivale a un SKU.
- El interprete puede indicar que el cliente eligio una opcion interactiva, pero la validacion de esa opcion es responsabilidad del orquestador.
- La temperatura se conserva inicialmente en `0` para reproducibilidad del JSON. La calidad se mejora por contrato, ejemplos y evaluacion, no por aumentar aleatoriedad.

### 4.2 `CandidateSet.v1`: resultado del recuperador de catalogo

El recuperador recibe un item semantico y devuelve candidatas activas del mismo tenant. Busca sobre nombre, marca, aliases, categoria, descripcion, etiquetas, familia, presentacion visible y presentacion normalizada.

```json
{
  "rawItemId": "turn-17:item-1",
  "query": { "rawText": "dos chocramos", "productHypothesis": "chocoramo" },
  "candidates": [
    {
      "sku": "BOG-PAN-019",
      "name": "Ponque Chocoramo",
      "family": "chocoramo",
      "presentation": "65 g",
      "price": 2800,
      "stock": 24,
      "score": 0.96,
      "evidence": ["alias_typo", "nombre", "familia"]
    }
  ]
}
```

El contrato no debe devolver ni usar productos de otro tenant. Precio y stock restringen las candidatas ofrecibles; no cambian el significado de `personal`, `familiar` o `grande`.

### 4.3 `ResolutionSet.v1`: unica etapa que puede asociar un SKU

Por cada `rawItemId`, el resolutor devuelve uno de estos estados:

| Estado | Significado | Siguiente accion |
| --- | --- | --- |
| `resolved` | Una candidata es claramente compatible y esta disponible | Crear o actualizar linea del borrador. |
| `needs_selection` | Hay dos o mas variantes disponibles, de la misma necesidad, que el cliente puede distinguir con nombre, presentacion y precio | Crear oferta interactiva de hasta tres opciones o lista de Meta. |
| `needs_quantity` | El producto es seguro, falta cantidad | Preguntar solo por cantidad. |
| `unavailable` | No hay candidata compatible o no existe stock suficiente para cumplir la solicitud | Crear tarea para el tendero; informar al cliente que la tienda lo esta validando. |
| `human_review` | La evidencia es baja, la peticion es contradictoria, las candidatas pertenecen a necesidades distintas o existe una excepcion comercial | Crear tarea para el tendero; no seleccionar ni sustituir automaticamente. |

La seleccion automatica exige evidencia suficiente: coincidencia semantica, atributos explicitos compatibles, stock, diferencia clara frente a la siguiente candidata y ausencia de ambiguedad material. Una medida explicita como `3 L`, `500 g` o `x12` es una restriccion fuerte.

#### Politica obligatoria de escalamiento

La intervencion humana ya definida se conserva como regla de producto:

1. **Sin producto compatible:** siempre se crea `human_handoff`. VIA no inventa una equivalencia ni promete una alternativa.
2. **Stock insuficiente:** siempre se crea `human_handoff`. El tendero decide si repone, divide cantidades, propone sustituto o rechaza el pedido.
3. **Baja evidencia:** siempre se crea `human_handoff` cuando el resolutor no alcanza el umbral o cuando las candidatas no representan la misma necesidad. No se elige la primera coincidencia ni se utiliza similitud debil.
4. **Ambiguedad seleccionable:** no requiere tendero cuando las alternativas son reales, activas, con stock y comprensibles para el cliente, por ejemplo Coca-Cola 400 ml o 1.5 L. VIA presenta opciones interactivas y espera la eleccion del cliente.
5. **Ambiguedad no seleccionable:** se crea `human_handoff` cuando las opciones requieren conocimiento de surtido, sustitucion, margen, calidad, compatibilidad o politica de la tienda que el cliente no puede decidir de manera informada.

Por tanto, `needs_selection` no significa "evidencia baja". Es una evidencia suficiente de varias opciones validas. La baja evidencia y la ausencia comercial son siempre tareas del tendero.

### 4.4 `OrderDraft.v2`: estado de dominio, no salida del LLM

El borrador se compone exclusivamente desde `ResolutionSet` y el perfil del cliente. Cada linea conserva `rawItemId`, texto original, SKU confirmado, cantidad, precio unitario, subtotal de linea y estado de resolucion.

```text
resolviendo_productos
esperando_seleccion_de_variante
esperando_cantidad
esperando_nombre
esperando_direccion
esperando_pago
esperando_confirmacion
confirmado
tomado
alistando
en_camino
cerrado
```

Una transicion debe ser idempotente y versionada. Un mensaje o boton desactualizado no puede reemplazar lineas, subtotal, direccion o pago del borrador vigente.

### 4.5 `ReplyFacts.v1`: entrada cerrada para el compositor

El compositor recibe el mensaje a redactar, hechos verificados, opciones activas, campos faltantes y tono del tenant. No recibe resultados crudos de busqueda ni la capacidad de decidir operaciones.

El fallback determinista se usa solo ante timeout, JSON invalido o violacion de hechos. La validacion de salida mantiene nombres, importes y acciones obligatorias.

## 5. Distribucion de responsabilidades

| Componente | Puede hacer | No puede hacer |
| --- | --- | --- |
| Interprete LLM | Entender modismos, typos, intencion, ocasion, cantidad y senales de presentacion | Elegir SKU, inventar precio/stock, mutar pedido o decidir estado |
| Recuperador | Buscar candidatas del tenant y explicar coincidencias | Confirmar una variante por cuenta propia |
| Resolutor | Comparar candidatas, decidir certeza u ofrecer opciones | Inventar candidatos ni saltar stock o atributos explicitos |
| Orquestador | Persistir borrador, pago, confirmacion, pedido, oferta y transiciones | Reinterpretar texto del cliente con aliases de productos hardcodeados |
| Compositor LLM | Convertir `ReplyFacts` en lenguaje natural con voz del tenant | Alterar hechos comerciales |
| Tendero | Aprobar excepciones, sustituciones, faltantes y operaciones | Ver datos de otro tenant |

## 6. Plan de implementacion

### Fase 0: linea base y guardas

**Estado: completada en desarrollo local.**

1. Congelar como evidencia la corrida E2E `20261021023351_238217d0` y sus fallos P0.
2. Agregar trazas con `traceId`, `conversationId`, `rawItemId` y `draftVersion` en cada frontera del flujo.
3. Crear contratos unitarios para los esquemas `SemanticFrame`, `CandidateSet`, `ResolutionSet`, `OrderDraft` y `ReplyFacts`.
4. Mantener la actual ruta como comportamiento de referencia durante la migracion, sin desplegar.

**Salida:** cada mensaje puede reconstruirse como `mensaje -> frame -> candidatas -> resolucion -> borrador -> respuesta`.

### Fase 1: extraer el interprete semantico

**Estado: completada en desarrollo local.**

1. Simplificar el prompt del planner: eliminar `toolPlan`, `recommendedTools`, `skuHint` y la obligacion de formar un pedido final.
2. Introducir un adaptador temporal que convierta `SemanticFrame.v1` al contrato que hoy consume `agentRuntime`.
3. Versionar prompt y esquema en telemetria para comparar la ruta actual y la nueva sobre el mismo escenario local.
4. Añadir ejemplos de modismos y errores colombianos como datos de evaluacion, no como marcas dentro del runtime.

**Salida:** el LLM conserva todas las necesidades con `rawItemId` y ninguna de ellas pierde su texto original.

### Fase 2: recuperacion y resolucion por item

**Estado: completada en desarrollo local.**

1. Crear un servicio de recuperacion que acepte un item semantico y devuelva `CandidateSet.v1` por tenant.
2. Mover aliases de productos, typos conocidos y sinonimos desde `inferCatalogFilter` a datos de catalogo o configuracion del tenant.
3. Retirar progresivamente del camino principal reglas por marca o producto concreto. Se mantienen solo como compatibilidad hasta que sus equivalentes de datos tengan contratos de regresion.
4. Implementar el resolutor con puntaje explicable, umbral y diferencia minima entre la primera y segunda candidata.
5. Aplicar presentacion y descripcion como atributos de recuperacion y comparacion, nunca como texto decorativo.

**Salida:** una consulta de `chocramos`, `granadiya`, `x12`, `personal` o `familiar` deja evidencia de candidatos y de por que se resolvio o se pregunto.

### Fase 3: ofertas de variante y continuidad conversacional

**Estado: completada en desarrollo local.**

1. Generalizar la infraestructura actual de botones de pago para crear ofertas de producto y variante.
2. Vincular cada oferta a `tenantId`, `conversationId`, `rawItemId`, `draftVersion`, vencimiento y uso unico.
3. Al recibir una respuesta interactiva, validar pertenencia, vigencia e idempotencia antes de mutar el borrador.
4. Mostrar de dos a tres opciones para boton y hasta diez para lista, con nombre, presentacion y precio. No mostrar SKU al cliente.
5. Cuando falta cantidad, preguntar exclusivamente por la cantidad del `rawItemId` afectado.

**Salida:** ninguna variante ambigua llega al subtotal sin una seleccion valida del cliente.

### Fase 4: unificar maquina de estados y persistencia

**Estado: completada en desarrollo local.**

1. Encapsular toda mutacion de `OrderDraft` en un servicio de dominio con operaciones `mergeItems`, `resolveItem`, `setCustomerField`, `setPayment`, `confirm` y `close`.
2. Rechazar mutaciones que disminuyan subtotal, borren una linea resuelta o reemplacen direccion/pago sin una accion explicita posterior.
3. Recalcular totales solo desde lineas `resolved`; nunca desde texto de la respuesta del LLM.
4. Asegurar que `orderId` exista antes de anunciar confirmacion y que el pedido confirmado conserve subtotal mayor que cero si tiene lineas resueltas.
5. Mantener el cierre actual: `en_camino` persiste, encola un unico aviso, cierra la conversacion y un mensaje posterior abre otra.

**Salida:** los casos multi-turno no pueden llegar a subtotal cero ni perder `orderId` por pago, confirmacion o seleccion de variante.

### Fase 5: compositor y voz por tenant

**Estado: completada en desarrollo local.**

1. Sustituir el prompt del compositor para que use solo `ReplyFacts.v1`.
2. Separar politica de interpretacion regional de voz de salida. `tendero_colombiano` define cercania moderada; no afecta productos, precios ni reglas de dominio.
3. Mantener validacion post-composicion de importes, nombres y acciones requeridas.
4. Medir por separado tokens, latencia, timeout y fallback del interprete y del compositor.

**Salida:** variar la voz de un tenant no puede cambiar la canasta, el subtotal o el siguiente estado.

## 7. Ajuste de pruebas E2E

### 7.1 Mantener tres niveles de prueba

| Nivel | Proposito | LLM / red |
| --- | --- | --- |
| Contratos unitarios | Esquemas, resolucion, estado, precios, aislamiento e idempotencia | Sin red; LLM simulado permitido |
| Integracion de runtime | Tool registry, Postgres clonado, ofertas Meta y outbox | Sin Meta real; LLM controlado cuando se pruebe dominio |
| E2E oficial de 40 casos | Flujo completo Meta simulada, cliente, tendero y DeepSeek real | DeepSeek real; Graph interceptado; sin WhatsApp real |

La fuente PostgreSQL local seguira siendo de solo lectura para el runner. Cada corrida crea una base clonada y un tenant sombra; cada escenario reinicia su catalogo y estado propios.

### 7.2 Reemplazar aserciones de SKU rigidas por aserciones semanticas

Una asercion exacta solo se conserva cuando el cliente suministra una marca, SKU, medida o variante explicita. Ejemplo: `Huevos AA x12` exige una referencia de huevos AA de doce unidades, no cualquier huevo.

Para solicitudes abiertas, cada escenario define expectativas de dominio:

```json
{
  "expect": {
    "intent": "catalog_query",
    "options": {
      "min": 2,
      "max": 4,
      "mustMatchAny": ["bebidas", "refrescante"],
      "mustBeActive": true,
      "mustHave": ["name", "presentation", "price", "stock"],
      "diverseFamilies": true
    },
    "mustNot": {
      "unrelatedFamilies": ["aseo", "panaderia"],
      "inventedPrice": true
    }
  }
}
```

El evaluador debe validar productos contra atributos de catalogo y no por una subcadena de la respuesta final. La respuesta se evalua por hechos obligatorios, tono, accion siguiente y ausencia de invenciones.

### 7.3 Matriz de regresion que se agregara a los 40 casos

1. **Solicitud especifica completa:** dos productos con cantidad, marca y presentacion; crea borrador y solicita solo pago si corresponde.
2. **Cantidad faltante:** conserva todos los `rawItemId` y pregunta solo por la linea sin cantidad.
3. **Typo y ortografia:** `chocramos` y `granadiya` conservan texto crudo, proponen hipotesis y no pierden lineas.
4. **Presentacion explicita:** `3 L`, `500 g`, `medio kilo` y `x12` no aceptan variantes incompatibles.
5. **Presentacion contextual:** `personal`, `familiar`, `grande` y `para compartir` seleccionan solo con diferencia clara; si no, generan opciones.
6. **Categoria u ocasion:** `algo para la sed`, `onces`, `lonchera`, `desayuno rapido` devuelven de dos a cuatro opciones pertinentes y diversas.
7. **Producto ausente:** informa falta de disponibilidad sin sustitucion de familia ajena.
8. **Pedido mixto:** una linea resuelta y otra ambigua conserva ambas y no crea subtotal final hasta resolver la ambigua.
9. **Seleccion interactiva:** boton o lista valido actualiza solo el `rawItemId` asociado; una opcion expirada o repetida no altera el borrador.
10. **Pago y confirmacion:** seleccion de pago, confirmacion y persistencia mantienen lineas, subtotal, direccion y `orderId`.
11. **Tendero:** tomar, alistar, marcar en camino, un unico aviso y cierre; posterior mensaje abre conversacion nueva.
12. **Aislamiento:** mismo texto y SKU en dos tenants no puede cruzar productos, precios, conversaciones, ofertas ni pedidos.

Los escenarios 5 a 9 tambien deben demostrar la politica de escalamiento: ausencia, stock insuficiente o baja evidencia producen un `human_handoff` trazable y una tarea visible para el tendero. Las variantes seleccionables producen una oferta al cliente, no una tarea humana.

### 7.4 Escenarios existentes que cambian de criterio

| Caso actual | Criterio nuevo |
| --- | --- |
| `algo_para_la_sed` | No exige Cifrut concreto. Exige bebidas activas, pertinentes, diversas y sin familias ajenas. |
| `mecato_onces`, `lonchera`, `desayuno` | Evalua ocasion, variedad y atributos visibles; no SKU de la semilla antigua. |
| `coca_personal` | Verifica hipotesis contextual y que no se seleccione una variante sin certeza suficiente. |
| `arroz + aceite + huevos` | Exige tres `rawItemId`, conservacion de los tres y pregunta solo por atributo realmente ambiguo. |
| `typos_colombianos` | Exige texto crudo, hipotesis razonada, candidatos compatibles y subtotal solo de lineas resueltas. |
| `confirmacion_handoff` | Exige `orderId`, subtotal coherente, pago, direccion y acciones del tendero sin perdida de estado. |

### 7.5 Evidencia minima por caso

Cada `case-report.json` y `case-report.md` debe incluir:

- mensajes de Meta simulada, cliente y tendero;
- `SemanticFrame`, `CandidateSet`, `ResolutionSet`, `OrderDraft` por turno y `ReplyFacts` saneados;
- llamadas LLM, proveedor, modelo, tokens, latencia y fallback;
- decisiones de catalogo por `rawItemId`, con candidatas y razon;
- payload Graph capturado, ofertas interactivas y resultado de consumo;
- transiciones de pedido, outbox y estado final;
- causa clasificada para cada fallo: `interpretation`, `retrieval`, `resolution`, `state`, `composition`, `contract` o `infrastructure`.

## 8. Criterios de aceptacion y puerta de salida

No se considera listo para piloto hasta cumplir simultaneamente:

1. Los contratos de esquema, resolucion, estado, aislamiento y Meta pasan al 100%.
2. Los 40 escenarios E2E pasan con DeepSeek real y Meta simulada; sus expectativas son semanticas salvo solicitudes explicitamente precisas.
3. Ningun escenario P0 pierde un `rawItemId`, una linea resuelta, el subtotal, direccion, pago u `orderId` durante una conversacion multi-turno.
4. Ningun producto de otro tenant aparece en una respuesta, oferta o pedido.
5. Todo caso sin producto, sin stock o con baja evidencia crea `human_handoff`; ninguna sustitucion se confirma automaticamente.
6. Todo caso de variantes seleccionables crea una oferta ligada a `tenantId`, conversacion, `rawItemId` y version de borrador.
7. El acuse de webhook mantiene p95 menor a un segundo y el procesamiento completo p95 menor o igual a diez segundos en local.
8. Cada llamada LLM y cada fallback queda correlacionada con `traceId`, conversacion y mensaje.
9. El flujo de despacho envia un solo aviso, cierra el pedido y crea una conversacion nueva ante el siguiente mensaje del cliente.

## 9. Orden de ejecucion recomendado

1. Fase 0 y contratos de observabilidad.
2. Fase 1 y adaptador de `SemanticFrame` sin cambiar la experiencia visible.
3. Fase 2 con pruebas de recuperacion, typos, descripcion y presentacion.
4. Fase 3 para opciones interactivas de variante.
5. Fase 4 para cerrar el P0 de borrador, subtotal y confirmacion.
6. Fase 5 y ajuste completo de la matriz E2E semantica.
7. Repetir E2E local antes de considerar despliegue o piloto.

## 10. Riesgos y controles

| Riesgo | Control |
| --- | --- |
| Migracion rompe conversaciones en curso | Versionar contratos y soportar lectura del borrador actual durante una version de transicion. |
| Alias cargados por un tenant degradan otro | Aliases y convenciones se consultan solo por `tenantId`; no hay diccionario global operativo. |
| E2E semantica se vuelve demasiado permisiva | Definir atributos obligatorios, familias prohibidas y ausencia de invenciones; conservar exactitud en marcas y medidas expresas. |
| LLM responde JSON inconsistente | Validar esquema, conservar texto original, usar fallback seguro y registrar causa. |
| Nuevo flujo aumenta latencia | Mantener una interpretacion y una composicion por mensaje; el recuperador y la maquina de estados son locales. |
| Opciones interactivas se usan dos veces | Vencimiento, version de borrador, consumo unico e idempotencia por oferta. |

## 11. Fuera de alcance de este plan

- Despliegue a produccion o modificaciones de Meta.
- RAG, embeddings, bases vectoriales, fine-tuning o ReAct.
- Importar el catalogo de referencia en tenants reales.
- Aprendizaje automatico a partir de conversaciones de clientes.
- Cambiar el modelo comercial, pagos o la integracion de Google fuera de lo necesario para conservar los contratos definidos.
