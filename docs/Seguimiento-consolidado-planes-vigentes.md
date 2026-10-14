# Seguimiento consolidado de planes vigentes

Actualizado: 2026-10-11.

## Fuentes revisadas

- `docs/Plan-implementacion-SaaS-Ventas-IA.docx`
- `docs/Plan-redisenio-experiencia-dashboard-premium.md`
- `docs/Checklist-piloto-produccion.md`
- `BACKEND.md`
- `docs/Decisiones-Mercado-Pago-SaaS.md`
- `docs/Plan-implementacion-Mercado-Pago-SaaS.md`
- Prompt maestro: auditoria y optimizacion de gemelo digital gamificado
- Chat real de WhatsApp con SuperMarket analizado localmente como evidencia conversacional de tienda de barrio

Este documento no reemplaza los planes originales. Los organiza como tablero maestro para saber que esta cerrado, que esta parcial y que falta antes de publicar.

## Lectura ejecutiva

La implementacion local ya cubre gran parte del plan SaaS y del redisenio premium: multi-tenant, Google auth contract-first, Mercado Pago contract-first, Google Drive/Sheets contract-first y ruta live, WhatsApp por tienda, DeepSeek como motor global real en local, PostgreSQL inicial, Centro de control, Observabilidad, Onboarding premium, Tienda viva sin inspector fijo y respuesta humana desde plataforma o WhatsApp.

Se incorpora un nuevo frente antes de continuar pruebas funcionales amplias: evolucionar **Tienda viva** hacia un gemelo digital gamificado. La pantalla no debe ser solo un mapa bonito; debe representar operaciones reales con logica de Digital Twin, experiencia tipo Business Tycoon, niveles de detalle, intervencion humana prioritaria, accesibilidad movil y rendimiento medido.

La decision de facturacion queda precisada: Mercado Pago se usara para suscripcion automatica mensual del SaaS, no para los pagos de domicilios de cada tienda.

El proyecto todavia no esta listo para piloto publico porque faltan validaciones reales con credenciales productivas/sandbox y URL publica: matriz amplia con DeepSeek real, Google live end-to-end repetido en entorno publico, Mercado Pago webhook real, WhatsApp Cloud API/Embedded Signup y endurecimiento de secretos/observabilidad.

El analisis del chat real de SuperMarket confirma que el agente no debe operar como parser de un unico mensaje. Debe trabajar con memoria de sesion, entender rafagas de mensajes, correcciones, pagos tardios, fotos, productos mal escritos, disponibilidad parcial y escalamiento prudente a humano. Varias capacidades ya existen en el repo; el plan se ajusta para cerrar las brechas reales, no para rehacer lo avanzado.

La publicacion debe quedar al final, como se definio. Antes de publicar hay trabajo local valioso: cerrar pruebas con PostgreSQL local, normalizar datos persistidos, formalizar el sistema visual y preparar la matriz de validacion.

## Cola priorizada pre-despliegue

| Prioridad | Bloque | Estado 2026-10-11 | Evidencia |
| --- | --- | --- | --- |
| 1 | Billing local: avisos, historial, checkout recuperable, descuentos, excepciones y limites por ciclo | Cerrado local | `npm run test:backend`, `npm run build` |
| 2 | Sincronizacion Mercado Pago administrable | Cerrado local con modo proveedor listo | Sync manual consulta `preapproval` si hay `MERCADOPAGO_ACCESS_TOKEN` y `mercadoPagoPreapprovalId`; rate limit 60 s; auditoria |
| 3 | Mantenimiento/reconciliacion ejecutable sin publicar | Cerrado local | `npm run billing:maintenance` escaneo 33 tiendas, 0 acciones pendientes |
| 4 | Prueba sandbox Mercado Pago sin URL publica | Preparada, bloqueada por credencial | `npm run test:mercadopago-sandbox` se salta correctamente sin `MERCADOPAGO_ACCESS_TOKEN` |
| 5 | Webhooks reales WhatsApp/Mercado Pago/OAuth publico | Pendiente por diseno | Requiere URL HTTPS publica y credenciales proveedor |

## Estado del plan SaaS

| Frente | Estado | Evidencia actual | Falta principal |
| --- | --- | --- | --- |
| Multi-tenant | Implementado local | `tenantId`, configuracion por tenant, bloqueo si no esta activo | Reforzar pruebas de aislamiento con auth real |
| Identidad Google | Parcial avanzado | Login Google contract-first, sesion httpOnly, CSRF, roles, membresias | Probar Google Sign-In real con `AUTH_REQUIRED=true` y `CSRF_REQUIRED=true` |
| PostgreSQL | Parcial avanzado | Migraciones, tablas espejo, lecturas/escrituras SQL criticas | Reducir dependencia restante del snapshot JSONB |
| Mercado Pago | Parcial avanzado local | Checkout, webhook, HMAC cuando hay secret, cambios de estado, UI owner/admin, job local de mantenimiento y persistencia PostgreSQL | Validar suscripcion automatica mensual con `preapproval`/`preapproval_plan`, cron y eventos reales sandbox/produccion |
| Google Drive/Sheets | Implementado local live | OAuth real, refresh token cifrado, provisioning live, herramientas Sheets y flujo de agente validados contra Google real | Repetir en URL publica/productiva |
| Aprovisionamiento | Implementado local live | Carpetas, hojas, encabezados, validaciones y escritura real en Sheets | Repetir en URL publica/productiva |
| WhatsApp por tienda | Parcial avanzado | Routing por `phoneNumberId`, outbound Graph API, wizard de alta | Probar Cloud API/Embedded Signup con URL publica |
| DeepSeek global | Implementado local real | Motor global en PostgreSQL con `provider=deepseek`, `model=deepseek-chat`, `simulator=null`, tokens medidos | Correr matriz amplia con DeepSeek real y rotar secreto antes de produccion |
| Agente comercial | Parcial avanzado | Razonamiento tipo tendero, `orderDraft`, lookup/upsert cliente por `wa_id`, herramientas, escalamiento humano, escritura de pedido y cuotas | Convertir chat real en matriz, probar sesiones multi-mensaje y ajustar politica de escalamiento |
| Intervencion humana | Implementado local | Bandeja priorizada permite aprobar/rechazar, guardar respuesta en plataforma o enviar WhatsApp; pedido confirmado escala a preparacion humana | Probar envio WhatsApp live con URL publica |
| Seguridad de secretos | Parcial | `secret_references` y vault local cifrado | Conectar secret manager administrado |
| Observabilidad backend | Parcial | Eventos, auditoria, uso, admin webhooks | Alertas productivas y politica de retencion |

## Estado del plan de experiencia premium

| Frente | Estado | Evidencia actual | Falta principal |
| --- | --- | --- | --- |
| Lenguaje visible | Implementado | Menos jerga: tenant, webhook, LLM, ACP y estados crudos salen de negocio | Barrido final en pantallas nuevas |
| Tienda viva / Gemelo digital | Parcial avanzado | Inspector fijo eliminado; ficha contextual por caso; zonas navegables, foco por zona, casos relacionados, alerta humana accionable, foco automatico por evento critico, tarjeta prioritaria con deep link a expediente humano exacto, backend crea/enlaza solicitud humana para `decision.requested`, avatar destacado, personajes mas humanos con props operativos auditables, bottom sheet movil, targets tactiles 44 px, foco/escape, roles ARIA, navegacion movil compacta, etiquetas compactas, camara con zoom/pan/reset, rueda/trackpad, arrastre directo, base tactil con pointer events, LOD inicial para 10/50/200/1.000 conversaciones, movimientos semanticos por estado/evento/etapa/herramienta y medicion visible RAF/CDP | Ampliar semantica con eventos productivos, diversidad visual de personajes y medicion GPU especializada si se requiere |
| Centro de control | Implementado parcial | Dashboard para plataforma, clientes, pagos, consumo, Motor IA, Mercado Pago y acciones admin | Conectar todos los datos a PostgreSQL normalizado y sandbox real |
| Observabilidad | Implementado parcial | Vista separada con filtros, KPIs, detalle tecnico y eventos | Alertas, retencion y datos reales de webhooks |
| Onboarding premium | Implementado parcial | Flujo guiado, franja de activacion, prueba guiada, WhatsApp asistido | Validacion real con Google/WhatsApp/MP |
| Configuracion global/tienda | Implementado parcial | DeepSeek global; Google y WhatsApp por tienda | Pantalla admin con parametros reales persistidos |
| Sistema visual | Implementado base | Guia visual formal creada con tokens, jerarquia, componentes, responsive y gobernanza | Extraer tokens a componentes reutilizables si el producto sigue creciendo |
| Normalizacion de datos | Pendiente | Normalizacion visual puntual | Normalizar datos persistidos en PostgreSQL/semillas |
| Pruebas visuales | Implementado base | `tests/verify_ui.py`, `tests/verify_long_content_ui.py`, build y revision local con PostgreSQL | Ampliar con regresion visual automatica si el producto sigue creciendo |

