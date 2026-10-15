# Analisis de pedidos y llamadas DeepSeek del chat SuperMarket

Actualizado: 2026-10-15.

## Objetivo

Revisar el archivo real de WhatsApp de `SuperMarket`, dividirlo en unidades operativas y estimar el consumo de DeepSeek bajo esta hipotesis:

> Cada mensaje enviado por `SuperMarket` equivale a una llamada independiente a DeepSeek.

Esta hipotesis sirve para medir el comportamiento conversacional observado. No significa que el chat historico haya sido atendido por DeepSeek ni que sea exactamente el disparador del runtime actual.

## Fuente y metodo

Fuente:

- `.analysis/whatsapp-supermarket/Chat de WhatsApp con SuperMarket.txt`

El export no contiene un identificador de pedido. Por ello se uso una unidad operativa reproducible:

1. Se agrupan mensajes consecutivos mientras la pausa entre ellos no supere 90 minutos.
2. Cada bloque recibe un identificador `SM-PED-###`.
3. Se marca como `consulta_o_pedido` cuando contiene intencion de compra, producto, disponibilidad, domicilio, precio, pago o entrega.
4. Se marca como `sin_pedido_identificable` cuando no hay evidencia suficiente.
5. Cada respuesta de `SuperMarket`, incluidas respuestas multimedia omitidas, cuenta como `1` llamada hipotetica a DeepSeek.

El analisis es heuristico y auditable. No inventa un numero de pedido que no exista en la fuente. Una unidad puede contener una compra, una consulta y una correccion; para separar pedidos contables reales haria falta un dato adicional como comprobante, total o identificador de pedido.

El proceso reproducible esta en:

- `scripts/analyze-supermarket-orders.mjs`
- `.analysis/whatsapp-supermarket/pedidos-supermarket.json`
- `.analysis/whatsapp-supermarket/pedidos-supermarket.csv`
- `.analysis/whatsapp-supermarket/llamadas-deepseek-supermarket.csv`

## Resultado del archivo

| Indicador | Resultado |
| --- | ---: |
| Mensajes analizados | 4.278 |
| Mensajes del cliente | 2.547 |
| Respuestas de `SuperMarket` | 1.731 |
| Bloques operativos por pausa de 90 min | 365 |
| Bloques con pedido o consulta identificable | 360 |
| Bloques sin pedido identificable | 5 |
| Multimedia o mensajes eliminados | 721 |
| Llamadas DeepSeek hipoteticas, todo el archivo | 1.731 |
| Llamadas DeepSeek hipoteticas, bloques con pedido/consulta | 1.730 |

### Llamadas por pedido o consulta con respuesta de la tienda

Se excluyen solo los bloques que tienen intencion pero ninguna respuesta de `SuperMarket`, porque no generan una llamada bajo la hipotesis solicitada.

| Indicador | Resultado |
| --- | ---: |
| Bloques con pedido/consulta y al menos una respuesta | 354 |
| Llamadas hipoteticas totales | 1.730 |
| Promedio de llamadas por bloque | 4,89 |
| Mediana | 4 |
| Percentil 75 | 6 |
| Maximo | 16 |

Distribucion de llamadas por bloque:

| Respuestas de la tienda | Bloques |
| ---: | ---: |
| 1 | 8 |
| 2 a 3 | 117 |
| 4 a 6 | 154 |
| 7 a 9 | 51 |
| 10 o mas | 24 |

## Costo DeepSeek para 300 domicilios

Tomando como referencia la tarifa oficial de `deepseek-flash` y el reparto del smoke test (`1.904` tokens de entrada y `446` de salida por llamada), la proyeccion queda asi:

| Escenario | Tokens entrada | Tokens salida | Costo off-peak | Costo peak |
| --- | ---: | ---: | ---: | ---: |
| Promedio observado | 2.791.458 | 653.881 | **US$0,81** | **US$1,62** |
| Percentil 75 | 3.427.200 | 802.800 | **US$1,00** | **US$1,99** |

La tarifa aplicada es `US$0,15 / 1M` de entrada sin cache y `US$0,60 / 1M` de salida en off-peak; en peak ambas tarifas se duplican. No se asumio cache hit, descuentos adicionales, impuestos ni saldo promocional. DeepSeek publica la tarifa por separado para entrada con cache, entrada sin cache y salida.

