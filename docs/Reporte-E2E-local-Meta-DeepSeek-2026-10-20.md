# Reporte E2E Local: Meta Simulada y DeepSeek Real

Fecha: 2026-10-20

## Resultado

La corrida `20261020222223_6c769366` ejecutó los 40 escenarios oficiales con un clon de PostgreSQL local, el contrato HTTP/HMAC de Cloud API de Meta simulado, actor cliente, actor tendero y DeepSeek real para planificación y composición de respuestas.

| Control | Resultado |
| --- | --- |
| Casos ejecutados | 40/40 |
| Casos aprobados | 13/40 |
| Llamadas reales a DeepSeek | 131 |
| Llamadas externas a Meta/WhatsApp | 0 |
| Base fuente sin cambios | Sí |
| Contratos Meta simulados | 5/5 aprobados |
| Listo para piloto autónomo | No |

La evidencia por escenario, el JUnit y el resumen de la corrida están en `test-results/e2e-local/20261020222223_6c769366/`. Este directorio se ignora en Git para no versionar conversaciones, identificadores de prueba ni respuestas de IA.

## Qué quedó validado

1. El webhook acepta el challenge válido, rechaza el token y la firma HMAC inválidos, ignora estados de entrega y resuelve el tenant a partir de `phone_number_id`.
2. La respuesta inicial del webhook se confirma antes del procesamiento asíncrono; los inbound se procesaron mediante la outbox y se deduplicó el reenvío intencional del mismo `wamid`.
3. El planner y el compositor utilizaron DeepSeek `provider_api`; no hubo simulador ni fallback en la ejecución final.
4. El flujo del tendero puede tomar el pedido y llevarlo a `preparing` y `dispatched` a través de los endpoints operativos.
5. Los mensajes y listas interactivas de pago se capturaron como payloads Cloud API locales, sin abrir Graph API ni enviar un WhatsApp real.

## Correcciones realizadas antes de la corrida final

1. Se corrigió la validación de importes del compositor LLM: trataba un `Set` como arreglo y causaba `llm.reply.fallback` aun cuando DeepSeek había contestado correctamente.
2. La lista de métodos de pago ahora conserva en su cuerpo el resumen compuesto (productos, precios y subtotal), en vez de reemplazarlo por el texto genérico "¿Cómo prefieres pagar?".
3. El runner conserva eventos por paso y genera evidencia individual incluso si una corrida alcanza su límite de llamadas de IA. El límite predeterminado se ajustó a 160 para poder ejecutar los 40 casos.

## Brechas que bloquean el piloto

### P0: despacho no cierra la conversación ni notifica al cliente

El tendero marca el pedido como `dispatched`, pero la prueba comprobó que no se envía "va en camino", la conversación permanece `active/live` y un mensaje posterior reutiliza la misma conversación. Esto contradice el flujo objetivo: avisar al cliente, cerrar el pedido y abrir una conversación nueva ante una solicitud posterior.

### P0: resolución de catálogo puede cruzar productos

En pedidos con varios productos, el resolvedor puede asignar el mismo producto a solicitudes distintas. La evidencia muestra, por ejemplo, que una solicitud de Chocoramo y Cifrut llegó a contener dos Chocoramos. En otros casos sustituyó papel higiénico o productos de despensa por artículos no equivalentes. Un pedido no debe poder confirmarse cuando queda una coincidencia ambigua o de baja confianza.

### P1: cantidades y presentaciones incompletas

Cuando el comprador no indica cantidad, el agente algunas veces asume una unidad. Debe conservar `quantity:<producto>` como dato faltante, preguntar solo por esa cantidad y no calcular un subtotal confirmable hasta recibirla. Se detectaron también asociaciones de presentación incorrectas entre productos distintos.

### P1: consultas por categoría y recomendaciones

Las consultas de jugos, aseo, onces, lonchera y despensa responden con una selección parcial o de otra categoría. La búsqueda necesita conservar la intención de categoría, obtener candidatos del catálogo pertinente y responder con opciones suficientes antes de pedir cantidad.

### P2: métodos de pago duplicados

El tenant de prueba expone Bre-B dos veces. La configuración por tenant debe deduplicar por identificador de método antes de crear la oferta interactiva, sin limitar que el dueño agregue métodos propios.

## Orden recomendado de corrección

1. Implementar el efecto de `dispatched`: persistir estado, emitir aviso al cliente, cerrar conversación y verificar que el siguiente inbound cree un caso nuevo.
2. Endurecer la selección de producto: coincidencia por SKU/alias exacto por item, umbral de confianza y bloqueo de sustituciones automáticas.
3. Hacer obligatorias cantidad y presentación cuando la entrada no las contiene; no ofrecer pago ni confirmación hasta resolverlas.
4. Separar búsqueda por intención de categoría de la selección de un producto para cotizar.
5. Normalizar y deduplicar métodos de pago en la configuración del tenant.
6. Repetir la batería de 40 y exigir 40/40, los contratos Meta aprobados, DeepSeek `provider_api`, cero red externa y el flujo completo de tendero antes de declarar el piloto listo.
