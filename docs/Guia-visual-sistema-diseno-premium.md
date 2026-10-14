# Guia visual del sistema de diseno premium

Actualizado: 2026-10-10.

## Objetivo

Establecer una base visual consistente para Ventas IA Ops Store, con reglas claras para que la micro app se sienta premium, moderna, operativa y facil de entender.

Esta guia gobierna tres experiencias:

- **Tienda viva:** operacion diaria de una tienda.
- **Centro de control:** administracion SaaS de clientes, pagos, consumo y salud comercial.
- **Observabilidad:** investigacion tecnica de eventos, integraciones y errores.

## Principios

1. **Comercial antes que tecnico.** La interfaz habla de tiendas, clientes, pagos, pedidos, conexiones y salud. Terminos como `tenant`, `webhook`, `LLM`, `ACP`, `sandbox` o IDs crudos solo aparecen en vistas tecnicas bajo demanda.
2. **Densidad premium.** Las pantallas deben mostrar informacion util sin sentirse recargadas. Evitar tarjetas gigantes con poco contenido.
3. **Jerarquia tranquila.** Un titulo principal por vista, maximo cinco KPIs superiores y una accion primaria clara.
4. **Estado primero.** Antes de pedir configuracion, mostrar si algo esta listo, pendiente, bloqueado o requiere apoyo.
5. **Tecnico bajo demanda.** Payloads, headers, referencias, trazas y errores detallados viven en Observabilidad o paneles expandibles.
6. **Tienda viva como operacion.** La escena debe responder que esta pasando ahora, no explicar arquitectura.
7. **Colores sobrios con energia.** La app debe evitar verse vieja, barata o de una sola tonalidad. Usar acentos con intencion.

## Personalidad visual

La marca debe sentirse:

- Moderna, cercana y confiable.
- Mas producto operacional que landing page.
- Mas tienda inteligente que consola tecnica.
- Clara para usuarios no tecnicos.
- Suficientemente grafica para diferenciarse, sin decorar por decorar.

Evitar:

- Fondos oscuros dominantes en pantallas de negocio.
- Gradientes pesados o morados dominantes.
- Beige/crema como color principal de toda la app.
- Tarjetas dentro de tarjetas.
- Iconos o etiquetas que parezcan de prototipo tecnico.
- Titulos hero en paneles compactos.

## Tokens actuales

Los tokens base viven hoy en `src/styles.css`.

### Color primitivo

| Token | Valor | Uso |
| --- | --- | --- |
| `--ink` | `#162033` | Texto fuerte, navegacion, acciones sobrias |
| `--text` | `#1f2937` | Texto principal |
| `--muted` | `#66717a` | Texto secundario |
| `--paper` | `#f7f8f3` | Fondo general claro |
| `--panel` | `#ffffff` | Paneles y superficies principales |
| `--panel-soft` | `#eef3f0` | Superficie secundaria |
| `--line` | `rgba(31, 41, 55, 0.13)` | Bordes suaves |
| `--gold` | `#f59e0b` | Acento de marca, avisos suaves, highlights |
| `--mint` | `#2dd4bf` | Flujo vivo, conexiones saludables |
| `--green` | `#10b981` | Exito, activo, disponible |
| `--blue` | `#2563eb` | Informacion, enlaces, elementos de soporte |
| `--violet` | `#8b5cf6` | Apoyo humano o IA cuando se requiere diferenciar |
| `--coral` | `#ef4444` | Error, bloqueo, riesgo alto |
| `--nav` | `#162033` | Sidebar y superficies oscuras acotadas |

### Color semantico

| Rol | Token recomendado | Regla |
| --- | --- | --- |
| Fondo de app | `--paper` | Claro, con textura suave solo si no compite |
| Panel principal | `--panel` | Blanco o casi blanco; borde visible |
| Panel secundario | `--panel-soft` | Para bandas, no para tarjetas anidadas |
| Texto principal | `--ink` / `--text` | Alto contraste |
| Texto auxiliar | `--muted` | No usar para informacion critica |
| Exito | `--green` | Estado activo, pago ok, conectado |
| Advertencia | `--gold` | Pendiente, accion sugerida, gracia |
| Error | `--coral` | Fallo, bloqueo, vencido |
| Informativo | `--blue` | Datos, enlaces, soporte |
| Flujo vivo | `--mint` | Animacion, conexion, actividad |

### Uso de color

