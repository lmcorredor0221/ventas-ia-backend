# Saludos colombianos, contexto e identidad por tienda

## Objetivo y alcance

Complemento de `Correccion-saludos-2026-11-03.md`. El intérprete distingue un saludo de una solicitud comercial por el significado del mensaje y la conversación. El nombre predeterminado del asistente es **Rocío**, configurable por cada tienda. No se añade un clasificador de palabras clave ni se reemplaza el intérprete/resolutor existente.

Fuentes lingüísticas consultadas:

- [ASALE: quiubo](https://www.asale.org/damer/quiubo): documenta el uso de esta fórmula de saludo en Colombia y otros países, derivada de «qué hubo».
- [Marca País Colombia: expresiones de bienvenida](https://colombia.co/en/colombia-travel/unique-experiences/colombia-the-most-welcoming-country-in-the-world): recoge «quiubo», «qué más» y «cómo está» como saludos cotidianos.

Las fuentes respaldan ejemplos, no una equivalencia obligatoria entre una palabra y una intención. Los escenarios siguientes son casos de prueba sintéticos, no una medición de frecuencia de uso en toda Colombia.

## Interpretación contextual

| Mensaje y contexto | Comportamiento esperado |
| --- | --- |
| «Quiubo», «Q hubo veci», «Qué más pues», «Buenas, sumercé» al abrir contacto | Saludar, presentarse brevemente como asistente virtual e invitar a contar qué necesita. |
| «Hola Rocio» | Reconocer el vocativo; no guardar Rocío como nombre del comprador. |
| «Quiubo, regálame una Coca-Cola de litro y medio para domicilio» | Procesar la compra y conservar el producto; el saludo no interrumpe el pedido. |
| «Buenas, para un domicilio» | Iniciar la solicitud y pedir lo que falta; no tratarlo como saludo puro. |
| «¿Qué más tienes de gaseosas?» | Consultar opciones del catálogo. |
| «¿Qué hubo con mi pedido? No ha llegado» | Atender el seguimiento mediante el flujo de intervención humana existente. |
| «De litro y medio, veci», después de preguntar la presentación | Completar el pedido existente mediante `order_clarification`. |
| «Hola veci», con carrito activo | Saludar sin borrar ni confirmar el carrito; no repetir la presentación ya realizada. |
| «¿Qué más tienes?», después de listar gaseosas | Interpretar la continuidad de la consulta, no un nuevo saludo. |

El prompt recibe la etapa, el carrito existente y hasta seis mensajes recientes, con un máximo de 700 caracteres por mensaje. Son contexto del usuario, no instrucciones superiores. La interpretación sigue a cargo del LLM; los ejemplos orientan el significado, no se ejecutan como reglas de coincidencia exacta.

La voz usa el perfil del tenant. Se pide cercanía colombiana natural, coherencia entre tú/usted y evitar regionalismos forzados. Las tiendas nuevas usan `tendero_colombiano`; el alias anterior `tendero_bogotano` sigue siendo compatible. Un saludo puro utiliza la respuesta generada en la llamada de interpretación existente, sin añadir otra llamada al modelo.

## Nombre configurable y aislamiento

Ruta de configuración: **Ajustes → Cómo responde → Nombre del asistente → Guardar nombre**.

- Campo: `tenant.config.agentPolicy.displayName`.
- Predeterminado: `Rocío`, también para tiendas existentes sin el campo; no requiere migración.
- El propietario puede modificar únicamente `displayName` dentro de `agentPolicy`. No adquiere acceso a cambiar proveedor, permisos ni política de escalamiento.
- Contrato existente: `PATCH /api/tenants/:tenantId/config`, cuerpo `{"agentPolicy":{"displayName":"Lucía"}}`.
- Validación: nombre de 1–60 caracteres, letras y marcas Unicode, espacios, puntos, apóstrofes y guiones. Normalización NFC y espacios. Sin saltos de línea, tabuladores ni objetos.
- Se persiste en la configuración del tenant usando el mecanismo existente; no modifica otras tiendas.
- El nombre se comunica al intérprete y al compositor como dato de identidad. El asistente se identifica como virtual; no suplanta al dueño ni interpreta su nombre como el del comprador.
- El formulario se reinicia al cambiar de tienda para no arrastrar un nombre editado de otro tenant.

## Validación ejecutada

1. `npm run test:backend`: **13 scripts aprobados**, incluidos saludos, continuidad de precios/carrito, concurrencia, errores, 50 escenarios colombianos/60 pasos, autenticación y contratos de Google/WhatsApp.
2. `auth-smoke.mjs`: propietario guarda un nombre normalizado; el dato queda persistido; otra tienda no cambia; acceso a un tenant ajeno devuelve 403; nombres inválidos devuelven 400; cambiar `humanEscalation` sigue prohibido al propietario.
3. `npm run build` del frontend: compilación Vite aprobada.
4. `agent-identity-context.mjs` con **DeepSeek real (`deepseek-chat`) y catálogo de referencia de 300 productos: 17/17 casos aprobados**. Dos tenants, nombres Rocío/Lucía, límite de salida de 600 tokens y timeout de 8 segundos. Persistencia local temporal y acceso de red restringido al endpoint de DeepSeek; sin mensajes reales a WhatsApp.

| Caso | Intención observada | Tiempo del proveedor |
| --- | --- | ---: |
| Quiubo | greeting | 2692 ms |
| Q hubo veci | greeting | 2258 ms |
| Qué más pues | greeting | 2820 ms |
| Buenas, sumercé | greeting | 2154 ms |
| Hola, ¿bien o qué? | greeting | 3166 ms |
| Muy buenos días | greeting | 2717 ms |
| Hola Rocio | greeting; nombre del comprador vacío | 2192 ms |
| ¿Cómo se llama el asistente? | greeting; identidad Rocío | 2284 ms |
| Quiubo, regálame una Coca-Cola de litro y medio para domicilio | delivery_order; producto conservado | 2659 ms |
| Buenas, para un domicilio | delivery_order | 2286 ms |
| ¿Qué más tienes de gaseosas? | catalog_query | 2361 ms |
| ¿Qué hubo con mi pedido? No ha llegado | human_handoff | 2337 ms |
| De litro y medio, veci; pregunta previa de presentación | order_clarification | 2633 ms |
| Hola veci; carrito activo y presentación anterior | greeting; sin repetir identidad | 2545 ms |
| ¿Qué más tienes?; consulta anterior de gaseosas | catalog_query | 2324 ms |
| Hola, ¿cómo te llamas?; segundo tenant | greeting; identidad Lucía | 1955 ms |
| Hola; regreso al primer tenant | greeting; identidad Rocío | 2277 ms |

Ejemplo real observado: «¡Quiubo! Bienvenido, soy Rocío, su asistente virtual de la tienda. Cuénteme qué necesita y con gusto le ayudo.» No se convierte en una plantilla fija.

La primera ronda detectó que «De litro y medio, veci» se clasificaba como un pedido nuevo. Se precisó el uso de la pregunta anterior y se repitió la batería completa, obteniendo los resultados de la tabla. Hubo un intento interrumpido por un fallo de red antes de la ronda final; no se contó como éxito del modelo.

## Reproducción, observabilidad y límites

Contrato local: `npm run test:identity`.

Con `DEEPSEEK_API_KEY` ya disponible en el entorno, ejecutar en PowerShell:

```powershell
$env:VIA_IDENTITY_REAL_LLM = '1'
npm run test:identity
```

El test imprime por caso el texto sintético, tenant, intención, saludo generado y duración. No imprime la credencial. La suite ordinaria usa respuesta de proveedor simulada para validar el contrato; no debe confundirse con la ronda real detallada arriba.

En producción siguen disponibles `llm.plan.created`, `llm.plan.fallback`, `agent.greeting.replied`, llamadas a herramientas y eventos de entrega, correlacionados con conversación/tenant. Una conversación retenida por atención humana o modo manual no se reactiva solo por recibir un saludo.

Los tiempos son del proveedor en pruebas locales, no latencia E2E de WhatsApp. Los 17 casos verifican interpretación e identidad, no todas las variantes regionales ni todas las conversaciones posibles. La redacción puede variar; sigue siendo necesario observar la naturalidad en uso real. No se enviaron saludos ni pedidos a clientes durante esta validación.

## Publicación

Pendiente de registrar los identificadores del despliegue y la comprobación de salud posteriores a la publicación.