## Subplan Tienda viva como gemelo digital gamificado

Este subplan convierte **Tienda viva** en una representacion operativa real, no en una ilustracion decorativa. La experiencia debe sentirse como un videojuego de gestion empresarial, pero responder a eventos, conversaciones, pedidos, agentes, bloqueos y solicitudes humanas reales.

### Objetivo

Lograr que el usuario pueda comprender el estado de su negocio mirando una tienda viva: procesos activos, cuellos de botella, conversaciones, agentes IA, errores, pedidos confirmados e intervenciones humanas, tanto en escritorio como en movil.

### Principios

- Digital Twin: cada movimiento, alerta o estado visual debe corresponder a actividad real o estar marcado como ambientacion.
- Business Tycoon UI: vista inmersiva, zonas operativas, camara, zoom, agrupaciones y lectura rapida del negocio.
- Enterprise Gamification: mecanicas intuitivas sin infantilizar la herramienta.
- Agent-Based Visualization: clientes, conversaciones, agentes, aprobaciones y procesos deben tener representacion visual coherente.
- No modificar reglas de negocio, autorizacion ni contratos API sin justificacion tecnica.
- No introducir datos simulados como si fueran reales.

### Fases del subplan

| Fase | Resultado esperado | Dependencia | Estado |
| --- | --- | --- | --- |
| DG-01 Auditoria real | Diagnostico de Tienda viva con evidencia, severidad, impacto y esfuerzo | App local ejecutable | Cerrado 2026-10-11 |
| DG-02 Adaptive Game UX | Estrategia desktop/movil diferenciada; movil no debe ser una miniatura de desktop | DG-01 | Parcial avanzado: ficha inferior, controles tactiles, navegacion movil por zonas, etiquetas compactas, camara con zoom/pan/reset, rueda/trackpad, arrastre directo y base pinch |
| DG-03 Niveles de detalle | LOD 1 empresa, LOD 2 zona, LOD 3 caso individual con conteos reales | DG-02 | Parcial avanzado: LOD individual/zona/empresa con clusters por zona |
| DG-04 Personajes y animaciones | Personajes mas humanos, expresivos y estados visuales claros | DG-03 | Parcial avanzado: rostro mas humano, moods, props operativos por estado real, data attrs auditables y animaciones semanticas |
| DG-05 Animacion semantica | Movimientos ligados a eventos reales: entrada, consulta, pedido, aprobacion, error, salida | DG-04 | Parcial avanzado: resolucion por estado critico, evento reciente, etapa, herramienta y fallback de ruta |
| DG-06 Intervencion humana prioritaria | Alertas faciles de localizar; apertura de solicitud, decision y actualizacion visual | Respuesta humana backend/UI | Parcial avanzado: alerta del mapa abre aprobaciones, la camara enfoca automaticamente eventos criticos, el caso se destaca, backend autoenlaza eventos criticos a solicitud humana y la zona de aprobacion prioriza casos criticos |
| DG-07 Rendimiento y escalabilidad | Medicion 10, 50, 200 y 1.000 conversaciones; LOD, culling o agrupacion cuando aplique | DG-03 | Parcial avanzado: auditoria con backend local, navegador visible, RAF/CDP, LOD, clusters y modo rendimiento; GPU especializada queda pendiente |
| DG-08 Accesibilidad y experiencia movil | Controles tactiles, bottom sheets, movimiento reducido, navegacion alternativa a gestos | DG-02 | Parcial avanzado: bottom sheet, 44 px touch targets, foco/escape, roles ARIA, `aria-current`, `aria-pressed`, navegacion movil compacta y auditoria dedicada |
| DG-09 Implementacion incremental | Mejoras por componentes sin reconstruir la app ni romper flujos actuales | DG-01 a DG-08 | Cerrado localmente: incrementos P0-09 a P0-17 integrados por componentes |
| DG-10 Validacion antes/despues | Pruebas desktop, movil, funcionales, visuales y rendimiento documentado | DG-09 | Cerrado localmente: comparativa antes/despues y evidencia P0-18 documentadas |

### Criterios de aceptacion

- Desktop conserva experiencia inmersiva tipo Tycoon.
- Movil ofrece experiencia gamificada adaptada, no una version miniatura de escritorio.
- Todas las zonas importantes son navegables.
- Los personajes pueden seleccionarse comodamente.
- Las conversaciones pueden consultarse desde personajes o zonas.
- Las solicitudes de intervencion humana son visibles sin recorrer toda la tienda.
- Las alertas criticas tienen prioridad visual.
- Los movimientos representan eventos operativos reales o estan claramente diferenciados como ambientacion.
- Los conteos agregados corresponden a datos reales.
- El renderizado se adapta al volumen de conversaciones.
- La interfaz funciona en orientacion vertical.
- No hay desplazamientos horizontales accidentales.
- No hay errores criticos de consola.
- Las funcionalidades existentes siguen operativas.
- Hay pruebas funcionales, visuales y de rendimiento con evidencia.

### Entregables esperados

| Entregable | Contenido |
| --- | --- |
| A. Diagnostico inicial | Tabla de problemas con evidencia, severidad, impacto, prioridad y esfuerzo |
| B. Plan de correccion | Componentes afectados, cambios propuestos, riesgos y dependencias |
| C. Implementacion | Codigo integrado en la app existente, por componentes |
| D. Validacion | Resultados desktop, movil, funcionales y rendimiento |
| E. Antes/despues | Que mejoro, que queda pendiente y limitaciones |
| F. Recomendaciones futuras | Mejoras separadas de las correcciones necesarias |

### Estado actual del subplan

Existe una base visual y funcional: mapa de tienda, zonas, personajes, seleccion de caso, ficha contextual, alertas y bandeja humana. La auditoria inicial quedo documentada en `docs/Diagnostico-tienda-viva-gemelo-digital.md`. Ya hay dos incrementos de P0-09 implementados, P0-10 parcial avanzado, P0-11 inicial, P0-12 inicial, P0-13 inicial, P0-14 inicial, P0-15 local, P0-16 local, P0-17 local y P0-18 local: ficha movil usable, bottom sheet, foco/escape, controles tactiles 44 px, navegacion por zonas, navegacion movil principal compacta, etiquetas compactas, casos relacionados, alerta humana accionable, foco automatico por evento critico, tarjeta prioritaria con deep link dinamico a la solicitud humana real, backend autoenlaza `decision.requested`/`approval.requested`/`human_handoff` a solicitudes humanas, avatar destacado, personajes mas humanos con expresiones y props operativos, camara con zoom/pan/reset, rueda/trackpad, arrastre directo, LOD inicial con fixtures de 10/50/200/1.000 conversaciones, clusters por zona, modo rendimiento para alto volumen, medicion RAF/CDP headless con backend local y personajes ubicados por senal semantica. Queda validado localmente como base de gemelo digital gamificado; la validacion productiva final depende de eventos reales y URL publica.

## Subplan agente comercial heuristico basado en interacciones reales

Este subplan aterriza el analisis del chat real de SuperMarket y lo cruza con el codigo existente. No parte de cero: el repo ya tiene runtime de agente, planner LLM, herramientas Google/WhatsApp, handoff humano, pedidos en Sheets y matriz ampliada a 50 escenarios. El foco ahora es cerrar la brecha entre una demo local robusta y un agente que soporte el comportamiento real de una tienda de barrio por WhatsApp.

