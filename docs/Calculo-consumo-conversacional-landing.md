# Calculo de consumo conversacional y promesa comercial

Actualizado: 2026-10-15.

## Objetivo

Medir, con la evidencia conversacional cargada en el repositorio, cuantas interacciones consume un domicilio y revisar si la promesa vigente de `400 domicilios`, con un costo interno objetivo de `US$3` para DeepSeek, es sostenible.

> **Decision vigente:** este documento conserva analisis historicos de escenarios de `1.000` domicilios y `8.000` interacciones, pero esos valores ya no son la configuracion comercial objetivo. La referencia actual es Plan Basico de `COP 89.000`, hasta `400 domicilios`, aproximadamente `2.700` llamadas reales al LLM para mantener un costo interno cercano a `US$3` en escenario peak, y hasta `5.000` como limite tecnico superior de proteccion si se conserva.

Este documento es una estimacion para ajustar el producto y el mensaje comercial. No es un benchmark universal del mercado ni una garantia de resultado para cada tienda.

## Fuente y alcance

Fuente principal:

- `docs/Analisis-interacciones-whatsapp-supermarket.md`
- Archivo original: `.analysis/whatsapp-supermarket/Chat de WhatsApp con SuperMarket.txt`

La fuente contiene una conversacion real de una tienda. Se agruparon los mensajes en sesiones usando una pausa de 90 minutos como separador.

El analisis anterior documenta `365` sesiones y `356` sesiones con pedido o consulta de domicilio. Al reproducir el calculo con un clasificador heuristico explicito se obtuvieron `352` sesiones con comportamiento de pedido. La diferencia se conserva como incertidumbre metodologica; no se presenta una cifra unica como verdad absoluta.

## Resultado observado

### Todas las sesiones

| Indicador | Resultado |
| --- | ---: |
| Mensajes totales | 4.278 |
| Mensajes del cliente | 2.547 |
| Mensajes de la tienda | 1.731 |
| Sesiones | 365 |
| Mensajes totales por sesion | 11,72 |
| Mensajes del cliente por sesion | 6,98 |
| Mensajes de la tienda por sesion | 4,74 |

### Sesiones clasificadas como pedido o consulta de domicilio

La clasificacion busca senales de domicilio, pedido, productos, pago, direccion o cierre. Es una aproximacion reproducible, no una lectura manual perfecta.

| Indicador | Promedio | Mediana | Percentil 75 |
| --- | ---: | ---: | ---: |
| Mensajes totales por pedido | 11,95 | 10 | 14 |
| Mensajes del cliente por pedido | 7,11 | 6 | 8 |
| Mensajes de la tienda por pedido | 4,85 | 4 | 6 |

En las sesiones clasificadas se encontraron `352` casos, `2.501` mensajes del cliente y `1.707` mensajes de la tienda. La relacion observada fue de aproximadamente `0,68` mensajes de tienda por cada mensaje de cliente.

## Que cuenta hoy como interaccion

El contador comercial actual es `agent_interactions`. En el flujo de entrada, el backend registra una interaccion por mensaje recibido del cliente mediante `recordAgentInteraction`. Por eso, para esta comparacion se usa el promedio de mensajes entrantes del cliente, no la suma de mensajes de entrada y salida.

En la implementacion local, `includedInteractions=2.700` es la referencia economica del Plan Basico. No equivale a `2.700 conversaciones` ni a `2.700 domicilios`. Las referencias de `5.000` se conservan solo como historico/proteccion tecnica y no deben aparecer en el copy del cliente.

Referencias de implementacion:

- `server/services/usageService.js`
- `server/services/billingService.js`
- `server/services/saasControlPlane.js`
- `server/services/agentRuntime.js`

## Capacidad historica del limite de 5.000

Con `5.000` interacciones entrantes:

| Escenario | Mensajes cliente por pedido | Capacidad aproximada |
| --- | ---: | ---: |
| Promedio observado | 7,11 | 704 pedidos |
| Mediana observada | 6 | 833 pedidos |
| Escenario exigente p75 | 8 | 625 pedidos |

### Escenario alternativo: entrada mas salida

Si en el futuro se decidiera contar cada mensaje del cliente y cada mensaje de la tienda como una interaccion facturable, el consumo seria mayor:

| Escenario | Mensajes totales por pedido | Capacidad aproximada con 5.000 |
| --- | ---: | ---: |
| Promedio observado | 11,95 | 418 pedidos |
| Escenario exigente p75 | 14 | 357 pedidos |

