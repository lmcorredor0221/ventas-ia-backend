# Plan ejecutable de pruebas E2E locales: Meta simulada y DeepSeek real

## 1. Propósito

Comprobar, sin enviar ni recibir mensajes reales de WhatsApp, que Ventas IA puede atender de extremo a extremo los 40 escenarios colombianos base: desde un webhook con el contrato de Meta hasta la respuesta que recibiría el cliente, la persistencia en PostgreSQL, la cola de integraciones y la acción posterior del tendero.

La IA no se simula. Cada mensaje que requiera interpretación o redacción debe pasar por la integración real de DeepSeek configurada para la prueba. Meta, Google Sheets/Drive y el teléfono se sustituyen por adaptadores locales controlados para no tocar cuentas, hojas, archivos ni números reales.

El resultado de cada corrida será una evidencia auditable por caso: qué llegó desde Meta, qué decidió el agente, qué herramientas llamó, qué persistió, qué habría enviado a WhatsApp y por qué pasó o falló.

## 2. Alcance y decisiones

### Incluido

1. Recepción GET y POST de /webhooks/whatsapp con las formas reales del Cloud API de Meta.
2. Firma HMAC X-Hub-Signature-256, validación de phone_number_id, deduplicación por message_id, estados de entrega ignorados y respuesta HTTP rápida.
3. Una clonación efímera de PostgreSQL local real, con persistencia de inbound_messages, integration_outbox, conversaciones, ofertas interactivas, pedidos, eventos, auditoría y métricas.
4. Worker local real que reclama la cola y ejecuta el mismo AgentRuntime, LLMPlanner, OrderService y ToolRegistry usados por la aplicación.
5. Llamadas reales a DeepSeek para el planner y, cuando aplique, el compositor de respuesta final.
6. Catálogo, perfiles, métodos de pago, Sheets/Drive y Graph API simulados localmente mediante los contratos existentes.
7. Actor cliente, actor tendero y simulador de Meta en conversaciones de varios mensajes.
8. Cierre de pedido al despachar, notificación al cliente y apertura de una conversación nueva cuando el mismo cliente escriba después.
9. Reporte por caso, reporte consolidado, métricas de latencia, consumo de DeepSeek y clasificación de causa raíz.

### Excluido deliberadamente

1. Mensajes a WhatsApp, llamadas a Meta Graph, Embedded Signup, OAuth Google y escritura en Drive/Sheets reales.
2. Cambios de producto o de arquitectura de producción. Solo se permiten costuras de prueba aisladas, por ejemplo, inyectar un fetch capturador para Graph y un adaptador local de Google.
3. Pruebas de carga masiva, seguridad externa o aprobación de Meta. Esta batería valida la preparación funcional antes de esas etapas.

## 3. Situación inicial encontrada en el repositorio

Ya existen componentes que deben reutilizarse, no duplicarse:

| Componente existente | Uso dentro de esta prueba |
| --- | --- |
| server/routes/whatsapp.js | Contrato de verificación, firma, normalización de webhook, deduplicación y cola asíncrona. |
| server/services/agentRuntime.js | Continuidad de conversación, pedido, escalamiento y cierre. |
| server/services/integrationOutbox.js | Cola, lease, reintentos y dead_letter. |
| server/services/llmPlanner.js | Planner y compositor con DeepSeek, incluyendo voz tendero_colombiano. |
| server/tests/whatsapp-async-inbound.mjs | Forma válida de eventos Cloud API y contrato de acuse temprano. |
| server/tests/whatsapp-live-contract.mjs | Contrato actual del payload saliente de Graph, incluido mensaje interactivo. |
| server/tests/deepseek-real-scenarios.mjs | Configuración segura de DeepSeek real, trazas de uso y comprobación de provider_api. |
| server/tests/fixtures/colombiaAgentScenarios.js | Matriz colombiana reutilizable de conversaciones, catálogo y expectativas. |

La matriz contiene hoy 50 escenarios. Para respetar el compromiso de 40, la aceptación E2E abarca exactamente los casos 1 a 40 de esa matriz. Los casos 41 a 50 son conversaciones reales ampliadas y quedarán como regresión posterior, sin mezclarlos con el indicador oficial de 40/40.