### Evidencia del repo

| Capacidad | Estado en repo | Evidencia |
| --- | --- | --- |
| Cliente identificado por WhatsApp | Implementado parcial avanzado | `AgentRuntime.routeConversation` llama `google_sheets_customer_profile_lookup`; `ToolRegistry` lee/escribe `Clientes` por `wa_id`; pruebas `backend-smoke`, `postgres-smoke` y `google-live-contract` lo cubren |
| Cliente nuevo pide nombre/direccion | Implementado local | `llmPlanner` agrega `customer_name` y `delivery_address`; `handleOrderClarification` puede guardar perfil; matriz Colombia cubre casos de cliente nuevo |
| Memoria de pedido | Implementado parcial | `conversation.orderDraft` permite continuar cantidades, pagos, remociones y confirmaciones |
| Parser heuristico con LLM | Implementado parcial | Prompt de `buildPlannerPrompt` exige inferencia, modismos, errores, canasta y herramientas; DeepSeek real ya respondio por API en smoke |
| Respaldo heuristico local | Implementado | `mockStructuredParse`, `extractUnknownOrderItems`, similitud por tokens/Levenshtein y filtros de catalogo sirven como fallback |
| Busqueda en catalogo vivo | Implementado parcial avanzado | `google_sheets_read_table` usa Google Sheets live cuando hay conexion; ranking por query/categoria/sku |
| Ambiguedad por presentacion | Implementado parcial | `findPresentationVariants`, `presentation:<producto>` y respuestas que piden escoger presentacion |
| Producto no encontrado o sin stock | Implementado local | `needsHumanProductResolution` escala por `product:*` o `stock:*`; pruebas cubren Club Colombia/Marlboro y stock cero |
| Pedido confirmado sube a humano | Implementado local | `handleOrderConfirmation` escribe `Pedidos` y crea `human_handoff` para preparar y entregar |
| Respuesta humana desde plataforma/WhatsApp | Implementado local | `resolveHumanRequest` y `whatsapp_business_messaging` permiten respuesta humana en plataforma o WhatsApp mock/live |
| Trazabilidad | Implementado parcial | Eventos `llm.plan.created`, `tool.call.*`, auditoria, uso de tokens y mensajes quedan registrados; falta reporte legible por caso |

### Lectura del chat real SuperMarket

El chat real muestra patrones que deben entrar a la matriz de validacion:

- El cliente conversa por rafagas: saludo, solicitud de domicilio, productos, pago, correcciones y confirmaciones.
- La tienda responde con frases cortas y operativas: `ok`, `si veci`, `medio de pago?`, `solo eso?`, `me confirma`.
- Hay productos con escritura informal o incorrecta: `Malboro`, `sandia`, `Cfrut`, `ponque`, referencias por foto y marcas incompletas.
- El pago puede llegar tarde y no siempre significa comprobante confirmado; puede ser solo preferencia: efectivo, Nequi, datáfono o tarjeta.
- Las fotos son frecuentes y deben escalar o solicitar confirmacion humana cuando el agente no pueda interpretarlas con seguridad.
- Las correcciones importan: `sin ese`, `entonces`, `mejor`, `la de abajo`, `no hay problema`, `asi no mas`.
- Los reclamos posteriores requieren trazabilidad de canasta, cantidades, preparacion humana y entrega.

### Brechas reales detectadas

| ID | Brecha | Impacto | Ajuste necesario |
| --- | --- | --- | --- |
| AC-01 | La matriz amplia aun corre en `codex_simulated_deepseek` | No mide calidad real del proveedor final | Crear runner de matriz con DeepSeek real y umbrales de aprobacion por caso |
| AC-02 | El chat real no esta persistido como diagnostico formal | El aprendizaje se puede perder | Crear documento de analisis y convertir patrones a escenarios ejecutables |
| AC-03 | La memoria de sesion existe, pero falta probar rafagas reales completas | Riesgo de cerrar pedido antes de que el cliente termine | Agregar casos multi-turno con saludo, productos, pago, correccion y confirmacion |
| AC-04 | Hay heuristicas locales de respaldo mezcladas con comportamiento LLM | Puede parecer hardcodeado si no se audita | Documentar separacion: LLM decide hipotesis; runtime valida con herramientas; fallback solo si proveedor falla |
| AC-05 | Falta politica explicita de confianza | Riesgo de preguntar demasiado o escalar tarde | Definir umbrales: cotizar, preguntar, disponibilidad parcial, escalar humano |
| AC-06 | No hay reporte de trazabilidad amigable por caso | Dificulta evaluar decisiones del agente | Generar salida por caso: mensaje, perfil, plan, herramientas, catalogo, decision, respuesta |
| AC-07 | Productos por foto/audio/comprobante aun no estan en matriz real | Canal WhatsApp real usa muchos adjuntos | Agregar casos contract-first para media y dejar vision/audio para fase posterior |
| AC-08 | Correcciones de pedido estan cubiertas parcialmente | Puede fallar en pedidos largos reales | Agregar pruebas de `sin X`, `agrega Y`, `mejor Z`, `solo eso`, `asi no mas` |
| AC-09 | La confirmacion de pago se separa de preferencia, pero falta mas casuistica | Riesgo de registrar pago sin evidencia | Probar datáfono/tarjeta/Nequi/efectivo como preferencia y comprobante como aprobacion humana |
| AC-10 | Catalogo de prueba de 20 productos es limitado frente a chat real | Reduce confianza de piloto | Crear set semilla ampliado con top productos reales, sin depender de reglas por producto |

### Plan de implementacion local

| Paso | Objetivo | Archivos probables | Evidencia de cierre |
| --- | --- | --- | --- |
| AC-P1 | Persistir diagnostico del chat real | `docs/Analisis-interacciones-whatsapp-supermarket.md` | Metricas, patrones, riesgos y ejemplos anonimizados |
| AC-P2 | Ampliar matriz con casos reales derivados | `server/tests/fixtures/colombiaAgentScenarios.js`, `docs/Matriz-pruebas-agente-comercial-colombia.md` | Nuevos escenarios multi-turno y correcciones pasan localmente |
| AC-P3 | Crear runner DeepSeek real controlado | `server/tests/deepseek-real-scenarios.mjs`, `package.json` | Ejecuta subconjunto sin simulador, registra tokens y resultado por caso |
| AC-P4 | Agregar trazabilidad exportable por caso | `server/tests/*`, posible `docs/trazas/` | Markdown/JSON por caso con plan, herramientas y decision |
| AC-P5 | Formalizar politica de confianza | `server/services/llmPlanner.js`, `server/services/agentRuntime.js`, docs | Umbrales documentados para cotizar/preguntar/escalar |
| AC-P6 | Reforzar rafagas de conversacion | `server/tests/fixtures/colombiaAgentScenarios.js` | Casos saludo -> productos -> pago -> correccion -> confirmacion verdes |
| AC-P7 | Reforzar pago y comprobantes | `server/tests/backend-smoke.mjs`, fixtures | Preferencia de pago no registra pago; comprobante pide aprobacion |
| AC-P8 | Preparar media contract-first | `server/tests/backend-smoke.mjs`, `ToolRegistry` si aplica | Imagen/audio/comprobante crean handoff con contexto suficiente |
| AC-P9 | Validar contra Google Sheets live | `tests/verify_google_live_sheets.mjs`, runner del agente | Casos seleccionados consultan catalogo real y guardan cliente/pedido real |
| AC-P10 | Actualizar checklist de piloto | `docs/Checklist-piloto-produccion.md` | Criterios de agente heuristico incluidos antes de publicar |

### Avance ejecutado 2026-10-11

