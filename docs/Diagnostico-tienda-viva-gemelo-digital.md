# Diagnostico P0-08: Tienda viva como gemelo digital gamificado

Actualizado: 2026-10-11.

## Objetivo

Auditar la implementacion actual de **Tienda viva** antes de continuar con pruebas amplias del plan consolidado. El foco fue validar si la pantalla ya funciona como gemelo digital gamificado o si todavia es una visualizacion isometrica con deuda de interaccion, movil, semantica operativa y rendimiento.

## Evidencia revisada

- Codigo: `src/App.jsx`, `src/styles.css`, `src/data/acpModel.js`.
- Prueba automatizada nueva: `tests/audit_tienda_viva.py`.
- Capturas generadas:
  - `test-results-tienda-viva-desktop.png`
  - `test-results-tienda-viva-mobile.png`
  - `test-results-tienda-viva-click.png`
  - `test-results-tienda-viva-mobile-click.png`
- Metricas generadas:
  - `test-results-tienda-viva-audit.json`
- Ejecucion:
  - `npm run build`
  - `npm run preview -- --port 4174`
  - `python tests\audit_tienda_viva.py`

## Lectura ejecutiva

La pantalla tiene una base visual valiosa: tienda isometrica clara, personajes mas humanos que la version inicial, zonas operativas, rutas visibles, alerta global de apoyo humano y panel contextual de caso seleccionado.

Todavia **no debe considerarse un gemelo digital gamificado completo**. La experiencia actual representa conversaciones y estados, pero todavia no garantiza que los movimientos correspondan a eventos reales, no tiene niveles de detalle para alto volumen, no tiene experiencia movil nativa tipo juego y la intervencion humana no esta priorizada desde el mapa de forma accionable.

## Hallazgos principales

| ID | Problema | Evidencia | Severidad | Impacto | Esfuerzo |
| --- | --- | --- | --- | --- | --- |
| TV-01 | Movimientos de conversaciones no son semanticos; dependen de `tick + index` y recorren `conversation.path` ciclicamente. | `StoreMap` calcula `currentZoneIndex` por tiempo, no por evento real. | Alta | Puede hacer creer que una conversacion avanzo aunque no haya evento operativo. | Medio |
| TV-02 | No hay niveles de detalle ni agrupacion visual. | `conversations.map(...)` renderiza un personaje por conversacion. | Alta | Con 50, 200 o 1.000 conversaciones la tienda no escala visual ni tecnicamente. | Medio/Alto |
| TV-03 | Movil no tiene Adaptive Game UX; es una reduccion vertical de la pantalla desktop. | Captura `test-results-tienda-viva-mobile.png`: sidebar, header y KPIs consumen gran parte antes de llegar al mapa. | Alta | El usuario no ve rapido la operacion viva en celular. | Medio |
| TV-04 | Al seleccionar un personaje en movil, el panel de caso se comporta como layout ancho y queda cortado. | Captura `test-results-tienda-viva-mobile-click.png`: el panel aparece con contenido desplazado/cortado hacia la derecha. | Alta | Consultar una conversacion en movil se vuelve incomodo y pierde informacion. | Medio |
| TV-05 | Las zonas son botones visuales, pero no navegan ni filtran. | `button.zone` no tiene `onClick`; solo `title`. | Media | El usuario no puede explorar por areas de tienda, requisito central del gemelo digital. | Bajo/Medio |
| TV-06 | La alerta de intervencion humana existe, pero no es accionable desde el mapa. | `.intervention-sign` muestra conteo, pero no permite abrir la cola ni filtrar casos. | Media/Alta | Las aprobaciones no tienen prioridad operacional suficiente, especialmente en movil. | Bajo |
| TV-07 | Controles superiores del mapa no cumplen comodidad tactil movil. | Metricas: botones de toolbar con 30 px de alto. | Media | Dificil operar con una mano; por debajo del objetivo tactil recomendado. | Bajo |
| TV-08 | En movil se ocultan etiquetas de zonas. | Metricas: `visibleZoneLabels = 0` en viewport movil. | Media | El mapa se ve atractivo, pero pierde explicacion operacional. | Medio |
| TV-09 | No hay camara, zoom ni pan real. | `Centrar vista` reinicia seleccion, pero no controla camara. | Media | Falta sensacion Tycoon real y exploracion de tienda. | Medio |
| TV-10 | Personajes con aprobacion/bloqueo pueden superponerse. | Metricas desktop: Carlos R. y Monica P. ocupan coordenadas muy cercanas en zona de aprobacion. | Media | Seleccion ambigua y lectura visual saturada en bloqueos. | Bajo/Medio |
| TV-11 | El contenedor usa `role="img"` mientras contiene botones interactivos. | `.store-map` tiene `role="img"` y adentro hay `button.zone` y `button.avatar`. | Media | Semantica accesible inconsistente para lectores de pantalla. | Bajo |
| TV-12 | Hay errores de consola cuando se audita en modo preview/offline. | `500 Internal Server Error` en capturas de consola. | Baja/Media | No rompe la vista, pero ensucia validacion y puede ocultar errores reales. | Bajo |