El runner actual de DeepSeek real cubre solo cinco escenarios y seis mensajes, y llama a /api/agent/run. Por tanto no valida el webhook, la cola, el actor tendero, ni evidencia completa por caso. Ese es el vacío que cierra este plan.

## 4. Arquitectura de simulación

    Cliente simulado                    Tendero simulado
           |                                     |
           | Cloud API payload                    | acción operativa normal
           v                                     v
    MetaSimulator ---- HTTP/HMAC ----> VIA local /webhooks/whatsapp
           ^                                      |
           | Graph request capturada              | PostgreSQL local E2E
           |                                      v
           +---- GraphCapture <---- Outbox/worker -> AgentRuntime
                                                    |       |
                                                    |       +-> DeepSeek real
                                                    |
                                                    +-> Catálogo y GoogleAdapter local

    EvidenceCollector <--- eventos, DB, llamadas, tiempos, decisiones y errores

### 4.1 MetaSimulator

El simulador no llama servicios externos. Construye y envía solicitudes HTTP contra el servidor local con el formato de Meta:

1. GET /webhooks/whatsapp?hub.mode=subscribe... para verificar que la aplicación responde el challenge y rechaza un token incorrecto.
2. POST /webhooks/whatsapp con object=whatsapp_business_account, entry, changes, metadata, contacts y messages para texto, imagen, botón/lista y estados de entrega.
3. Firma el cuerpo raw con un secreto de prueba y manda X-Hub-Signature-256.
4. Reenvía a propósito el mismo wamid en el caso de deduplicación y genera identificadores únicos y deterministas en los demás casos.
5. Captura las peticiones salientes a Graph mediante la costura global.fetch que ya usa server/tests/whatsapp-live-contract.mjs. Se valida URL, cabeceras, cuerpo, destinatario, texto e interacciones sin abrir una conexión con graph.facebook.com.

La primera versión no necesita modificar la URL base de Graph. El interceptor de fetch conserva el contrato de envío ya probado en el repositorio y elimina por completo el riesgo de publicar mensajes reales.

### 4.2 Cliente simulado

El CustomerDriver representa un único número de WhatsApp por conversación. Envía mensajes uno a uno, espera una condición de estado observable y usa la última respuesta capturada como contexto de la siguiente acción. Puede:

1. escribir texto, con modismos, errores tipográficos y mensajes vacíos con imagen;
2. pulsar un botón o seleccionar una opción de lista devolviendo un webhook interactive realista;
3. corregir, agregar o quitar productos;
4. proporcionar nombre, dirección y método de pago;
5. confirmar, ajustar o pedir hablar con la tienda;
6. escribir nuevamente después de que el tendero despacha para confirmar que nace una conversación nueva.

### 4.3 Tendero simulado

El ShopkeeperDriver actúa por la misma ruta de aplicación que utiliza la interfaz de operaciones. Debe tomar el pedido, marcarlo como alistando y luego como en camino. Si el endpoint HTTP de operaciones no cubre una transición requerida, el driver invocará OrderService.transition, nunca cambiará filas o documentos directamente.

Se verifica que la transición a dispatched:

1. persiste primero el nuevo estado y la historia;
2. encola o realiza el aviso al cliente según el contrato;
3. cierra el caso conversacional;
4. hace que un mensaje posterior del mismo wa_id se trate como una solicitud nueva.

### 4.4 DeepSeek real

El entorno E2E configura en el tenant:

    provider=deepseek
    model=<DEEPSEEK_MODEL, por defecto deepseek-chat>
    simulator=null
    temperature=0
    responseLanguage=es-CO
    tone=tendero_colombiano

Una precondición bloqueante revisa que DEEPSEEK_API_KEY exista, que LLM_SIMULATOR esté ausente, y que el evento de cada paso elegible declare provider=deepseek y executionMode=provider_api. Un deterministic_fallback, una respuesta simulada, una clave ausente, timeout o rate limit se registra como fallo de integración de IA, no como éxito funcional.

El límite predeterminado E2E_MAX_DEEPSEEK_CALLS es 160: cubre el planner y el compositor de los 40 casos, incluidos los diálogos de varios turnos. Si el límite se agota, el runner marca los casos restantes como blocked_ai, escribe su reporte individual y no los presenta como ejecutados.

No se registrarán la clave, encabezados de autorización, prompt completo con datos sensibles ni secretos de Meta en las evidencias.