- AC-P1 cerrado: se creo `docs/Analisis-interacciones-whatsapp-supermarket.md` con metricas, patrones, politica de confianza e implicaciones del chat real.
- AC-P2 y AC-P6 cerrados localmente: la matriz subio de 40 a 50 escenarios y de 43 a 57 pasos, incorporando rafagas reales, pago tardio, correcciones, agregados, multimedia, reclamos y cierre.
- AC-P3 cerrado localmente: se agrego `npm run test:deepseek-real` con `server/tests/deepseek-real-scenarios.mjs` para ejecutar subconjunto con DeepSeek real y reporte JSON.
- AC-P4 cerrado localmente: `npm run test:colombia` genera `test-results-colombia-scenarios.json`; `npm run test:codex-cli` genera `test-results-codex-cli-scenarios.json`; `npm run test:deepseek-real` genera `test-results-deepseek-real-scenarios.json`.
- AC-P5 cerrado localmente: la politica de confianza quedo documentada y se agregaron barandas para reclamos y preferencia de pago con pedido abierto.
- AC-P7 y AC-P8 cerrados localmente: preferencia de pago no registra pago confirmado, comprobante requiere aprobacion, imagen abre handoff.
- AC-P9 cerrado en modo local/contract-first: la validacion Google live sigue cubierta por `google-live-contract`; los escenarios nuevos se ejecutaron contra store aislado y herramientas mock/local. La repeticion contra Sheets live queda como prueba de piloto con datos controlados.
- AC-P10 cerrado: checklist de piloto actualizado con matriz heuristica, DeepSeek real, trazabilidad y politica de confianza.
- Mejora de runtime: `agregame`/`tambien` conserva canasta abierta y suma items; `sin el/la` remueve items; reclamos de entrega escalan a humano; `5000 de X` se trata como valor, no cantidad.
- Mejora de razonamiento: `Codex CLI` queda como simulador barato de DeepSeek para subconjunto critico, con normalizacion de intent, modo de razonamiento y preferencias de pago antes de gastar tokens del proveedor real.
- Evidencia: `npm run test:colombia` paso con 57 pasos/50 escenarios; `npm run test:codex-cli` paso con 6/6 intents; `npm run test:deepseek-real` paso con 6/6 intents; `npm run test:backend` paso; `npm run build` paso.

### Criterios de aceptacion del agente

- El agente conserva todos los productos candidatos de una canasta, incluso si algunos no aparecen en catalogo.
- Si el cliente es nuevo y pide domicilio, solicita nombre y direccion antes de finalizar.
- Si el cliente pregunta disponibilidad, consulta catalogo antes de afirmar.
- Si hay varias presentaciones razonables, pregunta por tamano/variedad.
- Si la coincidencia es baja, el stock no alcanza o el producto no aparece, escala a humano con contexto.
- Si el cliente confirma pedido completo, escribe `Pedidos` y crea handoff de preparacion.
- Si el cliente solo indica forma de pago, no registra pago confirmado.
- Si hay comprobante, reclamo o foto, crea solicitud humana.
- Cada caso deja trazabilidad de plan LLM, herramientas llamadas, fuente de catalogo, decision y respuesta.
- La matriz con DeepSeek real no debe depender de alias hardcodeados por producto para aprobar.

## Subplan Mercado Pago dentro del plan unificado

El detalle tecnico vive en `docs/Plan-implementacion-Mercado-Pago-SaaS.md`, pero el control de avance pertenece a este plan unificado.

### Objetivo Mercado Pago

Implementar Mercado Pago como motor de suscripcion automatica mensual del SaaS, sin mezclarlo con los pagos de domicilios de cada tienda.

### Decisiones cerradas

- Suscripcion automatica mensual.
- Un plan activo inicial, con soporte para multiples planes activables/desactivables.
- Trial configurable desde administracion, desactivado por defecto.
- Periodo de gracia inicial de 5 dias, parametrizable.
- Durante gracia opera normal con avisos progresivos; al vencer se suspende.
- Cancelacion autoservicio con acceso hasta fin del periodo pagado.
- Downgrade al siguiente ciclo; upgrade inmediato; sin devoluciones.
- Suspendido conserva acceso restringido; cancelado conserva solo lectura por 30 dias.
- Reactivacion autoservicio segun causa y antiguedad.
- Notificaciones por microapp, Centro de control y WhatsApp configurable; sin email.
- Cobro y ciclo de consumo por aniversario de suscripcion.
- Plan inicial con 1.000 domicilios y 5.000 interacciones por ciclo.
- Sin excedentes automaticos; upgrade o excepcion admin.
- Descuentos manuales por cliente, sin cupones publicos.
- Historial de pagos con referencia/comprobante Mercado Pago; sin factura fiscal propia inicial.
- Precio final unico; comision Mercado Pago incluida en el precio comercial.
- Sincronizacion manual admin y reconciliacion automatica.
- Diagnostico pre-pago liviano; configuracion completa despues de suscripcion activa.
- Checkout externo por redireccion; checkout abandonado recuperable por 7 dias.
- Embudo SaaS y motivos de abandono/bloqueo.

### Fases Mercado Pago

| Fase | Resultado | Dependencia | Estado |
| --- | --- | --- | --- |
| MP-01 Modelo billing | Tablas/entidades de planes, suscripciones, pagos, descuentos, excepciones y ciclos | PostgreSQL local | Ejecutado local |
| MP-02 Planes admin | Crear, editar, activar/desactivar planes y default | MP-01 | Ejecutado local backend/UI |
| MP-03 Checkout | Crear/continuar checkout externo y `pending_payment` | MP-01, credenciales MP sandbox | Ejecutado contract-first; falta sandbox real |
| MP-04 Webhooks | Webhook idempotente, validacion y consulta al proveedor | Credenciales MP sandbox; URL publica para prueba real | Parcial: firma/idempotencia base; falta prueba real |
| MP-05 Sincronizacion | Boton admin de sync por cliente con auditoria | MP-03 | Ejecutado contract-first; falta consulta real proveedor |
| MP-06 Pagos/historial | Historial owner/admin y comprobantes/referencias | MP-04/MP-05 | Ejecutado local |
| MP-07 Ciclos/limites | Ciclo por aniversario, 1.000 domicilios, 5.000 interacciones, avisos 80/90/100 | MP-01 | Parcial: ciclo/modelo local listo; falta enforcement completo UI/operacion |
| MP-08 Gracia/suspension | 5 dias de gracia, avisos y suspension automatica | MP-07 | Parcial local: job inicia gracia y suspende al vencimiento; faltan avisos progresivos |
| MP-09 Cancelacion/reactivacion | Cancelar, solo lectura 30 dias y reactivar segun antiguedad | MP-08 | Pendiente |
| MP-10 Descuentos/excepciones | Descuentos manuales y excepciones temporales auditadas | MP-01 | Ejecutado local backend/UI admin rapida |
| MP-11 Reconciliacion | Jobs diarios y frecuentes para estados sensibles | MP-04/MP-05 | Parcial local: endpoint admin ejecuta conciliacion; falta cron y proveedor real |
| MP-12 Embudo | Funnel cuenta-diagnostico-checkout-pago-Google-WhatsApp-activacion | Eventos onboarding | Ejecutado local: cuenta, checkout, pago, Google, WhatsApp, activacion y motivo manual |
| MP-13 UI cliente/admin | Facturacion owner y Centro de control admin | MP-01 a MP-12 | Ejecutado local; falta sandbox real e historial/comprobantes completos |
| MP-14 Pruebas | Unitarias, integracion, seguridad, UI y sandbox | Implementacion completa | Parcial: backend/PostgreSQL/build/UI local verdes |

### Avance ejecutado 2026-10-10

