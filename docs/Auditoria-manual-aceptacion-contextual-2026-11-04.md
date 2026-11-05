# Auditoría manual de la aceptación contextual — 2026-11-04

Complementa los veredictos automáticos de la campaña `20261104182259_3869c026`. No cambia sus archivos ni convierte un pedido final correcto en aprobación de todos sus turnos. Se contrastaron diálogos, borradores, eventos y los campos completos de las 300 referencias locales.

## Hallazgos confirmados en los casos 01–21

| Caso | Evidencia observada | Clasificación |
|---|---|---|
| 01 | Evento `llm.plan.fallback`: `deepseek unavailable: fetch failed`. Se conserva el mensaje original en la atención humana, sin pedido. | Integración/proveedor; no demuestra incapacidad semántica del modelo. |
| 02 | Tras aclarar dos Cifrut y Chocoramo de 65 g, VIA conserva líneas anteriores y agrega otras. Cotiza $20.400 en vez de $12.000 (3 × $2.800 + 2 × $1.800). Termina persistiendo el pedido correcto. | Fallo real de integridad durante la conversación, aunque se recupere al final. |
| 03 | Dos paquetes de arepas pasan a cuatro/$26.000 y seis/$39.000. Tras corregirse vuelven a duplicarse al aportar datos de entrega y efectivo. El pedido final es de dos/$13.000. | Fallo real de memoria/cantidades y confirmación ofrecida con importe incorrecto. |
| 04 | El juez afirma que no se registró efectivo, pero el borrador conserva `paymentMethod: cash`. Pedido de dos paquetes/$13.000, identidad, dirección y flujo del tendero correctos. | Ese motivo automático de fallo es falso. La aceptación inicial de paquetes sin aclaración sigue siendo una observación separada, no resuelta por el pedido final. |
| 06 | Las marcas Origen Colombia y Sello Rojo existen en `COL-299` y `COL-300`. | La observación del juez sobre marcas inventadas no se sostiene. |
| 09 | Acuse del segundo mensaje: 4.472 ms, supera el objetivo local de 1.000 ms. Productos, medidas y precios válidos; sin pedido. | Rendimiento, no integridad comercial. |
| 14 | El comprador pregunta composición/sabores; VIA responde precios. Después el comprador sintético aporta la información que faltaba. | Calidad de respuesta no cubierta adecuadamente por el aprobado automático; contaminación del diálogo por el actor. |
| 15 | Cereal Corn Flakes `COL-202` tiene marca Kelloggs, presentación 300 g y precio $12.500. | Falso fallo del juez: no recibió el campo marca en la primera evaluación. |

Los defectos de duplicación 02/03 aparecen directamente en mensajes y borradores. No dependen de aceptar como verdadera una extracción del juez.

Evidencia original: [carpeta de casos](../test-results/contextual-v2-grounding/20261104182259_3869c026/cases). Catálogo completo: [expansión de catálogo](../server/data/colombiaCatalogExpansion.js). [Informe consolidado](Evidencia-aceptacion-contextual-v2-2026-11-04.md).

## Implicaciones para el instrumento

- El juez debe recibir también marca, aliases, familia, atributos y demás campos disponibles. Omitirlos genera acusaciones falsas de invención.
- Una cita inexistente, una identificación de SKU incierta o una cantidad extraída sin sustento exige revisión del evaluador; no prueba un error aritmético de VIA.
- Las cantidades duplicadas se deben comprobar también directamente sobre los borradores contra las preferencias del comprador, sin depender del juez.
- Los hechos aportados por el comprador sintético no pueden usarse para afirmar que VIA contestó una consulta que realmente omitió.
- La evaluación debe conservar turnos intermedios. Revisar solo el pedido final ocultaría los errores 02/03.

No se modificó la aplicación para estos hallazgos. Se deben reproducir y corregir sus causas después de cerrar las expectativas y la confiabilidad del instrumento.

## Hallazgos confirmados en los casos 22–32