### 4.5 PostgreSQL: línea base inmutable y clon por ejecución

La base local existente, actualmente ventas_ia_dev en 127.0.0.1, es la **línea base**. El servidor VIA, el worker, las migraciones y los drivers E2E nunca pueden conectarse a ella para escribir. No se purga, no se crean tenants en ella, no se ejecutan migraciones sobre ella y no se cambia ninguno de sus objetos.

El aislamiento por esquema no es una opción segura en el estado actual: PostgresStore crea su Pool sin search_path configurable y trabaja sobre public. La estrategia obligatoria es un **clon lógico de la base por corrida**:

1. El preparador lee E2E_SOURCE_DATABASE_URL y valida que sea loopback. Solo la herramienta pg_dump puede usar esta URL y debe hacerlo como lectura.
2. Crea una base destino con nombre ventas_ia_e2e_<runId>, donde runId contiene solo letras minúsculas, números y guiones bajos.
3. Ejecuta pg_dump --format=custom --no-owner --no-privileges sobre la fuente y pg_restore --exit-on-error --no-owner --no-privileges sobre la base destino vacía.
4. Solo después de restaurar, el runner inyecta POSTGRES_E2E_DATABASE_URL como DATABASE_URL del proceso VIA. La fuente nunca se asigna a DATABASE_URL.
5. Dentro del clon se crea un tenant sombra e2e_<runId>, que copia la configuración comercial, catálogo y política de voz del tenant base elegido. Los objetos nuevos de la corrida pertenecen únicamente a este tenant sombra.
6. Se reemplazan en el tenant sombra los bindings de WhatsApp, las referencias de Google y los datos personales por identificadores de prueba. DeepSeek conserva la integración real mediante variable de entorno no registrada.
7. Al finalizar, se conserva el clon para diagnóstico por defecto. Solo E2E_DROP_CLONE=true permite eliminarlo, tras comprobar de nuevo host loopback, patrón exacto del nombre destino y desigualdad con la fuente.

Así se prueba una instantánea exacta de lo que ya existe sin modificar la base origen. También se preserva la configuración comercial real para detectar incompatibilidades entre los 40 escenarios y el catálogo/configuración local vigente.

El GoogleAdapter de prueba devuelve el catálogo y perfiles del tenant sombra, y simula la proyección de Sheets con tres modos: éxito, demora y fallo recuperable. Usa el contrato de las herramientas Google existentes y deja trazas en la outbox. Ninguna prueba depende de una hoja real.

### 4.6 Evidencia de inmutabilidad de la base fuente

Antes del dump y al finalizar la ejecución se generará un manifiesto de línea base con:

1. host, puerto y nombre de base, sin usuario ni contraseña;
2. versión de PostgreSQL, versión Git, lista de migraciones y hash SHA-256 del dump;
3. conteos y huellas por tabla relevante: tenants, products, conversations, orders, inbound_messages, integration_outbox, events, audit_events e interaction_offers;
4. tenant base, identificador del tenant sombra y nombres de base fuente/destino;
5. resultado de una comparación fuente inicial versus fuente final.

El runner falla como failed_contract si la base configurada para VIA coincide con la fuente, si la fuente no está en loopback, si el dump/restauración falla, o si las huellas de la fuente cambian. Una diferencia en el clon es esperada y se documenta por runId.

## 5. Datos de prueba

Cada ejecución parte de una instantánea de la base local y crea dentro del clon un único tenant sombra e2e_<runId>. Los teléfonos, nombres, direcciones y comprobantes son ficticios. El tenant base del snapshot queda sin mutaciones incluso dentro de la copia, lo que permite comparar su estado previo y posterior.