- Se agrego migracion `006_billing_subscriptions.sql` con tablas de planes, pagos, eventos, descuentos, excepciones, ciclos y embudo.
- Se agrego modelo billing en estado local/PostgreSQL con plan default `ventas_ia_1000_domicilios`.
- Se agregaron endpoints owner en `/api/billing`: planes, estado, checkout, continuar checkout, cancelar, cambiar plan e historial de pagos.
- Se agregaron endpoints admin en `/api/admin/billing`: planes, sync, descuentos, excepciones, cambio de plan y embudo.
- `pending_payment` queda como estado canonico para checkout pendiente.
- Checkout abandonado queda recuperable con `checkoutExpiresAt`.
- Mock activation crea periodo por aniversario, pago local aprobado y ciclo de consumo.
- Descuentos y excepciones temporales quedan auditables en backend.
- Embudo registra cuenta creada, checkout, pago, Google, WhatsApp y activacion.
- PostgreSQL persiste las nuevas entidades de billing en tablas dedicadas.
- Onboarding owner muestra plan, valor, proximo cobro, uso de domicilios/interacciones, ultimo pago y acciones de checkout/cancelacion.
- Centro de control admin muestra plan principal, estado de prueba/gracia, embudo de activacion, estado de pago del cliente seleccionado y acciones de sincronizacion, excepcion 48h y descuento piloto.
- Centro de control admin permite crear, editar, activar/desactivar y marcar plan principal; tambien parametriza trial y dias de gracia.
- Centro de control admin permite ejecutar conciliacion local de facturacion: vence checkouts, abre gracia, suspende al finalizar gracia, cancela al cierre de periodo y expira descuentos/excepciones temporales.
- Se corrigio el orden de routers para que `/api/admin/billing/*` responda antes del router generico `/api`.
- Se corrigio duplicidad de encabezado en Conversaciones para mantener jerarquia accesible y evitar ambiguedad en pruebas UI.
- Se normalizaron semillas, eventos y etiquetas visibles para ocultar jerga tecnica (`ACP`, `sandbox`, `tenant`, `Cloud API`, `OAuth`) en pantallas de negocio; las claves internas se conservan como contratos de datos.
- Se creo `docs/Guia-visual-sistema-diseno-premium.md` con tokens, color semantico, tipografia, layout, componentes, reglas para Tienda viva, Centro de control, Observabilidad, Onboarding, responsive, accesibilidad y gobernanza visual.
- Se corrigieron cortes de texto en Onboarding, Centro de control y billing cuando hay referencias largas, muchos clientes y estados reales; se agrego `tests/verify_long_content_ui.py` para escanear desktop, tablet y movil contra datos largos en PostgreSQL local.
- Se creo y amplio `docs/Matriz-pruebas-agente-comercial-colombia.md` hasta 50 escenarios, 57 pasos, catalogo base de 20 productos, criterios de aceptacion y trazabilidad esperada del agente.
- Se endurecio el piloto Google local: si `ALLOW_DEV_GOOGLE_LOGIN=false`, el backend rechaza `dev-google-id-token`; los scripts Google fuerzan `AUTH_REQUIRED=true`, `CSRF_REQUIRED=true`, `ALLOW_DEV_GOOGLE_LOGIN=false` y exponen `VITE_GOOGLE_CLIENT_ID`.
- Se valido Google Sign-In real local desde `http://127.0.0.1:3001` con `lmcorredor@gmail.com`: auditoria `auth.login` en modo `live`, rol `owner` y aislamiento al tenant `tienda-piloto-google`. Se agrego `build:google` para compilar el frontend con el Client ID y servirlo desde el backend en el origen autorizado.
- Se valido Google Drive/Sheets live para `tienda-piloto-google`: OAuth conectado con refresh token en vault, workspace `1iHQ_hWR4Bn2uBZqwhV94-zKTtsmihZ3Hvd97xgOHfxY` provisionado, 100 productos sembrados en `Catalogo`, cliente de prueba escrito/leido en `Clientes` y pedido escrito en `Pedidos`.

Evidencia:

- `npm run build`
- `npm run test:backend`
- `POSTGRES_TEST_DATABASE_URL=postgres://usrventas:usrventas@127.0.0.1:5432/ventas_ia_dev DATABASE_SSL=disable npm run test:postgres`
- `python .../with_server.py --server "npm run backend" --port 3001 --server "npm run dev -- --port 5173" --port 5173 --timeout 45 -- python tests\verify_ui.py`
- `UI_BASE_URL=http://127.0.0.1:3101 python tests\verify_long_content_ui.py` con backend local sobre PostgreSQL
- `npm run test:colombia`
- `npm run test:backend` con validacion adicional de bloqueo de `dev-google-id-token` cuando `ALLOW_DEV_GOOGLE_LOGIN=false`
- `npm run build`
- `POSTGRES_TEST_DATABASE_URL=postgres://usrventas:usrventas@127.0.0.1:5432/ventas_ia_dev DATABASE_SSL=disable npm run test:postgres`
- `npm run build:google`
- `UI_BASE_URL=http://127.0.0.1:3001 python tests\verify_google_auth_gate.py`
- Consulta PostgreSQL local: `lmcorredor@gmail.com` quedo con membresia `owner` activa solo en `tienda-piloto-google` y ultimo `auth.login` con `mode=live`
- `node scripts\seed-bogota-catalog.mjs tienda-piloto-google`
- `npm run test:google-live-sheets`
- Se confirmo que el pedido confirmado ejecuta `google_sheets_order_write` con estado `pending_human_preparation`, crea `human_handoff` para preparar y entregar, y envia recibo por WhatsApp.
- Se agrego resolucion humana con canal: respuesta guardada en plataforma o enviada por WhatsApp desde la bandeja de intervencion, con auditoria `human_response.platform_saved` / `human_response.whatsapp_sent`.
- Se ejecuto P0-08: auditoria real de Tienda viva como gemelo digital gamificado. Evidencia: `docs/Diagnostico-tienda-viva-gemelo-digital.md`, `tests/audit_tienda_viva.py`, `test-results-tienda-viva-audit.json` y capturas desktop/movil.
- Se avanzo P0-09 en dos cortes: alerta humana del mapa accionable, foco visual por zona, casos relacionados por zona, navegacion tactil movil por zonas, semantica interactiva de mapa corregida, controles tactiles de 44 px en movil y ficha inferior usable para caso seleccionado.
- Se avanzo P0-10: fixtures de carga locales, LOD individual/zona/empresa, clusters por zona, modo rendimiento, auditoria con backend local y medicion visible RAF/CDP para 10, 50, 200 y 1.000 conversaciones.
- Se avanzo P0-11: los personajes de conversaciones ya no usan movimiento ciclico por tiempo; se ubican por estado critico, evento reciente, etapa, herramienta o ruta configurada. Evidencia: `tests/audit_tienda_viva_semantic.py`, `test-results-tienda-viva-semantic.json`, `npm run build` y `python tests\audit_tienda_viva.py`.
- Se avanzo P0-12: camara inicial de Tienda viva con zoom, paneo, reset, enfoque por zona y prueba movil. Evidencia: `tests/audit_tienda_viva_camera.py`, `test-results-tienda-viva-camera.json`, `npm run build`, `python tests\audit_tienda_viva.py` y `python tests\audit_tienda_viva_semantic.py`.
- Se avanzo P0-13: etiquetas compactas moviles y validacion de camara con LOD alto. Evidencia: `tests/audit_tienda_viva_camera_lod.py`, `test-results-tienda-viva-camera-lod.json` y capturas para 50, 200 y 1.000 conversaciones.
- Se avanzo P0-14: foco automatico de Tienda viva por evento critico, tarjeta prioritaria, avatar destacado, apertura del expediente humano exacto (`hitl-884`/`wa-1045`) desde el mapa y backend idempotente que crea/enlaza solicitud humana para `decision.requested`. Evidencia: `tests/audit_tienda_viva_priority_focus.py`, `test-results-tienda-viva-priority-focus.json`, `test-results-tienda-viva-priority-focus.png`, `node server/tests/backend-smoke.mjs`, `node server/tests/llm-provider.mjs`, `npm run build`, `python tests\audit_tienda_viva_camera.py`, `python tests\audit_tienda_viva.py`, `python tests\audit_tienda_viva_semantic.py` y `python tests\audit_tienda_viva_camera_lod.py`.
- Se avanzo P0-15: gestos de camara refinados con zoom por rueda/trackpad, arrastre directo sobre escenario, base tactil con pointer events, supresion de clic accidental post-arrastre y listener no pasivo para evitar warnings de rueda. Evidencia: `tests/audit_tienda_viva_camera.py`, `test-results-tienda-viva-camera.json`, `npm run build`, `python tests\audit_tienda_viva_priority_focus.py`, `python tests\audit_tienda_viva.py`, `python tests\audit_tienda_viva_camera_lod.py` y `python tests\audit_tienda_viva_semantic.py`.
- Se avanzo P0-16: personajes mas humanos y expresivos con cejas, nariz, mejillas, mood por conversacion y props operativos auditables por estado real (`human`, `blocked`, `searching`, `basket`, `checkout`, `message`, `working`). Evidencia: `tests/audit_tienda_viva_semantic.py`, `test-results-tienda-viva-semantic.json`, `test-results-tienda-viva-semantic.png`, `npm run build`, `python tests\audit_tienda_viva.py`, `python tests\audit_tienda_viva_priority_focus.py`, `python tests\audit_tienda_viva_camera.py`, `python tests\audit_tienda_viva_camera_lod.py` y `python tests\audit_tienda_viva_lod.py`.
- Se avanzo P0-17: accesibilidad y movil con bottom sheet fijo, foco al abrir, cierre por Escape, targets tactiles de 44 px, roles ARIA, `aria-current`, `aria-pressed`, navegacion principal movil compacta y auditoria dedicada. Evidencia: `tests/audit_tienda_viva_accessibility.py`, `test-results-tienda-viva-accessibility.json`, `test-results-tienda-viva-accessibility.png`, `npm run build`, `python tests\audit_tienda_viva.py`, `python tests\audit_tienda_viva_priority_focus.py`, `python tests\audit_tienda_viva_camera.py`, `python tests\audit_tienda_viva_semantic.py`, `python tests\audit_tienda_viva_camera_lod.py` y `python tests\audit_tienda_viva_lod.py`.
- Se cerro P0-18/DG-10: comparativa antes/despues local, ajuste de prueba fragil de foco humano, tarjeta prioritaria con `data-priority-request-id` y `data-priority-conversation-id`, y evidencia consolidada desktop/movil/accesibilidad/semantica/foco humano/LOD/rendimiento. Evidencia: `docs/Diagnostico-tienda-viva-gemelo-digital.md`, `tests/audit_tienda_viva_priority_focus.py`, `test-results-tienda-viva-priority-focus.json`, `test-results-tienda-viva-audit.json`, `test-results-tienda-viva-accessibility.json`, `test-results-tienda-viva-semantic.json`, `test-results-tienda-viva-lod.json`, `test-results-tienda-viva-camera-lod.json`, `test-results-tienda-viva-performance-headless.json` y `npm run build`.
- Se cerro P1-01/P1-02 localmente: DeepSeek real quedo configurado por referencia segura `DEEPSEEK_API_KEY` en `.env.google.local`, la configuracion global del Motor IA en PostgreSQL quedo con `provider=deepseek`, `model=deepseek-chat`, `simulator=null`, `baseUrlRef=DEEPSEEK_BASE_URL`, `timeoutMs=30000` y `maxTokens=1600`. Smoke real: `executionMode=provider_api`, `intent=delivery_order`, `recommendedTools=[google_sheets_read_table, whatsapp_business_messaging]`, uso reportado por proveedor: 1.904 prompt tokens, 446 completion tokens, 2.350 total tokens, duracion 2.793 ms.