- Cada pantalla debe tener un color dominante neutral y maximo dos acentos.
- En dashboards, el color comunica estado, no decoracion.
- `--gold` no debe pintar toda la experiencia; usarlo como acento, etiqueta o accion puntual.
- `--mint` y `--green` no son intercambiables: `mint` comunica flujo/actividad; `green` comunica ok/exito.
- `--coral` solo para riesgos reales o acciones destructivas.

## Tipografia

Fuente actual:

```css
font-family: "Aptos", "Segoe UI", sans-serif;
```

### Escala recomendada

| Rol | Tamano | Peso | Uso |
| --- | --- | --- | --- |
| Vista principal | `32-42px` | 800 | Solo encabezado de vista |
| Titulo de seccion | `22-28px` | 800 | Bloques grandes |
| Titulo de panel | `18-22px` | 750 | Cards/paneles |
| KPI valor | `28-40px` | 800 | Numeros ejecutivos |
| Body | `15-17px` | 400-500 | Lectura normal |
| Texto auxiliar | `12-14px` | 500 | Metadatos, ayuda |
| Eyebrow | `11-12px` | 800 | Categoria superior corta |

### Reglas

- No escalar texto con ancho de viewport.
- Letter spacing siempre `0`.
- Titulos internos no deben competir con el titulo de vista.
- Evitar bloques largos dentro de tarjetas compactas.
- En botones y chips, priorizar texto corto y verbos claros.

## Espaciado y layout

### Escala