| Dato | Valor de prueba y propósito |
| --- | --- |
| phone_number_id de la tienda | e2e-phone-<runId>, enlazado únicamente al tenant E2E. |
| wa_id del cliente | 57399<caso><secuencia>, único por caso salvo casos multi-mensaje. |
| Nombre y dirección conocidos | Ana Prueba, Calle E2E 10 # 20-30, Bogotá; usados para continuidad, nunca valores reales. |
| Catálogo | Copia del catálogo real del tenant base en el snapshot. Antes de iniciar, el preflight verifica los productos mínimos de colombiaAgentScenarioSet: Chocoramo, Coca-Cola, Agua Cristal, arroz, aceite, huevos, pan, queso, lácteos, aseo, sinónimos, variantes y stock. |
| Casos de disponibilidad | Atún y Ponqué Ramo mora ausentes; variantes de Coca-Cola y productos con presentación ambigua. |
| Pagos tenant | Efectivo, Tarjeta y Bre-B activos, con al menos un método adicional de prueba desactivado para validar que no se ofrezca. |
| Política comercial | Sin descuento automático; descuentos, comprobantes y reclamos deben abrir aprobación o handoff. |
| Voz | tendero_colombiano, con registro cercano y respetuoso. |

La matriz de expectativas se obtiene de server/tests/fixtures/colombiaAgentScenarios.js. El catálogo no se siembra sobre la fuente: se copia del tenant base al tenant sombra dentro del clon. El preflight compara los productos y precios requeridos por la matriz; si una expectativa no existe en la instantánea, marca el caso blocked_baseline en vez de inventar datos o modificar el catálogo real.

## 6. Matriz oficial de 40 casos

| # | Fixture | Cobertura principal |
| --- | --- | --- |
| 1 | pedido_claro_con_cliente_conocido | Pedido conocido y respuesta de compra. |
| 2 | pedido_claro_con_cantidad_faltante | Solicitud de cantidad pendiente. |
| 3 | cliente_nuevo_domicilio_pide_nombre_direccion | Datos faltantes de cliente nuevo. |
| 4 | cliente_nuevo_completa_datos | Continuidad: completa nombre y dirección. |
| 5 | disponibilidad_producto_premium | Búsqueda y disponibilidad. |
| 6 | consulta_cafe_generica_infiere_similares | Consulta ambigua y alternativas. |
| 7 | categoria_jugos | Navegación por categoría. |
| 8 | categoria_algo_para_la_sed | Intención por ocasión. |
| 9 | categoria_mecato_onces | Modismo y recomendación. |
| 10 | categoria_mercado | Canasta de mercado. |
| 11 | categoria_aseo | Categoría de aseo. |
| 12 | categoria_onces_panaderia | Categoría panadería. |
| 13 | consulta_combo_jamon_queso_pan_parcial | Combo parcial y faltantes. |
| 14 | indeciso_antojo_dulce | Recomendación contextual. |
| 15 | indeciso_desayuno_rapido | Recomendación contextual. |
| 16 | indeciso_algo_frio_para_tomar | Recomendación contextual. |
| 17 | indeciso_presupuesto_bajo | Recomendación con restricción económica. |
| 18 | producto_impreciso_gaseosa | Presentación de gaseosa ambigua. |
| 19 | producto_impreciso_leche_bolsa | Presentación de leche ambigua. |
| 20 | producto_impreciso_papel_bano | Consulta aproximada de aseo. |
| 21 | producto_impreciso_jabon_ropa | Consulta aproximada de lavado. |
| 22 | mercado_basico_con_lista_parcial | Lista parcial de mercado. |
| 23 | pedido_claro_aseo_domicilio | Pedido con cantidades y domicilio. |
| 24 | pedido_claro_sin_domicilio | Pedido sin domicilio explícito. |
| 25 | producto_impreciso_savital_sobre | Sinónimo y presentación sachet. |
| 26 | consulta_precio_chocoramo | Precio y posible cotización. |
| 27 | indeciso_lonchera_nino | Recomendación para lonchera. |
| 28 | producto_no_catalogado_atun | Producto no encontrado sin inventar stock. |
| 29 | cliente_nuevo_coca_domicilio | Cliente nuevo y variantes de Coca-Cola. |
| 30 | pedido_confirmado_dale_hagale | Pedido, botón de pago, confirmación y handoff. |
| 31 | consulta_tintico_cafe | Lenguaje colombiano y variedad de café. |
| 32 | pedido_claro_despensa_domicilio | Canasta de tres artículos. |
| 33 | pedido_con_typos_colombianos | Typos: chocramos y cifru. |
| 34 | pedido_sin_cantidades_debe_preguntar | Cantidades obligatorias. |
| 35 | pedido_despensa_sin_cantidades | Varias cantidades faltantes. |
| 36 | consulta_lacteos | Consulta por grupo de lácteos. |
| 37 | descuento_escala_aprobacion | Descuento requiere aprobación. |
| 38 | pago_requiere_aprobacion | Comprobante/transferencia sensible. |
| 39 | pide_humano | Handoff solicitado por cliente. |
| 40 | pedido_confirmado_handoff_operaciones | Flujo completo con Bre-B y operaciones. |