Como referencia, si se usara `deepseek-v4-pro` en lugar de Flash, el mismo escenario costaria aproximadamente `US$3,14` off-peak o `US$6,27` peak en promedio; en p75, `US$3,85` o `US$7,70`.

Fuente oficial: [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/).

Lectura comercial: la conversacion tipica no consume una sola llamada. En la muestra, la mediana equivale a 4 llamadas hipoteticas y el 25% de los casos mas conversados llega a 6 o mas.

## Proyeccion a 300 domicilios

Usando la muestra historica y la hipotesis de una llamada por respuesta de la tienda:

| Escenario | Llamadas por domicilio | Llamadas para 300 | Tokens con baseline de 2.350 por llamada |
| --- | ---: | ---: | ---: |
| Promedio observado | 4,89 | 1.466 | 3.445.339 |
| Percentil 75 | 6 | 1.800 | 4.230.000 |

El baseline de `2.350` tokens por llamada proviene de una llamada real DeepSeek documentada en el smoke test del proyecto: `1.904` tokens de entrada y `446` de salida. No es una medicion de cada respuesta historica; es una referencia para convertir llamadas en una sensibilidad de costo.

La proyeccion anterior no debe confundirse con el consumo real de las pruebas:

- La matriz de 40 casos y la matriz Colombia usan simulacion local/Codex, por lo que el consumo real de DeepSeek fue `0`.
- Las pruebas Codex CLI tambien simulan DeepSeek localmente.
- Las pruebas DeepSeek reales alcanzaron la API. El runner fue actualizado para persistir `usage` por caso y falta repetir una corrida real controlada para validar el reporte.
- El backend local actual del tenant `andina` estaba en simulador y reportaba `0` tokens.

## Diferencia frente al runtime actual

El runtime implementado actualmente registra la interaccion y planifica por mensaje entrante del cliente. Por eso existen dos lecturas distintas:

### A. Medicion historica solicitada

`1 respuesta SuperMarket = 1 llamada DeepSeek`.

Resultado: `4,89` llamadas por bloque con pedido/consulta y una sensibilidad de `3,45 millones` de tokens para 300 domicilios en promedio.

### B. Comportamiento del runtime actual

`1 mensaje entrante del cliente = 1 planificacion LLM`, segun `server/services/agentRuntime.js`.

La misma muestra tiene aproximadamente `7,11` mensajes del cliente por bloque de pedido/consulta. Si cada uno tuviera el baseline de `2.350` tokens, la sensibilidad seria aproximadamente `5,01 millones` para 300 domicilios en promedio y `5,64 millones` en p75.

La cifra correcta para presupuesto de produccion dependera de la arquitectura que se decida conservar. No se debe usar la medicion historica de respuestas de la tienda para ocultar llamadas adicionales del runtime.

## Implicaciones para el producto

1. No conviene llamar al LLM por cada respuesta de salida de forma adicional. La respuesta debe ser el resultado del planificador que procesa el mensaje entrante.
2. Se deben registrar por llamada: `tenant_id`, conversacion, pedido, proveedor, modelo, `input_tokens`, `output_tokens`, `reasoning_tokens`, cache hit, cache miss, latencia y costo.
3. El pedido debe tener un identificador propio desde que aparece una intencion de compra. El cierre de la sesion de WhatsApp no debe ser el unico mecanismo de agrupacion.
4. Las nuevas solicitudes despues de un pedido cerrado deben abrir otro pedido, aunque el cliente sea el mismo.
5. Los mensajes multimedia omitidos deben conservarse como eventos y, si no hay vision productiva, escalar a decision humana; no deben hacerse pasar por productos identificados.
6. La promesa comercial debe usar un rango o un limite de interacciones, no afirmar que cada domicilio consume una cantidad fija de tokens.

## Validacion y limitaciones

La ejecucion se hizo localmente sin llamar a la API de DeepSeek, para no generar costo. El resultado es una medicion del archivo y una proyeccion. Antes de fijar precio o limite comercial, falta persistir el `usage` real de cada llamada del runner DeepSeek y repetir el analisis con conversaciones productivas del tenant.