| Caso | Evidencia observada | Clasificación |
|---|---|---|
| 22 | Al preguntar cuánto vale la leche, VIA sigue pidiendo pago. Después duplica la leche: $16.500 pasa a $21.300. | Fallo real de continuidad y duplicación. Los $16.500 anteriores sí eran correctos; actor y juez los cuestionan indebidamente. |
| 23 | El comprador devuelve `done:true, act:stop` al cerrar la colección. VIA ofrece la cotización correcta de $17.000, pero el ensayo termina antes de permitir confirmarla. | Ensayo incompleto por actor; no acredita un fallo de compra de VIA. |
| 24 | Al reiterar dirección y canasta se agrega un segundo yogurt: $9.700 pasa a $12.600. Se corrige y persiste yogurt + Festival por $9.700. | Duplicación real, recuperada después de intervención del comprador. |
| 25 | Dentro de «Savital en sobrecito» ofrece también la referencia de 180 ml, sin distinguirla como alternativa de formato. El sachet es de 18 ml. | Fallo funcional que el aprobado automático omitió; el comprador tuvo que corregirlo. |
| 29 | Cotización correcta de Coca-Cola original 1,5 L/$7.200. La cita del comprador incluye puntos suspensivos que no aparecen en el mensaje y el guard impide emitir la aceptación. | Error del actor/evaluador. No es un pedido comercial incorrecto ni prueba de incapacidad de VIA para crearlo. |
| 30 | Una botella de agua/$2.200, efectivo conservado, aceptación «Dale, hágale», pedido y tendero correctos. | La falta de repetición verbal del pago no demuestra pérdida de la preferencia. En esta corrida no hubo duplicación de agua. |
| 31 | La marca Sello Rojo sí está en catálogo; el límite de tres turnos impide evaluar una despedida posterior. Pasa de no poder confirmar café preparado a afirmar que no lo vende. | Separar límite del ensayo, falsa objeción de marca y afirmación no acreditada de disponibilidad. |
| 32 | Ofrece confirmar $15.000 con aceite pendiente; al recordárselo duplica aceite y cotiza $32.000. Termina con canasta correcta/$23.500. | Fallos reales de confirmación incompleta y duplicación. |

En 32, el juez también sumó dos alternativas de arroz aún no elegidas como si fueran compras simultáneas. Ese subtotal automático incorrecto es un defecto del evaluador, separado de los errores reales posteriores. El comprador aportó una medida de aceite de su preferencia privada que el título del botón no había transmitido: eso no prueba que VIA olvidara dicha medida; la necesidad de aceite sí estaba expresada.

En 26–28 no se encontró defecto crítico en esta revisión. El salmón ausente genera tarea humana. Los pedidos logrados en 24, 30 y 32 se persistieron después del consentimiento y con importes finales correctos.

## Frontera técnica que debe conservar el caso de regresión

En el caso 03, el primer borrador tiene `...3-1:item-1` con dos paquetes. La aclaración agrega `...3-2:item-1`, también con dos paquetes; posteriormente aparece `...3-4:item-1`. No es un precio mal calculado: son varias identidades para la misma necesidad reiterada. `applySemanticCart()` actualiza por `rawItemId` y agrega cuando no encuentra ese ID.

Esto localiza una frontera a investigar entre interpretación, normalización e integración del carrito. No demuestra todavía en cuál de ellas se originó cada ID incorrecto. El prompt ya pide conservar el ID de los productos existentes; la nueva prueba debe verificar el efecto observado, no aprobar por la mera presencia de esa instrucción.

La corrección futura debe distinguir mediante interpretación contextual entre reiterar/corregir una línea y pedir unidades adicionales. No corresponde resolverlo fusionando ciegamente todos los SKU iguales ni añadiendo palabras clave. Ambas operaciones pueden ser legítimas según lo que diga el cliente.

## Hallazgos confirmados en los casos 33–50

