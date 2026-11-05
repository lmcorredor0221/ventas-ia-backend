# Edición de pedidos y conversación para el tendero

Implementado y verificado localmente el 5 de noviembre de 2026. El usuario autorizó posteriormente commit, push y despliegue. Se aplica a pedidos ya registrados, mientras estén por preparar o en alistamiento. El cierre de producción se registra al final de este documento cuando se verifiquen ambos despliegues.

## Experiencia

1. En **Pedidos y pendientes**, abrir **Ver pedido y conversación**. También se puede llegar desde el pedido asociado a una conversación.
2. En computador, el pedido y su conversación aparecen en dos columnas con desplazamiento independiente. En celular, las pestañas **Pedido** y **Conversación** conservan los cambios en curso.
3. **Editar pedido** permite agregar o quitar productos del catálogo de la tienda, cambiar cantidades, modificar importes de líneas existentes vendidas por valor, nombre, dirección, modalidad de entrega, costo del domicilio y medio de pago habilitado.
4. El desglose muestra subtotal de productos, domicilio y total. Conserva los precios acordados de las líneas existentes; los productos nuevos usan el precio vigente del catálogo. No admite precios arbitrarios enviados por el navegador.
5. El tendero confirma que acordó los cambios y el nuevo total con el cliente. Una excepción al mínimo del domicilio requiere autorización explícita y motivo. Guardar no envía un WhatsApp ni verifica/acredita pagos.
6. El pedido conserva su etapa al guardar. Desde la misma vista se puede **Marcar tomado** y luego **Marcar en camino**, usando los procesos existentes. Despachado, entregado o cancelado queda en modo consulta.
7. El historial guarda actor, fecha, versión, motivo y los valores anteriores y posteriores. El chat se actualiza cada ocho segundos sin sustituir el formulario en edición.

## Consistencia y autorización

- API protegida por sesión, pertenencia a la tienda, rol `owner`/`operator` y CSRF en la modificación.
- `expectedVersion` y bloqueo de fila en PostgreSQL evitan que dos operadores sobrescriban una misma revisión. El bloqueo local se comparte con las transiciones de etapa.
- La transacción guarda pedido, datos comerciales, contexto de la conversación, tarea de preparación y proyección a Sheets en la cola. Si falla una escritura, revierte todo el cambio.
- Se comprueba nuevamente la revisión de las condiciones de domicilio bajo bloqueo de la fila del tenant.
- El servidor valida catálogo de la tienda, productos activos, restricciones comerciales existentes, precio, existencia, modalidad de venta por valor, cantidad, pago y total esperado.
- La memoria del agente conserva el contrato del intérprete/resolutor: `rawItemId`, `product`, `resolution`, cantidades y precios. Mantiene identificadores de líneas existentes y actualiza subtotal, precio del domicilio y versión de cotización. Invalida la auditoría anterior; no altera prompts ni incorpora decisiones lingüísticas por palabras clave.
- La edición no suma otro domicilio a la cuota ni crea otro pedido. No modifica los mensajes históricos ni cambia la atención manual.
- Sheets recibe la fila completa A:M de la revisión vigente mediante `order.sheet_edit`; los reintentos no deben proyectar una revisión antigua. Las proyecciones de etapa también leen el estado vigente, evitando retroceder Sheets por un reintento tardío.
- Las escrituras genéricas de pedidos mantienen la protección de datos comerciales; solo la operación autorizada de edición puede sustituirlos. No se añadieron tablas ni migraciones.
- Si el catálogo falla, el pedido y el chat siguen disponibles para consulta. La edición requiere catálogo válido; ante un conflicto se conserva el formulario y se ofrece recargar, confirmando antes de descartar.

## Archivos y origen de la integración

La rama de trabajo tenía un frontend anterior al publicado. Antes de añadir esta función, se alineó `src/` con `frontend/main` (`d097eb685d82e67d35d446902393687c1aa3a463`), partiendo de un árbol limpio. Por eso el diff respecto a la rama backend incluye cambios de interfaz ya publicados: `ManualOrderDialog`, `embeddedSignup`, ajustes de `App.jsx`, `OrderProgressCard` y estilos. No son una reimplementación del agente ni un reemplazo por una versión anterior.

