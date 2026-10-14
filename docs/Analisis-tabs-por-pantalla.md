# Analisis de navegacion por tabs por pantalla

Fecha: 2026-10-13

## Objetivo

Reducir sobrecarga cognitiva en la microapp sin esconder informacion critica ni fragmentar flujos operativos. El criterio no es "poner tabs en todo", sino separar intenciones reales de trabajo:

- Ver estado rapido.
- Investigar detalle.
- Configurar parametros.
- Ejecutar una accion.
- Revisar historico.

## Principios de aplicacion

1. Un tab debe representar una tarea clara, no solo una categoria visual.
2. La informacion critica debe permanecer visible o tener acceso inmediato.
3. Las acciones frecuentes no deben quedar escondidas en tabs secundarios.
4. En movil, tabs superiores o segmentados son preferibles a grillas largas.
5. En vistas operativas vivas, usar overlays, paneles colapsables o niveles de detalle antes que tabs globales.

## Matriz de viabilidad

| Pantalla | Estado actual | Viabilidad tabs | Recomendacion | Prioridad |
| --- | --- | --- | --- | --- |
| Resumen | Mezcla uso del plan, aprobaciones, embudo, salud, conversaciones y eventos. | Media | No convertir todo a tabs. Mantener resumen ejecutivo y agregar selector de foco: `Atencion`, `Uso`, `Actividad`. | P2 |
| Tienda viva | Gemelo visual con mapa, zonas, personajes, foco de zona y evento prioritario. | Baja para tabs globales | No usar tabs globales. Mantener experiencia viva; mejorar con paneles colapsables, LOD y overlays contextuales. | Mantener |
| Conversaciones | Ya separado en `Listado` y `Detalle`; dentro del detalle hay `Chat`, `Resumen`, `Acciones`. | Alta, ya aplicado | Mantener. Siguiente mejora: recordar ultimo tab por usuario y mejorar estado vacio. | Cerrado base |
| Aprobaciones | Cards de solicitudes mezclan clasificacion, preparacion, respuesta y resolucion. | Alta | Separar en tabs `Pendientes`, `Preparar pedidos`, `Respondidas`/`Historial`. Mantener contador critico visible. | P0 |
| Onboarding | Pantalla extensa: hero, facturacion, ruta, prueba guiada, WhatsApp, recursos Google, aislamiento. | Muy alta | Convertir a tabs o pasos: `Ruta`, `Pago`, `Google`, `WhatsApp`, `Prueba`. El tab activo debe seguir el siguiente paso recomendado. | P0 |
| Centro de control | Admin mezcla Motor IA, clientes, facturacion Mercado Pago y entrada a observabilidad. | Muy alta | Tabs principales: `Motor IA`, `Clientes`, `Facturacion`, `Observabilidad`. Cada tab conserva KPIs globales arriba. | P0 |
| Observabilidad | Filtros, monitor, KPIs, tabla y detalle tecnico en una sola superficie. | Alta | Tabs: `Monitor`, `Eventos`, `Detalle`. Alternativa desktop: mantener tabla+detalle, pero ocultar monitor/filtros avanzados en tabs. | P1 |
| Analitica | Estado ejecutivo, capacidad, flujo, conexiones, eventos y riesgos juntos. | Alta | Tabs: `Uso`, `Flujo`, `Riesgos`, `Eventos`. Mantener score de salud fijo como cabecera. | P1 |
| Configuracion | Ya separado en `Tienda`, `WhatsApp`, `Agente`, `Conexiones`. | Alta, ya aplicado | Mantener. Siguiente mejora: deep-link desde Onboarding al tab exacto. | Cerrado base |

## Tratamiento recomendado por pantalla

### P0 - Implementar primero

#### Aprobaciones

Problema: el usuario no distingue rapido si debe responder al cliente, alistar un pedido o simplemente resolver una excepcion.

Tabs propuestos:

- `Pendientes`: todas las solicitudes activas priorizadas.
- `Preparar pedidos`: solo solicitudes de pedido confirmado para alistar y entregar.
- `Responder cliente`: casos donde se debe enviar mensaje por WhatsApp o guardar nota.
- `Historial`: resueltas recientes, solo lectura.

Regla: el contador global de pendientes queda visible arriba; las acciones primarias siguen dentro de cada tarjeta.

#### Onboarding

Problema: la pagina es didactica pero larga; mezcla explicacion, pago, Google, WhatsApp y prueba.

Tabs propuestos:

- `Ruta`: resumen de avance y siguiente paso.
- `Pago`: suscripcion Mercado Pago, estado, uso, historial.
- `Google`: cuenta, Sheets, recursos aprovisionados.
- `WhatsApp`: diagnostico, alta guiada/manual, binding.
- `Prueba`: escenarios guiados antes de publicar.

Regla: al entrar, abrir automaticamente el tab del `nextStep` del onboarding.

#### Centro de control

Problema: el administrador ve demasiada informacion heterogenea en una sola pagina.

Tabs propuestos:

- `Motor IA`: DeepSeek global, simulador local, limites y timeout.
- `Clientes`: radar, salud, consumo, errores por tenant.
- `Facturacion`: planes, embudo, excepciones, conciliacion Mercado Pago.
- `Observabilidad`: resumen de webhooks y acceso a cabina completa.

Regla: KPIs globales se mantienen como cabecera persistente para no perder contexto.

## P1 - Implementar despues

#### Observabilidad

Tabs propuestos:

- `Monitor`: grafica, KPIs y salud por proveedor.
- `Eventos`: filtros y tabla.
- `Detalle`: payload enmascarado, headers, metadata y error.

En desktop se puede conservar tabla + detalle dentro del tab `Eventos`; en movil el detalle debe ser pantalla dedicada.

#### Analitica

Tabs propuestos:

- `Uso`: domicilios, interacciones, tokens y herramientas.
- `Flujo`: etapas del proceso comercial.
- `Riesgos`: conversaciones bloqueadas, degradadas o con binding pendiente.
- `Eventos`: ritmo reciente y tipos de eventos.

Regla: score de salud queda arriba como resumen fijo.

## P2 - Mejora selectiva

#### Resumen

No conviene partir demasiado el resumen, porque perderia su funcion ejecutiva. Mejor usar filtros de foco:

- `Atencion ahora`
- `Uso del plan`
- `Actividad reciente`

Esto puede implementarse como chips o tabs compactos, pero manteniendo siempre la tarjeta de prioridad visible.

## Pantallas donde no conviene tab global

### Tienda viva

La experiencia central es el gemelo digital gamificado. Tabs globales romperian la continuidad visual. Para reducir carga se recomienda:

- Panel de zona colapsable.
- Bottom sheet en movil.
- LOD por volumen.
- Overlays contextuales por personaje.
- Acceso directo a conversacion al seleccionar personaje.

## Orden de implementacion sugerido

1. Aprobaciones: separar decisiones humanas por tipo de trabajo.
2. Onboarding: convertir la experiencia guiada en tabs/pasos premium.
3. Centro de control: separar administracion de LLM, clientes, facturacion y observabilidad.
4. Observabilidad: separar monitor, eventos y detalle tecnico.
5. Analitica: agrupar por uso, flujo, riesgos y eventos.
6. Resumen: agregar foco compacto si despues de lo anterior sigue cargado.

## Criterios de aceptacion

- Cada pantalla tiene una tarea principal visible en menos de 3 segundos.
- Las acciones frecuentes no quedan ocultas.
- No hay scroll horizontal accidental.
- En movil no se renderiza una grilla desktop comprimida.
- Cada tab conserva estado local razonable durante la sesion.
- Los contadores criticos permanecen visibles aunque el usuario cambie de tab.
- El cambio no modifica contratos API ni reglas multitenant.

