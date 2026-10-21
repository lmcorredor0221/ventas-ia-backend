# Decisiones de landing y prueba gratuita

Actualizado: 2026-10-15.

Este documento consolida las respuestas dadas durante la sesion de definicion comercial y evita que las decisiones de la landing queden solamente en el historial conversacional.

## Objetivo de trabajo vigente

El objetivo no es construir una landing aislada. Es recopilar y ordenar la informacion necesaria para:

1. **Optimizar la plataforma para que sea autogestionable:** que un comercio no tecnico pueda registrarse, probarla, conectar Google Drive/Sheets, configurar WhatsApp, entender los costos y comenzar a operar con la menor asistencia posible.
2. **Construir una landing comercial honesta:** que explique esa experiencia, sus beneficios, limites, costos externos y siguiente paso sin prometer capacidades que la plataforma o las integraciones todavia no soportan.

Cada decision de copy, calculadora, onboarding, precio, limite, integracion y prueba debe servir a esos dos objetivos. La landing debe ser la puerta de entrada al autoservicio y el onboarding debe cumplir la promesa que la landing comunica.

## Objetivo original

Crear una landing muy comercial, clara y honesta para una persona no tecnica. Debe explicar:

- que hace la microapp;
- como funciona, paso a paso;
- para quien esta dirigida;
- por que utilizarla;
- cuanto tiempo puede ahorrar, usando supuestos transparentes;
- como puede mejorar la operacion del negocio;
- que incluye y que no incluye;
- como funciona la prueba gratuita;
- que necesita configurar el cliente;
- y que sucede despues de la prueba.

La landing debe poder respaldar sus afirmaciones con estudios, referencias de modelos SaaS y evidencia del propio producto. No debe prometer captacion de clientes ni incremento automatico de ventas, porque Ventas IA atiende los clientes que ya escriben por WhatsApp.

## Decisiones confirmadas por el usuario

### Publico objetivo

La landing atendera dos segmentos:

1. Tiendas de barrio, minimercados y comercios similares.
2. Panaderias, restaurantes, distribuidores y otros comercios que reciben pedidos por WhatsApp.

### Comprador y usuario

La comunicacion debe servir para ambos:

- el dueno que decide y paga;
- el administrador o persona que opera los pedidos.

No se debe escribir como si el comprador fuera necesariamente tecnico.

### Promesa comercial

No se afirmara que la plataforma capta clientes ni que garantiza vender mas.

La promesa base propuesta es operacional:

> Convierte los mensajes de WhatsApp de tu negocio en pedidos organizados, sin obligarte a responder cada conversacion manualmente.

La mejora de ventas solo puede presentarse como una consecuencia posible de responder mejor y no perder oportunidades que ya llegan al canal, nunca como una promesa garantizada.

### Llamado a la accion

El CTA principal sera:

> Probar gratis

### Plan y precio vigente

El repo confirma un unico plan SaaS activo como referencia inicial:

- **Nombre comercial:** Plan Basico.
- **Precio:** `COP 89.000` mensuales.
- **Domicilios configurados actualmente:** `400` por ciclo en el plan por defecto.
- **Interacciones tecnicas de referencia:** `2.700` por ciclo para el objetivo interno de DeepSeek; los `5.000` historicos no son la promesa comercial y no deben aparecer como beneficio del plan.
- **WhatsApp/Meta:** costo externo pagado directamente por cada cliente.

La capacidad comercial que se comunicara para el Plan Basico de `COP 89.000` es **hasta 400 domicilios**. El backend local ya esta alineado con ese limite y el costo interno se controla con una referencia separada de llamadas/tokens de IA.

Los `1.000` de Meta se comunicaran como **mensajes de servicio gratuitos de WhatsApp Business Platform por numero**, no como `1.000 mensajes entrantes` ni como interacciones incluidas en Ventas IA. Meta indica que cobra a las empresas por mensajes entregados por la empresa y que, desde el 1 de octubre de 2026, los primeros 1.000 mensajes de servicio mensuales por numero son gratuitos; el mensaje 1.001 queda sujeto a la tarifa publicada. Las respuestas de servicio se activan a partir de consultas entrantes y la categoria real debe validarse en WhatsApp Manager.

