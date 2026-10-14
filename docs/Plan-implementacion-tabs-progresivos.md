# Plan de implementacion - Tabs progresivos por pantalla

Fecha: 2026-10-13

## Objetivo

Reducir la sobrecarga visual de la microapp mediante navegacion por tabs o focos progresivos, sin ocultar alertas criticas ni cambiar contratos de API.

El patron busca que cada pantalla tenga una tarea principal clara:

- Revisar una cola.
- Resolver una decision.
- Configurar un area.
- Investigar eventos.
- Entender uso y riesgos.

## Alcance

### Fase 1 - Operacion critica

Pantallas donde el exceso de informacion afecta decisiones humanas o administracion diaria.

1. **Aprobaciones**
   - Tabs: `Pendientes`, `Preparar pedidos`, `Responder cliente`, `Historial`.
   - Mantener contadores visibles.
   - Seleccionar automaticamente el tab correcto cuando se abre una solicitud desde otra pantalla.

2. **Onboarding**
   - Tabs: `Ruta`, `Pago`, `Google`, `WhatsApp`, `Prueba`.
   - Abrir por defecto el tab asociado al siguiente paso pendiente.
   - Mantener avance y CTA principal visibles arriba.

3. **Centro de control**
   - Tabs: `Motor IA`, `Clientes`, `Facturacion`, `Observabilidad`.
   - Mantener KPIs globales visibles.
   - Separar administracion de DeepSeek, radar de tenants y Mercado Pago.

### Fase 2 - Investigacion y analitica

4. **Observabilidad**
   - Tabs: `Monitor`, `Eventos`, `Detalle`.
   - Mantener estado en vivo y filtros.
   - En movil, detalle como superficie dedicada.

5. **Analitica**
   - Tabs: `Uso`, `Flujo`, `Riesgos`, `Eventos`.
   - Mantener score de salud visible.

### Fase 3 - Resumen ejecutivo

6. **Resumen**
   - No dividir agresivamente.
   - Agregar foco compacto si sigue cargado: `Atencion`, `Uso`, `Actividad`.

### Pantallas excluidas de tabs globales

7. **Tienda viva**
   - No se implementan tabs globales.
   - Se conserva gemelo digital gamificado con paneles colapsables, LOD y overlays contextuales.

## Criterios de aceptacion

- El usuario entiende la tarea principal de cada pantalla en menos de 3 segundos.
- Las acciones criticas quedan visibles en el tab adecuado.
- Los contadores de pendientes no desaparecen al cambiar de tab.
- Los menus de navegacion entre tabs se presentan como tiras horizontales; si no caben, usan desplazamiento horizontal controlado.
- No hay scroll horizontal accidental.
- En movil los tabs son desplazables o compactos.
- No se duplican reglas de negocio ni llamadas de backend.
- `npm run build` pasa.
- `npm run test:backend` pasa si se tocan flujos o props compartidas.

## Orden de ejecucion

1. Implementar Fase 1 completa.
2. Validar build y smoke backend.
3. Revisar visualmente las tres pantallas.
4. Implementar Fase 2.
5. Validar nuevamente.
6. Evaluar si Resumen necesita foco compacto.

## Estado

| Fase | Pantalla | Estado |
| --- | --- | --- |
| 1 | Aprobaciones | Implementado: tabs `Pendientes`, `Preparar pedidos`, `Responder cliente`, `Historial` |
| 1 | Onboarding | Implementado: tabs `Ruta`, `Pago`, `Google`, `WhatsApp`, `Prueba` |
| 1 | Centro de control | Implementado: tabs `Motor IA`, `Clientes`, `Facturacion`, `Observabilidad` |
| 2 | Observabilidad | Implementado: tabs `Monitor`, `Eventos`, `Detalle` |
| 2 | Analitica | Implementado: tabs `Uso`, `Flujo`, `Riesgos`, `Eventos` |
| 3 | Resumen | Implementado: foco compacto `Atencion`, `Uso del plan`, `Actividad` |

## Ejecucion 2026-10-13

### Cambios aplicados

- `Aprobaciones`: cola segmentada por tipo de trabajo humano. Si se abre una solicitud desde otra pantalla, se selecciona automaticamente el tab correspondiente.
- `Onboarding`: flujo convertido en tabs de etapa. El tab inicial sigue el siguiente paso pendiente.
- `Centro de control`: administracion separada por Motor IA, Clientes, Facturacion y Observabilidad, manteniendo KPIs globales en cabecera.
- `Observabilidad`: investigacion separada en Monitor, Eventos y Detalle. Seleccionar un evento abre su detalle.
- `Analitica`: lectura separada por Uso, Flujo, Riesgos y Eventos, manteniendo score y senales ejecutivas arriba.
- `Resumen`: foco ejecutivo compacto por Atencion, Uso del plan y Actividad. La prioridad permanece visible y el resto de informacion aparece segun la intencion del usuario.
- Patron visual: `workspace-tabs`, `config-tabs` y `conversation-workspace-tabs` quedan como navegacion horizontal compacta tipo segmented control, evitando menus verticales tipo tarjeta y manteniendo scroll horizontal en movil.
- Se agrego un estilo comun `workspace-tabs` reutilizable para mantener consistencia visual.

### Validacion

- `npm run build`: OK.
- `npm run test:backend`: OK.
- Fase 2 validada con `npm run build` y `npm run test:backend`: OK.
- Fase 3 validada con `npm run build` y `npm run test:backend`: OK.


