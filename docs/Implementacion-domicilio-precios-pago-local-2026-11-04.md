# Condiciones de domicilio, precios y pago por texto — implementación local

Fecha: 2026-11-04. Continúa la sección 14 de [la propuesta](Propuesta-descomposicion-planner-grounding-llm-2026-11-04.md). Conserva la descomposición intérprete/coordinador/resolutor/composer y los cambios anteriores de canasta y confirmación. No se ha hecho commit, push ni despliegue.

**Alcance de pagos aclarado después de las pruebas:** VIA registra la preferencia; el domiciliario verifica/cobra. Si el comprador manda una imagen de comprobante, VIA avisa al tendero y acusa recibo, sin verificar fondos ni condicionar el pedido a una aprobación financiera dentro de VIA. La adaptación posterior de `payment_confirmation` y los casos 38/48 ya está implementada y probada localmente. Véase [informe específico de avisos](Implementacion-avisos-comprobante-local-2026-11-04.md); sus resultados se separan de esta campaña de condiciones de domicilio.

## Comportamiento implementado

En **Ajustes → Tu tienda → Condiciones del domicilio**, cada dueño puede guardar independientemente:

- `orderPolicy.deliveryFee`: costo fijo de entrega en COP, una sola vez por pedido.
- `orderPolicy.deliveryMinimumSubtotal`: mínimo de productos, sin sumar la tarifa de entrega.

Ambos aceptan enteros no negativos. Campo vacío significa **sin configurar** (`null`), no entrega gratuita. Cero explícito significa gratis/sin mínimo según el campo. Las tiendas existentes no reciben una tarifa global. Los fixtures antiguos de pruebas sí declaran cero explícito para conservar su expectativa anterior.

El backend calcula productos, tarifa, mínimo, faltante y total con datos confiables. El LLM interpreta el mensaje y el historial, conserva o modifica la canasta, responde preguntas comerciales y decide si invita a completar la compra o solicita atención humana. No hay un enrutador nuevo de palabras clave para elegir entre agregar productos y escalar.

| Ejemplo local | Resultado esperado e implementado |
|---|---|
| Productos $10.000, entrega $3.000, mínimo $10.000 | Total $13.000; el comprador acepta este desglose antes de crear la orden. |
| Misma canasta, mínimo $15.000 | Faltan $5.000 **en productos**. La entrega no completa el mínimo ni el faltante es un cargo adicional. |
| Añadir dos Chocoramos de $2.800 al ejemplo anterior | Tres Chocoramos en total, subtotal $15.600, entrega $3.000, total $18.600. No duplica líneas ni descarta la gaseosa. |
| Cliente no quiere añadir y pide excepción | El resolutor solicita una revisión humana con el pedido y las condiciones actuales. No crea automáticamente una orden. |
| Dueño autoriza excepción para esa canasta | VIA vuelve a cotizar; necesita una nueva aceptación del comprador. No modifica el mínimo general de la tienda. |
| Tarifa/mínimo sin configurar | Se informan como pendientes. El domicilio no se presenta como gratis y no se confirma autónomamente. |
| «Pago con tarjeta débito» | El intérprete elige el ID de tarjeta habilitado en esa tienda. No equivale a pago recibido ni a confirmación del pedido. |
| Medio personalizado o cambio a uno no habilitado | Usa el ID configurado; si solicita uno no admitido, no conserva silenciosamente la preferencia anterior para confirmar. |

## Archivos y responsabilidades

