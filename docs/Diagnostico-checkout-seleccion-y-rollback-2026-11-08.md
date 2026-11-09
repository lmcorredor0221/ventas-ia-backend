# Diagnóstico: selección de catálogo y continuidad del checkout

Fecha: 8 de noviembre de 2026  
Alcance: evidencia de producción y reproducción local. No contiene datos personales ni identificadores de clientes.

## Hecho observado

En una conversación de domicilio, el sistema logró:

1. identificar los productos;
2. presentar las alternativas de catálogo;
3. recibir la selección del último producto; y
4. calcular correctamente el subtotal.

Sin embargo, después de esa última selección, el mensaje saliente contenía solo el resumen. No incluía la pregunta de continuidad ni los botones para continuar, agregar productos o hablar con la tienda. Como consecuencia, el cliente escribió una confirmación libre y recibió el mismo resumen nuevamente.

## Evidencia correlacionada

La traza persistida de la conversación mostró que, tras la selección final:

- los dos renglones tenían producto, precio, cantidad y total válidos;
- el mensaje del agente tenía `interactive: null`;
- el borrador quedó con `checkout.phase: "collecting"` en vez de `"review"`;
- `missingFields` incluía `payment_method`, junto con explicaciones narrativas libres, por ejemplo, confirmaciones descritas en lenguaje natural;
- la señal estructurada de domicilio se podía sobrescribir con un `false` por defecto emitido por el intérprete en un turno posterior.

`checkoutProgress` trata cualquier faltante distinto de `payment_method` como una condición que impide salir de `collecting`. Por tanto, esas explicaciones libres no podían resolverse como campos de estado y bloqueaban la creación automática de la oferta `cart_review`.

## Causa raíz confirmada

El contrato de `missingFields` estaba mezclando dos tipos de información:

- **estado operativo estructurado**, como `payment_method`, `presentation:<línea>` o `selection:<línea>`;
- **explicaciones narrativas del LLM**, adecuadas para comunicar contexto, pero no para gobernar el estado de checkout.

La segunda categoría se persistía como si fuera la primera. No se trató de que el cliente debiera enviar un mensaje nuevo para activar DeepSeek: el estado inválido evitó que el backend construyera proactivamente el siguiente mensaje interactivo.

## Corrección preparada y verificada localmente

El commit `8abfa5a` añadió una validación en el límite de estado:

- conserva solamente claves operativas reconocidas en `missingFields`;
- mantiene `missingInfo` y el texto conversacional como canales narrativos separados;
- preserva un domicilio ya confirmado frente a valores predeterminados incompletos del intérprete;
- reproduce localmente el callback de selección final y exige que se envíen la pregunta de revisión y los botones `Continuar pedido`, `Agregar productos` y `Hablar con la tienda`.

Pruebas locales aprobadas:

- `node server/tests/catalog-selection-reconciliation.mjs`
- `node server/tests/checkout-sequence.mjs`
- `node server/tests/agent-runtime-quote-continuity.mjs`

## Decisión operativa

Por solicitud del usuario, la producción se revierte al commit estable `00329e4`. Este rollback solo cambia la versión ejecutada por Render; no purga ni modifica datos de producción.

La corrección documentada queda disponible en Git para revisión y reproducción local, pero no debe considerarse activa mientras Render ejecute `00329e4`.

## Complemento: escalamiento prematuro y mensajes posteriores (cliente terminado en 5060)

Fecha de análisis: 8 de noviembre de 2026. La siguiente evidencia usa identificadores reducidos y horas de Colombia (UTC-5).

### Secuencia observada en producción

| Hora | Evidencia | Resultado |
| --- | --- | --- |
| 3:53 p. m. | DeepSeek ejecutó interpretación de contexto y luego inferencia de producto. | Reconoció dos solicitudes; no fue un fallo de comprensión inicial. |
| 3:53 p. m. | PostgreSQL devolvió candidatos para ambas búsquedas de catálogo: 22 para gaseosas y 25 para papas. | No fue ausencia de catálogo ni indisponibilidad de PostgreSQL. |
| 3:53 p. m. | No se emitió `catalog.reconciliation`. | La selección contextual que conserva candidatos como alternativas pendientes no estuvo activa en esta ejecución. |
| 3:59 p. m. | Un mensaje posterior ejecutó solo `context_interpretation` (`provider_api_context_only`), sin inferencia de productos ni consulta de catálogo. | El modelo tuvo una única etapa de contexto; la traza no expone el texto ni permite afirmar la intención exacta. |
| 4:00 p. m. | Otro mensaje entrante terminó en 192 ms, sin llamada a DeepSeek, catálogo ni WhatsApp saliente. | Coincide con el cortocircuito de una solicitud humana pendiente: el mensaje queda registrado pero no recibe análisis ni respuesta automática. |

### Causa adicional confirmada

Cuando una búsqueda termina sin producto seleccionado, el flujo sin selección contextual conserva el faltante como `product:<consulta>`. Esa clave es considerada una resolución humana obligatoria. Se crea la tarea `human_handoff`, la conversación queda bloqueada y los mensajes posteriores se detienen antes de que DeepSeek pueda hacer una pregunta de aclaración.

La guarda que produce este comportamiento está en `agentRuntime`: si existe una solicitud humana abierta, persiste el mensaje entrante y retorna antes de enrutar la conversación. Es consistente con la traza de 192 ms observada a las 4:00 p. m.

### Qué queda demostrado y qué no

- Demostrado: DeepSeek sí identificó productos y el catálogo devolvió candidatos; el salto a humano ocurrió después de esas dos etapas.
- Demostrado: después de crear la tarea humana, el siguiente mensaje no recorrió DeepSeek ni catálogo.
- Fuertemente sustentado: la ruta de reconciliación contextual estaba desactivada, pues no hay evento `catalog.reconciliation` y el comportamiento corresponde al fallback legado.
- No verificable desde los registros disponibles: el valor crudo de `missingFields` y la fila de la solicitud pendiente. El conector de Supabase disponible no apunta a la base de datos operativa de VIA; para comprobarlo directamente se requiere acceso de solo lectura a la base de datos de Render.

### Ajuste focalizado propuesto, aún no aplicado

1. Mantener candidatos como selecciones pendientes cuando hay evidencia razonable, en vez de convertir de inmediato la ambigüedad en `product:<consulta>`.
2. Registrar por solicitud ambigua un estado estructurado de aclaración (`ámbito`, `intentos`, `última pregunta` y `evidencia`), separado de las tareas humanas.
3. Hacer que DeepSeek formule hasta dos preguntas contextuales, usando el historial y los candidatos reales; el contador limita la seguridad operacional, no interpreta por palabras clave.
4. Escalar únicamente después de esas dos aclaraciones sin resolución, o inmediatamente ante una solicitud explícita de humano, restricción de política, error de proveedor u otra condición obligatoria.
5. Separar solicitudes de aprobación operativa de `human_handoff`, para que una tarea interna no bloquee innecesariamente el análisis de nuevos mensajes del cliente.

Antes de aplicar ese ajuste deben añadirse pruebas para categorías vagas como “dos gaseosas y dos paquetes de papas”, dos rondas de aclaración, solicitud explícita de humano y continuidad después de una tarea humana cerrada. Esto preserva la línea base `00329e4` para reconocimiento, alternativas y selección de productos.