| Archivo | Cambio de este trabajo |
|---|---|
| `src/features/orders/OrderWorkspace.jsx` y `.css` | Vista conjunta, edición, validación visual, conflictos, historial y adaptación móvil |
| `src/features/orders/orderWorkspaceValues.js` | Normalización de identificadores existentes de medios de pago para el editor |
| `src/App.jsx` | Apertura, actualización local del pedido y continuidad con tomar/despachar |
| `src/features/orders/OrderProgressCard.jsx` | Acceso a pedido y conversación |
| `server/routes/api.js` | GET `/orders/:id/workspace` y PATCH `/orders/:id`, ambos autorizados |
| `server/services/orderService.js` | Carga y edición comercial validada; coordinación con cambios de estado |
| `server/domain/orderEdit.js` | Revisiones, política de domicilio y actualización del contexto sin perder productos resueltos |
| `server/store/postgresStore.js` | Transacción de edición y protección frente a snapshots de pedidos antiguos |
| `server/store/jsonStore.js` | Contrato equivalente para pruebas y uso local |
| `server/services/toolRegistry.js` | Proyección completa de la fila editada a Sheets |
| `server/index.js` | Consumidor de `order.sheet_edit` y protección de proyecciones de etapa tardías |
| `server/domain/whatsappCommercePolicy.js` | Reutilizado sin cambios desde `backend/main`; aplicado al catálogo y escritura del editor. No se cambió el intérprete ni se certificó aquí la integración de esta política en todos los demás flujos |
| `server/tests/fixtures/order-edit.mjs` | Catálogo y conversación ficticios, reutilizados en contrato y UI |
| `server/tests/order-edit-contract.mjs` | Contratos funcionales, HTTP y PostgreSQL real |
| `server/tests/order-edit-ui-server.mjs` | Servidor local de prueba, sin acceso a proveedores externos |
| `tests/verify_order_workspace.py` | Prueba de navegador en computador y celular |

## Validación

| Verificación | Resultado |
|---|---|
| Edición y API, con PostgreSQL real | 45 comprobaciones exitosas: precios, totales, stock, aislamiento, roles, CSRF, versiones, historial, transacción, rollback, proyección, contrato semántico del borrador |
| Persistencia de domicilio existente, PostgreSQL real | 37 comprobaciones exitosas |
| Regresión de etapas, despacho, cola de integraciones y autenticación | Exitosa |
| Interfaz 1440×1000 y 390×844 | Exitosa: modificar, guardar, actualizar chat, conflicto sin pérdida del formulario, tomar, despachar, consulta y descarte de cambios |
| Compilación Vite | Exitosa |

El caso de UI cambia una Coca-Cola y un Chocoramo por dos Coca-Cola y una leche Colanta: productos **$19.200**, domicilio **$3.000**, total **$22.200**. Verifica la sustitución, pago Bre-B y dirección sin perder los mensajes nuevos del cliente.

Evidencias locales en `test-results/order-workspace/`: `desktop-order-chat.png`, `desktop-edit.png`, `desktop-dispatched.png`, `mobile-order.png`, `mobile-chat.png` y `result.json`. Son fixtures, no datos de clientes. La carpeta está ignorada por Git.

Las pruebas PostgreSQL usan la instancia local documentada, con un esquema temporal `order_edit_<uuid>` eliminado al finalizar. No usan `DATABASE_URL` de producción ni cambian las tablas existentes del esquema público. Los errores de restricción y de versión impresos en las pruebas negativas son fallos inducidos para comprobar el rechazo/rollback, no fallos de la suite.

Reproducir:

```powershell
npm run test:order-edit
# POSTGRES_TEST_DATABASE_URL debe apuntar explícitamente a PostgreSQL local.
npm run test:order-edit:postgres
npm run test:delivery:postgres
npm run build
```

Prueba de interfaz, en terminales separadas:

```powershell
node server/tests/order-edit-ui-server.mjs
npm run dev -- --port 5173 --strictPort
python tests/verify_order_workspace.py
```

## Límites y pendiente detectado

- Alcance: edición humana de **pedidos existentes**. Crear un pedido desde una conversación manual sin pedido es otro flujo. El frontend publicado contiene `ManualOrderDialog`, pero la rama backend actual no incorpora su endpoint `/conversations/:id/manual-order`; no se restauró de otra rama de forma indiscriminada. Requiere integración separada con las condiciones comerciales actuales.
- No se ejecutaron los 50 casos con DeepSeek: este cambio no modifica el razonamiento conversacional y se verificó mediante contratos, PostgreSQL y navegador. No certifica la latencia ni los fallos previamente documentados del agente en producción.
- La sincronización asíncrona requiere los consumidores de outbox configurados. Las pruebas sustituyen únicamente a los proveedores externos; no envían WhatsApp ni escriben en Google real.
- Las pruebas de varios operadores validan la versión del pedido en PostgreSQL. No son una certificación de toda la arquitectura de snapshots/memoria compartida entre múltiples procesos del backend.
- La implementación inicial se verificó localmente. El release posterior autorizado publica el código sin purgar datos, cambiar credenciales ni enviar mensajes reales de prueba.