| Archivo | Cambio de esta ampliación |
|---|---|
| `server/domain/deliveryPolicy.js` (nuevo) | Validación numérica, cálculo puro, revisión de política/canasta, elegibilidad y excepción acotada. |
| `server/domain/paymentMethods.js` (completa extracción previa) | IDs habilitados y etiquetas por tenant; lista vacía explícita no reactiva medios predeterminados. La equivalencia lingüística sigue a cargo del LLM. |
| `server/services/tenantConfigPolicy.js` | Permite ambos campos y valida el merge parcial para dueño/administrador. |
| `server/services/saasControlPlane.js`, `server/data/seed.js` | Configuración inicial sin valores comerciales implícitos; fixture histórico Andina con cero explícito. |
| `server/routes/api.js`, `server/routes/admin.js` | Guardado crítico de configuración; autorización por tenant; el responsable de una resolución se obtiene de la sesión. |
| `src/App.jsx` | Editor de condiciones, formulario de revisión humana con valores tipados/motivo y desglose en tareas. |
| `src/features/orders/OrderProgressCard.jsx` | Resumen compartido de productos, domicilio y total; históricos sin snapshot se muestran sin inventar una tarifa. |
| `server/services/llmPlanner.js`, `server/domain/semanticContracts.js` | Contexto comercial y medios habilitados, preservación de preguntas/canasta y preferencia de pago. Reparación acotada de un contrato semántico inválido. |
| `conversationGroundingCoordinator.js`, `groundedDecisionAgent.js` | El resolutor recibe hechos comerciales y decide `answer_question`, `invite_additions`, aclaración o `human_review` según contexto. Una consulta informativa no crea una tarea; pedir intervención para condiciones desconocidas sí debe hacerlo. |
| `server/services/agentRuntime.js` | Cotización vigente, bloqueo comercial, revisión humana única, reaceptación del comprador y relectura de condiciones antes de confirmar/enviar. |
| `server/domain/groundingContracts.js` | Impide confirmar canasta o condiciones pendientes, aun si el modelo propone hacerlo. |
| `server/services/llmReplyComposer.js` | Respuesta contextual con evidencia monetaria tipada. El modelo selecciona hechos y redacta; el servidor inserta/valida importes y etiquetas, sin calcularlos desde texto. |
| `server/services/toolRegistry.js` | Revalida cotización/resolución humana y persiste snapshot, pago y modalidad. Sheets sigue en outbox; columnas A:M conservadas, desglose en metadatos M. |
| `server/store/postgresStore.js` | Política bloqueada en transacción hasta commit de pedido+outbox; rollback limpio e inmutabilidad del snapshot histórico. JSONB existente, sin migración nueva. |
| Contratos y runner E2E | Pruebas financieras, contexto, pago, concurrencia y persistencia. Oráculo comercial independiente; 50 casos existentes con costo cero explícito y pruebas nuevas con tarifa/mínimo reales del fixture. |

`orderService.js` no necesitó cambios adicionales: las transiciones existentes conservan el payload comercial. No se creó otro planner ni un agente para aritmética.

## Límites obligatorios y control conversacional

La división se conserva: el intérprete comprende; la búsqueda aporta evidencia; el resolutor selecciona la siguiente acción; el composer comunica. La aritmética y los permisos son controles del servidor.

El composer recibe `commercialFacts` con campos e importes confiables. Puede referenciarlos con `{{commercial:pricing.deliveryFee}}` y declarar su uso en `commercialClaims`; el backend sustituye el marcador por el dato verificado. Esto evita exigir que el modelo copie cifras y etiquetas exactas. No fija la intención, el tono ni la siguiente acción. También se valida el contrato literal compatible. Una respuesta rechazada se registra como fallback, nunca como composición exitosa.

Una caída técnica del proveedor conserva una respuesta segura construida desde los hechos, las opciones de catálogo y los pendientes; no inventa precios ni revive una confirmación inválida. Esta degradación técnica no constituye prueba de comprensión por IA: las pruebas nuevas con DeepSeek real fallan si ocurre.

La excepción humana queda ligada a tenant, canasta y revisión comercial, con responsable y motivo. Cambiar la canasta o las condiciones la invalida. El guard PostgreSQL impide que una cotización vieja se confirme entre la lectura de política y el commit. Los pedidos confirmados conservan su desglose aunque luego se cambie la tarifa.

## Validación y evidencias

**Implementación terminada y pruebas locales ejecutadas. Los escenarios nuevos pasan; la campaña general no está aprobada.** Se conservan los resultados originales, incluidos los fallos, y se distingue la versión ejecutada en cada campaña.

| Validación final | Resultado | Evidencia local |
|---|---|---|
| Dominio/configuración, runtime, persistencia JSON, consultas/pago y composer | Aprobada: 9 escenarios de runtime, 32 comprobaciones de persistencia JSON, 3 contratos de consulta/pago y 29 del composer, además de dominio/configuración. | [Log de contratos](../test-results/delivery-contracts-final.log) |
| PostgreSQL local real | **36 comprobaciones aprobadas**: dos carreras de actualización de política/pedido, round-trip JSONB, rollback, rechazo de omisión del snapshot y conservación del histórico. Esquema temporal, sin migrar tablas de desarrollo existentes. | [Log PostgreSQL](../test-results/delivery-postgres-final.log) |
| Regresión backend | 7 scripts aprobados; incluye 50 escenarios colombianos/60 pasos **con simulador**, no evidencia de comprensión de DeepSeek. | [Log backend](../test-results/delivery-backend-final.log) |
| Arquitectura y contratos contextuales | 12 scripts de arquitectura aprobados; también aprobados los contratos de aceptación contextual y grounding después de los cambios. | [Log arquitectura](../test-results/delivery-architecture-final.log) |
| Compilación frontend | Aprobada, 1.680 módulos; compilación en memoria con `write:false`, sin publicación. | [Log de compilación](../test-results/delivery-build-final.log) |
| Conversaciones focalizadas con DeepSeek real | **15/15 aprobadas**, cinco escenarios por tres variantes lingüísticas; 54 turnos de comprador y 3 de tendero. | [Resumen y enlaces por caso](../test-results/delivery-commerce/final-summary.md) |