## Fortalezas detectadas

- Desktop ya comunica una operacion tipo tienda viva con buena orientacion espacial.
- La eliminacion del inspector fijo mejoro el espacio disponible.
- La ficha contextual aparece al seleccionar personajes en escritorio.
- Hay alerta agregada de apoyo humano y estados visuales por personaje.
- Existe modo de movimiento reducido dentro del mapa.
- No se detecto overflow horizontal de documento en desktop, tablet ni movil durante la auditoria.
- Los personajes son mas humanos y diferenciables que en la primera version.

## Diagnostico por fase del subplan

| Fase | Estado diagnosticado | Comentario |
| --- | --- | --- |
| DG-01 Auditoria real | Cerrado | Este documento y `tests/audit_tienda_viva.py` cierran el diagnostico inicial. |
| DG-02 Adaptive Game UX | Parcial avanzado | Mapa mas prioritario en movil, ficha inferior usable, controles tactiles, navegacion alternativa por zonas, etiquetas compactas, camara con zoom/pan/reset, rueda/trackpad y arrastre directo sobre escenario. |
| DG-03 Niveles de detalle | Parcial avanzado | Se agrego foco de zona con conteo, riesgo y casos relacionados; tambien LOD individual/zona/empresa con agrupacion visual para 50/200/1.000 conversaciones. |
| DG-04 Personajes y animaciones | Parcial avanzado | Personajes con rostro mas humano, expresiones por mood, props operativos por estado real y validacion sin overflow; falta ampliar libreria visual con mas diversidad si el volumen crece. |
| DG-05 Animacion semantica | Parcial avanzado | Los personajes de conversaciones ya se ubican por estado critico, evento reciente, etapa o herramienta; falta ampliar catalogo semantico con eventos reales productivos. |
| DG-06 Intervencion humana prioritaria | Parcial avanzado | Backend/UI de respuesta humana existe; la alerta del mapa abre aprobaciones y la zona de aprobacion se prioriza con casos criticos. |
| DG-07 Rendimiento y escalabilidad | Parcial avanzado | Se agrego auditoria con fixtures de 10, 50, 200 y 1.000 conversaciones, backend local, navegador visible, RAF y metricas CDP; GPU queda pendiente por herramienta especializada. |
| DG-08 Accesibilidad y experiencia movil | Parcial avanzado | Bottom sheet movil, targets tactiles de 44 px, foco/escape, roles ARIA, navegacion alternativa por carriles y auditoria dedicada listos. |
| DG-09 Implementacion incremental | Cerrado localmente | Mejoras aplicadas por incrementos sin reconstruir la app: ficha contextual, evento humano prioritario, camara, LOD, personajes, accesibilidad movil y pruebas dedicadas. |
| DG-10 Validacion antes/despues | Cerrado localmente | Comparativa posterior documentada con pruebas desktop, movil, semantica, accesibilidad, foco humano, LOD y rendimiento headless. |

## Prioridad recomendada

1. **Corregir movil primero:** bottom sheet para caso seleccionado, mapa visible antes, toolbar tactil y navegacion por zonas.
2. **Hacer accionable la intervencion humana:** click en alerta global y filtros visuales de casos que requieren apoyo.
3. **Separar ambientacion de eventos reales:** mantener personajes decorativos como ambientacion, pero los personajes de conversaciones deben moverse solo por cambios reales de estado/evento.
4. **Definir LOD:** vista empresa con conteos, vista zona con grupos y vista individual con caso.
5. **Crear fixtures de carga:** 10, 50, 200 y 1.000 conversaciones para rendimiento y legibilidad.
6. **Arreglar accesibilidad:** reemplazar `role="img"` por una region interactiva con descripciones y controles accesibles.

## Recomendacion de implementacion

Ejecutar P0-09 en tres incrementos pequenos:

1. **Movil operativo:** bottom sheet, toolbar tactil, mapa priorizado y panel seleccionado sin cortes.
2. **Intervencion humana en mapa:** alerta accionable, foco automatico en casos criticos y filtro de zona aprobacion.
3. **LOD base:** agrupar conversaciones por zona cuando superen un umbral y mantener visibles los casos criticos.

Despues de eso ejecutar P0-10 con fixtures de carga y mediciones.

## Avance P0-09 - primer incremento

Actualizado: 2026-10-11.

Se implemento el primer corte de Adaptive Game UX sin tocar reglas de negocio:

- La alerta **Requiere apoyo** dentro del mapa ahora es accionable y abre la bandeja de aprobaciones cuando existen casos pendientes.
- Las zonas de la tienda ahora pueden enfocarse visualmente; se agrego un panel de zona enfocada con conteo relacionado y acceso a conversaciones.
- El mapa cambio de `role="img"` a `role="region"` para no mezclar semantica de imagen con controles interactivos.
- Los controles del mapa subieron de 30 px a 34 px en escritorio y 44 px en movil.
- En movil, el panel de **Caso seleccionado** se convierte en una ficha inferior de una sola columna, sin corte horizontal.
- La auditoria `tests/audit_tienda_viva.py` ahora mide correctamente el panel seleccionado despues del click.

Evidencia posterior:

- `npm run build`
- `python tests\audit_tienda_viva.py`
- `test-results-tienda-viva-mobile-selected.png`
- `test-results-tienda-viva-desktop-selected.png`
- `test-results-tienda-viva-audit.json`

Resultados medidos despues del ajuste:

| Vista | Resultado |
| --- | --- |
| Desktop | Sin overflow horizontal; alerta humana es `BUTTON`; panel seleccionado abre correctamente. |
| Tablet | Sin overflow horizontal; panel seleccionado abre correctamente. |
| Movil | Sin overflow horizontal; mapa visible en el primer tramo de la vista de tienda; botones de mapa con 44 px de alto; panel seleccionado mide 358 px de ancho en viewport de 390 px. |

Pendiente dentro de P0-09:

- Mantener etiquetas o resumen de zona sin saturar el mapa movil.
- Separar animaciones decorativas de movimientos por eventos reales.
- Preparar LOD base para P0-10.

## Avance P0-09 - segundo incremento

Actualizado: 2026-10-11.

Se implemento exploracion real por zonas y priorizacion operativa:

- El panel de **Zona enfocada** ahora muestra conteo, riesgo y hasta tres casos relacionados con esa zona.
- Cada caso listado en la zona abre la ficha individual del caso en la tienda.
- Los personajes relacionados con la zona enfocada quedan resaltados; los demas se atenúan para facilitar lectura operacional.
- La zona de aprobacion queda priorizada por defecto cuando hay casos con `approval_required`, `blocked` o `degraded`.
- En movil se agrego una navegacion tactil horizontal por zonas para no depender de tocar areas pequenas del dibujo isometrico.
- La alerta **Requiere apoyo** abre la bandeja de aprobaciones en desktop, tablet y movil.
- La auditoria ignora correctamente el overflow interno esperado de la banda horizontal de zonas y sigue verificando que el documento no tenga overflow horizontal accidental.

Evidencia posterior:

- `npm run build`
- `python tests\audit_tienda_viva.py`
- `test-results-tienda-viva-audit.json`
- `test-results-tienda-viva-mobile-selected.png`
- `test-results-tienda-viva-desktop-selected.png`

Resultados medidos despues del segundo ajuste:

| Vista | Resultado |
| --- | --- |
| Desktop | Cambio a zona `catalog` medido; panel de zona muestra 3 casos; alerta humana abre aprobaciones; sin overflow horizontal. |
| Tablet | Cambio a zona `catalog` medido; panel de zona muestra 3 casos; alerta humana abre aprobaciones; sin overflow horizontal. |
| Movil | Navegacion tactil por zonas cambia a `catalog`; panel de zona muestra 3 casos; alerta humana abre aprobaciones; documento sin overflow horizontal. |

Pendiente dentro de P0-09/P0-10:

- Mantener etiquetas o resumen de zona sin saturar el mapa movil.
- Refinar agrupacion/culling para casos extremos.
- Medir GPU con herramienta especializada si se vuelve necesario.

## Avance P0-10 - LOD y carga inicial

Actualizado: 2026-10-11.

Se implemento una primera version funcional de niveles de detalle para evitar que la tienda renderice cientos o miles de personajes:

- Fixture local controlado mediante `?loadFixture=10`, `?loadFixture=50`, `?loadFixture=200` y `?loadFixture=1000`.
- LOD individual: hasta 24 conversaciones se muestran como personajes individuales.
- LOD zona: desde 25 hasta 200 conversaciones se muestran casos criticos/seleccionados y clusters por zona.
- LOD empresa: mas de 200 conversaciones se muestran como tablero de zonas, con pocos casos criticos visibles y el resto agrupado.
- Los casos `approval_required`, `blocked` y `degraded` conservan prioridad visual y no quedan ocultos dentro de los grupos.
- Los clusters por zona son interactivos y cambian la zona enfocada.
- La auditoria de carga quedo en `tests/audit_tienda_viva_lod.py`.

Evidencia posterior:

- `npm run build`
- `python tests\audit_tienda_viva.py`
- `python tests\audit_tienda_viva_lod.py`
- `test-results-tienda-viva-lod.json`
- Capturas `test-results-tienda-viva-lod-10.png`, `test-results-tienda-viva-lod-50.png`, `test-results-tienda-viva-lod-200.png`, `test-results-tienda-viva-lod-1000.png`.

Resultados medidos:

| Carga | LOD | Avatares renderizados | Clusters | Overflow horizontal | Lectura operacional |
| --- | --- | ---: | ---: | --- | --- |
| 10 | Individual | 10 | 0 | No | Todos los casos visibles |
| 50 | Zona | 14 | 8 | No | 36 casos agrupados |
| 200 | Zona | 14 | 8 | No | 186 casos agrupados |
| 1.000 | Empresa | 8 | 8 | No | 992 casos agrupados |

Limitaciones restantes:

- La medicion actual ya incluye muestreo RAF automatizado, pero en Chromium headless entrega FPS artificialmente bajo; debe repetirse en navegador visible/DevTools para FPS, CPU y GPU definitivos.
- Los movimientos de conversacion ya no dependen de posicion temporal; falta ampliar el catalogo de eventos reales cuando entren mas integraciones productivas.
- La agrupacion visual funciona y la camara ya cubre botones, rueda/trackpad y arrastre directo; falta validar eventos productivos reales con URL publica.

## Avance P0-10 - medicion con backend local

Actualizado: 2026-10-11.

Se ejecuto medicion con frontend y backend local levantados al mismo tiempo:

- Backend: `npm run backend`, salud verificada en `http://127.0.0.1:3001/health`.
- Frontend: `npm run preview -- --port 4174`.
- Pruebas:
  - `python tests\audit_tienda_viva_performance.py`
  - `$env:PW_HEADLESS='false'; python tests\audit_tienda_viva_performance.py`
- Evidencia:
  - `test-results-tienda-viva-performance-headless.json`
  - `test-results-tienda-viva-performance-headed.json`
  - Capturas `test-results-tienda-viva-performance-headed-10.png`, `-50.png`, `-200.png`, `-1000.png`.

Resultados:

| Carga | Boot visible | FPS aprox. visible | LOD | Avatares | Clusters | Heap JS | Overflow | Errores reales |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- | --- |
| 10 | 2.3 s | 23.0 | Individual | 10 | 0 | 5.44 MB | No | 0 |
| 50 | 2.5 s | 29.5 | Zona | 14 | 8 | 4.72 MB | No | 0 |
| 200 | 2.2 s | 30.5 | Zona | 14 | 8 | 5.01 MB | No | 0 |
| 1.000 | 2.4 s | 46.4 | Empresa | 8 | 8 | 5.99 MB | No | 0 |

Notas:

- La advertencia `401 Unauthorized` corresponde al endpoint admin cuando no hay sesion admin activa; se contabiliza como advertencia esperada, no como error de render.
- Las advertencias del widget Google Sign-In (`403`, `GSI_LOGGER`) se clasifican como externas esperadas para `127.0.0.1` y no afectan la Tienda viva.
- Se agrego `performance-mode` automatico para LOD zona/empresa: desactiva animaciones decorativas, transiciones pesadas y ambientacion no critica en LOD empresa.
- El muestreo RAF headless reporta valores bajos y no debe tomarse como FPS final de usuario; la medicion visible es la referencia local actual.
- Playwright/CDP no entrega GPU confiable en esta ruta; si el producto exige medicion grafica fina, debe repetirse con Chrome DevTools Performance/GPU o herramienta dedicada.

## Avance P0-11 - movimientos semanticos

Actualizado: 2026-10-11.

Se corrigio la deuda TV-01: los personajes que representan conversaciones ya no cambian de zona por `tick + index` ni recorren rutas ciclicas. Ahora su ubicacion se resuelve por prioridad operativa:

1. Estado critico o solicitud humana pendiente: zona **Aprobacion**.
2. Evento reciente: aprobacion, decision, herramienta, fallback o cierre.
3. Etapa del caso: catalogo, aprobacion, pago, fuera de horario o canasta.
4. Herramienta principal: Google Sheets, Drive, WhatsApp, scheduler, planner o escritura transaccional.
5. Ruta configurada como fallback visual.

Tambien se agregaron atributos de diagnostico en cada avatar (`data-zone`, `data-zone-source`, `data-conversation-id`) para validar por automatizacion que la posicion visual tiene una causa operativa.

Evidencia posterior:

- `npm run build`
- `npm run backend`
- `npm run preview -- --port 4174`
- `python tests\audit_tienda_viva_semantic.py`
- `python tests\audit_tienda_viva.py`
- `test-results-tienda-viva-semantic.json`
- `test-results-tienda-viva-semantic.png`

Resultados medidos:

| Prueba | Resultado |
| --- | --- |
| Semantica de avatars | 5/5 avatares con `data-zone` y `data-zone-source`. |
| Movimiento no ciclico | `stableRatio = 1.0` despues de 3,1 s con backend local conectado. |
| Auditoria Tienda viva | Desktop, tablet y movil sin overflow horizontal accidental; seleccion de caso sigue operativa. |

Limitaciones restantes:

- La semantica cubre los eventos y herramientas actuales; cuando entren WhatsApp/DeepSeek/Mercado Pago reales deben agregarse nuevos tipos de evento al mapa semantico.
- La advertencia `401 Unauthorized` de `/api/auth/me` sigue apareciendo cuando se entra sin sesion y luego se usa acceso local; no rompe el render, pero conviene filtrarla o tratarla como estado esperado en auditorias visuales.

## Avance P0-12 - camara, zoom y paneo

Actualizado: 2026-10-11.

Se implemento una primera camara operativa para la tienda viva:

- Capa `store-camera-stage` para transformar el escenario sin escalar los paneles operativos.
- Controles compactos dentro del mapa para acercar, alejar, mover y restablecer camara.
- Enfoque automatico al seleccionar una zona desde la navegacion tactil, zonas del mapa o clusters.
- Arrastre con pointer events sobre el escenario para paneo manual sin interferir con botones, avatares ni zonas.
- Reset de camara integrado al boton **Centrar vista** y al control interno de camara.
- Adaptacion movil: controles de 38 px, ubicados en la parte inferior del mapa sin generar overflow horizontal.

Evidencia posterior:

- `npm run build`
- `npm run backend`
- `npm run preview -- --port 4174`
- `python tests\audit_tienda_viva_camera.py`
- `python tests\audit_tienda_viva.py`
- `python tests\audit_tienda_viva_semantic.py`
- `test-results-tienda-viva-camera.json`
- `test-results-tienda-viva-camera-mobile.png`

Resultados medidos:

| Prueba | Resultado |
| --- | --- |
| Zoom | `scale` pasa de `1` a `1.12`. |
| Paneo | El eje X cambia despues de mover camara a la derecha. |
| Enfoque por zona | La navegacion a `catalog` actualiza zona activa y transformacion de camara. |
| Reset | `scale=1`, `x=0`, `y=0` sin overflow horizontal. |
| Regresion Tienda viva | Auditoria desktop/tablet/movil sigue sin overflow horizontal accidental. |
| Semantica | `stableRatio=1.0`; la camara no reintroduce movimiento artificial. |

Limitaciones restantes:

- El paneo tactil ya existe por pointer events y se refino con arrastre directo sobre el escenario; falta validar sensacion final con usuarios reales.
- La camara enfoca zonas y eventos criticos locales; falta validar la misma automatizacion con eventos productivos reales.
- Los controles son funcionales; en una iteracion posterior conviene convertirlos en un minimapa o rail mas elegante si el mapa crece.

## Avance P0-13 - etiquetas moviles y camara con LOD alto

Actualizado: 2026-10-11.

Se ajusto la lectura movil del mapa:

- Las etiquetas completas de zona siguen disponibles en desktop/tablet.
- En movil, la zona enfocada o con riesgo muestra una etiqueta compacta tipo chip con el nombre corto.
- La navegacion tactil superior sigue siendo el mecanismo principal para recorrer zonas sin saturar el escenario.
- Los controles de camara se validaron contra LOD zona y LOD empresa.

Evidencia posterior:

- `npm run build`
- `npm run backend`
- `npm run preview -- --port 4174`
- `python tests\audit_tienda_viva_camera_lod.py`
- `python tests\audit_tienda_viva_camera.py`
- `python tests\audit_tienda_viva.py`
- `python tests\audit_tienda_viva_semantic.py`
- `test-results-tienda-viva-camera-lod.json`
- Capturas `test-results-tienda-viva-camera-lod-50.png`, `-200.png`, `-1000.png`.

Resultados medidos:

| Carga | LOD | Clusters | Avatares despues de foco | Camara | Overflow |
| --- | --- | ---: | ---: | --- | --- |
| 50 | Zona | 8 | 18 | Zoom/pan/enfoque OK | No |
| 200 | Zona | 8 | 18 | Zoom/pan/enfoque OK | No |
| 1.000 | Empresa | 8 | 9 | Zoom/pan/enfoque OK | No |

Limitaciones restantes:

- El control visual todavia es una botonera funcional; puede evolucionar a minimapa si la experiencia requiere mas sensacion Tycoon.
- El enfoque automatico por evento critico quedo implementado despues de este corte; queda validar con eventos productivos reales.

## Avance P0-14 - foco automatico por evento critico

Actualizado: 2026-10-11.

Se implemento prioridad operativa dentro del mapa:

- La Tienda viva detecta eventos criticos como `decision.requested`, `approval.requested`, `human_handoff`, errores del agente, fallbacks y conexiones pendientes.
- Cuando aparece una senal prioritaria, la camara enfoca automaticamente la zona operativa correspondiente.
- El caso afectado se resalta con un halo visual propio, sin depender de movimiento decorativo.
- El mapa muestra una tarjeta contextual compacta con tipo de evento, cliente, detalle y accion principal.
- Si el evento requiere humano y existe una solicitud asociada, la accion abre la bandeja priorizada y enfoca el expediente exacto.
- Si el evento critico no tiene solicitud humana persistida, la accion vuelve al caso/conversacion para no perder contexto.
- En movil, la tarjeta se adapta como control inferior compacto para no tapar la lectura principal del mapa.
- En backend, `decision.requested`, `approval.requested` y `human_handoff` sin `requestId` crean o reutilizan una solicitud humana pendiente y enlazan el evento con `metadata.requestId`.

Evidencia posterior:

- `npm run build`
- `npm run preview -- --port 4174`
- `python tests\audit_tienda_viva_priority_focus.py`
- `python tests\audit_tienda_viva_camera.py`
- `python tests\audit_tienda_viva.py`
- `python tests\audit_tienda_viva_semantic.py`
- `python tests\audit_tienda_viva_camera_lod.py`
- `node server/tests/backend-smoke.mjs`
- `node server/tests/llm-provider.mjs`
- `test-results-tienda-viva-priority-focus.json`
- `test-results-tienda-viva-priority-focus.png`

Resultados medidos:

| Validacion | Resultado |
| --- | --- |
| Tarjeta prioritaria | Visible con fuente `event` y zona `approval`. |
| Foco automatico | Camara en `scale=1.14`, zona activa `approval`. |
| Caso destacado | `priorityAvatars=1`. |
| Accion humana | Boton `Abrir decisión` abre `hitl-884` para `wa-1045`. |
| Backend | `decision.requested` sin `requestId` crea una solicitud humana y un segundo evento igual no duplica. |
| Movil | Sin overflow horizontal accidental. |
| Regresion semantica | `stableRatio=1.0` con eventos vivos pausados y movimiento reducido para medir ubicacion real. |

Limitaciones restantes:

- La prioridad usa eventos disponibles en la UI local; en produccion debe conectarse a eventos reales persistidos de webhooks, agente y cola humana.
- El deep link exacto ya funciona cuando existe `requestId`; el backend ya crea/enlaza solicitudes para eventos criticos sin `requestId`, pero falta validar este contrato con eventos productivos reales cuando exista URL publica.

## Avance P0-15 - gestos de camara refinados

Actualizado: 2026-10-11.

Se completo el refinamiento local de camara para que la Tienda viva se sienta mas cercana a una experiencia Tycoon:

- La rueda y el trackpad hacen zoom directamente sobre el escenario.
- El arrastre directo sobre la tienda mueve la camara sin depender solo de botones.
- La interaccion tactil mantiene una base de paneo y pinch con `PointerEvent`.
- Se suprimen clics accidentales despues de arrastrar para no seleccionar casos por error.
- El estado de gesto (`idle`, `pan`, `pinch`, `wheel`) queda expuesto en el mapa para auditoria y futuras mejoras visuales.
- Se elimino el warning de navegador por `preventDefault` en listener pasivo de rueda usando listener nativo no pasivo en el escenario.

Evidencia posterior:

- `npm run build`
- `npm run preview -- --port 4174`
- `python tests\audit_tienda_viva_camera.py`
- `python tests\audit_tienda_viva_priority_focus.py`
- `python tests\audit_tienda_viva.py`
- `python tests\audit_tienda_viva_camera_lod.py`
- `python tests\audit_tienda_viva_semantic.py`
- `test-results-tienda-viva-camera.json`

Resultados medidos:

| Validacion | Resultado |
| --- | --- |
| Zoom rueda/trackpad | La camara paso de `scale=1.12` a `scale=1.28` despues de `wheel`. |
| Arrastre directo | El eje X cambio de `-16` a `23` despues de drag sobre escenario. |
| Foco prioritario | El boton `Abrir decisión` sigue abriendo `hitl-884` para `wa-1045`. |
| Regresion visual | Desktop, tablet y movil siguen sin overflow horizontal accidental. |
| LOD alto | 50, 200 y 1.000 conversaciones siguen navegables con camara. |
| Semantica | `stableRatio=1.0`; no se reintrodujo movimiento decorativo como actividad real. |

Limitaciones restantes:

- La camara queda validada en local; la prueba con eventos productivos reales se posterga hasta tener URL publica y webhooks reales.
- El minimapa o rail visual mas avanzado queda como mejora opcional, no como bloqueo del plan local.

