# Diagnóstico: cantidad operativa y actualizaciones contextuales de canasta

## Alcance

Corrección focalizada de la transición entre la interpretación de DeepSeek y el estado operativo de la canasta. No modifica la búsqueda de catálogo, PostgreSQL, el grafo ni el despliegue.

## Causa raíz confirmada

La conversación podía contener productos ya resueltos pero con cantidades pendientes. DeepSeek podía entender una respuesta corta como `una de cada una`, pero el contrato del intérprete no tenía una salida estructurada para asociar esa decisión con cada `lineId` de la canasta. Por ello la interpretación quedaba solo como texto contextual.

Además, los borradores heredados podían guardar una medida semántica, por ejemplo `media libra`, dentro de `quantity`. El runtime la usaba implícitamente en validaciones de disponibilidad. Como no era una cantidad de unidades válida, se generaba un falso `stock:<producto>`; ese faltante activaba el escalamiento operativo a atención humana.

La investigación confirma que no fue una falla de catálogo, PostgreSQL ni del grafo: las referencias y existencias estaban disponibles. Tampoco fue una solicitud de escalamiento emitida por DeepSeek.

## Cambio mínimo aplicado

| Componente | Cambio | Responsabilidad |
| --- | --- | --- |
| `server/prompts/catalogSemanticGuide.js` | Amplía los contratos de las dos etapas LLM con `lineUpdates`. | El LLM interpreta una respuesta respecto a líneas existentes. |
| `server/services/llmPlanner.js` | Normaliza y conserva `lineUpdates`; separa `quantity` numérica de `requestedMeasure`. | Evita que un texto de medida llegue como cantidad operativa. |
| `server/services/agentRuntime.js` | Valida que la actualización apunte a un `lineId` existente, recalcula subtotal/inventario solo con unidades enteras positivas y conserva la medida semántica. | El runtime protege precio, SKU, stock y estado de checkout. |
| `server/tests/llm-line-updates-reconciliation.mjs` | Regresión de dos líneas seleccionadas y respuesta contextual de cantidad. | Verifica que no exista un falso faltante de stock. |

`lineUpdates` tiene la forma:

```json
{
  "lineId": "line-queso",
  "quantity": 1,
  "quantityExplicit": true,
  "requestedMeasure": "media libra",
  "requestedAttributes": null
}
```

Solo se aplican actualizaciones sobre líneas ya existentes. El LLM no puede cambiar producto, SKU, precio, existencia o disponibilidad mediante este contrato.

## Criterio operativo

- `quantity`: unidades enteras positivas compatibles con el inventario del catálogo.
- `requestedMeasure`: evidencia semántica del cliente (peso, volumen u otra medida). No se usa para multiplicar precio ni comparar inventario.
- `stock:<producto>`: solo se crea cuando hay una cantidad operativa válida y la disponibilidad real es insuficiente.
- Una cantidad pendiente continúa como `quantity:<producto>` para pedir aclaración; no escala a humano por sí sola.

## Pruebas ejecutadas localmente

1. `node server/tests/llm-line-updates-reconciliation.mjs`
   - Pan tajado Bimbo 500 g: stock 50.
   - Queso doble crema Colanta 250 g: stock 24 y medida previa `media libra`.
   - `lineUpdates` para ambas líneas con una unidad.
   - Resultado: subtotal COP 21.000, ambas líneas disponibles, medida preservada y sin `stock:` ni bloqueo; la aceptación de canasta avanza al paso de pago.
   - Incluye además cantidades mixtas (2 panes y 3 quesos), una respuesta ambigua que conserva `quantity:` sin crear `stock:`, y una insuficiencia real de inventario que sí crea `stock:queso doble crema`.
2. `node server/tests/catalog-selection-reconciliation.mjs`
3. `node server/tests/catalog-ambiguity-regression.mjs`
4. `node server/tests/checkout-sequence.mjs`
5. `node server/tests/checkout-continuation-intent.mjs`
6. `node server/tests/llm-json-recovery.mjs`

Todas pasaron.

## Validación real con DeepSeek (aislada)

Se ejecutó una conversación local aislada con adaptador de WhatsApp `mock`, datos temporales y el proveedor real `deepseek-chat`. No se escribió en producción ni se envió un mensaje real.

Con el historial de dos líneas seleccionadas y la entrada `una de cada una`, DeepSeek devolvió dos `lineUpdates`, una por cada `lineId`. El runtime dejó ambas líneas en cantidad 1, conservó `media libra` como `requestedMeasure`, calculó COP 21.000 y no dejó faltantes.

Uso observado de la llamada de validación: dos llamadas de planificación, 2.680 tokens de entrada y 893 de salida; el proveedor reportó 768 y 512 tokens de caché en las dos etapas, respectivamente. La traza completa de entrada tardó 7,43 s, dentro del límite local configurado de 8 s, con el costo y la latencia atribuidos a DeepSeek, no a Meta ni a producción.

## Límites preservados

Esta corrección no convierte expresiones concretas en reglas. La interpretación de equivalencias, ambigüedad y número de unidades continúa a cargo del LLM; el runtime solo valida tipos, identidad de línea y hechos de inventario/precio.
