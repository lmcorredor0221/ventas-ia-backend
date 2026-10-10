# Plan de redisenio de experiencia y dashboards premium

## Objetivo

Convertir la micro app Ventas IA en una experiencia premium, clara y operativa, separando tres mundos que hoy estan mezclados:

1. **Tienda Viva:** operacion diaria de cada tienda.
2. **Centro de Control:** administracion SaaS de todos los clientes.
3. **Observabilidad:** salud tecnica y eventos de integracion.

La meta es que la interfaz deje de sentirse como una consola tecnica y se perciba como una herramienta moderna de operacion comercial inteligente.

## Estado de ejecucion

Actualizado: 2026-10-10.

### Ejecutado en el primer bloque

- Navegacion principal renombrada: se agrego **Observabilidad** y **Admin Plataforma** paso a **Centro de control**.
- Encabezado superior ahora cambia segun la vista activa.
- **Centro de control** quedo enfocado en clientes, pagos, consumo, estado operativo y Motor IA.
- El monitor de eventos salio de Centro de control y quedo en una vista propia de **Observabilidad**.
- **Observabilidad** incluye filtros por cliente/tienda, proveedor, estado, busqueda y rango de fechas.
- **Observabilidad** incluye grafica de ritmo historico, KPIs, lista de eventos y detalle tecnico con payload enmascarado.
- **Tienda viva** ya no muestra un panel fijo de Inspector operativo.
- **Tienda viva** abre una ficha contextual de **Caso seleccionado** solo cuando el usuario selecciona una conversacion/personaje.
- Se redujo lenguaje tecnico visible: `LLM`, `tenant`, `webhook`, `ACP`, `binding` y estados crudos fueron reemplazados por etiquetas humanas donde aplica.
- Se normalizaron textos persistidos conocidos en la capa visual, por ejemplo `Production pilot` se muestra como `Piloto productivo`.
- Se ajustaron tamanos visuales de encabezado, metricas y hero del Centro de control para una jerarquia mas sobria.

### Ejecutado en el segundo bloque

- **Onboarding** paso a una experiencia guiada mas premium, con encabezado menos pesado y lectura por etapas.
- Se agrego una franja de activacion con senales de Suscripcion, Google del cliente, WhatsApp y Motor IA.
- El panel de preparacion ahora resume claramente que falta para operar, sin obligar al usuario a leer detalles tecnicos.
- Se agrego una **Prueba guiada** para validar una conversacion completa antes de publicar.
- El asistente de WhatsApp Business ahora pregunta por el punto de partida del cliente y explica alta guiada, guia asistida o conexion existente.
- Se redujo jerga visible en el onboarding y configuracion: identificador del numero, cuenta WhatsApp, referencias seguras y eventos de conexion.

### Ejecutado en el tercer bloque

- **Analitica** paso de una grilla basica de tarjetas a una lectura ejecutiva de la tienda.
- Se agrego un score visual de salud operativa con estado claro.
- Se agregaron senales rapidas: conversaciones activas, apoyo humano, pedidos avanzados y conexiones pendientes.
- La capacidad mensual ahora se lee con indicadores circulares para domicilios e interacciones.
- El flujo comercial muestra etapas con etiquetas humanas y barras comparativas.
- Conexiones, eventos recientes y riesgos quedaron en paneles separados con lenguaje de negocio.
- Se reviso responsive en escritorio y movil para evitar cortes de texto y mejorar lectura.

### Ajuste de calidad visual posterior

- Se corrigio overflow horizontal en **Centro de control**.
- La lista de clientes del radar ahora es compacta, con scroll interno y sin invadir el panel de detalle.
- El panel de Motor IA ya no se estira artificialmente cuando la lista de clientes es larga.
- Se agrego validacion automatica para detectar overflow horizontal de documento en Centro de control.

### Validacion ejecutada

- `npm run build`
- `npm run test:backend`
- `python tests\verify_ui.py`
- Revision visual local en `http://127.0.0.1:5173/`
- Validacion de navegacion: Resumen, Tienda viva, Centro de control y Observabilidad.
- Validacion de que la ficha de Tienda viva aparece solo al seleccionar un caso y no usa el texto "Inspector operativo".
- Validacion de Onboarding: franja de activacion, prueba guiada y asistente de WhatsApp Business.
- Validacion de Analitica: lectura ejecutiva, score de salud, capacidad mensual y flujo comercial.
- Validacion de Centro de control: radar comercial sin superposicion ni overflow horizontal.

### Pendiente