## Avance P0-16 - personajes operativos mas humanos

Actualizado: 2026-10-11.

Se avanzo DG-04 sin cambiar reglas de negocio:

- Los personajes ahora tienen cejas, nariz y mejillas para mejorar lectura humana sin caer en estilo infantil.
- Cada conversacion calcula una pose operativa desde datos reales: estado, etapa, herramienta y ultimo evento.
- Se agregaron estados visuales auditables: `human`, `blocked`, `searching`, `basket`, `checkout`, `message` y `working`.
- Cada avatar expone `data-operation-state`, `data-operation-label` y `data-operation-reason` para pruebas automatizadas.
- Los props visuales muestran intencion operativa: decidir, revisar, buscar catalogo, canasta, caja, mensaje o agente procesando.
- Las animaciones siguen siendo semanticas: pedir ayuda, buscar, sostener canasta, registrar pago o saludar mensaje; no se agrego movimiento aleatorio.
- Movimiento reducido apaga tambien los props animados.

Evidencia posterior:

- `npm run build`
- `npm run preview -- --port 4174`
- `python tests\audit_tienda_viva_semantic.py`
- `python tests\audit_tienda_viva.py`
- `python tests\audit_tienda_viva_priority_focus.py`
- `python tests\audit_tienda_viva_camera.py`
- `python tests\audit_tienda_viva_camera_lod.py`
- `python tests\audit_tienda_viva_lod.py`
- `test-results-tienda-viva-semantic.json`
- `test-results-tienda-viva-semantic.png`

Resultados medidos:

| Validacion | Resultado |
| --- | --- |
| Avatares auditados | 4 avatares con semantica y operacion completas. |
| Estados operativos | `human` y `searching` presentes en la muestra local base. |
| Movimiento semantico | `stableRatio=1.0`; no hubo desplazamiento decorativo durante medicion. |
| Foco humano | `hitl-884` / `wa-1045` sigue abriendo correctamente desde mapa. |
| Desktop/tablet/movil | Sin overflow horizontal accidental. |
| LOD alto | 50, 200 y 1.000 conversaciones siguen pasando con camara y agrupacion. |

Limitaciones restantes:

- Falta ampliar variedad de vestuario, peinados y estados si se quiere una sensacion mas rica en volumen alto.
- La expresion visual ya es semantica en local; queda pendiente validar con eventos productivos reales cuando exista URL publica.

## Avance P0-17 - accesibilidad movil y bottom sheet

Actualizado: 2026-10-11.

Se avanzo DG-08 en la experiencia movil de Tienda viva:

- El detalle de caso ahora funciona como bottom sheet fijo en movil, dentro del viewport y con lectura operativa completa.
- Al seleccionar un caso, el foco de teclado pasa al panel de detalle.
- `Escape` cierra el panel para volver rapidamente al mapa.
- Los controles tactiles principales del mapa, zonas, camara, prioridad y casos relacionados cumplen minimo 44 px en movil.
- La camara se declara como `role="toolbar"` y la tienda conserva `role="region"`.
- Las zonas del mapa y el carril de navegacion exponen etiquetas ARIA utiles.
- La zona activa usa `aria-current`.
- Los toggles de rutas y movimiento reducido usan `aria-pressed`.
- La navegacion principal movil queda compacta como carril horizontal, evitando que el menu lateral consuma la primera pantalla.
- La auditoria visual excluye carriles horizontales intencionales de zonas y navegacion para no confundirlos con overflow accidental.

Evidencia posterior:

- `npm run build`
- `npm run preview -- --port 4174`
- `python tests\audit_tienda_viva_accessibility.py`
- `python tests\audit_tienda_viva.py`
- `python tests\audit_tienda_viva_priority_focus.py`
- `python tests\audit_tienda_viva_camera.py`
- `python tests\audit_tienda_viva_semantic.py`
- `python tests\audit_tienda_viva_camera_lod.py`
- `python tests\audit_tienda_viva_lod.py`
- `test-results-tienda-viva-accessibility.json`
- `test-results-tienda-viva-accessibility.png`

Resultados medidos:

| Validacion | Resultado |
| --- | --- |
| Region del mapa | `.store-map` conserva `role="region"`. |
| Toolbar de camara | `.camera-dock` expone `role="toolbar"`. |
| Targets tactiles | `smallTouchTargets=[]` en movil. |
| Bottom sheet | Panel fijo dentro del viewport: `x=12`, `right=378`, `bottom=832` en viewport 390x844. |
| Foco | El panel recibe foco al abrirse. |
| Cierre teclado | `Escape` cierra el panel (`operatorPanelCount=0`). |
| Navegacion activa | Un boton de zona tiene `aria-current="true"`. |
| Overflow | Sin overflow horizontal accidental en desktop, tablet y movil. |