Fuentes oficiales: [FAQ de WhatsApp Business](https://whatsappbusiness.com/resources/faq/) y [precios de WhatsApp Business Platform](https://whatsappbusiness.com/products/platform-pricing/).

Por tanto, el plan debe mostrar tres contadores separados:

1. `Domicilios Ventas IA`: promesa comercial de hasta 400.
2. `Interacciones Ventas IA`: llamadas reales al LLM incluidas en el costo operativo objetivo. La referencia economica recomendada es aproximadamente `2.700` por ciclo; `5.000` debe conservarse, si se desea, como limite superior de proteccion contra abuso, no como equivalencia de 400 domicilios.
3. `Mensajes WhatsApp/Meta`: consumo externo del numero del cliente; referencia gratuita de 1.000 mensajes de servicio, sin que Ventas IA controle ni garantice el cobro de Meta.

No se debe cambiar `includedInteractions` a `1.000` por esta decision. Ese campo mide otra cosa en el backend y su referencia vigente local es `2.700`; antes de publicar se debe validar el consumo real con el proveedor.

### Que significa el limite de 5.000 interacciones internas

Para efectos economicos, una interaccion interna es una llamada real de planificacion o razonamiento al LLM para un tenant. No es:

- un domicilio;
- un mensaje gratuito de Meta;
- un mensaje saliente de WhatsApp;
- ni una conversacion completa.

El runtime actual usa aproximadamente un paso de planificacion por mensaje entrante y registra esa actividad en `agent_interactions`. Esa medicion funciona hoy como proxy, pero debe corregirse para registrar tambien si hubo llamada efectiva al LLM, tokens de entrada, tokens de salida y costo estimado. Los saludos, validaciones deterministicas, cache, agrupacion de mensajes y atencion humana no deben consumir una interaccion LLM si no hubo llamada al modelo.

Usando solo como referencia el smoke test de `2.350` tokens por llamada (`1.904` de entrada y `446` de salida), el costo estimado con `deepseek-flash` queda asi:

| Escenario | Tokens totales | DeepSeek off-peak | DeepSeek peak |
| --- | ---: | ---: | ---: |
| 2.700 llamadas | 6,35 millones | US$1,49 | US$2,99 |
| 2.844 llamadas, promedio observado para 400 domicilios | 6,68 millones | US$1,57 | US$3,15 |
| 3.200 llamadas, escenario p75 | 7,52 millones | US$1,77 | US$3,54 |
| 5.000 llamadas, limite superior de proteccion | 11,75 millones | US$2,77 | US$5,53 |

El valor de `2.700` se obtiene de `US$3 / US$0,0011064` por llamada en tarifa peak, usando el consumo de referencia. Es una cifra de control, no una garantia del proveedor. Si el producto quiere prometer estrictamente un costo interno maximo de US$3, debe optimizar el flujo para que 400 domicilios no superen ese limite.

Esto es un costo operativo estimado de la plataforma, no un cobro adicional al tenant en el modelo actual. Si el tenant usa Codex/simulador local, el costo DeepSeek es `US$0`, aunque las interacciones sigan registrándose para control de uso.

### Alineacion recomendada del Plan Basico

Para el plan de `COP 89.000` recomiendo separar asi la oferta:

- **Hasta 400 domicilios por ciclo:** promesa comercial principal.
- **Aproximadamente 2.700 interacciones LLM por ciclo:** referencia de costo interno maximo cercano a US$3 en escenario peak, antes de impuestos y sin contar infraestructura.
- **Hasta 5.000 interacciones tecnicas:** solo como limite superior de proteccion, con alertas y escalamiento; no debe venderse como consumo incluido equivalente a 400 domicilios.
- **1.000 mensajes de servicio Meta:** referencia externa por numero de WhatsApp del cliente; el excedente lo cobra Meta directamente.

La muestra de SuperMarket sugiere aproximadamente `7,11` mensajes entrantes por bloque de pedido/consulta. Por eso 400 domicilios consumirian cerca de `2.844` llamadas IA en promedio o `3.200` en p75. Esto excede la referencia economica de `2.700`, por lo que antes de publicar la promesa se debe reducir aproximadamente un 5,1% el numero de llamadas o el consumo de tokens por pedido. El limite de domicilios sigue siendo el limite comercial principal; las interacciones controlan el costo interno.

### Prueba gratuita

- Duracion definida: 7 dias.
- El periodo ya existe como parametro de la plataforma.
- Al terminar la prueba se debe solicitar la suscripcion para continuar utilizando la plataforma.
- La habilitacion de la prueba puede administrarse desde la plataforma.

### Datos minimos para iniciar

El boton `Probar gratis` solicitara solamente:

- nombre del negocio;
- nombre del usuario;
- autenticacion con Google.

No solicitara inicialmente direccion, datos tecnicos de WhatsApp ni configuraciones operativas. Esos datos se pediran despues, durante el onboarding guiado.

### Demostracion interactiva

La landing debe incluir una experiencia de prueba, no solamente texto:

- chat interactivo dentro del sitio;
- simulacion de una conversacion de pedido;
- posibilidad de probar con el catalogo propio del usuario;
- lenguaje simple y cercano;
- muestra de como el agente entiende, busca, pregunta y escala a humano.

### Catalogo de prueba

- La prueba comienza con un catalogo de ejemplo listo para usar.
- El usuario puede elegir `Usar mi catalogo` y cargar un CSV propio.
- La carga CSV sirve para demostrar el valor sin exigir configuracion tecnica inmediata.
- El catalogo operativo real pertenece al Google Drive/Sheets del cliente.
- La fuente principal debe ser el Drive del cliente.
- No se debe presentar un espejo local como si fuera la fuente oficial del comercio.
- Se definio soportar carga inicial mediante CSV para facilitar la prueba o preparacion del catalogo.
- La descripcion del producto es opcional.
- El tool de consulta de productos debe poder considerar nombre, marca, categoria, presentacion, descripcion y alias para buscar similares.

### Momento de conectar Google

- La demostracion comienza sin exigir OAuth de Google.
- El usuario puede probar el catalogo de ejemplo y cargar un CSV propio.
- La conexion real de Google Drive/Sheets se solicita despues de la demostracion inicial.
- OAuth de Google es obligatorio antes de activar WhatsApp y operar pedidos reales.
- El CSV de prueba no reemplaza el Google Drive/Sheets del cliente como fuente operativa.

### Estimacion de ahorro de tiempo

La landing incluira una calculadora interactiva. El usuario ingresara conversaciones diarias, pedidos aproximados y minutos manuales por conversacion. El resultado sera una estimacion personalizada de horas potencialmente recuperables.

La interfaz debe mostrar los supuestos y aclarar que se trata de una proyeccion, no de una garantia de resultado.

La capacidad del plan tambien debe explicarse con base en mensajes entrantes por pedido. El chat real analizado muestra un promedio de 7,11 mensajes del cliente por pedido o consulta y un percentil 75 de 8. Con la referencia economica de 2.700 llamadas IA, la capacidad seria de aproximadamente 380 domicilios en el promedio y 337 en el p75. Por eso la promesa de 400 domicilios exige optimizacion del runtime, no solo cambiar un numero en la interfaz. El detalle esta en `docs/Calculo-consumo-conversacional-landing.md` y `docs/Analisis-pedidos-y-llamadas-deepseek-supermarket.md`.

### Calculadora comercial de capacidad y costo

La landing debe incluir una calculadora visible, simple y explicativa. No debe presentar el cupo de Meta como si fuera el limite de Ventas IA.

#### Entradas

- `Domicilios al mes`: selector inicial con `100`, `200`, `300` y `400`.
- `Mensajes Meta promedio por domicilio`: valor inicial `4,89`, con opcion `p75 = 6`.
- `Interacciones IA promedio por domicilio`: valor inicial `7,11`, con opcion `p75 = 8`.
- `Mensajes de servicio incluidos por Meta`: valor inicial `1.000`.
- `Tokens por llamada DeepSeek`: valor de referencia `2.350`, presentado como estimacion.
- `Precio DeepSeek`: cargar tarifa vigente o permitir alternar `off-peak` y `peak`.

#### Calculos

```text
mensajesMeta = domicilios * mensajesMetaPorDomicilio
mensajesMetaExcedentes = max(0, mensajesMeta - mensajesGratisMeta)
domiciliosCubiertosMeta = mensajesGratisMeta / mensajesMetaPorDomicilio
llamadasDeepSeek = domicilios * interaccionesIAPorDomicilio
tokensDeepSeek = llamadasDeepSeek * tokensPorLlamada
```

Para el escenario inicial de `400` domicilios:

- Promedio: aproximadamente `1.956` mensajes Meta; `956` sobre el cupo gratuito.
- P75: `2.400` mensajes Meta; `1.400` sobre el cupo gratuito.
- DeepSeek: aproximadamente `2.844` llamadas y `6,68 millones` de tokens promedio usando la referencia de 2.350 tokens por llamada; costo estimado de `US$1,57` off-peak o `US$3,15` peak.
- Para mantener un tope interno estricto de `US$3` en peak, el objetivo debe ser `2.700` llamadas o menos, lo que requiere optimizar el promedio a `6,75` llamadas por domicilio.

#### Salidas para el usuario

La calculadora debe mostrar cuatro resultados, en este orden:

1. **Domicilios que puede operar la plataforma:** hasta 400.
2. **Mensajes estimados de WhatsApp:** por ejemplo, 1.956 de 1.000 incluidos por Meta.
3. **Mensajes que Meta podria cobrar:** por ejemplo, 956, pagados directamente por el cliente.
4. **Costo estimado del agente IA:** DeepSeek aproximado, separado de WhatsApp y sin presentarlo como precio definitivo.

Texto de ayuda obligatorio:

> WhatsApp cobra por mensajes y no por domicilios. La cantidad real depende de cuantas aclaraciones, cambios y respuestas necesite cada pedido.

La calculadora debe mostrar un rango promedio/p75 y no una garantia. Debe indicar que la tarifa de Meta depende de la categoria, el pais y las condiciones vigentes en WhatsApp Manager.

WhatsApp Business App y WhatsApp Business Platform/API deben explicarse como productos distintos. La aplicacion es gratuita y no publica un cupo mensual de mensajes; la Platform/API es la que permite automatizacion y webhook. Segun la FAQ oficial vigente, desde el 1 de octubre de 2026 cada numero empresarial tiene 1.000 mensajes de servicio gratuitos al mes y el excedente lo paga el cliente directamente a Meta. La suscripcion de Ventas IA no debe prometer WhatsApp gratis o ilimitado.

### Decision comercial de capacidad y WhatsApp

La promesa se separa en dos limites distintos:

- **Ventas IA:** hasta `400 domicilios` por ciclo, sujeto al uso conversacional del plan.
- **WhatsApp Business Platform:** Meta incluye `1.000 mensajes de servicio` por numero empresarial, sujeto a sus condiciones vigentes.

Con la evidencia del chat de SuperMarket (`4,89` respuestas promedio de la tienda por bloque con pedido/consulta), esos `1.000` mensajes representan aproximadamente `204 domicilios` en promedio. En un escenario p75 de `6` respuestas, representan aproximadamente `166 domicilios`.

Por eso no se debe decir que `200 domicilios` estan garantizados por WhatsApp. La formulacion aprobada para la landing sera:

> Hasta 400 domicilios al mes. Meta incluye aproximadamente 1.000 mensajes de servicio por numero de WhatsApp Business Platform; segun la duracion de las conversaciones, ese cupo suele cubrir cerca de 200 domicilios. Los mensajes adicionales son cobrados directamente por Meta al cliente.

El cliente paga a Meta cualquier excedente. Ventas IA no incluye ni adelanta ese costo. La plataforma debe mostrar el consumo estimado y real de mensajes, avisar en `70%`, `85%` y `100%`, y no bloquear automaticamente el pedido por superar el cupo gratuito de Meta.

Esta decision comercial no cambia por si sola los parametros tecnicos vigentes del backend ni el precio SaaS; esos cambios requieren una actualizacion separada del plan, el enforcement y la configuracion de Mercado Pago.

### Alineacion obligatoria antes de publicar

La promesa comercial de **400 domicilios al mes** todavia debe alinearse con la configuracion real del producto. Antes de publicar la landing o activar cobros se debe:

- cambiar el plan persistido de `1.000` a `400` domicilios, si esa es la decision aprobada;
- definir el limite de costo interno de DeepSeek y traducirlo a llamadas reales al modelo;
- registrar por tenant las llamadas, tokens y costo estimado del agente;
- optimizar el flujo para que 400 domicilios no superen el costo interno objetivo de `US$3`;
- actualizar la calculadora, las alertas, la interfaz, el enforcement y Mercado Pago;
- probar que el mensaje comercial, el cobro y los limites tecnicos muestran la misma informacion.

Mientras esto no se complete, los `400 domicilios`, los `2.700` llamados de IA y los `US$3` son una **propuesta de alineacion**, no una capacidad tecnica cerrada.

El costo de DeepSeek lo absorbe inicialmente la plataforma como costo operativo global. El repositorio tiene una llamada real documentada de 1.904 tokens de entrada y 446 de salida, pero la matriz principal y las pruebas Codex CLI fueron simuladas y no consumieron DeepSeek. Las cifras para 300 o 400 domicilios son proyecciones, no consumo histórico. Antes de convertirlas en promesa comercial, el runner real debe persistir tokens por caso, tenant y conversacion.

### Funcion de la IA

La landing debe explicar que el agente:

- entiende lenguaje cotidiano;
- consulta el catalogo antes de afirmar disponibilidad;
- arma una canasta;
- solicita cantidad, presentacion, nombre o direccion cuando falten;
- identifica productos similares;
- escala al humano cuando no puede inferir con seguridad, no encuentra el producto o hay problemas de stock;
- registra el pedido confirmado para que el tendero lo prepare y lo entregue.

No debe describirse como un chatbot que responde cualquier cosa sin control.

## Mensaje comercial simple

### Titular

> Recibe pedidos por WhatsApp sin estar pegado al celular.

### Subtitular

> El asistente entiende lo que tus clientes piden, revisa tus productos, arma el pedido y te avisa cuando necesitas intervenir.

### Explicacion corta

> Tu cliente escribe como siempre. El asistente le ayuda a elegir, confirma los datos y te entrega el pedido listo para preparar. Si algo no esta claro o un producto se agota, te avisa a ti.

### Promesa del Plan Basico

> Hasta 400 domicilios al mes por $89.000 COP.
>
> WhatsApp puede cubrir aproximadamente los primeros 200 domicilios con su saldo gratuito. Si se supera ese saldo, Meta cobra directamente al cliente.

### Como explicarlo en tres pasos

1. **Tu cliente escribe:** pide productos con sus propias palabras.
2. **El asistente organiza:** revisa el catalogo, confirma cantidades y pregunta lo que falte.
3. **Tu preparas y entregas:** recibes el pedido claro y te haces cargo cuando se necesita una decision humana.

En la landing no se deben mostrar como promesa comercial las palabras `tokens`, `interacciones LLM`, `peak`, `off-peak`, `enforcement` ni `costo de infraestructura`. Esos datos pertenecen al panel del administrador y a la documentacion tecnica. Para el cliente deben mostrarse domicilios, precio, alcance y costos externos de WhatsApp en lenguaje cotidiano.

Estas frases quedan como base de copy comercial simple. La capacidad solo puede publicarse cuando el plan persistido, la calculadora y los limites tecnicos hayan sido alineados.

## Estructura propuesta de la landing

1. Hero con la promesa operacional y CTA `Probar gratis`.
2. Ejemplo visible de una conversacion realista de tienda.
3. Explicacion simple del flujo: WhatsApp, agente, Google Sheets, canasta, humano y entrega.
4. Beneficios para el dueno: menos dependencia de responder cada mensaje, mayor visibilidad y control.
5. Beneficios para el operador: pedidos claros, datos completos y cola priorizada.
6. Demostracion con chat y catalogo de prueba.
7. Como funciona la prueba de 7 dias.
8. Que incluye y que paga aparte el cliente, especialmente WhatsApp/Meta.
9. Limites y casos que siempre pasan a humano.
10. Preguntas frecuentes y CTA final.

## Afirmaciones que requieren evidencia

No se debe publicar un numero de ahorro de tiempo sin explicar su calculo. La landing debe diferenciar:

- evidencia interna: pruebas del agente, chat real de SuperMarket y escenarios colombianos;
- evidencia externa: estudios sobre mensajeria empresarial, automatizacion y adopcion SaaS;
- estimacion comercial: calculo basado en conversaciones por dia, mensajes por pedido y tiempo manual por interaccion.

La investigacion de fuentes externas y la implementacion visual de las calculadoras quedan como trabajo de contenido y frontend. La formula de capacidad/costo de WhatsApp y DeepSeek ya esta definida en este documento.

## Pendientes que no deben darse por definidos

- cantidad tipica de conversaciones/pedidos por tienda y por dia;
- tiempo manual promedio por conversacion;
- validacion de la formula y los supuestos de horas ahorradas;
- si el usuario conecta Google antes o despues de probar el chat;
- si la carga CSV ocurre durante la prueba, en onboarding o en ambos momentos;
- columnas minimas y validaciones del CSV;
- alineacion final del Plan Basico de `COP 89.000`: 400 domicilios comerciales, limite de IA equivalente, costo interno objetivo de US$3 y reglas de WhatsApp/Meta;
- contenido exacto solicitado al terminar los 7 dias;
- testimonios, logos o resultados de clientes autorizados;
- fuentes externas definitivas para las afirmaciones comerciales.

## Orden de preguntas pendientes

Las preguntas se deben realizar una por una. Las decisiones de catalogo de prueba, Google y capacidad WhatsApp ya estan documentadas. El siguiente bloque es:

1. Definir la formula y los supuestos del ahorro de tiempo.
2. Definir el precio y la informacion mostrada al finalizar los 7 dias.
3. Investigar y seleccionar las fuentes externas que se citaran.
4. Construir la landing y las calculadoras con los supuestos aprobados.

## Siguiente paso recomendado

Construir primero la calculadora como componente aislado y probarla con estos escenarios: `100`, `200`, `300` y `400` domicilios, usando promedio y p75. Luego integrarla en la landing junto a la calculadora de ahorro de tiempo. El backend y los limites del plan no deben modificarse hasta cerrar precio, enforcement y Mercado Pago.

## Relacion con otros documentos

- `docs/Brief-comercial-microapp-Ventas-IA.md`: alcance y posicionamiento general.
- `docs/Seguimiento-consolidado-planes-vigentes.md`: tablero maestro de implementacion.
- `docs/Analisis-interacciones-whatsapp-supermarket.md`: evidencia conversacional real.
- `docs/Decisiones-Mercado-Pago-SaaS.md`: suscripcion, prueba, pagos y ciclo comercial.