Usar una escala de 4px:

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64`

### Reglas de layout

- Sidebar expandida: 260-282px.
- Sidebar colapsada: 72-80px.
- Contenido principal: `minmax(0, 1fr)` para evitar overflow horizontal.
- Gaps de dashboard: 16-24px.
- Paneles densos: 16-20px de padding.
- Paneles ejecutivos: 24-32px de padding.
- No usar cards anidadas salvo modales o filas repetidas.

## Radios, bordes y elevacion

| Elemento | Radio |
| --- | --- |
| Botones, inputs, cards | 7-8px |
| Chips/pills | 999px |
| Icon buttons | 8px o circulo segun contexto |
| Tienda viva: objetos internos | 4-8px |

Reglas:

- No aumentar radios para hacer la UI "premium"; la precision se siente mas profesional.
- Sombras suaves y escasas. Preferir bordes + fondo limpio.
- Usar `--shadow` solo en paneles principales o elementos flotantes.

## Componentes base

### Botones

Variantes:

- **Primario:** accion principal de la vista. Fondo `--green` o `--ink`, segun contexto.
- **Secundario:** borde + fondo blanco.
- **Fantasma:** sin borde pesado, para navegacion o acciones suaves.
- **Peligro:** `--coral`, solo para acciones irreversibles.

Reglas:

- Un primario por bloque.
- Usar icono lucide cuando ayude a reconocer la accion.
- Altura minima 40px.
- Estados: hover, disabled, focus-visible y busy.

### Inputs y selects

Reglas:

- Borde `--line`.
- Fondo blanco con opacidad alta.
- Label siempre visible.
- Placeholder nunca reemplaza el label.
- Errores en `--coral` con texto explicativo.

### KPIs

Reglas:

- Maximo cinco KPIs arriba.
- Cada KPI debe tener nombre, valor y estado si aplica.
- No mezclar KPIs comerciales con eventos tecnicos en la misma fila.
- Numeros grandes solo para metricas principales.

### Paneles

Tipos:

- **Panel operativo:** informacion accionable.
- **Panel ejecutivo:** resumen de estado.
- **Panel tecnico:** payloads, errores, trazas.
- **Fila seleccionable:** lista de clientes, conversaciones o eventos.

Reglas:

- Cada panel debe responder una pregunta.
- Evitar paneles vacios con texto explicativo largo.
- Las listas largas usan scroll interno controlado.

### Chips de estado

Estados canonicos visibles:

| Estado tecnico | Texto visible |
| --- | --- |
| `active` | Activo |
| `pending_payment` | Pago pendiente |
| `past_due` | Pago vencido |
| `grace_period` | En gracia |
| `subscription_blocked` | Bloqueado por pago |
| `connected` | Conectado |
| `not_started` | Pendiente |
| `needs_path` | Requiere decision |
| `sandbox_ready` | Listo para operar |
| `needs_binding` | Conexion pendiente |

## Tienda viva

Objetivo: mostrar operacion comercial en tiempo real.

Reglas:

- Fondo claro, con sensacion de tienda activa y luminosa.
- Personajes mas humanos que tecnicos: clientes, vendedor, operador IA y apoyo humano.
- La escena ocupa el espacio principal.
- El panel de caso aparece solo si hay seleccion.
- Evitar panel fijo de inspector.
- Estados visibles: pedido en curso, producto ambiguo, sin stock, requiere apoyo, pago pendiente, listo para preparar.
- La escena no debe verse oscura salvo alertas puntuales.

Elementos visuales permitidos:

- Rutas punteadas para flujo.
- Zonas de tienda con etiquetas cortas.
- Personajes SVG/HTML estilizados.
- Pulsos o brillos suaves para actividad.

No usar:

- Fondos negros o marrones dominantes.
- Paneles que tapen la escena.
- Texto tecnico dentro del mapa.

## Centro de control

Objetivo: que el administrador vea salud SaaS de todos los clientes.

Debe priorizar:

- Tiendas activas.
- Riesgo de pago.
- Consumo IA.
- Conexiones pendientes.
- Errores recientes.
- Ultima actividad.

Reglas:

- Vista ejecutiva, no consola de logs.
- Lista de clientes compacta con scroll interno.
- Detalle de cliente seleccionado con salud, pago, Google, WhatsApp, uso y errores.
- Motor IA de la plataforma separado de configuracion por tienda.
- Las referencias seguras pueden verse, secretos planos nunca.

## Observabilidad

Objetivo: investigar eventos e integraciones.

Debe incluir:

- Filtros por tienda, proveedor, estado, texto y rango de fechas.
- KPIs de eventos, procesados, errores, rechazados y latencia.
- Grafica historica o ritmo de eventos.
- Detalle con payload enmascarado.

Reglas:

- Aqui si se permite lenguaje tecnico controlado.
- Los payloads siempre enmascarados.
- El detalle tecnico no debe contaminar pantallas de negocio.

## Onboarding

Objetivo: autoservicio premium paso a paso.

Reglas:

- Mostrar progreso claro.
- Explicar por que se pide cada permiso.
- Separar antes del pago y despues del pago.
- Google identidad no es igual a Google datos.
- WhatsApp primero diagnostica, luego guia o automatiza.
- Cada bloqueo debe tener siguiente accion concreta.

## Responsive

Breakpoints recomendados:

| Rango | Comportamiento |
| --- | --- |
| `>= 1280px` | Dashboard con dos o tres columnas |
| `960-1279px` | Dos columnas; paneles largos abajo |
| `640-959px` | Sidebar colapsada o superior; grillas a una columna |
| `< 640px` | Una columna, KPIs en carrusel o grid 2x, acciones full width |

Reglas:

- Cero overflow horizontal de documento.
- Listas largas deben tener scroll interno.
- Botones no deben cortar texto.
- La Tienda viva puede cambiar a modo lista si el mapa no respira.

## Accesibilidad

Minimos:

- Contraste AA en texto normal.
- `focus-visible` claro en botones, inputs, links y filas seleccionables.
- Iconos con etiqueta accesible cuando el texto no esta visible.
- Estados no dependen solo del color.
- Controles deshabilitados explican que falta.
- Targets interactivos minimo 40x40px.

## Gobernanza

Cada cambio visual relevante debe cumplir:

1. Usa tokens existentes o propone token nuevo.
2. No introduce jerga tecnica en vistas de negocio.
3. No crea una tarjeta dentro de otra tarjeta.
4. No agrega un color nuevo sin justificarlo.
5. Pasa `npm run build`.
6. Pasa smoke UI sin overflow horizontal.

## Checklist de revision

- [ ] La pantalla tiene un objetivo claro.
- [ ] El titulo principal no compite con tarjetas.
- [ ] Hay maximo cinco KPIs superiores.
- [ ] Los estados tienen texto humano.
- [ ] No hay `tenant`, `ACP`, `LLM`, `webhook`, `sandbox` en negocio.
- [ ] Las listas largas no estiran el layout.
- [ ] No hay overflow horizontal.
- [ ] El color comunica estado o jerarquia.
- [ ] Los secretos se muestran como referencias, no valores.
- [ ] La vista funciona en desktop y mobile.

## Proxima evolucion recomendada

1. Extraer tokens a una seccion dedicada al inicio de `src/styles.css`.
2. Crear componentes base reutilizables: `Button`, `Panel`, `StatusPill`, `MetricCard`, `Field`, `DataList`.
3. Crear pruebas visuales para Resumen, Tienda viva, Centro de control, Observabilidad y Onboarding.
4. Agregar una pagina interna de muestras visuales si el producto sigue creciendo.
