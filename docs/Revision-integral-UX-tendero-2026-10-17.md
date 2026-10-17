# Revisión integral de experiencia para el tendero

Fecha: 17 de octubre de 2026. Base examinada: frontend local, contratos de `/api/ops/overview`, `/api/saas/tenants/:id/status`, solicitudes humanas y flujo de confirmación de pedidos. Este diagnóstico precede los cambios de este trabajo. Las capturas y datos de prueba no sustituyen entrevistas con tenderos reales.

## Trabajo principal del usuario

Una persona que atiende una tienda, panadería, minimercado o droguería quiere empezar sin conocimientos técnicos, saber qué pedidos y clientes necesitan atención, y completar cada entrega sin perderse entre pantallas.

| Momento | Lo que necesita saber | Acción principal | Fuente existente |
| --- | --- | --- | --- |
| Entrada | Si su cuenta/tienda ya está lista | Crear tienda o seguir activación | Sesión y estado de activación |
| Pago y conexiones | Qué falta y por qué | Completar el siguiente paso | Estado de suscripción, Google, WhatsApp |
| Primer uso | Si un mensaje se convierte en pedido | Probar con su catálogo | Conversaciones, hoja de productos |
| Día a día | Qué atender primero | Abrir pedido o consulta pendiente | `ops/overview`, solicitudes pendientes |
| Pedido confirmado | Productos, dirección, responsable y decisión | Marcar tomado o indicar que no puede alistar | `prepare_delivery_order` y `contextSnapshot` |
| Después de tomarlo | Si fue despachado/entregado | Registrar hitos reales | **No existe contrato persistente para esos hitos** |

## Hallazgos del código actual

1. **La navegación no representa el trabajo del dueño.** El menú muestra Resumen, Tienda viva, Conversaciones, Onboarding, Centro de control, Observabilidad, Aprobaciones, Analítica y Configuración. El dueño ve rutas de administrador que terminan en acceso restringido. “Aprobaciones”, “Onboarding” y “Ops Store” añaden vocabulario ajeno al mostrador.
2. **La verdad operativa se mezcla con ejemplos.** Cuando `ops/overview` responde con cero conversaciones, el frontend vuelve a `conversations` de demostración. También suma 14 al contador de activas y 1 al de fallos. En modo desconectado genera eventos sintéticos cada 2,3 segundos. Esto puede mostrar actividad inexistente y erosionar la confianza en Tienda viva.
3. **La atención diaria está repartida.** Resumen, Tienda viva, Conversaciones y Aprobaciones contienen distintas entradas para el mismo caso. La bandeja de solicitudes ya separa preparar pedidos y responder al cliente; debe ser el centro de tareas, con una ruta directa desde la escena visual.
4. **La preparación existe; despacho y entrega todavía no.** El backend confirma el pedido, lo registra en Google Sheets y crea una solicitud humana con productos, subtotal y dirección. Resolver esa solicitud registra aprobado/rechazado y cambia la conversación, pero no guarda `preparando`, `despachado` ni `entregado`. La interfaz no debe presentar esos hitos como hechos.
5. **La Tienda viva ya tiene bases operativas.** Usa estado de conversaciones/eventos, zonas, prioridad humana, personajes seleccionables, agrupación de alto volumen, cámara y ficha móvil. El siguiente salto de valor es que sus cifras y movimientos representen solo datos verificables y que cada alerta lleve a la tarea exacta.
6. **La puesta en marcha ya tiene ruta, pestañas y acciones reales.** Todavía repite señales y utiliza términos como “Motor IA”, “Drive y Sheets” y “validar” como tarea principal. La ruta debe expresar una acción concreta y distinguir claramente preparación de operación habilitada.
7. **Riesgo de acción silenciosa.** La resolución de solicitudes no comprueba la respuesta HTTP antes de refrescar la pantalla; en un error puede aparentar éxito. La confirmación necesita resultado visible y la tarjeta debe conservarse si falla.

## Propuesta de información y diseño