Después de conseguir 40/40, se ejecutarán como regresión no bloqueante inicial los diez casos 41 a 50: saludo sin productos, pago con tarjeta, corrección y adición de canasta, pedido por valor, imagen, reclamo, comprobante, disponibilidad parcial y cierre «solo eso».

## 7. Flujo automatizado por caso

1. Crear runId, directorio de evidencia y el clon PostgreSQL. Generar las huellas de fuente, clon y tenant base; crear el tenant sombra con copia de catálogo, perfiles, pagos y voz.
2. Arrancar VIA local con storageDriver=postgres, asyncInboundEnabled=true, integrationOutboxEnabled=true y workers controlados manualmente. El HTTP y el worker pueden coexistir dentro del proceso de prueba para conservar el flujo sin depender de tiempos fijos.
3. El cliente envía un POST firmado a /webhooks/whatsapp. Se mide el acuse antes de drenar el worker.
4. Esperar mediante polling de estado, con límite por paso, a que el inbound quede completed, dead_letter o venza el timeout. No usar sleep ciego.
5. Recoger conversación, eventos, uso LLM, herramientas, ofertas interactivas, salida Graph y mutaciones de base.
6. Evaluar contratos duros y expectativas semánticas. Para cada paso multi-mensaje, alimentar el siguiente mensaje solo después de que su estado esperado esté persistido.
7. En casos 30 y 40, el cliente selecciona pago interactivo, confirma el pedido y el tendero toma/alista/despacha. Luego el cliente escribe un mensaje nuevo para validar cierre y continuidad.
8. Simular fallos seleccionados: firma inválida, duplicado, Graph temporalmente no disponible, Google lento/no disponible y worker reintentando. El pedido ya confirmado no se pierde por un fallo de proyección.
9. Escribir case-report.json y case-report.md, actualizar el consolidado, generar la comparación de huellas de la fuente y cerrar conexiones. El clon se conserva por defecto para diagnóstico; su eliminación es una acción explícita y solo puede afectar ventas_ia_e2e_<runId>, nunca ventas_ia_dev.

## 8. Validaciones por capa

| Capa | Aserciones obligatorias |
| --- | --- |
| Meta ingress | Verificación válida e inválida, HMAC válida e inválida, phone_number_id desconocido, acuse HTTP 200 antes de LLM/Google, delivery status ignorado y duplicado sin segunda ejecución. |
| PostgreSQL y cola | Fuente inmutable; un inbound y un trabajo por message_id en el tenant sombra; trazabilidad traceId; lock/reintento; dead_letter visible; no escritura de pedido duplicada. |
| DeepSeek | provider=deepseek, executionMode=provider_api, modelo esperado, trazas de tokens; intent y candidatos coherentes con el caso. |
| Catálogo | Cada artículo citado existe y está disponible; no se inventan precios, stock o alternativas; subtotal igual a suma de líneas; solicitudes ambiguas preguntan antes de confirmar. |
| Conversación | Misma conversación en mensajes consecutivos; canasta se corrige sin duplicar; dirección, nombre y pago se retienen; solo una confirmación genera un pedido. |
| Voz | La respuesta es española colombiana, breve y respetuosa; interpreta me regala, veci, pa las onces, errores y marcas incompletas. No exige una muletilla exacta ni acepta respuestas caricaturescas. |
| Interacciones | Métodos de pago se ofrecen como botones/lista persistidos; una opción válida se consume una vez; repetición, expiración u opción de otro tenant no modifica el pedido. |
| Tendero | Tomar, alistar y despachar en orden; la UI/dominio muestra productos legibles, precios correctos, total, dirección, pago y responsable. |
| Cierre | dispatched emite aviso al cliente, deja el pedido cerrado y un mensaje posterior inicia una nueva conversación. |
| Integraciones secundarias | La proyección Google se encola después de persistir; una falla temporal no revierte ni bloquea la respuesta principal; se observa reintento. |

