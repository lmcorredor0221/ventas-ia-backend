# Diagnóstico: alternativas de catálogo y saludo personalizado por tienda

**Fecha:** 11 de noviembre de 2026
**Estado:** diagnóstico y propuesta; no implementado
**Alcance:** listas de resolución de ambigüedades de catálogo y saludo inicial del agente. No modifica el checkout, el catálogo, la base de datos ni producción.

## Objetivo

Permitir que un cliente, ante una lista de alternativas de un producto ambiguo, pueda:

1. elegir una referencia;
2. indicar que ninguna alternativa es correcta sin afectar el resto de la canasta; o
3. pedir alternativas distintas sin repetir las que ya vio.

Además, garantizar que el primer saludo use el nombre del agente configurado por cada tienda, sin repetir su presentación durante la misma conversación.

## Hallazgos confirmados

### 1. La eliminación aislada de una línea ya existe

El estado de la canasta ya modela una línea descartada mediante `removedByCustomer: true` o `selectionStatus: 'removed'`.

- `server/services/agentRuntime.js`, `isRemovedOrderItem`, normalización de línea y `applyStructuredLineUpdates`.
- `server/services/catalogResolutionService.js`, preparación y adjudicación de líneas.
- `server/tests/removed-catalog-line-continuity.mjs` verifica que una línea eliminada no se vuelva a resolver, no borre líneas ya seleccionadas y no altere el subtotal de ellas.

Por tanto, no hace falta crear una segunda canasta ni eliminar físicamente información histórica. La eliminación debe aplicarse exclusivamente al `lineId` pendiente, dejando trazabilidad del rechazo.

### 2. La interfaz interactiva actual solo permite seleccionar un SKU

`createCatalogSelectionOffer` en `server/services/agentRuntime.js` crea una oferta para una sola línea pendiente y construye filas cuyo único propósito es `select_catalog_product`.

Actualmente:

- toma hasta diez coincidencias del catálogo;
- no reserva filas para acciones de control;
- no registra qué SKU se mostraron a ese producto en intentos anteriores;
- no existe una acción para descartar la línea ni para solicitar nuevas alternativas.

La secuencia de una ambigüedad es correcta al ser una por vez: conserva foco y evita mezclar respuestas de distintos productos. El vacío está en las acciones disponibles dentro de esa lista.

### 3. Las ofertas son transaccionales y aptas para extenderse

`handleInteractiveReply` consume las ofertas por `offerId` de forma única. Los almacenamientos JSON y PostgreSQL validan tenant, conversación, vencimiento y opción; PostgreSQL además bloquea la fila durante el consumo.

Esto protege contra clics duplicados y opciones vencidas. Las nuevas acciones deben crear una oferta nueva cuando corresponda; no deben reutilizar la oferta consumida.

### 4. `continueClarifyingProducts` no debe reutilizarse para “Buscar otras opciones”

El flujo actual de `continueClarifyingProducts` reinicia intentos de aclaración y solicita texto libre. Reutilizarlo para buscar alternativas:

- no excluye opciones ya presentadas;
- puede reiniciar el contador de aclaraciones;
- puede repetir la misma lista;
- favorece ciclos conversacionales sin progreso.

La búsqueda de alternativas necesita una acción separada y un estado de historial por línea.

### 5. El prompt conoce el nombre, pero el runtime no lo exige

El nombre del agente se obtiene mediante `agentDisplayNameForTenant` en `server/domain/agentIdentity.js`, desde:

```text
tenant.config.agentPolicy.displayName
```

Si no hay valor válido, el valor predeterminado es `Rocío`.

El prompt de contexto, en `server/prompts/catalogSemanticGuide.js`, recibe la identidad y el prompt de saludo, en `server/services/llmPlanner.js`, solicita que el primer mensaje presente al agente.