### Corte de ejecucion local

Antes de publicar, este subplan debe llegar como minimo a:

- Modelo billing creado.
- Plan activo inicial configurado.
- Checkout sandbox/contract-first funcionando.
- `pending_payment` y continuar pago funcionando.
- Historial de pagos preparado.
- Ciclos de consumo por aniversario.
- Reglas de gracia, limites, cancelacion y reactivacion probadas localmente.
- UI admin/owner con estados principales.

Las pruebas reales de webhook Mercado Pago quedan para la etapa de URL publica.

## Brechas consolidadas

### P0 - Cerrar localmente antes de publicar

| ID | Pendiente | Cierre esperado |
| --- | --- | --- |
| P0-01 | Ejecutar matriz local completa: build, backend, UI y PostgreSQL local | Cerrado 2026-10-10: build, backend, PostgreSQL y UI pasaron |
| P0-02 | Revisar `.env.example` contra el checklist piloto | Cerrado 2026-10-10: variables minimas presentes sin secretos reales |
| P0-03 | Normalizar datos persistidos y semillas visibles | Cerrado 2026-10-10: semillas, eventos y etiquetas visibles normalizadas; claves internas como `tenantId`, `phoneNumberId` y `sandbox_ready` se conservan como contratos |
| P0-04 | Crear guia visual formal | Cerrado 2026-10-10: `docs/Guia-visual-sistema-diseno-premium.md` documenta tokens, colores, tipografia, jerarquia, componentes y reglas responsive |
| P0-05 | Revisar pantallas con listas largas y textos reales | Cerrado 2026-10-10: prueba responsive con datos largos en PostgreSQL local paso sin overflow horizontal ni cortes inesperados |
| P0-06 | Probar PostgreSQL local como fuente principal | Cerrado 2026-10-10: `npm run test:postgres` paso con `usrventas/usrventas` |
| P0-07 | Documentar matriz de pruebas del agente | Cerrado 2026-10-10: `docs/Matriz-pruebas-agente-comercial-colombia.md` documenta casos por grupo, catalogo, criterios, trazabilidad y ejecucion verde |
| P0-08 | Auditar Tienda viva como gemelo digital gamificado | Cerrado 2026-10-11: `docs/Diagnostico-tienda-viva-gemelo-digital.md` documenta evidencia, severidad, impacto, prioridad y esfuerzo |
| P0-09 | Implementar Adaptive Game UX para Tienda viva | Cerrado localmente 2026-10-11: movil/ficha inferior, navegacion real por zonas, casos relacionados, alerta humana accionable, foco automatico por evento critico, tarjeta prioritaria con deep link a expediente humano exacto, backend autoenlaza decisiones humanas, avatar destacado, etiquetas compactas, camara con botones, rueda/trackpad, arrastre directo y base tactil listos; minimapa queda como mejora opcional |
| P0-10 | Implementar LOD y rendimiento de Tienda viva | Cerrado localmente con deuda no bloqueante: fixtures 10/50/200/1.000, LOD individual/zona/empresa, clusters, modo rendimiento, auditoria con backend local, RAF/CDP headless y validacion de camara con LOD alto listos; falta GPU especializada si se exige para produccion |

### P1 - Requiere credenciales reales, pero no URL publica