Navegación del dueño: **Hoy**, **Tienda viva**, **Pedidos y pendientes**, **Conversaciones**, **Poner en marcha** y un grupo secundario para **Uso del plan** y **Ajustes**. Administración y observabilidad se muestran solo a administradores. El encabezado indica el estado de la tienda y la acción prioritaria; la barra inferior móvil da acceso directo a Hoy, Pedidos, Tienda viva y Conversaciones. Una única fuente de datos alimenta contadores, prioridades y escena.

Lenguaje: “pedido por preparar”, “cliente por responder”, “tu tienda está lista”, “conectar tu WhatsApp”, “productos y precios”, “marcar tomado”. Los nombres de proveedor, identificadores y detalles técnicos quedan en ayuda contextual o administración. La estética conserva la paleta clara y los acentos semánticos actuales; movimiento breve solo cuando cambia un estado real, con alternativa sin movimiento.

Tienda viva: una franja operativa muestra cuántos pedidos esperan preparación, cuántos clientes necesitan respuesta y cuántas conversaciones requieren revisión. Seleccionar una señal abre el caso o la cola correspondiente. Los personajes se mueven por cambios de estado/evento recibidos; con cero casos se muestra explícitamente “Sin actividad ahora”. Ningún movimiento ni cifra debe derivarse de un temporizador decorativo. Las zonas siguen siendo una segunda forma de explorar, no un requisito para trabajar.

Ciclo de vida visible con los contratos actuales: **Mensaje recibido → Asistente atendiendo → Pedido confirmado → Pendiente de preparación → Tomado por la tienda → Seguimiento manual**. Solo se activa cada hito con evidencia disponible. **Despachado** y **Entregado** serán estados futuros, marcados como pendientes de capacidad y nunca inferidos de una aprobación.

## Plan priorizado y criterios de aceptación

| Prioridad | Entrega | Impacto/esfuerzo | Criterio verificable |
| --- | --- | --- | --- |
| P0 | Navegación y lenguaje del dueño | Alto/bajo | Dueño no ve administración restringida; encuentra pendientes en un toque en móvil; tareas con verbos cotidianos. |
| P0 | Veracidad de operación | Muy alto/bajo | Con backend conectado y cero registros se muestran cero casos; sin sumas fijas ni eventos simulados; estado sin conexión claramente señalado. |
| P0 | Centro de pedidos y pendientes | Muy alto/medio | Solicitudes reales clasificadas; pedido muestra productos, total, dirección y acción; error de resolución conserva tarea y explica qué ocurrió. |
| P1 | Tienda viva como puerta a acciones | Alto/medio | Señales y personajes apuntan a solicitudes/conversaciones existentes; cero casos tiene vacío honesto; eventos y movimiento corresponden a datos reales. |
| P1 | Onboarding orientado a siguiente paso | Alto/medio | El primer bloque muestra qué falta, por qué y una acción; cuenta conectada y tienda operando son distinguibles; no hay jerga principal. |
| P1 | Jerarquía responsive y componentes | Medio/medio | 320–1440 px sin desbordamiento; acciones frecuentes visibles; foco y lectores de pantalla conservan acceso; movimiento reducido respetado. |
| P1 | Persistir despacho y entrega | Muy alto/medio | API sobre el pedido ya guardado; transición validada, estado sobrevive recarga y se actualiza en la hoja cuando Google está conectado. |
| P2 | Pruebas con tenderos reales | Muy alto/medio | 5–8 personas intentan activar, encontrar un pedido y resolver una incidencia; medir éxito, tiempo y errores antes de cerrar la experiencia. |

### Decisión de implementación para despacho y entrega

Alternativa solo frontend: guardar estos hitos en memoria o almacenamiento local. Se descarta porque se perderían entre dispositivos, navegadores y sesiones, y podría mostrar información falsa al dueño. Se añadirá un contrato acotado al backend: lectura de los pedidos existentes en `ops/overview`, transición validada por pedido, responsable, marca de tiempo e historial en el mismo objeto de pedido que ya se persiste. No requiere migración ni modifica la estructura de conversaciones, solicitudes o facturación. Al aprobar la preparación, el pedido pasa a `preparing`; el dueño puede marcarlo `dispatched` y luego `delivered`. El rechazo pasa a `cancelled`. Se debe mantener el estado en la hoja de pedidos cuando la conexión Google esté activa; un error de sincronización debe ser visible y no debe aparentar un paso completado. Este cambio se prueba con contrato de API y recorrido de navegador.

