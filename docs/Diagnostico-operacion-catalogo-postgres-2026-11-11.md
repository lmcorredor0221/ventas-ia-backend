# Diagnóstico: catálogo operativo y continuidad ante fallos del proveedor

## Evidencia de producción analizada

En la ejecución fallida del 11 de noviembre, la conversación recibió el mensaje de pedido, pero no se ejecutó `catalog.search`.

La traza muestra esta secuencia:

1. El webhook se encoló durante aproximadamente 3,5 s.
2. La consulta del perfil del cliente contra Google Sheets tomó aproximadamente 1,3 s.
3. La llamada `llm.plan` a DeepSeek falló después de aproximadamente 2,9 s.
4. El runtime convirtió ese error técnico en `human_handoff`, envió el mensaje de escalamiento y no llegó a la búsqueda del catálogo.

El catálogo publicado en PostgreSQL para la tienda demo sí existía: versión `6e93b66411cb7383c8d2`, 2.000 filas y fuente `postgres_catalog`. Por tanto, esa evidencia no sustenta que el origen del fallo fuera una ausencia de productos ni la consulta semántica.

La lectura directa y de solo consulta realizada después en el proyecto de producción confirmó además:

- `products` contiene 2.000 referencias para `demo-de-tienda`, incluyendo Coca-Cola y las referencias de `Chocoramo` (una sola `r` en el nombre almacenado).
- `catalog_knowledge_indexes` conserva el índice publicado de esa tienda, con 2.000 vectores, 2.660 nodos y 74.552 relaciones.
- La configuración persistida del tenant no contiene aún `config.catalog.readSource = postgres`; en cambio, `orderPolicy` mantiene `customerProfileStore` y `confirmedOrderStore` como `google_sheets`.
- La traza de la conversación fallida prueba que se ejecutó la búsqueda de perfil en Google Sheets antes del fallo de DeepSeek y que no se ejecutó `catalog.search`.

## Causas confirmadas

### 1. Fallo del proveedor confundido con decisión comercial

`llmPlanner` convertía un error estricto del proveedor en un plan de `human_handoff`. `agentRuntime` interpretaba ese plan como una transferencia real antes de ejecutar la búsqueda. El cliente veía una escalación aunque no hubiese pedido atención humana ni se hubiera agotado una aclaración.

### 2. Dependencia heredada de Google para perfiles

La lectura del perfil del cliente acudía a Google Sheets antes de utilizar el perfil persistido. Además de añadir latencia, una reconexión requerida podía interrumpir una conversación aun cuando PostgreSQL tuviera los datos necesarios.

### 3. Fuente del catálogo no consolidada después de sincronizar

La sincronización ya publicaba el snapshot y el índice del catálogo en PostgreSQL, pero no cambiaba de forma persistente la configuración de la tienda a `catalog.readSource = postgres`. Una configuración heredada podía seguir haciendo que el runtime intentara Google.

## Correcciones aplicadas localmente

- Un error temporal de DeepSeek ahora genera una respuesta transparente de reintento y mantiene la conversación abierta; no crea una atención humana.
- La lectura y escritura de perfiles prioriza PostgreSQL en producción. Google queda fuera de la ruta operativa cuando esa fuente está configurada.
- Una sincronización de catálogo correcta fija y persiste la fuente operativa `postgres` para la tienda.
- La configuración de producción usa PostgreSQL por defecto tanto para catálogo como para perfiles, salvo una configuración explícita que lo sustituya.
- Se ajustó el orden de manejo de una reconexión de Google para no invocar al LLM cuando esa ruta realmente sea necesaria y esté inválida.

## Validación local ejecutada

Pasaron los contratos de:

- proveedor LLM no disponible y conservación de la conversación;
- runtime ante proveedor no disponible, sin escalamiento humano;
- catálogo leído desde PostgreSQL;
- perfil existente y nuevo persistidos sin llamada a Google en modo PostgreSQL;
- sincronización de catálogo y promoción de la fuente operativa;
- recuperación de Google y reconciliación de Sheets;
- recuperación JSON y manejo de proveedor del LLM.

## Acceso y límite de la evidencia

Se obtuvo acceso de solo lectura mediante el panel de Supabase al proyecto de producción `mmcxphpstxjugxjrdffb`; las verificaciones anteriores se hicieron exclusivamente con `SELECT` y no modificaron datos. El conector automatizado de Supabase sigue sin reconocer esa autorización, por lo que para automatizar revisiones posteriores debe reconectarse con la misma cuenta que ya tiene acceso al proyecto.

Antes de publicar, sigue siendo necesario comprobar en producción: que el despliegue incluye estas correcciones, que cada tenant sincronizado persiste `catalog.readSource = postgres`, y que nuevas trazas alcanzan `catalog.search` después del plan LLM.

## Resultado esperado tras publicar

Un pedido debe consultar el snapshot publicado en PostgreSQL. Google Drive/Sheets solo se usa para sincronizar o actualizar el catálogo bajo demanda; no para atender cada mensaje. Si DeepSeek presenta una indisponibilidad transitoria, VIA debe pedir reintentar sin escalar el pedido automáticamente al tendero.
