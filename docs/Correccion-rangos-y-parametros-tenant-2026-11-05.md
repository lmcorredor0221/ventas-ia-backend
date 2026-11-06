# Corrección de rangos y parámetros por tienda — 2026-11-05

## Hallazgo

La interfaz permitía editar `catalogRange`, `customerProfilesRange` y
`ordersRange`, pero algunas rutas del runtime seguían usando el campo legado
`googleSheets.range` o rangos escritos directamente como `Pedidos!A:M` y
`Clientes!A:H`. Por eso un valor podía aparecer guardado en la pantalla sin
ser el rango efectivo de la operación.

Además, la pantalla de condiciones del domicilio comparaba los valores con los
defaults `0` y `10.000` y no enviaba el `PATCH` si coincidían. Eso hacía
ambiguo si el valor estaba explícitamente guardado por la tienda o si solo se
estaba aplicando el default.

## Corrección aplicada

- Se añadió `server/services/googleSheetRanges.js` como fuente única para
  resolver los rangos efectivos por tenant.
- `catalogRange` es el rango canónico del catálogo y se sincroniza con el
  alias legado `range` al guardar configuración.
- Lecturas y escrituras de clientes y pedidos usan sus rangos configurados,
  incluyendo append, búsqueda de filas y actualización de estado.
- La interfaz persiste siempre los valores efectivos del domicilio, incluso
  cuando son `0` y `10.000`, y muestra los valores devueltos por el backend.
- Se añadieron contratos para verificar que guardar y resolver rangos no
  vuelva a separar configuración y runtime.

## Validación local

- `npm run test:google-ranges`: aprobado.
- `npm run test:delivery`: aprobado.
- `npm run test:architecture`: aprobado.
- `npm run build`: aprobado.
- `npm run test:backend`: el contrato principal llega a un fallo preexistente
  de texto en el caso de producto desconocido (`backend-smoke.mjs:351`); no es
  un error de rangos ni de persistencia. Debe auditarse por separado antes de
  usar la suite completa como criterio de release.

## Incidente de arranque en Render

Durante el primer reemplazo de instancia, Render reportó `statement timeout`
al insertar el índice de `app_state`. La causa no era el rango ni el valor del
domicilio: la hidratación de estado ejecutaba un `save()` completo en cada
arranque, aunque no hubiera cambios, y competía con la instancia anterior
durante el rolling deploy.

Se corrigió en dos capas:

- La hidratación de identidad y facturación conserva sus marcas de tiempo si
  no cambió el contenido.
- `PostgresStore.load()` compara el documento persistido con el estado
  hidratado y solo guarda cuando la migración o la carga de semillas cambió
  realmente el documento.

La validación local volvió a pasar y el despliegue posterior debe verificarse
por estado `Live`, commit activo y `/health/ready`. No se purgaron ni alteraron
datos de producción como parte de esta corrección.