Las afirmaciones sobre lenguaje no compararán la frase completa, porque DeepSeek real puede redactar variaciones correctas. Se aplicará esta jerarquía: hechos invariantes exactos, acción de negocio válida, intención/candidatos aceptados y, por último, una rúbrica de tono con términos prohibidos y señales esperadas.

## 9. Criterios de aceptación y salida

La batería se considera apta para una prueba controlada de negocio únicamente si:

1. Los 40 casos se ejecutan, cada uno con una llamada real comprobable a DeepSeek cuando el paso requiere LLM.
2. El 100% de los contratos P0 pasa: firma, acuse temprano, deduplicación, aislamiento tenant, persistencia, no inventar productos/precios, confirmación única, botones seguros, transición del tendero y cierre de conversación.
3. Al menos 38 de 40 casos cumplen la expectativa funcional y semántica; ninguno de los dos restantes puede ser P0/P1. Todo fallo se clasifica y tiene evidencia suficiente para reproducirse.
4. La respuesta del webhook queda por debajo de 1 segundo en el percentil 95 antes de ejecutar LLM, catálogo o Sheets. Se informa aparte el tiempo de procesamiento completo y el tiempo de DeepSeek por paso.
5. No hay salida a red de Meta, Google, WhatsApp ni producción; el único servicio externo permitido es api.deepseek.com o el DEEPSEEK_BASE_URL autorizado.
6. El 100% de los casos de pedido confirma líneas, precio, subtotal, método de pago y estado de forma consistente entre base, respuesta al cliente y vista del tendero.
7. El informe no contiene claves, tokens, números reales, direcciones reales ni cuerpos de webhook sin enmascarar.
8. La evidencia de huellas confirma que la fuente no cambió y que cada objeto nuevo vive en el clon y en el tenant sombra del runId.

| Estado | Significado |
| --- | --- |
| passed | Todas las aserciones del caso pasan. |
| failed_functional | El sistema respondió, pero la decisión, datos o flujo no cumplen. |
| failed_contract | Incumple webhook, persistencia, aislamiento, duplicación, seguridad o integración. Bloquea piloto. |
| blocked_ai | No se alcanzó DeepSeek real, hubo fallback o excedió límites. No cuenta como prueba exitosa. |
| infra_error | Falló Postgres, proceso local o adaptador antes de poder evaluar el caso. |

## 10. Observabilidad y evidencias

La corrida genera test-results/e2e-local/<runId>/ con esta estructura:

run-manifest.json                 Versiones, hashes, configuración saneada y presupuesto
baseline-source.json              Huella inicial y final de la base fuente, sin secretos
baseline-clone.json               Nombre, hash y estado de la copia E2E
baseline-tenant-diff.json         Comparación del tenant base y el tenant sombra
    summary.json                      Totales, latencias, tokens, estados y causas
    summary.md                        Informe legible de preparación
    junit.xml                         Resultado para herramientas de pruebas
    cases/
      01-pedido-claro-conocido/
        case-report.json              Resultado y aserciones
        timeline.json                 traceId, timestamps y duración por fase
        meta-inbound.redacted.json    Cuerpo Cloud API, firma ocultada
        planner.json                  Plan, candidatos y estrategia
        llm-usage.json                proveedor, modelo, tokens, ejecución
        tool-calls.json               entradas y resultados saneados
        graph-outbound.json           texto e interacción que recibiría el cliente
        database-snapshot.json        entidades afectadas, sin secretos
        outbox.json                   trabajos, intentos y resultado
        failure.md                    solo cuando falle, con causa reproducible

Los eventos se correlacionan con runId, caseId, stepId, messageId, conversationId, orderId y traceId. El recolector debe persistir estos identificadores incluso si el proceso falle.

La clasificación automática de causa raíz usará: meta_contract, webhook_security, queue_or_persistence, deepseek_interpretation, deepseek_composer, catalog_data, order_workflow, interactive_offer, shopkeeper_workflow, outbox_projection o test_infrastructure. El informe sugerirá la siguiente evidencia a revisar, no cambios automáticos de producto.

## 11. Implementación mínima requerida

Se crean archivos de prueba, sin alterar la arquitectura de negocio:

| Archivo propuesto | Responsabilidad |
| --- | --- |
| server/tests/e2e-local-deepseek-40.mjs | Orquestador de la corrida de 40 y generador de informes. |
| server/tests/helpers/e2eEnvironment.mjs | Clon PostgreSQL, huellas, tenant sombra, catálogo, lifecycle y limpieza segura. |
| server/tests/helpers/metaSimulator.mjs | Webhook Meta firmado, cliente y captura de Graph. |
| server/tests/helpers/shopkeeperDriver.mjs | Acciones de tendero por servicio/ruta real. |
| server/tests/helpers/evidenceCollector.mjs | Evidencias saneadas, métricas y JUnit/Markdown. |
| server/tests/fixtures/e2eScenarioOverlay.js | Metadatos E2E para los 40 fixtures existentes, sin duplicar catálogo. |
| scripts/e2e/clone-postgres-baseline.ps1 | Dump de solo lectura, creación/restauración del clon y guardas de nombres. |
| scripts/e2e/drop-postgres-clone.ps1 | Eliminación explícita de un clon ya validado; no acepta la base fuente. |
| .env.e2e.local.example | Variables no secretas, límites y guardas de seguridad. |

Se añade el script:

    "test:e2e:local": "node scripts/run-with-env.mjs .env.e2e.local node server/tests/e2e-local-deepseek-40.mjs"

La clonación requiere que pg_dump, pg_restore, createdb y dropdb estén disponibles mediante PG_BIN o PATH. Si no están, la prueba queda bloqueada antes de abrir VIA; no se sustituye por apuntar temporalmente a ventas_ia_dev. El PostgresStore ejecuta las migraciones al abrirse sobre el clon, por lo que no se introduce un sistema de migración paralelo ni se altera la fuente.

## 12. Configuración local y ejecución

Archivo local no versionado .env.e2e.local:

    NODE_ENV=test
    STORAGE_DRIVER=postgres
    E2E_SOURCE_DATABASE_URL=postgres://<usuario>:<secreto>@127.0.0.1:5432/ventas_ia_dev
    # En la base de desarrollo actual, el tenant semilla es andina.
    # Para probar otro tenant local, escríbelo explícitamente aquí.
    E2E_BASELINE_TENANT_ID=andina
    POSTGRES_E2E_DATABASE_URL=
    DATABASE_SSL=disable
    INTEGRATION_OUTBOX_ENABLED=true
    WHATSAPP_ASYNC_INBOUND_ENABLED=true
    BACKGROUND_WORKERS_ENABLED=false
    WHATSAPP_APP_SECRET=<secreto-solo-de-prueba>
    WHATSAPP_WEBHOOK_VERIFY_TOKEN=<token-solo-de-prueba>
    WHATSAPP_PROVIDER_MODE=live
    DEEPSEEK_API_KEY=<secreto-real-no-versionado>
    DEEPSEEK_MODEL=deepseek-chat
    LLM_REQUEST_TIMEOUT_MS=30000
    E2E_MAX_DEEPSEEK_CALLS=160
    E2E_MAX_CASE_DURATION_MS=90000
    E2E_RESULT_DIR=test-results/e2e-local
    E2E_KEEP_CLONE=true
    E2E_DROP_CLONE=false

El preparador crea POSTGRES_E2E_DATABASE_URL en tiempo de ejecución. El runner copia solo esa URL destino a la configuración efectiva DATABASE_URL y rechaza las siguientes condiciones:

1. host que no sea 127.0.0.1 o localhost;
2. fuente y destino iguales, o fuente asignada a DATABASE_URL;
3. nombre destino que no coincida con ventas_ia_e2e_<runId>;
4. E2E_BASELINE_TENANT_ID inexistente, inactivo o sin los datos mínimos declarados;
5. presencia de LLM_SIMULATOR;
6. WHATSAPP_PROVIDER_MODE=mock, porque ocultaría el contrato saliente;
7. acceso de red a dominios Meta, Google, WhatsApp, Render, Vercel o producción;
8. ausencia de una clave DeepSeek, herramientas PostgreSQL o agotamiento del presupuesto de llamadas.

Secuencia de ejecución:

    # Crea un dump de lectura y restaura un clon único para el runId.
    powershell -ExecutionPolicy Bypass -File scripts/e2e/clone-postgres-baseline.ps1

    # Preflight rápido: contratos existentes y el clon recién creado.
    npm run test:architecture
    $env:POSTGRES_TEST_DATABASE_URL = $env:POSTGRES_E2E_DATABASE_URL
    npm run test:postgres

    # Batería E2E. El runner usa solamente el clon y el tenant sombra.
    npm run test:e2e:local