Este no es el modelo actual, pero debe quedar documentado porque cambia sustancialmente la capacidad percibida del plan.

Esta tabla explica por que se abandono la combinacion historica de `1.000 domicilios + 5.000 interacciones`; no describe la promesa vigente.

## Interacciones necesarias para 1.000 domicilios

> **Nota:** esta seccion es historica y se conserva para entender por que se abandono la promesa anterior de 1.000 domicilios. No representa el Plan Basico vigente.

| Limite de interacciones | Promedio observado | Escenario p75 |
| ---: | ---: | ---: |
| 5.000 | 704 domicilios | 625 domicilios |
| 8.000 | 1.126 domicilios | 1.000 domicilios |
| 10.000 | 1.407 domicilios | 1.250 domicilios |

## Diagnostico comercial

La combinacion `1.000 domicilios + 5.000 interacciones` es internamente inconsistente si se comunica como capacidad conjunta. No significa que el producto falle: significa que uno de los dos limites puede detener la operacion primero.

La promesa `1.000 domicilios` solo es defendible si:

1. se eleva el limite de interacciones a por lo menos `8.000`; o
2. se explica claramente que los `1.000 domicilios` son un techo comercial sujeto al limite de interacciones; o
3. se cambia la unidad comercial y se vende principalmente por interacciones, dejando los domicilios como indicador operativo.

## Recomendacion vigente

Para el Plan Basico recomiendo:

- comunicar hasta `400 domicilios` como promesa comercial;
- traducir el costo interno objetivo de `US$3` a aproximadamente `2.700` llamadas reales al LLM;
- conservar `5.000` solo como limite tecnico superior de proteccion, con alertas y escalamiento;
- instrumentar llamadas reales, tokens, cache y costo por tenant/conversacion;
- optimizar el flujo para reducir el promedio de `7,11` llamadas por domicilio a `6,75` o menos;
- alinear el plan persistido, el enforcement, la calculadora, Mercado Pago y la landing antes de publicar.

El parametro local ya fue alineado: `400` domicilios y `2.700` interacciones de referencia. La capacidad comercial y el costo final deben validarse con medicion real antes de publicar.

## Ajuste vigente de la promesa para la landing

No se debe publicar:

> 400 domicilios garantizados sin condiciones.

La formulacion simple recomendada es:

> Hasta 400 domicilios al mes por $89.000 COP. El resultado depende de la cantidad de mensajes y aclaraciones que necesite cada pedido.

En la explicacion interna de capacidad:

> El agente esta calibrado para ese volumen. Si un pedido necesita muchos cambios, aclaraciones o validaciones humanas, el consumo puede aumentar.

La calculadora de la landing debe preguntar por mensajes entrantes promedio por pedido o permitir seleccionar `6`, `8` o `10` mensajes. Debe mostrar capacidad estimada, no prometer ventas ni ahorro garantizado.

## Decision tecnica pendiente

La decision comercial y la alineacion local ya estan definidas: `400 domicilios`, `COP 89.000` y un costo interno objetivo cercano a `US$3`; `server/tests/autoservicio-plan.mjs` comprueba el plan y el trial. Falta medir una corrida real de DeepSeek y validar proveedores antes de publicar.

## WhatsApp Business: aplicacion frente a Platform/API

No son el mismo producto:

| Producto | Costo y limite relevante | Implicacion para Ventas IA |
| --- | --- | --- |
| WhatsApp Business App | Aplicacion gratuita para descargar y usar. Meta no publica un cupo mensual de mensajes para la aplicacion. Tiene integraciones limitadas. | Sirve para operacion manual, pero no es la base de la automatizacion multi-tenant. |
| WhatsApp Business Platform/API | Acceso programatico. Meta cobra por mensaje entregado segun categoria y mercado. | Es la ruta necesaria para webhook, agente, envio automatico y trazabilidad. |

La FAQ oficial de WhatsApp indica que, desde el `1 de octubre de 2026`, cada numero de telefono empresarial tiene `1.000 mensajes de servicio gratis por mes`; desde el mensaje `1.001` se aplica la tarifa publicada para el mercado. La tarifa no es un cobro de Ventas IA y debe ser pagada por el cliente en su cuenta de Meta.