- Normalizar datos persistidos directamente en PostgreSQL si se quiere corregir informacion historica, no solo la capa visual.
- Crear una guia visual o tokens formales si el producto sigue creciendo.

## Diagnostico

La app ya tiene una base funcional fuerte: onboarding, Google, WhatsApp, Mercado Pago, configuracion por tienda, configuracion global de DeepSeek, dashboard administrativo y monitoreo de eventos.

El problema principal no es funcional sino de experiencia:

- Se mezclan terminos tecnicos con terminos comerciales.
- Algunas pantallas usan lenguaje de implementacion: `tenant`, `webhook`, `LLM`, `ACP`, `sandbox_ready`.
- La jerarquia visual aun compite: encabezados grandes, paneles laterales pesados y tarjetas que ocupan mas espacio del valor que entregan.
- La vista **Tienda Viva** tiene un concepto potente, pero debe sentirse mas luminosa, moderna, humana y operativa.
- El dashboard administrativo necesita separarse de la observabilidad tecnica.
- El onboarding debe sentirse guiado, premium, paso a paso y autoservicio.

## Benchmark y aprendizajes

### Shopify

Shopify organiza la experiencia alrededor de la tienda: ventas, sesiones, canales, ordenes y cumplimiento. El aprendizaje para Ventas IA es que el usuario operativo no debe ver primero arquitectura ni integraciones, sino resultados y estado comercial.

### Stripe

Stripe separa pagos, clientes, ingresos, suscripciones, eventos y configuracion. La interfaz permite operar negocio y luego profundizar en detalle tecnico cuando hace falta. El aprendizaje es separar **estado comercial** de **evento tecnico**.

### Intercom

Intercom trata conversaciones, canales, IA y humanos como una bandeja compartida. El aprendizaje es que WhatsApp, agente y humano deben sentirse parte de un mismo flujo, no modulos aislados.

### Datadog

Datadog es referente para observabilidad: eventos, logs, metricas, alertas, filtros y trazabilidad. El aprendizaje es que la vista de eventos debe existir, pero separada de las pantallas de negocio.

## Principios de redisenio

1. **Lenguaje de negocio primero.** El usuario debe entender que esta pasando sin conocer la arquitectura.
2. **Separacion de capas.** Operacion, administracion SaaS y observabilidad no deben competir en la misma pantalla.
3. **Densidad premium.** Menos tarjetas gigantes, mas informacion util por pantalla.
4. **Jerarquia clara.** Un titulo principal, maximo cinco KPIs visibles y acciones principales evidentes.
5. **Estado antes que configuracion.** Primero mostrar salud, avance o bloqueo; luego permitir editar detalles.
6. **IA como operador comercial.** El motor de IA debe sentirse como un asistente de tienda, no como un proveedor tecnico.
7. **Tecnico bajo demanda.** Payloads, headers, IDs y logs deben aparecer solo en vistas de investigacion.

## Arquitectura de navegacion propuesta

Menu recomendado:

- **Resumen**
- **Tienda viva**
- **Conversaciones**
- **Onboarding**
- **Centro de control**
- **Observabilidad**
- **Configuracion**

### Cambios de nombres

| Actual | Propuesto |
| --- | --- |
| Admin Plataforma | Centro de control |
| Tenant | Cliente / Tienda |
| Webhook | Evento de conexion |
| LLM | Motor de IA |
| DeepSeek global | Motor IA de la plataforma |
| ACP | Eliminar de interfaz visible |
| Inspector operativo | Caso seleccionado |
| Bindings | Conexiones |
| Human-in-loop | Requiere apoyo |

## Fase 1: Limpieza de lenguaje

### Objetivo

Eliminar lenguaje tecnico innecesario de la interfaz visible.

### Alcance

- Navegacion principal.
- Encabezados.
- KPIs.
- Estados.
- Tooltips.
- Paneles.
- Onboarding.
- Configuracion.
- Centro de control.
- Observabilidad.

### Tareas

- Reemplazar `Admin Plataforma` por `Centro de control`.
- Reemplazar `Tenant` por `Cliente` o `Tienda`, segun contexto.
- Reemplazar `Webhook` por `Evento de conexion` en vistas de negocio.
- Mantener `Webhook` solo dentro del detalle tecnico.
- Reemplazar `LLM` por `Motor de IA`.
- Reemplazar `DeepSeek global` por `Motor IA de la plataforma`.
- Eliminar `ACP` de toda interfaz final.
- Reemplazar estados tecnicos como `sandbox_ready`, `needs_binding` y `payment_required` por textos humanos.

### Resultado esperado

Una persona sin contexto tecnico puede entender la app en menos de un minuto.

