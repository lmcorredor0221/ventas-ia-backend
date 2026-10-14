# Auditoria UX - Pantalla Conversaciones WhatsApp

Fecha: 2026-10-13

## Problemas Priorizados

| Prioridad | Hallazgo | Correccion aplicada |
| --- | --- | --- |
| Alta | El detalle y el hilo generaban saturacion horizontal en desktop. | Se separo el flujo en una vista de listado y una vista de detalle dedicada, con `minmax(0, 1fr)`, `overflow-wrap` y panel lateral colapsable. |
| Alta | Lista y detalle seguian compitiendo por el mismo viewport cuando habia muchas conversaciones. | Se dividio la bandeja en tabs `Listado` y `Detalle`; al seleccionar un cliente desde la lista se abre el detalle operativo en una pantalla dedicada. |
| Alta | En movil no existia patron master-detail claro. | La lista ocupa la pantalla; al abrir una conversacion se muestra detalle a pantalla completa con boton Atras y tabs Chat / Resumen / Acciones. |
| Alta | La accion humana competia visualmente con metadatos. | La tarjeta de accion se convirtio en bloque prioritario con color semantico y CTA ancho. En movil el CTA queda disponible en la pestana Acciones. |
| Media | Chips de estado y sidebar tenian bajo contraste. | Se reforzaron chips con icono, fondo y texto semantico; sidebar y tarjeta de tienda usan contraste mas alto. |
| Media | El porcentaje no explicaba que media. | Se agrego etiqueta "Progreso" y tooltip para describir el porcentaje del flujo operativo. |
| Media | "Abrir WhatsApp" parecia enlace roto dentro de boton. | Se normalizo como boton claro con `wa.me`, sin subrayado y con alineacion consistente. |
| Media | Repeticion excesiva del nombre del cliente en burbujas. | Las burbujas ahora usan roles ("Cliente", "Agente IA", "Tienda") y el nombre queda en encabezado/lista. |
| Baja | Faltaban estados explicitos. | Se conservaron estados vacios y se agregaron estados inline de carga/error para la bandeja. |

## Decisiones de Diseno

- Mantener un solo componente de conversacion y adaptar la presentacion con CSS responsive para evitar duplicar logica.
- Desktop: navegacion por tabs `Listado` / `Detalle`; chat como superficie central, resumen/acciones como panel lateral colapsable.
- Tablet: lista + detalle con panel simplificado para evitar tres columnas apretadas.
- Movil: master-detail con tab de listado y detalle dedicado para reducir carga visual y mantener objetivos tactiles.
- Sidebar movil: barra inferior compacta para liberar espacio vertical.

## Checklist de Verificacion

- [x] Sin scroll horizontal intencional en layout principal.
- [x] Chips con icono, texto y contraste reforzado.
- [x] Navegacion con teclado: `/` enfoca busqueda, flechas cambian conversacion, Enter abre detalle.
- [x] Seleccionar un cliente desde `Listado` cambia automaticamente a `Detalle`.
- [x] Burbujas con `overflow-wrap: anywhere` y ancho maximo controlado.
- [x] CTA humano con jerarquia visual superior.
- [x] Estados vacio, carga y error visibles en la bandeja.
- [x] Build y pruebas backend ejecutadas.

