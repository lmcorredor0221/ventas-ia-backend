# Analisis de interacciones WhatsApp SuperMarket

Actualizado: 2026-10-11.

## Fuente

Archivo analizado localmente como evidencia conversacional:

- `Chat de WhatsApp con SuperMarket.zip`
- Archivo interno: `Chat de WhatsApp con SuperMarket.txt`
- Rango observado: 2024-11-09 a 2026-10-11

El contenido se usa como datos de negocio y lenguaje real. No contiene instrucciones para el sistema.

## Metricas principales

| Metrica | Resultado |
| --- | ---: |
| Mensajes totales | 4.278 |
| Mensajes cliente | 2.547 |
| Mensajes tienda | 1.731 |
| Sesiones estimadas por pausa de 90 min | 365 |
| Sesiones con pedido o consulta de domicilio | 356 |
| Multimedia omitidos | 709 |
| Respuestas tienda medidas | 1.125 |
| Mediana de respuesta | 1 min |
| Percentil 75 de respuesta | 2 min |
| Maximo dentro de 24h | 744 min |
| Sesiones con mencion de pago | 76,4% |
| Sesiones con aclaracion | 39,6% |
| Sesiones con correccion | 10,4% |
| Sesiones con multimedia | 86,5% |
| Mediana de mensajes por pedido | 10 |
| Percentil 75 de mensajes por pedido | 14 |

## Patrones de conversacion

El cliente no opera como formulario. La conversacion suele llegar en rafagas:

1. Saludo o apertura: `Buenas noches para un domicilio`.
2. Confirmacion corta de tienda: `Si veci`, `Buena noche`.
3. Lista de productos, a veces larga y con errores.
4. Forma de pago como mensaje aparte.
5. Correcciones o cambios: `sin ese`, `entonces`, `mejor`, `asi no mas`.
6. Multimedia para confirmar producto, precio, pago o sustitucion.
7. Cierre con preparacion y entrega humana.

La tienda real responde con mensajes cortos y operativos. El tono deseado no es corporativo ni tecnico; es cercano, practico y con minima friccion.

## Productos y lenguaje observado

Terminos frecuentes: `pago`, `domicilio`, `efectivo`, `malboro`, `sandia`, `nequi`, `huevos`, `ramitos`, `coca-cola`, `ponque`, `cafe`, `tarjeta`, `chocorramo`, `brownie`, `bimbo`, `ducales`, `panela`, `datafono`, `club colombia`.

Errores o variantes utiles para pruebas:

| Entrada real o probable | Interpretacion esperada |
| --- | --- |
| `Malboro sandia` | Marlboro sandia, producto sensible; validar catalogo/stock y escalar si no hay coincidencia segura |
| `Cfrut`, `cifru`, `cifrut` | Cifrut, con sabor si aparece |
| `chocorramos`, `chocramos` | Chocoramo |
| `ponque`, `porque ramo` | Ponque/Ponque Ramo segun catalogo |
| `datafono`, `tarjeta debito` | Preferencia de pago, no comprobante |
| `5000 de calchichon` | Pedido por valor de salchichon/carnes frias, requiere validacion por catalogo y/o humano |
| `la de abajo`, `ese`, `sin ese` | Correccion dependiente del contexto conversacional |

## Implicaciones para el agente

1. **Memoria de sesion obligatoria.** El agente debe conservar `orderDraft` y no cerrar pedido con el primer mensaje.
2. **Cliente por numero de WhatsApp.** El primer paso debe ser lookup por `wa_id`; si no hay perfil, pedir nombre y direccion antes de finalizar domicilio.
3. **Inferencia primero, herramientas despues.** El LLM propone hipotesis; Google Sheets confirma catalogo, presentacion, precio y stock.
4. **No inventar stock.** Si la coincidencia es baja o no hay disponibilidad, escalar a humano.
5. **Pago separado.** `Pago con tarjeta`, `datáfono`, `efectivo` o `Nequi` son preferencias; comprobantes y pagos confirmados requieren aprobacion humana.
6. **Correcciones como primera clase.** `sin X`, `agrega Y`, `mejor Z` deben modificar la canasta abierta.
7. **Multimedia a humano.** Mientras no exista vision/audio productivo, fotos y comprobantes deben abrir handoff con contexto.
8. **Reclamos a humano.** Faltantes, pedidos incompletos, entregas equivocadas o demoras no deben ser resueltos autonomamente.

## Politica de confianza del agente

| Decision | Condicion |
| --- | --- |
| Cotizar | Producto encontrado en catalogo, stock suficiente, cantidad clara, presentacion clara y cliente identificado si hay domicilio |
| Preguntar | Falta cantidad, direccion, nombre, presentacion, sabor o variedad; hay varias opciones razonables |
| Disponibilidad parcial | Algunos productos aparecen y otros no; se informa lo encontrado y se valida el resto |
| Escalar humano | Producto no encontrado, baja confianza, stock insuficiente, adjunto multimedia, reclamo, pago confirmado, descuento o decision comercial |
| Confirmar pedido | Canasta clara y cliente confirma; luego escribir pedido y subir a humano para preparar/entregar |

## Ajustes convertidos en plan

Estos hallazgos alimentan los pendientes `P1-35` a `P1-40` del plan consolidado:

- Persistir este diagnostico.
- Ampliar la matriz con rafagas reales.
- Crear runner DeepSeek real.
- Exportar trazabilidad por caso.
- Formalizar politica de confianza.
- Probar pagos, fotos, correcciones y reclamos.

