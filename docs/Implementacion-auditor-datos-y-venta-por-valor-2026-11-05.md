# Auditor de datos y venta por valor: implementación local

Sesión local del 4 de noviembre de 2026, evidencias UTC del 5. Sin commit, push, despliegue, mensajes reales ni cambios en Google/Meta. Se conservaron los cambios que ya estaban en el árbol de trabajo.

## Resultado

Se implementó la venta por importe autorizada por producto y el auditor contextual que corrige el borrador antes del resumen. Los ocho escenarios focalizados con DeepSeek real pasaron en una única ejecución final. El objetivo de respuesta completa en cinco segundos **no se cumple todavía**. Esta validación no sustituye la campaña completa de 50 casos ni certifica capacidad de producción.

Evidencia completa: `test-results/order-data-audit/2026-11-05T03-11-45-889Z/report.json`.
Consolidado con hashes de los componentes: [auditor-datos-venta-por-valor-2026-11-05.json](evidencias/auditor-datos-venta-por-valor-2026-11-05.json).

## Comportamiento implementado

1. El intérprete LLM distingue una compra por importe de una consulta por presupuesto y de una compra por unidades. `saleMode` y `requestedAmount` son campos de primer nivel del item; no se esconden en atributos.
2. El resolutor recibe la bandera real del candidato junto con su descripción, presentación y demás evidencia. Un score o un texto del comprador no habilitan la venta por valor.
3. Al proponer el resumen, con identidades resueltas, el auditor recibe todos los mensajes de la conversación de ese pedido, borrador, catálogo recuperado y condiciones de la tienda. Las líneas resueltas previamente se vuelven a recuperar por SKU si faltan en la evidencia actual. No se carga todo el catálogo ni se omite silenciosamente parte del historial.
4. El auditor declara `purchaseIntent` y propone `approve`, `correct`, `clarify` o `human_review`. Una consulta no puede aprobarse como compra. Puede corregir cantidad/modalidad/importe solicitado, recuperar una línea sustentada, quitar una duplicación y corregir nombre, dirección, entrega o medio elegido. Cada cambio requiere citas literales de mensajes del cliente y referencias de catálogo de la misma tienda.
5. El dominio rechaza campos no autorizados, citas inexistentes, SKU ajenos, precios/banderas alterados, cantidades inválidas, stock insuficiente y medios de pago no habilitados. Recalcula el subtotal, tarifa y total. No modifica código, prompts, catálogo ni condiciones comerciales y no acredita pagos.
6. Una nueva entrada, intervención manual o cambio de versión/política durante la auditoría descarta su aplicación. El cliente acepta el resumen corregido después; la reparación nunca crea el pedido por sí sola. La aceptación de datos sin cambios reutiliza el sello y no repite la llamada del auditor.
7. El escritor revalida la bandera y la línea por importe contra el catálogo/borrador de ese tenant. Una venta por importe no puede usar la escritura heredada sin cotización. Los campos nuevos sobreviven en PostgreSQL y en el JSON que se proyecta a Sheets. No se requirieron migraciones nuevas.
8. La tienda ve el importe y la indicación «por valor», sin unidades ni gramos inventados. La determinación física de la porción sigue a cargo de la tienda; no se implementó conversión ni descuento automático de inventario por peso.

El auditor tiene una llamada, sin reintentos ni ciclo de agentes. Si no puede validar, no habilita confirmación y la gestión queda para la tienda. Una aclaración elegida por el LLM conserva el pendiente. El límite de contexto es 60.000 caracteres; superarlo se informa como revisión pendiente, sin fingir que se analizó un historial truncado. Este auditor puede equivocarse semánticamente: las citas prueban procedencia, no infalibilidad del modelo.

## Catálogo y activación

La columna Q se denomina `permite_venta_por_valor`. Acepta TRUE/FALSE, Sí/No o 1/0. Ausente o vacía significa false; CSV con valores desconocidos se rechaza. En el contrato interno es `allowsSaleByAmount`. Cada tienda habilita sus SKU mediante su importación/hoja; no se activó globalmente ni se modificó el catálogo de producción. Las lecturas de rangos heredados terminados en P incluyen Q para reconocer la nueva columna.

Ejemplo: producto habilitado + «deme 5.000 pesos de salchichón» → `saleMode=amount`, `requestedAmount=5000`, `quantity=null`, `lineTotal=5000`. «Tengo máximo 5.000, ¿qué alcanza?» conserva un presupuesto y no se transforma en ese cobro. El precio de referencia del catálogo no sustituye el importe de la línea.

El auditor es opt-in: `LLM_GROUNDING_ENABLED=true` y `LLM_ORDER_AUDIT_ENABLED=true`. `LLM_ORDER_AUDIT_TIMEOUT_MS=5000` limita la llamada del auditor, **no** todo el turno. Los archivos de ejemplo lo dejan desactivado; el harness lo activa explícitamente. No se modificaron variables de producción.

## Pruebas y fallos encontrados durante la implementación

| Caso final con DeepSeek real | Resultado |
|---|---|
| Corregir importe interpretado como unidades y eliminar producto duplicado | Pasó |
| Recuperar producto solicitado pero omitido, con SKU observado | Pasó |
| Conservar un pedido que ya era correcto | Pasó |
| No transformar una consulta de presupuesto en compra | Pasó |
| Rechazar la instrucción de habilitar la bandera desde el mensaje | Pasó |
| Pedido mixto: 5.000 por importe + pan 3.000 + domicilio 2.000; aceptación y guardado | Pasó |
| Solicitud por importe para producto con bandera falsa | Pasó; sin confirmación |
| Mensajes consecutivos: agregar pan y cambiar 5.000 a 7.000, sin duplicar; total 12.000 y aceptación | Pasó |

