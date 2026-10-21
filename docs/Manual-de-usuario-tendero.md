# Manual del dueño de tienda

Este manual está pensado para quien atiende una tienda, panadería, minimercado o droguería y quiere recibir pedidos de WhatsApp organizados, sin aprender términos técnicos.

## En menos de diez segundos

- **Hoy** te dice qué pasa en la tienda.
- **Pedidos y pendientes** te muestra qué debes atender ahora.
- Cada pedido enseña productos, total, dirección, etapa y el siguiente botón.
- **Tienda viva** convierte los pedidos activos y las conversaciones en una vista visual que puedes tocar para abrir el caso.

## Primera puesta en marcha

Entra a **Poner en marcha** y sigue el bloque que aparece como siguiente paso. El avance se confirma con datos reales de la cuenta.

### 1. Revisa el pago de la plataforma

En la pestaña **Pago** puedes ver el plan, el valor, el estado de la suscripción y el próximo cobro cuando exista. El cobro de Ventas IA es independiente del dinero que cobras por tus domicilios.

### 2. Conecta Google

En la pestaña **Google**:

1. Pulsa **Conectar Google** y elige la cuenta que usas para la tienda.
2. Pulsa **Crear mi hoja**.
3. Agrega productos, precios y existencias.
4. Si ya tienes un archivo CSV, usa **Elegir CSV**, revisa la vista previa y pulsa **Copiar a Google Sheets**.

La carga CSV necesita como mínimo las columnas `sku` y `nombre`. También puedes incluir `precio`, `stock`, `categoría`, `marca` y `presentación`. Corrige las filas marcadas antes de importarlas.

La hoja de la tienda organiza tres datos principales:

- `Catalogo`: productos y precios que el asistente puede consultar.
- `Clientes`: información que la tienda decide guardar.
- `Pedidos`: pedidos confirmados y sus etapas.

### 3. Conecta WhatsApp

En la pestaña **WhatsApp**, elige la situación que describe tu negocio:

- **Ya tiene integración oficial**.
- **Tiene WhatsApp Business App**.
- **Empieza desde cero**.

Cuando la conexión automática esté habilitada, pulsa **Conectar con Meta**. Ten a mano el acceso de administrador de Meta, el celular con el número de la tienda y el nombre visible del negocio. Si escoges una ruta que lo solicite, crea el PIN de seguridad de seis dígitos y guárdalo: Ventas IA no lo almacena.

Si Meta todavía no está habilitado para la plataforma, la pantalla lo indicará. En ese caso puedes dejar lista la cuenta Google, el catálogo y la información del negocio mientras se habilita el canal.

### 4. Haz una prueba

En la pestaña **Prueba**, revisa el recorrido completo: el cliente escribe, el asistente consulta el catálogo, el pedido queda registrado y la tienda recibe la tarea de preparación. Usa casos reales de tu negocio, incluido un producto agotado o una pregunta que deba atender una persona.

Cuando el estado diga **Lista para recibir pedidos**, el botón principal te lleva a **Pedidos y pendientes**.

## Rutina diaria

### Al comenzar el día

1. Abre **Hoy**.
2. Mira las tarjetas de pedidos por tomar, pedidos en preparación, pedidos en camino y conversaciones activas.
3. Pulsa la acción principal de la tarjeta que quieras atender.

### Para preparar un pedido

1. Entra a **Pedidos y pendientes**.
2. Abre la pestaña **Pedidos**.
3. Revisa nombre del cliente, productos, cantidades, total y dirección.
4. Pulsa **Marcar tomado** cuando una persona de la tienda empiece a alistarlo.
5. Pulsa **Marcar en camino** cuando el domicilio salga de la tienda.
6. Pulsa **Marcar entregado** cuando el cliente reciba el pedido.

La pantalla conserva el orden de las etapas. No marques una etapa antes de que haya ocurrido en la operación real.

Si el pedido tiene una tarea pendiente de decisión, atiéndela desde esa tarjeta. La plataforma evita que se avance por dos caminos distintos para el mismo pedido.

### Para responder un cliente

1. Abre **Pedidos y pendientes** y entra a **Responder cliente**, o abre **Conversaciones**.
2. Selecciona la conversación.
3. Lee la pestaña **Mensajes**.
4. Escribe una respuesta y elige **Enviar por WhatsApp**, o guarda una nota si solo necesitas dejar contexto para tu equipo.
5. Usa **Abrir WhatsApp** si necesitas continuar la conversación directamente en el canal.

### Para usar Tienda viva

**Tienda viva** muestra tres señales sencillas: pedidos activos, clientes por responder y conversaciones activas. Toca una señal, un personaje de pedido o una conversación para abrir el caso. En una pantalla sin actividad verás **Sin actividad ahora**; no se muestran movimientos de ejemplo.

En el celular, la vista prioriza las señales y los casos. Los controles avanzados de cámara quedan ocultos para que la acción principal sea más rápida.

## Estados y avisos

| Estado | Qué significa | Qué hacer |
| --- | --- | --- |
| Pedido confirmado | El cliente confirmó una canasta válida. | Revisar productos y tomarlo. |
| Pedido por tomar | Falta que una persona de la tienda se haga cargo. | Pulsar **Marcar tomado**. |
| Alistando pedido | La tienda está preparando los productos. | Alistar y marcar **En camino** al despachar. |
| Pedido en camino | El pedido salió con el domicilio. | Marcar **Entregado** al finalizar. |
| Pedido entregado | La entrega fue registrada. | Consultarlo en **Finalizados** si necesitas revisar. |
| Pedido cancelado | La tienda no pudo aceptar o alistar el pedido. | Revisar el motivo y conservar el registro. |

Si aparece el aviso de que Google no estaba conectado, el cambio quedó guardado en Ventas IA, pero no se pudo actualizar la hoja. Reconecta Google y revisa `Pedidos` antes de cerrar la jornada.

## Uso del plan y ajustes

- **Uso del plan** muestra los domicilios usados y los disponibles del ciclo.
- **Ajustes** resume la tienda, el número de WhatsApp, Google y el asistente.
- Los detalles técnicos están dentro de secciones desplegables. No necesitas modificarlos para operar.

## Si algo no sale como esperabas

- **No ves pedidos:** confirma que estás en la tienda correcta y actualiza la lista.
- **El pedido no avanza:** revisa si tiene una tarea pendiente o si Google requiere reconexión.
- **No aparece WhatsApp:** entra a **Poner en marcha → WhatsApp** y revisa el estado de la conexión.
- **Un botón muestra un error:** no repitas muchas veces la acción; actualiza la pantalla y comprueba si la etapa cambió.
- **El catálogo tiene precios viejos:** corrige la hoja `Catalogo` y vuelve a probar una conversación.