## Secuencia de implementación

1. Corregir los datos de ejemplo que contaminan la operación y hacer confiable el resultado de cada acción.
2. Reordenar la navegación del dueño y dar prioridad a sus pendientes.
3. Integrar lectura del pedido y su etapa respaldada por datos en la bandeja y en Tienda viva.
4. Simplificar el primer bloque de activación y revisar el recorrido móvil.
5. Añadir la transición persistente mínima de pedidos y reflejar sus estados en la bandeja y Tienda viva.
6. Verificar los recorridos con pruebas de navegador y registrar lo que aún necesita validación con usuarios.

La implementación no cambia el esquema de almacenamiento; solo añade operaciones sobre pedidos ya persistidos. Los estados visibles de despacho/entrega nunca se infieren de la aprobación.

## Resultado implementado y límites

- La navegación del dueño prioriza Hoy, Pedidos y pendientes, Tienda viva y Conversaciones. Poner en marcha, Uso del plan y Ajustes siguen accesibles en móvil desde «Más opciones». Las pantallas de administración se reservan a administradores.
- La operación conectada ya no mezcla conversaciones, contadores ni eventos de ejemplo. Las conversaciones sin mensajes guardados muestran un vacío explícito en vez de inventar un diálogo a partir del resumen. El modo de muestra explícito conserva sus propios datos para pruebas.
- La bandeja incluye pedidos pendientes de tomar, en preparación, en camino y finalizados. Cada tarjeta presenta productos, valor, dirección, etapa y siguiente acción. Las acciones muestran confirmación o error; un fallo no se presenta como éxito.
- Tienda viva muestra señales basadas en solicitudes y pedidos reales. Sus personajes de pedidos se colocan según la etapa y abren el pedido específico. En móvil se prioriza la acción sobre los controles de cámara.
- El backend añade únicamente lectura de pedidos en el resumen y transición de etapa en `PATCH /api/orders/:id/status`. Guarda el historial dentro del pedido existente, sin migración. Cuando Google está conectado, actualiza la fila de la hoja antes de confirmar la transición; si la hoja falla, la acción devuelve un error y no avanza en la aplicación. Si Google está desconectado, el estado queda guardado en la plataforma y la tarjeta advierte que la hoja no se actualizó. Este corte no hace una sincronización automática retrospectiva al reconectar.
- Si se registró un pedido y falló la creación de su tarea, el pedido aparece como «por tomar». La API permite al dueño tomarlo directamente solo cuando no existe una solicitud pendiente para ese pedido.
- No se envía automáticamente un mensaje de WhatsApp al marcar despacho o entrega; hacerlo requeriría decidir el texto y consentimiento operativo del negocio. Tampoco se interpreta “entregado” a partir de la aprobación inicial.
- Sigue pendiente validar con tenderos reales y medir tiempos/errores de activación y operación. Los 200 pedidos finalizados más recientes se incluyen en el resumen operativo; una búsqueda histórica paginada sería un paso posterior para tiendas con mayor volumen.

## Verificación realizada

La compilación de Vite pasa. La suite `npm run test:backend` pasa, incluidos contratos de autenticación, Google y WhatsApp. El recorrido Playwright `tests/verify_owner_ux.py` pasa en 1440, 390 y 320 px: estado vacío real, navegación, pedido desde Tienda viva, error de guardado, preparación, despacho, entrega, ajustes y regreso a pedidos desde la activación. El contrato backend prueba transiciones inválidas, rechazo cuando hay una tarea pendiente, recuperación de un pedido sin tarea y fallo de sincronización de hoja sin avanzar el pedido.