Las quince conversaciones finales usan catálogo de 300 referencias, runtime real y DeepSeek real, con transporte Meta/Google simulado y almacenamiento JSON temporal. **No atraviesan el webhook HTTP ni sustituyen la prueba PostgreSQL**: esas fronteras se verifican en los contratos y en la campaña E2E siguiente. Un fallback del planner/composer, un rechazo de grounding o un error del agente hacen fallar estos casos. Las tres ejecuciones tienen la misma huella de los ocho componentes productivos controlados, comprobada también contra los archivos al generar el resumen.

Los cinco escenarios son: consulta de precio unitario/domicilio y pago por texto; mínimo insuficiente y adición de productos; excepción humana seguida de nueva aceptación; condiciones sin configurar; y medio personalizado/no admitido con cambio posterior válido. Incluyen «cancelar con tarjeta débito» como preferencia de pago, sin cancelar el pedido.

Medición local de esas quince conversaciones: p50 **6.119 ms**, p95 **9.562 ms** por turno; 140 llamadas de VIA, 587.710 tokens de entrada y 33.088 de salida. No hay llamadas de comprador/juez IA en esta suite. Estas cifras no constituyen un SLA productivo ni permiten atribuir una mejora de latencia respecto a otra campaña con distinta carga.

### Actualización: 50 casos sobre la versión final

Se completó posteriormente la repetición solicitada de los **50 escenarios** sobre las fuentes finales congeladas: **13 aprobados, 17 fallos funcionales, 16 revisiones, 2 errores del evaluador, 1 error de infraestructura y 1 fallback de integración**; 168 turnos. Esta campaña no está aprobada. Las cuatro copias locales conservaron intacta la base original y las huellas de fuentes antes/después coinciden.

La auditoría individual encontró defectos de VIA incluso en seis casos aprobados automáticamente, y separó citas inválidas, SKU incorrectos, límites de turnos y errores del comprador/juez. Los 15 pedidos creados conservaron importes/cantidades correctos y pasaron la operación del tendero hasta despacho/cierre. Esto no elimina las brechas de consultas, atributos, tareas humanas y comprobantes. La repetición diagnóstica separada de 03/17 resolvió el error de conexión: 03 pasó; 17 expuso una negativa de catálogo incorrecta.

Detalle vigente: [Resultado de los 50 casos finales y auditoría](Resultado-50-casos-version-final-y-auditoria-2026-11-04.md). Se conserva a continuación la campaña anterior como evidencia histórica; sus resultados no se atribuyen a las fuentes finales ni sustituyen esta nueva ejecución. No hubo cambios de runtime ni despliegue durante la repetición.

### Campaña general anterior: resultados y alcance de la evidencia

Se ejecutaron los 50 escenarios existentes con Meta simulada mediante webhook firmado/Graph capturado y DeepSeek real, distribuidos en cuatro copias locales independientes de PostgreSQL. El comprador y el juez también usan IA. Las huellas antes/después confirman la base original intacta en los cuatro grupos.

| Clasificación original | Casos |
|---|---:|
| Aprobado | 8 |
| Clasificado como fallo funcional | 21 |
| Requiere revisión | 18 |
| Error del evaluador | 3 |

Evidencia: [informe de los 50 casos](../test-results/delivery-full50/consolidated.md), con enlaces a conversaciones y aserciones individuales; [datos consolidados](../test-results/delivery-full50/consolidated.json). Son 173 turnos. VIA consumió 489 llamadas/1.911.004 tokens; el comprador de pruebas 121 llamadas/240.384 tokens y el juez 50 llamadas/3.013.596 tokens. No sumar los dos últimos como consumo operativo de VIA.