Existe una diferencia de redaccion entre la FAQ fechada y algunos textos de la pagina general de precios que todavia describen la ventana de servicio de 24 horas como gratuita. Para presupuestar el producto se usa la regla mas conservadora: `1.000 mensajes de servicio gratuitos por numero`, y se debe confirmar el valor vigente en WhatsApp Manager antes de facturar a un cliente.

Fuentes oficiales:

- [FAQ de WhatsApp para empresas](https://whatsappbusiness.com/resources/faq/)
- [Precios de WhatsApp Business Platform](https://whatsappbusiness.com/products/platform-pricing/)

### Impacto en un plan de 1.000 domicilios

En la muestra, el negocio envia aproximadamente `4,85` mensajes por pedido en promedio y `6` en p75. Si las respuestas del agente salen por la Platform/API, los `1.000` mensajes gratuitos cubririan aproximadamente:

- `206` pedidos en promedio;
- `167` pedidos en un escenario p75.

Para `1.000` domicilios quedarian aproximadamente `3.849` mensajes de servicio facturables en el promedio o `5.000` en p75. El valor final depende de la tarifa que Meta aplique al numero colombiano, la moneda de facturacion, impuestos y cualquier proveedor intermediario.

Como referencia de planificacion, si la tarifa aplicable fuera `US$0,0008` por mensaje de servicio, el costo Meta seria cercano a:

| Escenario | Mensajes facturables | Costo referencial Meta |
| --- | ---: | ---: |
| 1.000 domicilios promedio | 3.849 | US$3,08 |
| 1.000 domicilios p75 | 5.000 | US$4,00 |

Este valor es una sensibilidad, no una tarifa contractual. La plataforma debe leer y mostrar el costo real de Meta cuando el cliente conecte su cuenta.

## Costo estimado de DeepSeek

### Correccion metodologica

La cifra de millones de tokens para 300 domicilios es una **proyeccion de estres**, no el consumo observado en las pruebas realizadas. Se obtuvo multiplicando el consumo de una llamada real por todos los mensajes entrantes estimados de 300 pedidos. No debe presentarse como dato historico.

La evidencia disponible en el repositorio dice:

| Evidencia | Pasos | Consumo real de DeepSeek |
| --- | ---: | ---: |
| Matriz Colombia | 50 escenarios / 57 pasos | `0`: usa `codex_simulated_deepseek` |
| Pruebas Codex CLI | 6 pasos | `0`: usa `codex_cli_simulated_deepseek` |
| Pruebas DeepSeek reales | 6 pasos | API alcanzada; el runner ya captura `usage` por caso y falta validar una nueva corrida real |
| Smoke DeepSeek documentado | 1 llamada | `2.350` tokens reportados |
| Backend local actual | Consulta de uso | `0` tokens para el tenant `andina`; esta instancia esta en simulador Codex |

Por esta razon, no existe evidencia para afirmar que ya se consumio un millon de tokens en las pruebas. Para 40 casos de un solo paso, usando solo como referencia el smoke de 2.350 tokens, el maximo teorico equivalente seria aproximadamente `94.000` tokens; si se ejecutaron con Codex o con el parser local, el consumo de DeepSeek fue `0`.

El smoke real documentado en el repositorio reporto por llamada:

- `1.904` tokens de entrada;
- `446` tokens de salida;
- `2.350` tokens totales.

El runtime realiza una planificacion LLM por mensaje entrante del cliente. Por tanto, el costo por domicilio se estima multiplicando ese consumo por los `7,11` mensajes entrantes promedio o por los `8` mensajes del p75.

La documentacion oficial vigente de DeepSeek publica para `deepseek-flash`, por cada millon de tokens:

| Modelo | Entrada cache miss off-peak | Salida off-peak | Pico |
| --- | ---: | ---: | ---: |
| `deepseek-flash` | US$0,15 | US$0,60 | El doble de cada tarifa |
| `deepseek-v4-pro` | US$0,66 | US$1,98 | El doble de cada tarifa |

La entrada con cache tiene una tarifa mucho menor, pero no se asume cache para el presupuesto. DeepSeek indica que los precios pueden cambiar y que el costo se descuenta por uso real.

Fuente oficial: [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/).

### Costo DeepSeek estimado por capacidad

Usando el consumo medido de `2.350` tokens por llamada:

| Cobertura | Llamadas LLM estimadas | DeepSeek Flash off-peak | DeepSeek Flash pico | DeepSeek Pro off-peak |
| --- | ---: | ---: | ---: | ---: |
| 1.000 domicilios promedio | 7.105 | US$3,93 | US$7,86 | US$15,20 |
| 1.000 domicilios p75 | 8.000 | US$4,43 | US$8,85 | US$17,12 |

Estos valores no incluyen un posible aumento de tokens de razonamiento. Por eso el presupuesto debe agregar una reserva de `30%` y registrar siempre `input_tokens`, `output_tokens`, `reasoning_tokens`, cache hit y cache miss.

### Riesgo de la configuracion actual

El repositorio tiene el motor global configurado como `deepseek-chat`, mientras que la documentacion vigente presenta `deepseek-flash` como nombre actual. Antes de produccion se debe validar la compatibilidad del alias y normalizar el modelo a `deepseek-flash` si la API lo requiere. El endpoint actual de Chat Completions puede conservarse si el proveedor lo mantiene, pero el nombre del modelo no debe darse por permanente.

## Propuesta economica y operativa

### Propuesta vigente para el Plan Basico

1. Comunicar hasta `400 domicilios` por ciclo y controlar el costo interno con aproximadamente `2.700` llamadas reales al LLM.
2. Usar `deepseek-flash` como motor global principal, con control de tokens y presupuesto por tenant.
3. No incluir el costo de Meta en la suscripcion: cada cliente paga su WhatsApp Business Platform directamente.
4. Mostrar al cliente, durante onboarding, los `1.000 mensajes de servicio gratuitos por numero` y advertir que Meta cobra el excedente.
5. No usar `deepseek-v4-pro` para cada mensaje. Reservarlo para casos ambiguos o escalados si las pruebas demuestran valor; de lo contrario, el costo puede multiplicarse aproximadamente por cuatro.
6. Agregar un margen operativo de seguridad de `30%` sobre el costo LLM observado.
7. Alertar al administrador cuando un tenant supere `70%`, `85%` y `100%` del consumo de interacciones o tokens.

### Costo variable de referencia del plan vigente

Para `400` domicilios, usando la referencia de `2.844` llamadas IA promedio y la tarifa de DeepSeek documentada solo como sensibilidad:

| Componente | Off-peak | Pico |
| --- | ---: | ---: |
| DeepSeek Flash | US$1,57 | US$3,15 |
| Objetivo optimizado de 2.700 llamadas | US$1,49 | US$2,99 |
| WhatsApp Platform despues del cupo gratuito, referencia | Lo paga el cliente a Meta | Lo paga el cliente a Meta |
| Costo interno objetivo de IA | **Menor a US$3** | **Cercano a US$3** |

No se incluyen hosting, Google, impuestos, Mercado Pago, soporte humano, almacenamiento ni comisiones de terceros. El costo de WhatsApp debe salir de la cuenta del tenant y no del margen de la plataforma.

## Promesa comercial resultante

No publicar:

> WhatsApp gratis e ilimitado, con 400 pedidos garantizados sin condiciones.

Publicar:

> Hasta 400 domicilios al mes por $89.000 COP. WhatsApp puede cubrir aproximadamente los primeros 200 domicilios con su saldo gratuito; cualquier cobro adicional de Meta lo pagas directamente a Meta.

La landing debe mostrar la cifra como capacidad estimada y explicar que un pedido con cambios, aclaraciones o productos agotados consume mas mensajes. El ahorro de tiempo, las ventas y el numero de domicilios no deben presentarse como garantizados.

## Recalculo solicitado: una llamada por respuesta de SuperMarket

El archivo real fue dividido en bloques operativos de 90 minutos y cada mensaje de `SuperMarket` fue contado como una llamada hipotetica independiente a DeepSeek. El detalle reproducible esta en `docs/Analisis-pedidos-y-llamadas-deepseek-supermarket.md` y en `.analysis/whatsapp-supermarket/`.

| Indicador | Resultado |
| --- | ---: |
| Respuestas de `SuperMarket` en todo el archivo | 1.731 |
| Bloques con pedido o consulta identificable | 360 |
| Bloques con respuesta de la tienda | 354 |
| Llamadas hipoteticas en bloques con pedido/consulta | 1.730 |
| Promedio por bloque con respuesta | 4,89 |
| Mediana | 4 |
| Percentil 75 | 6 |

Usando el smoke test real de `2.350` tokens como referencia, no como medicion historica individual:

| Escenario de 300 domicilios | Llamadas | Tokens estimados |
| --- | ---: | ---: |
| Promedio observado | 1.466 | 3.445.339 |
| Percentil 75 | 1.800 | 4.230.000 |

Con la tarifa vigente de `deepseek-flash` y el reparto observado de `1.904` tokens de entrada y `446` de salida por llamada, el costo estimado de DeepSeek seria:

| Escenario | Off-peak | Peak |
| --- | ---: | ---: |
| Promedio observado | **US$0,81** | **US$1,62** |
| Percentil 75 | **US$1,00** | **US$1,99** |

Se calcula con entrada sin cache a `US$0,15 / 1M` y salida a `US$0,60 / 1M` en off-peak; en peak ambas tarifas se duplican. No incluye impuestos ni cache hit.

Este recalculo responde a la hipotesis historica solicitada. El runtime actual planifica por mensaje entrante del cliente, no por respuesta de la tienda; por eso la proyeccion de `5,01` a `5,64` millones que aparece abajo sigue siendo la sensibilidad del comportamiento de la arquitectura vigente. No se deben sumar ambas cifras ni presentarlas como si fueran llamadas simultaneas: son dos modelos de conteo distintos.

## Escenario de 300 domicilios

### Consumo conversacional del agente

Como proyeccion de estres, si cada mensaje entrante de 300 domicilios dispara una llamada LLM con exactamente el mismo consumo del smoke (`1.904` tokens de entrada y `446` de salida), el escenario quedaria asi:

| Escenario | Mensajes entrantes | Llamadas LLM | Tokens de entrada | Tokens de salida | Tokens totales |
| --- | ---: | ---: | ---: | ---: | ---: |
| Promedio observado | 2.132 | 2.132 | 4,06 millones | 0,95 millones | 5,01 millones |
| Escenario p75 | 2.400 | 2.400 | 4,57 millones | 1,07 millones | 5,64 millones |

Por tanto, `5,01` a `5,64` millones es una **proyeccion bajo esa hipotesis**, no una medicion de las pruebas actuales. Un escenario de 300 pedidos de un solo mensaje por pedido equivaldria a aproximadamente `705.000` tokens con el mismo consumo por llamada.

El dato definitivo debe salir de DeepSeek en cada respuesta y guardarse por tenant, conversacion y caso de prueba. El runner ahora copia `providerMetadata.usage` al JSON de resultados; falta ejecutar una corrida real controlada para verificar la respuesta del proveedor y sustituir el baseline estimado.

Con DeepSeek Flash, el costo LLM de referencia seria aproximadamente:

| Escenario | Off-peak | Pico | Con reserva LLM del 30% |
| --- | ---: | ---: | ---: |
| Promedio observado | US$1,18 | US$2,36 | US$1,53 / US$3,07 |
| Escenario p75 | US$1,33 | US$2,66 | US$1,73 / US$3,45 |

### Consumo del cupo gratuito de WhatsApp Platform

El negocio envia aproximadamente `4,85` mensajes por pedido en promedio y `6` en p75. Para `300` domicilios:

| Escenario | Mensajes de servicio enviados | Mensajes sobre el cupo gratuito de 1.000 |
| --- | ---: | ---: |
| Promedio observado | 1.455 | 455 |
| Escenario p75 | 1.800 | 800 |

Conclusiones:

- `300` domicilios si caben dentro de `5.000` interacciones entrantes del plan actual.
- `300` domicilios no quedan completamente cubiertos por los `1.000` mensajes de servicio gratuitos de WhatsApp Platform si el agente envia respuestas automaticas con el comportamiento observado.
- Para mantenerse dentro del cupo gratuito, el flujo tendria que promediar como maximo `3,33` mensajes de salida por pedido.
- Si se desea mantener una promesa de 300 domicilios, el tenant debe registrar metodo de pago en Meta y aceptar el excedente de mensajes.
- Si se desea una promesa sin costo adicional de Meta, el limite comercial deberia estar cerca de `150` domicilios en p75 o `200` en promedio.

### Propuesta para comunicarlo

No comunicar:

> 300 domicilios gratis por WhatsApp.

Comunicar:

> Prueba la operacion con hasta 300 domicilios y el consumo estimado de tu agente. WhatsApp Business Platform se conecta por separado; Meta incluye 1.000 mensajes de servicio por numero al mes y cobra el excedente directamente al negocio.

La prueba gratuita puede limitarse a `150` domicilios para reducir la probabilidad de exceder el cupo de Meta en un escenario p75. El plan comercial de `300` domicilios debe tratarse como un plan que requiere WhatsApp Platform activa y metodo de pago registrado.