Sin embargo, `handleGreeting` en `server/services/agentRuntime.js` envía `plan.greetingReply` literalmente. Si DeepSeek devuelve un saludo válido pero genérico, el runtime lo acepta sin comprobar que:

- incluya el nombre configurado;
- sea el primer saludo de la conversación; o
- haya quedado registrada la presentación.

Esto explica por qué un saludo puede salir sin el nombre personalizado incluso si el prompt lo recibió correctamente. Si además un tenant no guardó `agentPolicy.displayName`, se sumaría un problema de configuración, que debe verificarse en lectura contra el registro específico antes de atribuirlo a ese dato.

## Evidencia de pruebas local

Se ejecutaron sin enviar mensajes reales ni alterar producción:

1. `node server/tests/catalog-selection-reconciliation.mjs`
2. `node server/tests/basket-line-mutations.mjs`
3. `node server/tests/removed-catalog-line-continuity.mjs`
4. `node server/tests/agent-identity-context.mjs`
5. `node server/tests/agent-runtime-greeting.mjs`
6. `node server/tests/contextual-clarification-escalation.mjs`

Todas finalizaron correctamente. No obstante, la cobertura actual tiene dos brechas relevantes:

- la prueba de selección espera únicamente filas de productos y no cubre acciones auxiliares;
- la prueba de saludo acepta una respuesta genérica como `¡Hola, veci! ¿En qué te puedo ayudar?`, por lo que no verifica que el nombre configurado se presente al inicio.

## Diseño propuesto

### Estado por línea de canasta

Conservar `orderDraft.items` como única fuente de estado. Para cada línea con ambigüedad, agregar metadatos compactos, por ejemplo:

```json
{
  "lineId": "line-abc",
  "selectionStatus": "pending",
  "catalogSelectionHistory": {
    "attempts": 1,
    "seenCandidateSkus": ["SKU-1", "SKU-2"],
    "searchQueries": ["coca cola litro y medio"],
    "lastOfferId": "io-xyz"
  }
}
```

El historial es evidencia operativa, no una segunda interpretación de la solicitud. Permite evitar repetición de alternativas y conservar el resto de la canasta intacto.

### Lista de alternativas

La lista interactiva debe reservar dos de sus diez filas máximas:

1. hasta ocho productos compatibles;
2. `Buscar otras opciones`;
3. `Ninguna de estas`.

La etiqueta compacta se usa por los límites de Meta; la descripción puede explicar que la segunda acción quita únicamente ese producto de la solicitud.

Cada acción debe contener, dentro de su valor seguro:

- `basketKey`;
- `lineId`;
- SKU presentados;
- intento de búsqueda;
- identificador de oferta.

Antes de mutar estado, el runtime debe validar que la línea continúe pendiente y pertenezca a la canasta actual.

### Acción “Ninguna de estas”

Es una instrucción explícita del cliente, por lo que no requiere una llamada al LLM.

Debe:

1. aplicar la operación existente `remove` exclusivamente sobre el `lineId` de la oferta;
2. guardar el motivo `customer_rejected_presented_options`, fecha y SKU ofrecidos;
3. limpiar solo las condiciones pendientes de esa línea;
4. conservar productos seleccionados, cantidades, nombre, dirección y demás contexto;
5. continuar con la siguiente línea pendiente o el flujo de pedido parcial correspondiente.

Esto es una garantía de integridad, no una regla determinística de interpretación lingüística.

### Acción “Buscar otras opciones”

Debe crear una oferta nueva y conservar el estado de la línea. El proceso es:

1. entregar al LLM el mensaje original, atributos inferidos, historial breve de conversación, producto pendiente y SKU ya presentados;
2. pedir una reformulación o ampliación contextual de la consulta, sin permitir inventar SKU ni precios;
3. consultar el motor de catálogo con la nueva consulta y `excludeSkus` igual a los SKU previamente presentados;
4. evaluar coincidencias nuevas con los atributos expresos del cliente;
5. presentar solo alternativas nuevas;
6. si no existen, informar que no hay alternativas diferentes y avanzar al siguiente pendiente o a la decisión sobre pedido parcial.