## Procedimiento de publicación autorizado

- Backend: conservar la rama `codex/backend-plan-payload-20261020` y desplegar el SHA exacto en Render `srv-db7sqqmq1p3s73elv1eg`. La configuración del servicio sigue apuntando a `main`, con auto-deploy desactivado; por tanto no usar «último commit» de esa rama ni reemplazar su historia divergente.
- Frontend: incorporar el delta de `src/` sobre `frontend/main` en el worktree de release, conservando la configuración publicada. Publicar `main` sin forzar Git, después de comprobar que el backend nuevo está activo.
- Verificar SHA, estado terminal y HTTP de ambos servicios, con autenticación obligatoria. Una comprobación de salud no sustituye la prueba de un pedido real.
- Reversión de código disponible: backend `2ecbe26c97ff1a9a23a1f7ff42e071731c06de29` y frontend `d097eb685d82e67d35d446902393687c1aa3a463`. No revierte cambios comerciales ya guardados; conservar pedidos e historial.

## Cierre de producción — 5 de noviembre de 2026

| Componente | Commit publicado | Despliegue verificado | Estado |
|---|---|---|---|
| Backend | `6c8be7c61f6d0c25750414eb0e3ee3cb8e251d17`, remoto backend, rama `codex/backend-plan-payload-20261020` | Render `dep-dbm6rplbedkc73bdblag` | `live`, 11:55:51 UTC / 06:55:51 Colombia |
| Frontend | `de6699b24e5925c7c2d043c3c8f254965b85874f`, remoto frontend, `main` | Vercel `dpl_88hRdJiBDHkY6GPNSGUGJ3aW8oRg` | `READY`, producción, alias `via.leanagentbuilder.com` confirmado |

El frontend de release se construyó nuevamente antes de publicarlo. Su árbol Git `src/` coincide exactamente con el del commit backend (`dd5a7dafab83ed0d5411f38de54d7983aa365f69`); se conservó la configuración de producción del repositorio frontend. El delta frontend son cinco archivos: la vista, sus estilos y normalización de pagos, más los dos accesos desde la interfaz existente.

Comprobaciones posteriores, 11:56–11:58 UTC:

- `/health/ready` del backend: HTTP 200, PostgreSQL, producción, WhatsApp live, sin advertencias ni errores de configuración.
- `https://via.leanagentbuilder.com/api/health`: HTTP 200.
- `/api/auth/me` directo y mediante VIA: HTTP 401 sin sesión; `/api/ops/overview?tenantId=demo`: HTTP 401 sin sesión.
- GET del workspace con identificador ficticio inexistente: HTTP 404 «Pedido no encontrado», según el contrato de la ruta. No se solicitó ni modificó un pedido real.
- `https://via.leanagentbuilder.com/?app=1`: HTTP 200. Bundle público `/assets/index-Vy6rKoEb.js`: HTTP 200, JavaScript, 494.033 bytes; contiene «Ver pedido y conversación», «Editar pedido» y la confirmación de acuerdo con el cliente.
- No aparecieron errores nuevos en la consulta de registros de Render entre 11:55:53 UTC y el cierre de la verificación. Esto es una observación de esa ventana, no una certificación de estabilidad bajo carga.

Incidencias conservadas: durante la rotación se repitió el timeout PostgreSQL `57014` al guardar el snapshot `app_state`, seguido de un reinicio de instancia. El stack de ese fallo refiere `PostgresStore.save:740`, correspondiente al código previo; el nuevo despliegue terminó activo a las 11:55:51. Este release no corrige ni certifica la contención de snapshots durante el reemplazo de instancias. También continúan los dos avisos de dependencias del release anterior (uno alto y uno moderado).

El conector Render requirió reautenticación; se usó la CLI ya autenticada en el workspace confirmado. Hubo fallos DNS locales transitorios; se verificó el historial antes de reintentar y se creó un único despliegue. Vercel se desplegó automáticamente al publicar `main`; se comprobaron SHA, estado y alias mediante su conector.

Los commits posteriores de documentación no modifican el código desplegado. No se cambiaron variables, credenciales, planes ni datos de clientes; no se enviaron mensajes reales. Los límites funcionales y de latencia del informe anterior siguen vigentes.
