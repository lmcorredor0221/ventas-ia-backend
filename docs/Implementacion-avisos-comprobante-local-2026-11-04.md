# Medio de pago y aviso de comprobante — implementación local

Fecha: 2026-11-04. Alcance autorizado: implementar y probar localmente, sin desplegar. Continúa el §14.12 de la propuesta de descomposición. Se preservaron los cambios locales anteriores; no se hizo commit, push ni despliegue.

## Comportamiento

- VIA conserva el medio de pago habilitado por la tienda; elegir efectivo, tarjeta, Bre-B o un medio personalizado no acredita dinero ni exige comprobante. «Contraentrega» indica cuándo se paga; no crea automáticamente un medio global nuevo.
- El LLM interpreta preferencia, declaración de pago, comprobante, foto de producto, imagen sin contexto y agradecimiento usando mensaje, historial y pedido. No se añadió un detector de comprobantes por palabras clave ni por extensión de archivo.
- Una declaración textual produce acuse contextual y aviso informativo. Una imagen anunciada/contextualizada como comprobante añade la referencia real del adjunto. La promesa de enviarlo no se convierte en «imagen recibida».
- Se conserva `payment_confirmation` por compatibilidad de contratos e históricos, pero ya no invoca `approval_gate`, crea aprobación financiera ni cambia el estado del pedido.
- El aviso incluye tenant, comprador, conversación, mensaje original, fecha, referencia del adjunto y pedido relacionado cuando el LLM lo identifica entre referencias reales del mismo tenant/comprador. Un ID ajeno no se acepta. La falta de asociación puede aclararse sin bloquear pedidos.
- La tienda encuentra **Comprobantes y avisos de pago** en Hoy, Pedidos y pendientes y el resumen de conversación. El enlace abre el chat original de WhatsApp para consultar el adjunto; VIA conserva la referencia, no descarga ni verifica la imagen. No se envía un WhatsApp adicional al tendero.
- Con atención manual activa se clasifica el adjunto y se conserva el aviso, sin reactivar IA ni interrumpir al humano con una respuesta automática. Si falla esa clasificación, el adjunto queda en el historial y se registra el fallo.
- Un comprobante posterior al despacho puede referenciar el pedido cerrado; no lo reabre ni crea una compra. La nueva conversación de atención no equivale a un nuevo pedido.
- Reentregas del mismo mensaje y referencias de medios repetidas en una conversación no duplican avisos. La inserción usa el estado más reciente, no el snapshot previo al LLM; el worker conserva sus mecanismos existentes de serialización/lease por conversación.

## Causas corregidas

1. `payment_confirmation` invocaba una aprobación financiera y retornaba sin responder al comprador.
2. La rama universal de imágenes interceptaba comprobantes y prometía identificar un producto.
3. `mediaRef` no quedaba en los mensajes persistidos del historial; ahora se conserva junto con el tipo de mensaje y su ID.
4. La recuperación por expresiones como «pedido anterior» podía reabrir una conversación de compra cerrada. Se preserva ese límite de ciclo de vida para pedidos ya registrados.
5. El composer no recibía la ambigüedad contextual del intérprete ante una imagen aislada. Ahora recibe el resumen y las ambigüedades, sin otra llamada de análisis.

## Archivos

| Archivo | Cambio de esta continuación |
|---|---|
| `server/services/agentRuntime.js` | Aviso informativo antes del manejo genérico de imágenes; persistencia, deduplicación, asociación segura, atención manual y contexto para composer. |
| `server/services/llmPlanner.js` | Semántica de pagos fuera de verificación, metadatos de adjunto, historial y referencias de pedidos para el LLM. |
| `server/domain/semanticContracts.js` | Campo opcional `paymentReport.relatedOrderId`; no admite estado pagado ni aprobación. |
| `server/services/llmReplyComposer.js` | Acuse basado en hechos recibidos; no verificar/cobrar/bloquear; aclarar finalidad de imagen según interpretación. |
| `server/routes/api.js` | Expone avisos del tenant autorizado, incluyendo conversaciones históricas. |
| `src/App.jsx`, `src/core/api/contracts.js` | Carga y presentación de avisos; enlace al adjunto original en el chat. |
| `src/features/orders/PaymentNotices.jsx` (nuevo) | Panel informativo, sin botones de aprobar/rechazar pagos. |
| `server/tests/payment-notice-contract.mjs` (nuevo) | Contratos JSON/PostgreSQL, API de operación, aislamiento, deduplicación y continuidad del pedido. |
| `server/tests/payment-notice-deepseek.mjs` (nuevo) | Conversaciones focalizadas con DeepSeek real y transporte local. |
| Fixtures y helpers de aceptación contextual | Casos 38/48 pasan de aprobación financiera a aviso; el juez distingue medio de pago de acreditación. Una afirmación de pago verificado con evidencia es fallo, no requisito. |