Limitaciones restantes:

- No se ejecuto lector de pantalla real; la validacion actual cubre semantica DOM, foco, teclado, targets y layout.
- La experiencia movil puede seguir evolucionando con gestos de bottom sheet por arrastre, pero no es bloqueo local.

## Avance P0-18 - validacion antes/despues DG-10

Actualizado: 2026-10-11.

Se cerro la comparativa local de Tienda viva como gemelo digital gamificado despues de los incrementos P0-09 a P0-17.

### Correccion adicional detectada en DG-10

Durante la validacion se encontro una prueba fragil en el foco humano prioritario:

- Antes: `tests/audit_tienda_viva_priority_focus.py` esperaba siempre `hitl-884` / `wa-1045`, aunque el evento critico vigente podia pertenecer a otra solicitud humana segun el estado limpio o acumulado del backend.
- Correccion: la tarjeta prioritaria expone `data-priority-request-id` y `data-priority-conversation-id`; la prueba ahora valida que se abra la solicitud real indicada por la tarjeta.
- Resultado con store temporal limpio: la tarjeta abrio `hitl-881` / `wa-1043`, que era la solicitud humana prioritaria real del estado semilla.

### Antes / despues

| Area | Antes de los incrementos | Despues de DG-10 |
| --- | --- | --- |
| Panel operativo | Inspector fijo ocupaba espacio y no aportaba suficiente valor. | Ficha contextual por caso; en movil se comporta como bottom sheet con foco y cierre por `Escape`. |
| Mapa vivo | Vista principalmente estatica, con lectura limitada de zonas y casos. | Zonas navegables, foco por zona, casos relacionados, tarjeta prioritaria y camara con zoom/pan/reset. |
| Intervencion humana | Riesgo de que una alerta no llevara al expediente exacto. | Evento humano prioritario abre la bandeja y selecciona la solicitud real asociada por datos. |
| Movimientos | Podian interpretarse como decoracion o actividad aleatoria. | Personajes se ubican por estado, evento reciente, etapa, herramienta o ruta operacional. |
| Escala | Sin evidencia clara para 50, 200 o 1.000 conversaciones. | LOD individual/zona/empresa con clusters y fixtures de 10, 50, 200 y 1.000. |
| Movil | Riesgo de miniatura de desktop, overflow y paneles invasivos. | Navegacion compacta, controles 44 px, bottom sheet y auditoria sin overflow horizontal. |
| Accesibilidad | Faltaban roles/estados de interaccion en Tienda viva. | Region de mapa, toolbar de camara, `aria-current`, `aria-pressed`, foco programatico y etiquetas de zona. |

### Evidencia ejecutada

| Prueba | Resultado |
| --- | --- |
| `npm run build` | Verde. |
| `python tests\audit_tienda_viva.py` | Verde; desktop, tablet y movil sin overflow horizontal. La alerta humana abre aprobaciones en desktop/tablet; en movil se prioriza el bottom sheet y el foco dedicado se valida por prueba especifica. |
| `python tests\audit_tienda_viva_accessibility.py` | Verde; bottom sheet movil fijo, dentro del viewport, con foco y cierre por `Escape`. |
| `python tests\audit_tienda_viva_semantic.py` | Verde; movimientos estables y semanticos, sin estados operativos faltantes. |
| `python tests\audit_tienda_viva_priority_focus.py` | Verde; tarjeta prioritaria abre y selecciona la solicitud humana real asociada. |
| `python tests\audit_tienda_viva_lod.py` | Verde; LOD individual/zona/empresa y clusters para 10, 50, 200 y 1.000 conversaciones. |
| `python tests\audit_tienda_viva_camera_lod.py` | Verde; camara y foco por zona funcionan con LOD alto. |
| `python tests\audit_tienda_viva_performance.py` | Verde para estructura: sin overflow, sin errores de consola inesperados, LOD activo y DOM acotado. |

### Lectura de rendimiento

La medicion headless registro FPS bajo, pero es una limitacion del entorno de prueba headless y no una medicion final de experiencia humana. Para DG-10 se toma como evidencia util:

- No hubo overflow horizontal.
- No hubo errores de consola inesperados.
- El DOM se mantuvo acotado por LOD y clusters.
- El modo empresa se activo en 1.000 conversaciones.
- La memoria JS se mantuvo en un rango bajo para el escenario de prueba.

### Cierre local

Tienda viva queda validada localmente como base funcional de gemelo digital gamificado. No queda cerrada como validacion productiva final hasta ejecutar:

- Prueba con lector de pantalla real.
- Medicion GPU/FPS en navegador visible y equipo objetivo.
- Eventos productivos reales de WhatsApp, DeepSeek, Google y Mercado Pago con URL publica.