La exclusión de SKU garantiza no repetir resultados; el LLM continúa siendo responsable de comprender la solicitud, corregir expresiones y reformular la búsqueda cuando exista nueva evidencia contextual.

Las respuestas escritas del cliente, por ejemplo “ninguna”, “otra marca” o “busca algo diferente”, siguen siendo interpretadas por DeepSeek y deben actualizar la línea existente mediante su `lineId`; no deben crear un producto nuevo.

### Saludo personalizado y no repetitivo

La corrección mínima propuesta es:

1. leer el nombre configurado del tenant al iniciar el saludo;
2. detectar de forma durable si ya se presentó el agente en esa conversación;
3. si es el primer saludo y la salida del LLM omite el nombre, usar una respuesta natural de respaldo que incluya el nombre y la tienda;
4. persistir `agentIntroductionSentAt` o metadato equivalente;
5. en mensajes posteriores no exigir una nueva presentación;
6. medir en telemetría `agentName`, `isFirstGreeting`, `introductionIncluded` y `replySource` sin guardar contenido sensible innecesario.

El LLM continúa definiendo tono, intención y redacción conversacional. La comprobación del nombre solo protege una preferencia explícitamente configurada por la tienda.

## Componentes de intervención

| Componente | Cambio focalizado |
| --- | --- |
| `server/services/agentRuntime.js` | Construir filas de control, manejar las dos nuevas acciones, validar ofertas y actualizar una sola línea. |
| Servicio/motor de búsqueda de catálogo | Aceptar exclusiones de SKU e historial de alternativas para no devolver resultados repetidos. |
| `server/prompts/catalogSemanticGuide.js` | Aclarar el contrato de actualización contextual para respuestas escritas sobre una línea existente. |
| `server/services/llmPlanner.js` | Exponer el contexto mínimo para reformular una búsqueda de alternativas y conservar la identidad configurada. |
| `server/domain/agentIdentity.js` | Reutilizar su resolución actual de nombre; no requiere rediseño. |
| Pruebas de runtime y selección | Añadir cobertura de acciones, agotamiento de opciones, concurrencia y saludo personalizado. |

## Riesgo, rendimiento y límites

- `Ninguna de estas` solo actualiza estado; no agrega llamada a DeepSeek ni búsqueda de catálogo.
- `Buscar otras opciones` agrega una llamada focalizada al LLM y una consulta al catálogo, únicamente tras la decisión explícita del cliente. No aumenta la latencia de la selección normal.
- El historial y la exclusión evitan loops sin convertir la interpretación semántica en reglas rígidas.
- Las ofertas de un solo uso ya reducen el riesgo de mutaciones duplicadas; se deben conservar esas validaciones en las nuevas acciones.

## Criterios de aceptación

1. Descartar una línea no modifica ninguna otra línea de la canasta.
2. Una búsqueda alternativa nunca vuelve a presentar un SKU ya ofrecido para la misma línea.
3. Si no hay alternativas nuevas, el sistema comunica el resultado y avanza sin repetir la lista.
4. Respuestas de texto que aclaren, reemplacen o descarten una opción operan sobre el `lineId` existente.
5. Una opción vencida, duplicada o asociada a otra canasta no modifica el pedido.
6. El primer saludo incluye el nombre configurado para la tienda; los siguientes no repiten la presentación.
7. Siguen pasando las pruebas de selección, continuidad de canasta, consolidación y checkout ya existentes.

## Próximo paso recomendado

Antes de implementar, comprobar en lectura la configuración `tenant.config.agentPolicy.displayName` de las tiendas afectadas. Después, aplicar los cambios focalizados descritos y ejecutar la matriz de regresión anterior, incluyendo escenarios de selección, descarte, alternativas agotadas, selección tardía y saludo inicial/reintento.