| ID | Pendiente | Cierre esperado |
| --- | --- | --- |
| P1-01 | Cargar API key real de DeepSeek en entorno local seguro | Cerrado local 2026-10-11: clave guardada en `.env.google.local` ignorado por Git, usando referencia `DEEPSEEK_API_KEY` |
| P1-02 | Desactivar simulador Codex para prueba real | Cerrado local 2026-10-11: Motor IA global en PostgreSQL con `simulator=null`; prueba devuelve `executionMode=provider_api` |
| P1-03 | Probar Google Sign-In real con el proyecto creado | Cerrado 2026-10-10: `lmcorredor@gmail.com` entra con Google live y solo ve `tienda-piloto-google` |
| P1-04 | Activar `AUTH_REQUIRED=true` y `CSRF_REQUIRED=true` en local | Cerrado 2026-10-10: 401/403 correctos, mutaciones con token CSRF y sandbox Google bloqueado cuando el piloto usa credenciales reales |
| P1-05 | Ejecutar OAuth Drive/Sheets real local | Cerrado 2026-10-10: refresh token cifrado y workspace Google en modo `live` |
| P1-06 | Probar lectura/escritura real en Sheets | Cerrado 2026-10-10: `Catalogo` leido, `Clientes` upsert/leido y `Pedidos` escrito en Google Sheets real |
| P1-07 | Evaluar calidad del agente con DeepSeek real | Cerrado local controlado: `npm run test:deepseek-real` paso con 6/6 intents en subconjunto representativo y reporte JSON |
| P1-08 | Implementar prueba local de creacion de suscripcion Mercado Pago en sandbox | Preparado 2026-10-11: `npm run test:mercadopago-sandbox` creado; se salta sin `MERCADOPAGO_ACCESS_TOKEN`. Falta credencial sandbox real para cerrar contra proveedor |
| P1-09 | Agregar configuracion admin de periodo de prueba | Cerrado local 2026-10-11: planes administrables incluyen `trialEnabled`/`trialDays`, estado owner/admin emite aviso `trial_active` y build/backend verdes |
| P1-10 | Agregar configuracion admin de periodo de gracia | Cerrado local 2026-10-11: plan parametriza `graceDays`, job local aplica gracia/suspension y estado owner/admin emite avisos `grace_active`/`grace_ending` |
| P1-11 | Implementar cancelacion autoservicio | Cerrado local 2026-10-11: `/api/billing/cancel` marca `cancelAtPeriodEnd`, conserva acceso hasta `currentPeriodEnd` y smoke test lo valida |
| P1-12 | Implementar administracion de planes | Ejecutado local: backend y UI para crear, editar, activar/desactivar y marcar principal |
| P1-13 | Implementar reglas de cambio de plan | Cerrado local 2026-10-11: upgrade aplica inmediato, downgrade queda en `pendingPlanChange` al siguiente ciclo y `noRefunds=true`; smoke test lo valida |
| P1-14 | Implementar politica de acceso suspendido/cancelado | Cerrado local operativo 2026-10-11: mantenimiento suspende/cancela, agente/webhook bloquean operacion y UI conserva consulta; retencion 30 dias queda para politica P3 |
| P1-15 | Implementar reactivacion autoservicio | Cerrado local 2026-10-11: checkout/continue-checkout y webhook/mock activation reactivan al confirmar pago; cancelados antiguos requieren validacion manual en P3 |
| P1-16 | Implementar notificaciones de facturacion | Cerrado local 2026-10-11: `getBillingStatus` expone `notices`, UI owner/admin muestra alertas de pago, prueba, gracia, limites, descuentos, excepciones e historial; WhatsApp owner configurable queda para integracion live |
| P1-17 | Implementar facturacion por aniversario | Cerrado local 2026-10-11: activacion y webhook fijan `currentPeriodStart`, `currentPeriodEnd` y `nextBillingDate` por cliente |
| P1-18 | Implementar ciclo de consumo por aniversario | Cerrado local 2026-10-11: `UsageService` usa `currentPeriodStart` como periodo por defecto y sincroniza contadores con `billingUsageCyclesByTenant` |
| P1-19 | Implementar politica de limite de consumo | Cerrado local 2026-10-11: limites por plan se aplican a interacciones/domicilios, avisos 80/90/100 y bloqueo con opcion de upgrade o excepcion admin |
| P1-20 | Implementar descuentos manuales | Cerrado local 2026-10-11: admin crea, lista y revoca descuentos con auditoria; UI muestra descuentos activos por cliente |
| P1-21 | Implementar historial de pagos | Cerrado local 2026-10-11: `/api/billing/payments` y `getBillingStatus.paymentHistory` devuelven historial con referencia/comprobante si existe; comprobante real queda condicionado al payload Mercado Pago |
| P1-22 | Implementar precio final unico | Comisiones Mercado Pago incluidas en el precio comercial, no como cargo separado |
| P1-23 | Implementar sincronizacion manual Mercado Pago | Cerrado local 2026-10-11: accion admin con auditoria, rate limit 60 s, consulta real a `preapproval` cuando hay token/preapproval y modo contrato cuando no hay credencial |
| P1-24 | Implementar excepciones manuales de acceso | Cerrado local 2026-10-11: admin crea, lista y revoca excepciones temporales; `requireTenantOperational` permite operar por excepcion activa sin alterar Mercado Pago |
| P1-25 | Implementar reconciliacion automatica Mercado Pago | Cerrado local ejecutable 2026-10-11: `POST /api/admin/billing/jobs/run` y `npm run billing:maintenance` operan mantenimiento; ejecucion local escaneo 33 tiendas sin acciones. Falta cron externo y consulta masiva proveedor en P2/P3 |
| P1-26 | Dividir onboarding por momento de cobro | Cerrado local 2026-10-11: creacion/diagnostico antes del pago; Google operativo, WhatsApp binding y activacion exigen suscripcion activa |
| P1-27 | Implementar diagnostico liviano de WhatsApp pre-pago | Cerrado local 2026-10-11: `whatsapp/status` e `intent` permiten clasificar ruta sin tokens; Embedded Signup/binding se bloquean antes del pago |
| P1-28 | Implementar separacion Google identidad/datos | Cerrado local 2026-10-11: Google Sign-In es identidad; OAuth Drive/Sheets y provisioning devuelven `subscription_required_for_setup` antes del pago |
| P1-29 | Implementar datos minimos pre-pago | Cerrado local suficiente para piloto: `storeName`, owner y telefono; ciudad queda como mejora de formulario, no bloquea contrato tecnico |
| P1-30 | Implementar checkout por redireccion externa | Cerrado local 2026-10-11: contract-first usa redireccion externa/mock; retorno o callback no activa sin webhook/mock activation |
| P1-31 | Implementar recuperacion de checkout abandonado | Cerrado local 2026-10-11: `checkoutRecovery` expone `recoverable`, dias restantes y accion; owner/admin muestran aviso para continuar o regenerar pago |
| P1-32 | Implementar embudo de conversion SaaS | Cerrado local 2026-10-11: eventos backend y visualizacion admin cubren cuenta, checkout, pago, Google, WhatsApp, activacion y bloqueos |
| P1-33 | Implementar motivos de abandono/bloqueo | Cerrado local 2026-10-11: motivos automaticos y nota manual admin via `/api/admin/billing/funnel/:tenantId/reason` |
| P1-34 | Implementar respuesta humana operativa | Cerrado local: la bandeja humana responde en plataforma o WhatsApp; confirmacion de pedido crea handoff de preparacion |
| P1-35 | Persistir diagnostico del chat real SuperMarket | Cerrado: `docs/Analisis-interacciones-whatsapp-supermarket.md` |
| P1-36 | Ampliar matriz del agente con casos reales multi-turno | Cerrado local: matriz con 50 escenarios/57 pasos, incluyendo saludo, pago tardio, correccion, agregado, foto, reclamo y cierre |
| P1-37 | Crear runner DeepSeek real para escenarios seleccionados | Cerrado local: `npm run test:deepseek-real` y `test-results-deepseek-real-scenarios.json` |
| P1-38 | Definir politica explicita de confianza del agente | Cerrado local: politica documentada y barandas implementadas para pago/reclamo |
| P1-39 | Generar trazabilidad legible por caso de prueba | Cerrado local: `test-results-colombia-scenarios.json` y `test-results-deepseek-real-scenarios.json` |
| P1-40 | Reforzar pruebas de pago, fotos y reclamos | Cerrado local: preferencia de pago, comprobante, imagen y reclamo cubiertos |
| P1-41 | Probar agente end-to-end contra Google Sheets live sin publicar | Cerrado local 2026-10-11: `npm run test:agent-google-live` paso con `codex_simulated_deepseek`, leyo `Catalogo`, guardo `Clientes`, escribio `Pedidos` y creo handoff humano |
| P1-42 | Clarificar onboarding Google Drive/Sheets | Cerrado local 2026-10-13: pestaña Google convertida en guia de 3 pasos con autorizacion OAuth, provisioning Drive/Sheets, apertura de Google Sheets y acceso a configuracion editable |

### P2 - Requiere URL publica o callbacks externos

| ID | Pendiente | Cierre esperado |
| --- | --- | --- |
| P2-01 | Publicar backend con URL HTTPS estable | `PUBLIC_APP_URL` real configurada |
| P2-02 | Configurar redirect URI publico en Google Cloud | OAuth callback productivo funcionando |
| P2-03 | Probar WhatsApp webhook real | Meta verifica webhook y mensajes entrantes enrutan por `phoneNumberId` |
| P2-04 | Probar envio WhatsApp live | Mensaje saliente usa token y numero del tenant |
| P2-05 | Probar Embedded Signup o guia asistida WhatsApp | Ruta clara segun si el cliente ya tiene Cloud API, App o empieza desde cero |
| P2-06 | Probar Mercado Pago webhook real | HMAC valida eventos y estados de suscripcion |
| P2-07 | Prueba E2E publica | Pago, Google, WhatsApp, agente, pedido y handoff humano funcionando |