**Esta campaña precede a las últimas correcciones focalizadas.** No se le atribuye el código corregido después ni se reemplazan sus resultados con los 15 éxitos. En particular, se corrigieron después la interpretación del evento de aprobación humana, la confusión entre canasta incompleta y revisión de domicilio, la exigencia innecesaria del nombre del agente en consultas generales, la repetición literal de productos en turnos sin cambio de canasta y la protección contra omitir `pricing` al guardar.

Se repitieron además los casos 30 y 32 por HTTP/PG con la versión final y el contexto inicial del fixture disponible para el juez: **30 aprobado y 32 pendiente de revisión**, en [la nueva ejecución](../test-results/delivery-fixture-context/20261104213530_ce21b5a6). La base original permanece intacta. Esto no constituye una nueva campaña completa de 50 casos.

### Hallazgos que siguen abiertos

- Tareas humanas genéricas duplicadas en 27/37/39/47/49; la deduplicación comercial de `delivery_policy_review` sí está cubierta, pero no resuelve todos los tipos de tarea anteriores.
- Contexto vacío de tarea en 45, conservación de adjuntos en 46 y ausencia de respuesta en escenarios de comprobantes de pago 38/48. Requieren corrección y nueva validación independiente.
- Continuidad/cantidades y respuestas parciales en varios diálogos; 11/12/16/17/18 agotaron el presupuesto de turnos. Agotar tres turnos no prueba por sí solo un error del agente: se debe revisar expectativa, comprador y conversación.
- El juez anterior no conocía la dirección ya guardada ni la tarifa cero explícita del fixture y las marcó como inventadas. Ahora recibe solo datos iniciales confiables y autorizados, sin decisiones futuras privadas del comprador. El caso 30 pasó con este contexto. El 32 sigue en revisión: conserva subtotal/total de $23.500 y tarifa cero, pero el juez cuestiona un subtotal parcial y confunde preferencia de efectivo con evidencia de pago. Sus citas también necesitan revisión; no se le adjudica un aprobado manual sin resolverlo.
- Hay errores de extracción de precio unitario frente a total de línea y tres errores del evaluador. Las clasificaciones se conservan, sin presentar todos los resultados negativos como defectos comprobados de VIA ni descartarlos por suponer que son del juez.
- En algunas respuestas focalizadas se repite la etiqueta del importe (por ejemplo, «Domicilio: Domicilio: …»). Las cifras son correctas; queda una mejora de redacción, no una autorización para relajar las validaciones financieras.

Los intentos intermedios y sus fallos permanecen en `test-results`: no se borran ni se reclasifican como éxitos. Para una declaración de aptitud general es necesario corregir/revisar estas brechas y ejecutar nuevamente la campaña completa sobre una versión congelada.

### Reproducción

Comandos repetibles (credenciales solo en variables locales; no pegarlas en documentación):

```powershell
npm run test:delivery
# POSTGRES_TEST_DATABASE_URL debe apuntar al PostgreSQL local
npm run test:delivery:postgres
npm run test:backend
npm run test:architecture
# DEEPSEEK_API_KEY cargada localmente; sin LLM_SIMULATOR
$env:DELIVERY_LANGUAGE_VARIANT='1'
npm run test:delivery:real
$env:DELIVERY_LANGUAGE_VARIANT='2'
npm run test:delivery:real
$env:DELIVERY_LANGUAGE_VARIANT='3'
npm run test:delivery:real
# E2E_SOURCE_DATABASE_URL local; el runner crea una copia
npm run test:e2e:contextual
```

Los scripts detienen llamadas a proveedores no autorizados. No hay mensajes reales por WhatsApp ni escritura en Drive productivo. La prueba de integración conserva huellas de la base original antes/después. El contexto E2E histórico sigue teniendo sus propios criterios de aceptación; pasar los casos nuevos no acredita toda la plataforma.

## Alcance y restricciones

- Tarifa fija por pedido; zonas, distancias, horarios y envío gratis por umbral no están incluidos.
- Se distingue retiro de domicilio en cálculo/persistencia; esto no añade una nueva oferta comercial de retiro a tiendas que no la tengan.
- Desglose de Sheets en JSON de M; no se agregaron columnas visibles al documento de cada dueño.
- La resolución simultánea de una tarea humana se serializa en la instancia actual. Antes de escalar a varios procesos habrá que validar/adaptar esa coordinación; la carrera de política/pedido sí está controlada en PostgreSQL.
- El snapshot tiene revisión y versión; la fecha de creación del pedido/eventos permite auditarlo. No se añadió un campo independiente `quotedAt` a cada cálculo puro.
- No se han configurado importes en ninguna tienda productiva ni cambiado permisos de Meta, tokens o facturación.