No hay migración de esquema: los avisos y metadatos se conservan en el payload JSON existente de conversaciones. No se modificaron datos productivos ni se limpiaron tareas históricas.

## Validación

| Prueba | Resultado |
|---|---|
| `npm run test:payment` | 10 contratos aprobados con almacenamiento JSON. |
| `npm run test:payment:postgres` | Los mismos 10 aprobados con PostgreSQL real local, esquema temporal propio eliminado al terminar. Incluye persistencia, escrituras superpuestas, lectura del operador y flujo tomar → preparar → despachar. |
| `npm run test:payment:real` | 8 escenarios focalizados aprobados: declaración→imagen→gracias; soporte tras despacho; foto de producto; imagen sin contexto; soporte en atención manual; efectivo contraentrega; débito contraentrega; medio personalizado. |
| E2E contextual 38/48 | 2/2 aprobados, 4 turnos, HTTP con firma, PostgreSQL local, Meta/Graph y Google simulados, DeepSeek real. |
| `npm run test:delivery` | Suite aprobada; aritmética, condiciones, excepciones, preferencia de pago y contrato de respuestas comerciales. |
| `npm run test:architecture` | Suite aprobada; incluye estados, outbox, concurrencia, lotes, revalidación de respuesta y contratos semánticos. |
| `node server/tests/colombia-scenarios.mjs` | 50 escenarios / 60 pasos aprobados con simulador; **no equivale a repetir 50 con DeepSeek real**. |
| `node server/tests/contextual-acceptance-contract.mjs` | Contratos del evaluador aprobados, incluida distinción entre acreditación inventada y mala extracción del juez. |
| `npm run build` | Frontend compilado correctamente. |

Evidencias reproducibles guardadas localmente (ignoradas por Git):

- `test-results/payment-notice/2026-11-04T22-25-00-325Z/report.json`: 8 escenarios, 15 llamadas reales, 33.466 tokens de entrada y 2.692 de salida. Conversaciones revisadas además del resultado automático. La imagen sin contexto produjo una pregunta sobre su finalidad; el agradecimiento no generó otro aviso.
- `test-results/payment-notice-e2e/20261104222244_d7d05ba9/`: 38/48, 12 llamadas incluyendo comprador/juez; VIA consumió 18.432 tokens. p95 de acuse 38 ms y de procesamiento 8.086 ms en esta muestra pequeña. El runner conserva «listo para piloto: NO» porque el subset no satisface su umbral global de campaña; no hay casos fallidos en este subset.
- La última protección de inserciones superpuestas y el fallback informativo se validaron después mediante los 10 contratos tanto JSON como PostgreSQL; no se atribuyen retroactivamente a la ejecución DeepSeek anterior.

Los scripts reales solo permiten acceso de red a DeepSeek; el E2E usa la simulación y controles de red existentes. No se enviaron mensajes reales ni se escribió en Google Drive. Los secretos se cargaron por entorno desde archivos locales y no se guardaron en los informes.

## Reejecución y límites

1. `npm run test:payment` no requiere credenciales ni red externa.
2. Para `npm run test:payment:postgres`, proporcionar `POSTGRES_TEST_DATABASE_URL` local explícita; solo acepta loopback. El script crea y elimina únicamente su esquema temporal `payment_notice_<uuid>` usando las migraciones existentes.
3. Para `npm run test:payment:real`, proporcionar `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL=https://api.deepseek.com` y quitar `LLM_SIMULATOR`. Meta es mock local; no configurar credenciales de WhatsApp productivas.
4. Para repetir 38/48, utilizar el runner contextual existente con `E2E_CASE_IDS=38,48`, la URL local de origen y un directorio de resultados nuevo. Sus controles clonan la base y comprueban que el origen no cambió.

No se implementó OCR ni lectura visual de comprobantes: la finalidad se infiere por contexto y el contenido queda para la tienda. Un archivo sin contexto se aclara. Los avisos se conservan como historial informativo, no como tareas pendientes de aprobación. La revisión real del archivo se hace en WhatsApp; no hay visor multimedia autenticado nuevo dentro de VIA.

Esta corrección no resuelve ni reclasifica los demás hallazgos de la campaña histórica de 50 (duplicación de otros handoffs, consultas y catálogo). Tampoco acredita una prueba de carga ni preparación general para producción.
