# Evidencia P9 — replay E2E con DeepSeek real

Fecha: 2026-11-04
Run final: `20261104152951_d4af6f21`
Evidencia: `test-results/e2e-local/20261104152951_d4af6f21/`

## Controles de infraestructura

| Control | Resultado |
|---|---|
| Casos ejecutados | 40/40 |
| DeepSeek real (`provider_api`) | PASS |
| Meta/Graph | Simulado localmente |
| Red externa prohibida | 0 salidas bloqueadas |
| Huella de `ventas_ia_dev` | Sin cambios |
| p95 acuse webhook | 16 ms |
| p95 procesamiento worker | 5.132 ms |
| Llamadas DeepSeek | 181 |
| Tokens DeepSeek | 112.025 |
| Promedio de tokens por caso | 2.801 |
| Listo para piloto local | SI |

## Resultado funcional

- 40 casos aprobados.
- No hubo fallos funcionales en la matriz, autenticación, clonación, Meta simulado, deduplicación ni procesamiento asíncrono.

### Correcciones verificadas en la matriz final

#### Caso 34 — cantidades faltantes

El agente interpretó y resolvió correctamente `Chocoramo` y `Agua Cristal sin gas de 600 ml`, y pidió las cantidades antes del pago. El fallo fue del oráculo de la matriz: la aplicación persistió la hipótesis de recuperación `agua embotellada sin gas`, mientras la expectativa comparaba literalmente `Agua Cristal sin gas 600ml`. Se ajustó la aserción para validar el mismo ítem semántico mediante el borrador, no por igualdad de etiquetas.

#### Caso 35 — lista de despensa sin cantidades

DeepSeek devolvió `catalog_query` para `Necesito arroz, aceite y huevos AA x12`, por lo que el runtime mostró opciones de catálogo en lugar de abrir una solicitud de domicilio y pedir cantidades. Se ajustó el prompt del intérprete para reconocer expresiones de compra como `necesito`, `quiero llevar`, `me haces un mercado` y listas de productos como `delivery_order`, conservando los productos y marcando los campos faltantes.

La prueba focalizada y el replay final con DeepSeek real devolvieron:

- `intent=delivery_order`;
- tres productos interpretados;
- cantidades faltantes para los tres;
- `executionMode=provider_api`.

#### Caso 14 — antojo dulce y ranking contextual

La búsqueda amplia por categoría devolvía referencias del inventario, pero el ranking podía presentar primero snacks salados aunque el cliente hubiera pedido «algo dulce». Se ajustó únicamente la relevancia de presentación: además de la consulta y el texto del cliente, usa las señales semánticas ya producidas por DeepSeek (`occasion`, `categoryHint`, `presentationSignal`) para ordenar candidatos. No se agregó un SKU ni una respuesta fija.

La ejecución final presentó referencias coherentes con el antojo, entre ellas Maní confitado, Arequipe Alpina familiar y Bocadillo veleño.

## Telemetría final

| Métrica | Resultado |
|---|---:|
| Llamadas al planner | 48 |
| Llamadas al compositor | 47 |
| Tokens planner | 64.478 |
| Tokens compositor | 47.547 |
| Promedio tokens por llamada | 1.179 |
| p95 planner | 3.066 ms |
| p95 compositor | 1.717 ms |

El flujo operativo de tendero también pasó: visualizar tarea, tomar pedido, alistar, marcar en camino, notificar al cliente, cerrar la conversación y aceptar un mensaje posterior como una nueva conversación/pedido.

## Criterio de cierre

P9 queda cerrada para validación local: la matriz final obtuvo 40/40, la fuente PostgreSQL quedó intacta y DeepSeek se consumió mediante `provider_api` real. Esto habilita el siguiente paso de revisión para piloto, pero no constituye por sí solo un despliegue ni aprobación para producción.

No se hizo commit, push ni despliegue.