### P3 - Endurecimiento productivo

| ID | Pendiente | Cierre esperado |
| --- | --- | --- |
| P3-01 | Conectar secret manager administrado | Secretos resueltos por referencia, no por vault local |
| P3-02 | Retirar dependencia restante de snapshot JSONB | Rutas criticas leen/escriben SQL directamente |
| P3-03 | Convertir validaciones pendientes a SQL puro | `resolveHumanRequest` y control plane sin memoria local |
| P3-04 | Definir retencion de eventos y auditoria | Politica por tipo de dato y ventana de consulta |
| P3-05 | Crear alertas productivas | Pago, Google, WhatsApp, DeepSeek, consumo y errores criticos |
| P3-06 | Backups y restauracion PostgreSQL | Procedimiento probado de recuperacion |
| P3-07 | Runbook de soporte | Como diagnosticar tenant, pago, Google, WhatsApp, agente y webhook |

## Orden recomendado

1. Cerrar P0-01 con la matriz local completa.
2. Cerrar P0-02 revisando `.env.example` contra `docs/Checklist-piloto-produccion.md`.
3. Cerrar P0-03 normalizando semillas/datos persistidos visibles.
4. Cerrar P0-08, P0-09 y P0-10: auditar e implementar Tienda viva como gemelo digital gamificado antes de pruebas visuales grandes.
5. Ejecutar `docs/Plan-implementacion-Mercado-Pago-SaaS.md` hasta pruebas locales/sandbox que no requieran URL publica.
6. Cerrar P1-03 y P1-04: Google Sign-In real local con auth y CSRF obligatorios.
7. Cerrar P1-05 y P1-06: OAuth Drive/Sheets real y escritura de `Catalogo`, `Clientes`, `Pedidos`.
8. Repetir validacion Google Sheets live con una seleccion de escenarios nuevos y datos controlados del piloto. Cerrado localmente con `npm run test:agent-google-live`.
9. Preparar publicacion solo cuando los pendientes P1 restantes esten cerrados o aceptados con deuda explicita.
10. Ejecutar P2 con URL publica: WhatsApp, Mercado Pago y OAuth publico.
11. Entrar a P3 para hardening productivo y operacion continua.

## Criterios para pasar a piloto publico

- `AUTH_REQUIRED=true` y `CSRF_REQUIRED=true` validados.
- PostgreSQL operando como fuente principal.
- DeepSeek real configurado como motor global de plataforma.
- Matriz heuristica del agente ejecutada con DeepSeek real en un subconjunto representativo.
- Trazabilidad de casos del agente disponible: plan LLM, herramientas, catalogo, decision, respuesta y handoff.
- Google OAuth live funcionando con lectura/escritura real de Sheets.
- Tenant isolation probado: un owner no ve ni opera tenants ajenos.
- Onboarding completa suscripcion, Google, aprovisionamiento, WhatsApp y prueba guiada.
- Webhook WhatsApp rechaza numeros no asociados.
- Mercado Pago valida firma y no duplica eventos.
- Observabilidad permite filtrar por tienda, proveedor, estado y rango de fechas.
- Tienda viva opera como gemelo digital gamificado con LOD, experiencia movil adaptativa, intervencion humana prioritaria y rendimiento medido.
- UI sin overflow horizontal en desktop, laptop y movil.

## Decisiones vigentes

- Autenticacion: Google.
- Base de datos: PostgreSQL.
- Datos operativos del comercio: Google Drive/Sheets propio de cada cliente.
- Facturacion: Mercado Pago.
- Modalidad de facturacion: suscripcion automatica mensual para el uso de la plataforma.
- Periodo de prueba: configurable desde administracion, desactivado por defecto.
- Periodo de gracia por cobro fallido: 5 dias iniciales, parametrizable desde administracion. Opera normal con avisos progresivos y suspende automaticamente al vencer.
- Cancelacion: autoservicio desde microapp para owner, con confirmacion y acceso hasta fin del periodo pagado.
- Planes: un solo plan activo inicialmente, con soporte administrativo para crear, activar y desactivar multiples planes.
- Cambios de plan: modelo mixto. Owner puede hacer upgrade autoservicio; downgrade con confirmacion fuerte al siguiente ciclo; admin puede ambos con auditoria. Sin devoluciones.
- Acceso suspendido/cancelado: suspendido con acceso restringido; cancelado solo lectura por 30 dias; recursos Google del cliente no se eliminan automaticamente.
- Reactivacion: autoservicio segun causa y antiguedad. Pago confirmado reactiva suspendidos; cancelados recientes conservan configuracion; cancelados antiguos requieren validacion completa.
- Notificaciones de facturacion: microapp y Centro de control obligatorios; WhatsApp al owner configurable; email excluido en primera version.
- Fecha de cobro: aniversario de suscripcion de cada cliente, sin corte fijo global inicial.
- Ciclo de consumo: limites del plan se reinician con el ciclo de facturacion por aniversario, no por mes calendario.
- Limite de consumo: plan inicial con 1.000 domicilios y 5.000 interacciones por ciclo; domicilios como limite comercial y interacciones como uso justo.
- Excedentes: no hay cobro automatico en primera version; se resuelve con upgrade o excepcion administrativa auditada.
- Descuentos: manuales por cliente desde administracion, con vencimiento, motivo y auditoria; sin cupones publicos inicialmente.
- Comprobantes: historial de pagos y referencia/comprobante Mercado Pago si existe; factura fiscal propia fuera del alcance inicial.
- Comisiones Mercado Pago: incluidas en el precio comercial; el cliente ve un precio final unico.
- Sincronizacion Mercado Pago: accion admin por cliente, con auditoria y control de uso.
- Excepciones manuales: acceso temporal por admin con motivo, vencimiento y auditoria; no cambia estado real de Mercado Pago.
- Reconciliacion Mercado Pago: job automatico diario y reintentos frecuentes para estados pendientes/vencidos/en gracia.
- Onboarding y cobro: diagnostico inicial antes del pago; Google operativo, aprovisionamiento, WhatsApp y prueba guiada despues de suscripcion activa.
- WhatsApp pre-pago: solo diagnostico de ruta; conexion real, tokens y webhooks despues de suscripcion activa.
- Google pre-pago: solo identidad con Google Sign-In; Drive/Sheets despues de suscripcion activa.
- Datos pre-pago: nombre comercial y ciudad; datos operativos completos despues de suscripcion activa.
- Checkout: redireccion externa a Mercado Pago en primera version; embebido queda como mejora futura.
- Checkout abandonado: `pending_payment`, recuperable por 7 dias con continuar pago; luego expira o se regenera.
- Embudo SaaS: Centro de control debe mostrar conversion desde cuenta creada hasta tienda activada.
- Motivos de abandono/bloqueo: automaticos y nota manual admin opcional para entender fricciones del onboarding.
- WhatsApp Business: propio y pagado por cada cliente.
- LLM: DeepSeek global administrado por la plataforma.
- Intervencion humana: toda decision humana debe poder resolverse desde la plataforma y, cuando aplique, responder al cliente por WhatsApp desde la misma interfaz.
- Pedido confirmado: el agente debe registrar el pedido y subirlo a humano para preparacion y entrega; el humano no solo aprueba, tambien opera el cumplimiento.
- Tienda viva: debe evolucionar como gemelo digital gamificado. Los movimientos visuales deben representar eventos reales o diferenciarse como ambientacion; la experiencia movil debe ser adaptativa, no una miniatura del escritorio.
- Publicacion: al final, despues de cerrar pruebas locales que no requieren callbacks externos.

## Nota de seguimiento

Cada pendiente debe cerrarse con evidencia: comando ejecutado, captura, endpoint probado, registro en observabilidad o documento actualizado. Si un pendiente se difiere, debe quedar marcado con razon, riesgo y condicion para retomarlo.