Tras revisar el informe, la eliminación es opt-in:

    $env:E2E_DROP_CLONE = 'true'
    powershell -ExecutionPolicy Bypass -File scripts/e2e/drop-postgres-clone.ps1 -DatabaseUrl $env:POSTGRES_E2E_DATABASE_URL

Los scripts deben abortar antes de ejecutar pg_restore o dropdb si el nombre destino coincide con la fuente, no contiene el prefijo ventas_ia_e2e_ o no está en loopback. Nunca ejecutan DROP, TRUNCATE, DELETE, ALTER ni migraciones contra ventas_ia_dev.

## 13. Fases de trabajo y entregables

### Fase A. Preparación y guardas

1. Localizar los binarios PostgreSQL, configurar la URL de fuente y elegir el tenant base sin exponer credenciales.
2. Implementar dump/restauración, guardas de inmutabilidad y manifiesto de huellas.
3. Añadir .env.e2e.local.example y validadores de seguridad.
4. Ejecutar los contratos ya existentes contra el clon para establecer una línea base.

Entregable: preflight verde o bloqueos explícitos sin usar DeepSeek, más evidencia de que la fuente permanece inmutable.

### Fase B. Harness de contratos

1. Implementar MetaSimulator y captura Graph sobre las costuras existentes.
2. Implementar tenant/semilla aislados, GoogleAdapter local y ShopkeeperDriver.
3. Probar en un caso de pedido y uno de error antes de invocar los 40.

Entregable: dos informes completos reproducibles y sin tráfico externo distinto de DeepSeek.

### Fase C. Batería oficial de 40

1. Ejecutar los 40 casos en serie para limitar costo, conservar orden de evidencia y evitar interferencia de conversaciones.
2. Permitir paralelismo únicamente para casos sin conversaciones compartidas después de demostrar aislamiento y límites de DeepSeek.
3. Generar consolidado, JUnit y archivos individuales.

Entregable: reporte de preparación E2E 40/40 con fallos clasificados.

### Fase D. Triage y rerun

1. Corregir únicamente causas demostradas en los artefactos.
2. Repetir primero el caso fallido, luego el grupo funcional y finalmente los 40.
3. Ejecutar los diez casos de regresión ampliada después de lograr la aceptación principal.

Entregable: comparación entre corridas, lista de correcciones verificadas y decisión de pasar o no a un piloto de producción.

## 14. Riesgos y controles

| Riesgo | Control |
| --- | --- |
| DeepSeek responde con variaciones de estilo | Temperatura cero, expectativas por hechos/acciones, rúbrica de tono y evidencia de plan saneada. |
| Costo o rate limit | Tope de llamadas, serialización inicial, conteo de tokens y corte explícito. |
| La prueba altera la base local existente | Dump de solo lectura, clon único por runId, tenant sombra, fuente nunca asignada a DATABASE_URL y huellas antes/después. |
| Datos de desarrollo contaminan resultados | El tenant base se copia al tenant sombra dentro del clon; teléfonos y runId exclusivos; no se depura ni elimina la fuente. |
| Una prueba envía WhatsApp real | Interceptor de fetch fail-closed: toda URL Graph no local se captura; cualquier otra salida se considera error. |
| Sheets lento encubre la respuesta al cliente | Adaptador local controlado y aserción de persistencia/cola antes de proyección. |
| Fallos no reproducibles | Identificadores correlacionados, snapshots, versión Git, hash de fixtures y pasos exactos del cliente. |

## 15. Definición de preparado para piloto

VIA estará preparado para un piloto controlado cuando el informe final demuestre 40/40 contratos críticos, al menos 38/40 resultados funcionales, cero accesos externos prohibidos, DeepSeek real en los pasos aplicables, una base fuente local inmutable y ninguna discrepancia entre pedido persistido, respuesta al cliente y vista del tendero.

Un reporte con fallbacks determinísticos ocultos, mensajes duplicados, artículos/precios inventados, pérdida de estado, pedido sin persistencia o cierre incorrecto no habilita producción aunque el texto del agente parezca correcto.