## Fase 2: Redisenio de Tienda Viva

### Objetivo

Convertir **Tienda Viva** en la pantalla principal de operacion diaria.

### Ajustes

- Eliminar el panel fijo **Inspector operativo**.
- Crear un panel contextual solo cuando se seleccione un caso.
- Dar mas espacio al mapa vivo.
- Reducir controles superiores.
- Mantener solo acciones esenciales:
  - Rutas visibles.
  - Vista lista.
  - Centrar vista.
  - Animacion viva.
- Reforzar estados comerciales:
  - Pedido en curso.
  - Necesita confirmar producto.
  - Requiere apoyo humano.
  - Pago pendiente.
  - Listo para preparar.
- Hacer que los personajes se sientan mas humanos.
- Mantener una paleta clara, moderna y activa.

### Resultado esperado

La pantalla debe responder visualmente la pregunta: "Que esta pasando ahora en mi tienda?"

## Fase 3: Centro de Control SaaS

### Objetivo

Crear una pantalla premium para el administrador de la plataforma.

### Debe mostrar

- Total de tiendas.
- Tiendas activas.
- Tiendas bloqueadas por pago.
- Tiendas sin Google conectado.
- Tiendas sin WhatsApp conectado.
- Consumo total de IA.
- Consumo por tienda.
- Errores recientes.
- Ultima actividad por tienda.
- Estado de suscripcion Mercado Pago.
- Estado Google.
- Estado WhatsApp.
- Estado del agente.
- Configuracion global de DeepSeek.

### Estructura recomendada

1. **KPIs ejecutivos**
   - Tiendas activas.
   - Riesgo de pago.
   - Consumo IA.
   - Errores.
   - Operacion saludable.

2. **Lista de tiendas**
   - Nombre.
   - Estado de pago.
   - Google.
   - WhatsApp.
   - Uso.
   - Ultimo error.

3. **Detalle de tienda seleccionada**
   - Salud.
   - Consumo.
   - Conexion Google.
   - Conexion WhatsApp.
   - Ultima actividad.
   - Alertas.

4. **Motor IA de la plataforma**
   - Proveedor: DeepSeek.
   - Modelo.
   - API key reference.
   - Timeout.
   - Limites.
   - Modo simulacion local.

### Resultado esperado

El administrador puede responder: "Que clientes estan bien, cuales tienen problema y donde debo actuar?"

## Fase 4: Observabilidad

### Objetivo

Separar la salud tecnica y los eventos de integracion en una vista propia.

### Filtros requeridos

- Cliente / tienda.
- Proveedor: WhatsApp, Google, Mercado Pago.
- Estado: procesado, rechazado, error, duplicado.
- Fecha inicial.
- Fecha final.
- Busqueda libre por ID, telefono, error o conversacion.

### Visualizaciones

- Eventos por minuto, hora o dia.
- Tasa de exito.
- Errores.
- Rechazos.
- Latencia promedio.
- Pico de eventos.
- Ultimo error critico.

### Detalle de evento

- Cliente asociado.
- Proveedor.
- Estado.
- Fecha de recepcion.
- Duracion.
- ID externo.
- Conversacion asociada.
- Error.
- Payload enmascarado.
- Headers enmascarados.
- Metadata.

### Resultado esperado

El administrador puede responder: "Que fallo, en que tienda, cuando y por que?"

## Fase 5: Onboarding premium

### Objetivo

Convertir el onboarding en una experiencia autoservicio, guiada, explicativa y moderna.

### Pasos

1. Pago de suscripcion.
2. Conexion Google.
3. Aprovisionamiento automatico de Drive y Sheets.
4. Configuracion WhatsApp.
5. Validacion de catalogo.
6. Validacion de datos minimos.
7. Activacion de tienda.
8. Prueba guiada con conversacion simulada.

### Cada paso debe tener

- Estado claro.
- Explicacion humana.
- Accion principal.
- Revision automatica.
- Errores accionables.
- Indicador de progreso.

### WhatsApp

La interfaz debe preguntar si el cliente:

- Ya tiene WhatsApp Business Cloud API.
- Tiene WhatsApp Business App.
- Empieza desde cero.

Si se puede automatizar, se guia hacia Embedded Signup. Si no se puede automatizar, se ofrece una guia paso a paso sin presentar la situacion como error.

### Resultado esperado

Un cliente puede activar la tienda sin asistencia tecnica.

## Fase 6: Configuracion global y por tienda

### Configuracion global

Aplica para toda la plataforma:

- Proveedor IA: DeepSeek.
- Modelo.
- API key reference.
- Base URL.
- Timeout.
- Max tokens.
- Costos IA.
- Limites de uso.
- Reglas globales de seguridad.

### Configuracion por tienda

Aplica por cliente:

- WhatsApp propio.
- Google propio.
- Catalogo.
- Reglas de pedidos.
- Tono del agente.
- Horarios.
- Zonas de domicilio.
- Medios de pago.
- Reglas de escalamiento humano.

### Principio

DeepSeek es transversal. Google y WhatsApp son por tienda.

## Fase 7: Sistema visual

### Objetivo

Crear una base visual consistente y premium.

### Paleta recomendada

- Fondo principal claro.
- Verde / menta para operacion normal.
- Azul para conexion y confianza.
- Ambar para advertencias.
- Rojo solo para errores reales.
- Violeta moderado para IA.
- Evitar cafes, naranjas oscuros y paletas que parezcan antiguas.

### Jerarquia

- H1 entre 32px y 40px.
- KPIs entre 84px y 104px de alto.
- Maximo cinco KPIs principales por pantalla.
- Sidebar colapsable.
- Paneles laterales entre 280px y 340px.
- Menos cards gigantes.
- Mas densidad operativa.

### Componentes

- Botones con iconos Lucide.
- Estados claros.
- Chips con bajo ruido visual.
- Tarjetas con radio maximo de 8px.
- Tablas densas pero legibles.
- Tooltips para terminos tecnicos.

## Fase 8: Normalizacion de datos persistidos

### Objetivo

Evitar que datos existentes en PostgreSQL sigan mostrando textos antiguos.

### Tareas

- Normalizar planes antiguos.
- Normalizar estados.
- Normalizar nombres visibles.
- Normalizar etiquetas tecnicas.
- Actualizar datos semilla.
- Revisar tenants existentes.
- Revisar eventos existentes.

### Ejemplos

| Valor antiguo | Valor visible propuesto |
| --- | --- |
| Production pilot | Piloto productivo |
| Design binding | Conexion en curso |
| Human review | Revision asistida |
| sandbox_ready | Listo para operar |
| needs_binding | Conexion pendiente |

## Fase 9: Pruebas

### Pruebas funcionales

- Onboarding completo local.
- Google OAuth local.
- Aprovisionamiento Google Sheets.
- Simulacion WhatsApp.
- Simulacion Mercado Pago.
- Configuracion DeepSeek global.
- Configuracion WhatsApp por tienda.
- Configuracion Google por tienda.
- Centro de control.
- Observabilidad.

### Pruebas visuales

- Desktop grande.
- Laptop.
- Tablet.
- Movil.
- Sidebar colapsado.
- Textos largos.
- Estados vacios.
- Estados con error.
- Estados con muchos datos.

### Pruebas del agente

- Cliente sabe exactamente que quiere.
- Cliente escribe con errores.
- Cliente pide categorias.
- Cliente no sabe que pedir.
- Producto con varias presentaciones.
- Producto sin stock.
- Producto ambiguo.
- Escalamiento humano.

## Orden de ejecucion recomendado

1. Renombrar navegacion y copy visible.
2. Separar Observabilidad como vista propia.
3. Redisenar Centro de Control.
4. Pulir Tienda Viva eliminando panel fijo.
5. Mejorar onboarding premium.
6. Separar configuracion global y por tienda.
7. Normalizar textos persistidos.
8. Ejecutar pruebas completas locales.
9. Dejar publicacion para el final.

## Primer bloque ejecutable

Este bloque debe hacerse primero porque mejora mucho la percepcion sin requerir publicacion:

1. Cambiar navegacion y lenguaje visible.
2. Crear vista Observabilidad.
3. Limpiar Centro de Control.
4. Quitar Inspector operativo fijo de Tienda Viva.
5. Ejecutar `npm run build`.
6. Ejecutar `npm run test:backend`.

## Criterio de aceptacion

El redisenio se considera exitoso cuando:

- La app no usa lenguaje tecnico innecesario en pantallas de negocio.
- Tienda Viva explica la operacion actual sin depender de paneles laterales pesados.
- Centro de Control permite administrar clientes, pagos, uso, errores y estado del motor IA.
- Observabilidad permite investigar fallas de integracion sin contaminar la experiencia comercial.
- Onboarding guia al cliente paso a paso hasta activar la tienda.
- DeepSeek queda configurado como motor global de la plataforma.
- Google y WhatsApp quedan claramente configurados por tienda.
- La interfaz se percibe moderna, clara, premium y facil de entender.