| Caso | Resultado contrastado |
|---|---|
| 33 | Pedido con errores de escritura completado correctamente. |
| 34 | Duplica Chocoramo y mantiene agua pendiente junto a otra agua: $7.800 frente a $5.000. Finalmente persiste correctamente. |
| 35 | Duplica huevos/aceite: $35.300 y $43.800 frente a $23.500. Luego corrige cantidades, pero omite el desglose unitario solicitado. No crea pedido. |
| 36 | Consulta respondida. El actor marca fin de conversación aunque su texto aún contiene una pregunta; VIA la responde. Debe corregirse el actor, sin inventar un fallo comercial. |
| 37, 39, 47 | Un agradecimiento crea otra solicitud humana pendiente para la misma conversación. Son falsos aprobados respecto a unicidad de tareas. |
| 38, 48 | No hay respuesta nueva al cliente; sí existe aprobación humana pendiente. El error posterior del juez no debe ocultar ese silencio. |
| 40 | Duplica un pan: $15.200 frente a $7.600. El actor también es demasiado rígido al exigir una frase sobre pago pendiente: VIA nunca afirmó haber recibido dinero. |
| 41 | El saludo no falla por sí mismo; el ensayo de apertura agota dos turnos sin terminal. Clasificar como cobertura/revisión, no como fallo demostrado del saludo. |
| 42 | Reiterar un resumen duplica tres Chocoramos: $16.800 frente a $8.400. El JSON inválido del juez es otro error y no es fallo de infraestructura de VIA. |
| 43 | Retiro del agua y pedido final correctos. El juez denuncia omisión del agua mientras su propia cita la incluye; esa objeción no es válida. |
| 44 | Agrega el queso correctamente, pero después duplica pan: $25.000 frente a $17.400. Ignora preguntas por el precio unitario y no corrige la canasta al final. |
| 45 | La aclaración de $5.000 de salchichón duplica ambas necesidades: $16.400 frente a $8.200. No resuelve la cantidad/peso ni escala. El primer $8.200 no era por sí solo error aritmético: incluía un importe solicitado por valor, no cantidad unitaria. |
| 46 | Pide transcribir la foto, sin inventar su contenido. No alcanza el handoff/adjunto que exige la ficha en dos turnos. Revisar la expectativa de aclaración vs escalamiento; no confundirla con alucinación visual. |
| 49 | Duplica la necesidad de ponqué de mora y la tarea humana. El texto resume Chocoramo como «sin coincidencia», aunque conserva opciones y cantidad tres en el contexto. No perdió toda la necesidad ni la instrucción de avisar antes de sustituir. |
| 50 | El actor cita una cotización anterior y el guard bloquea el envío. Nunca se emite «Sí veci, solo eso»; los dos hitos de interpretación quedan sin ejercitar. Es fallo de actor/cobertura, no una confirmación incorrecta ejecutada por VIA. |

Los nueve pedidos logrados en la campaña tienen flujo posterior de tendero aprobado. Esto no elimina los problemas intermedios ni demuestra continuidad de las excepciones humanas desde la interfaz.

## Ajustes del instrumento derivados de la revisión

La versión 2.1 debe recibir todo el catálogo, distinguir alternativas de líneas elegidas, considerar importes pedidos por valor, detectar duplicados en borradores y tareas humanas, y separar los errores de JSON/citas del evaluador. El comprador debe reconocer un resumen vigente repartido en varios mensajes; no exigir que todos los datos se repitan en una sola frase ni convertir restricciones internas del ensayo en preguntas técnicas al vendedor.

Las correcciones del actor no reescriben las conversaciones ya realizadas. Los casos cortados por el actor o sin cobertura del hito siguen pendientes de nueva ejecución; una reevaluación semántica no sustituye esa ejecución.

## Comprobación focalizada posterior del actor 2.1

Run `20261104191214_0d415b43`. Sin cambios al backend, se repitieron únicamente 23, 29, 40 y 50. Los casos 23, 29 y 50 crean pedidos y ya no presentan citas rechazadas ni interrupción prematura del comprador. El 40 vuelve a duplicar pan y no completa compra. La huella de la base fuente sigue intacta.

En 23, el juez exige haber recibido efectivo antes de crear el pedido y llega a llamar incorrecto a $17.000 mientras escribe el cálculo correcto de $9.800 + 2 × $3.600. Estas objeciones se contradicen con la política y la aritmética del ensayo: **aceptar el pedido no equivale a acreditar el pago**. La falta de desglose ante una pregunta concreta se revisa por separado.

En 50, el pedido se confirma, pero no aparece el hito previo de terminar colección con la misma frase. Su cobertura sigue pendiente. No mezclar los tres pedidos de esta comprobación con los nueve de la campaña principal ni reinterpretar el resultado automático como aprobación integral.

La auditoría de esta comprobación confirma pedidos de $17.000 (23), $7.200 (29) y $2.900 (50), todos con consentimiento y flujo del tendero correctos. En 29 y 50 persisten acuses de 3.332 y 3.876 ms. El botón «Tarjeta» solo transmite esa categoría: no prueba que se transmita el subtipo débito que figuraba en el texto privado del actor.

En 40, el comprador termina coherentemente solicitando una persona después de que VIA no respondiera si el domicilio estaba incluido. La tarea existe, pero su snapshot inmediato contiene acción/botón; motivo y canasta requieren consultar conversación/borrador vinculados. Esto queda como brecha de contexto para el tendero, no como abandono injustificado del actor.