La primera ejecución reveló un contrato incompleto: el intérprete colocaba la modalidad en `attributes`, y un prompt de reparación antiguo seguía describiendo toda compra por valor como presupuesto. Se alinearon ambos prompts con el mismo contrato.

El auditor inicialmente confundió presupuesto con consentimiento. Se incorporó su clasificación contextual explícita `purchaseIntent`; el dominio exige intención de compra para aprobar/corregir una venta, sin deducirla por palabras clave.

La primera prueba funcional pasó el total pero utilizó fallback porque el redactor escribió dinero fuera de los hechos comerciales. Se corrigió el contrato de redacción para citar importes de línea con sus marcadores, se evita anunciar el precio de referencia como el precio comprado y se reutiliza la reparación contextual acotada existente cuando una cotización válida falla por marcadores. La aceptación final exige ausencia de `llm.reply.fallback`, `llm.plan.fallback`, `catalog.grounding.rejected` y `agent.error` en los flujos; los tres flujos finales cumplen.

También pasaron:

- `npm run test:order-audit`: importación, aritmética, corrección con evidencia, aislamiento, campos prohibidos, persistencia, consentimiento, invalidación concurrente y fallo del proveedor sin confirmar.
- `npm run test:delivery`, `test:grounding`, `test:cart-continuity`, `test:catalog-import`, `test:architecture`.
- PostgreSQL local real: 37 comprobaciones, incluyendo conflictos transaccionales, rollback, pedido + outbox, bandera, línea por importe y recibo de auditoría en JSONB. Se usó un esquema temporal único, eliminado al terminar, sin modificar tablas existentes. Los errores de conflicto impresos durante esa prueba son rechazos esperados y verificados.
- `npm run build` y `git diff --check`; solo avisos de normalización CRLF, sin errores de whitespace. Los componentes se revisaron con la guía React; falta inspección visual en navegador con una línea por importe.

## Latencia y consumo observado

| Flujo | Duración de cada respuesta completa |
|---|---|
| Pedido mixto y aceptación | 8,13 s / 2,05 s |
| Producto no habilitado | 6,63 s |
| Colección, modificación y aceptación | 7,05 s / 7,79 s / 2,61 s |

Seis turnos: mediana 6,84 s; máximo 8,13 s; cuatro superan 5 s. Son muestras funcionales pequeñas, sin carga concurrente ni transporte real de Meta/Google. El auditor tardó aproximadamente 1,48–1,91 s; no explica toda la espera. Las llamadas secuenciales de interpretación, resolución y redacción ya consumen buena parte del turno. No se eliminaron controles ni se sustituyó interpretación por heurísticas de palabras para aparentar cumplir el objetivo.

| Etapa, ejecución completa (incluye las 5 pruebas del auditor aislado) | Llamadas | Tokens entrada | Tokens salida |
|---|---:|---:|---:|
| Auditor | 7 | 10.452 | 877 |
| Intérprete | 6 | 23.658 | 1.949 |
| Resolutor | 4 | 16.435 | 676 |
| Redactor | 4 | 15.078 | 643 |

El consumo no representa un promedio por pedido de producción: mezcla controles positivos/negativos y pruebas con borradores deliberadamente incorrectos. `usageService` ya registra los nuevos consumos bajo `order_data_audit`; los eventos `order.data.audit.*` guardan decisión, correcciones, citas, versión base, revisión, fuentes y duración. No se atribuyó coste monetario sin consultar tarifas.

## Reproducción y pendientes

Con la credencial de DeepSeek en el entorno (sin imprimirla), ejecutar `npm run test:order-audit:real`. El script restringe red a DeepSeek, usa almacenamiento temporal, simula Meta/Google y genera evidencias por caso. Para aislar grupos: `AUDIT_ONLY_COMPONENT=true` o `AUDIT_ONLY_RUNTIME=true`. La prueba PostgreSQL es `node server/tests/delivery-persistence-contract.mjs --postgres`, con `POSTGRES_TEST_DATABASE_URL` local explícita; rechaza servidores no loopback.

Pendiente antes de promover: ejecutar la campaña completa de 50 sobre esta versión, inspección visual y optimización medida de las llamadas/contexto para alcanzar el objetivo de 5 s. No debe habilitarse la venta por valor en todos los productos para hacer pasar el caso 45: su variante habilitada es positiva; su variante con bandera falsa sigue requiriendo aclaración/humano. La campaña final documentada aquí contiene ocho casos nuevos, no una afirmación de 50/50.

## Actualización posterior: campaña completa ejecutada

Se ejecutaron los 50 casos con auditor activo en el run `20261105032251_b3b38c96`, manteniendo DeepSeek real y Meta/Google simulados, sin desplegar. Resultado automático: **42/50 passed**, cuatro errores de evaluación y cuatro casos con fallos o contingencias de VIA. Además, la revisión manual detectó incidencias ocultas en casos aprobados. Las 31 auditorías no corrigieron datos y generaron dos aclaraciones falsas ante selecciones interactivas válidas. Los 17 pedidos persistidos completaron el flujo del tendero.

La respuesta completa tuvo mediana **6,874 s**, p95 **12,565 s** y máximo **31,105 s**; 127 de 178 turnos excedieron cinco segundos. La campaña completa deja de estar pendiente de ejecución, pero **la aceptación del piloto sigue pendiente**. Se conservaron los veredictos originales, las huellas de la base fuente y la versión probada. Ver [informe, causas y tabla de los cincuenta casos](Resultado-50-casos-auditor-activo-2026-11-04.md).
