# Resumen de pedido por WhatsApp

Estado: implementado y validado localmente el 5 de noviembre de 2026. Commit y push completados en ambos repositorios. Despliegue de producción bloqueado por suspensión de Render por facturación; detalle y procedimiento de continuación al final. No se enviaron mensajes reales ni se modificaron pedidos de producción.

## Objetivo aprobado

Presentar al comprador un resumen legible antes de confirmar: nombre y dirección arriba; cada producto con presentación, cantidad, precio unitario e importe; subtotal, domicilio, total y medio de pago. Conservar **Confirmar pedido / Ajustar pedido / Hablar con la tienda**.

Ejemplo de salida, con importes ficticios de la prueba local:

```text
🛒 *Resumen de tu pedido*

*Nombre:* Ana Gómez
*Dirección:* Calle 100 # 20-30

*Productos*

• Coca-Cola original (1.5 L)
  2 × $ 7.200 = *$ 14.400*

• Ponqué Chocoramo (65 g)
  1 × $ 2.800 = *$ 2.800*

*Subtotal de productos: $ 17.200*
Domicilio: $ 3.000
*Total: $ 20.200*

*Medio de pago:* Bre-B

Revisa los productos y los datos de entrega. ¿Confirmamos tu pedido?
```

## Comportamiento

- El LLM sigue interpretando la conversación y decidiendo la acción. El nuevo componente presenta los datos estructurados de la cotización validada; no interpreta intenciones, no selecciona productos, no modifica prompts ni añade llamadas al modelo.
- La oferta de confirmación toma el borrador vigente, comprueba tenant, versión, productos resueltos, datos de entrega y consistencia de importes. El texto guardado en la conversación coincide con el cuerpo enviado junto a los botones.
- Se conserva el reconocimiento de la cotización comunicada aunque contenga negritas de WhatsApp. Una aceptación contextual sigue pudiendo confirmar una cotización completa ya comunicada; el formato no fuerza otra pregunta ni cambia ese flujo.
- `catalogLineTotal` conserva la aritmética existente. Los importes ausentes o inconsistentes se presentan como **Por confirmar**, no como cero. Una oferta incompleta no habilita los botones de confirmación.
- Una línea vendida por importe muestra **Por valor solicitado: $ ...**. No inventa cantidad ni convierte pesos a gramos. Un domicilio gratuito explícito sí muestra $0; ausencia de información no significa gratuidad.
- `delivery:false` se presenta como **No incluye servicio de domicilio**. No se infiere que el cliente eligió recoger en tienda.
- Tras registrar la confirmación del cliente, el recibo incluye referencia y el mismo desglose, con el cierre **Pedido recibido. La tienda lo revisará para alistarlo.** No anuncia aceptación del tendero ni acreditación del pago.
- Los cuerpos que excedan el límite interactivo existente (1024 caracteres) se envían completos como texto y después con los botones. Los textos mayores a 4096 caracteres se dividen por bloques/líneas cuando es posible. No se truncan productos y se conservan pares Unicode.

## Edición humana de un pedido existente

Después de que el tendero marque que acordó los cambios y guarde una edición válida, el pedido y dos tareas se guardan en la misma transacción: `order.sheet_edit` y `order.summary_notification`. La segunda requiere outbox habilitada y usa la revisión recién guardada. Guardar no espera respuestas de Google ni Meta.

El consumidor envía **Pedido actualizado**, con el mismo formato y los datos acordados. No solicita una segunda confirmación, no crea otro pedido ni cambia su etapa, consumo de cuota, estado de atención manual o pago. El flujo de creación manual de pedidos desde una conversación sin pedido sigue fuera de este cambio.

Protecciones y seguimiento:

- Verifica tienda, conversación, destinatario, pedido, revisión y etapa antes de enviar y entre fragmentos. Omite revisiones reemplazadas y pedidos que ya salieron de preparación.
- Reutiliza el envío de sesión. Exige un mensaje entrante registrado dentro de las últimas 24 horas; no introduce plantillas ni convierte automáticamente un envío rechazado en otro tipo de mensaje.
- Cada fragmento guarda una `deliveryKey` por pedido/revisión/índice en el historial. Un reintento omite los fragmentos cuya aceptación ya se persistió.
- El resultado de outbox y eventos `order.summary.*` permiten distinguir aceptación por el proveedor, omisión por nueva revisión, ventana cerrada y datos incompletos. Los fallos de proveedor usan los reintentos existentes de la cola.
- **Aceptado por Meta no significa entregado ni leído.** La interfaz informa del estado al guardar y al actualizar/abrir el pedido; el chat conserva su actualización periódica existente.
- Si outbox no está habilitada, se guarda la edición y se informa que no se pudo programar la notificación.

## Archivos

| Archivo | Cambio |
|---|---|
| `server/domain/whatsappOrderSummary.js` | Presentación compartida de borrador/recibo/actualización y división de mensajes largos |
| `server/services/agentRuntime.js` | Usa el resumen en las cuatro rutas de oferta y en el recibo; registra la cotización efectivamente enviada |
| `server/services/llmReplyComposer.js` | Ignora marcadores de negrita al comprobar una cotización comunicada; sin cambios de prompt |
| `server/services/orderService.js` | Encola el resumen con la edición y expone estado de la notificación actual |
| `server/services/orderSummaryNotification.js` | Consumidor del resumen editado con validación de revisión/destinatario y reintentos por fragmento |
| `server/index.js` | Registra el consumidor en la outbox existente |
| `server/services/toolRegistry.js` | Persiste la clave del fragmento enviado en el historial existente |
| `server/store/jsonStore.js`, `postgresStore.js` | Filtros de consulta de outbox por tenant, pedido y tipo; sin tablas ni migraciones nuevas |
| `src/features/orders/OrderWorkspace.jsx` | Explica el envío tras guardar y muestra su estado, sin acreditar pagos |
| `server/tests/*summary*`, `confirmation-offer-contract.mjs` | Contratos nuevos y fixture de confirmación actualizado al borrador vigente |
| `server/tests/order-edit-contract.mjs` | Edición y dos entradas atómicas de outbox; aislamiento, competencia y rollback en PostgreSQL real |
| `server/tests/delivery-runtime-contract.mjs`, `order-data-audit-runtime.mjs` | Expectativas ajustadas al formato, conservando invariantes de domicilio/auditor |
| `tests/verify_order_workspace.py` | Verifica el aviso de resumen en cola al guardar |
| `package.json` | Comando `test:order-summary` |

## Validación local

| Verificación | Resultado |
|---|---|
| Formato y cálculos | Pasó: cantidades, presentación, subtotal, domicilio, total, desconocidos, venta por importe, medios personalizados y Unicode |
| Oferta de confirmación | Pasó: tres botones, texto persistido, aislamiento de tenant, versión, datos incompletos y pedidos largos |
| Notificación de edición | 10 escenarios pasaron: cola, reemplazo de revisión, destinatario, ventana, reintentos parciales y outbox deshabilitada |
| Edición/API/PostgreSQL local | 45 comprobaciones pasaron, incluyendo guardado atómico y rollback provocado |
| Domicilio en runtime | 14 escenarios pasaron, incluidos cambios de tarifa y aceptación de cotización comunicada |
| Compositor de respuestas | Pasó la suite de hechos comerciales y reparación contextual |
| Auditor, comprobantes y revalidación de respuestas | Pasaron las suites de regresión; conservan decisiones contextuales y límites comerciales |
| Contrato de transporte WhatsApp y outbox | Pasaron con proveedores simulados |
| Compilación Vite | Pasó |
| Interfaz en computador y celular | Pasó en 1440×1000 y 390×844: aviso de resumen en cola, edición, chat, conflictos y continuidad tomar/despachar |

Comandos principales:

```powershell
npm run test:order-summary
npm run test:order-edit
# POSTGRES_TEST_DATABASE_URL debe apuntar exclusivamente a la instancia local documentada.
npm run test:order-edit:postgres
node server/tests/delivery-runtime-contract.mjs
node server/tests/llm-reply-composer-contract.mjs
node server/tests/order-data-audit-runtime.mjs
node server/tests/payment-notice-contract.mjs
node server/tests/response-revalidation-contract.mjs
node server/tests/whatsapp-live-contract.mjs
node server/tests/integration-outbox.mjs
npm run build
```

Las pruebas PostgreSQL crean y eliminan un esquema temporal `order_edit_<uuid>` dentro de `ventas_ia_dev`; no alteran las tablas existentes. El error 23502 impreso durante el ensayo de rollback es intencional y la suite comprueba que revierte también la cola.

La prueba de interfaz se ejecutó con `order-edit-ui-server.mjs`, Vite local y `python tests/verify_order_workspace.py`. Evidencias en `test-results/order-workspace/result.json` y capturas de computador/celular; usan fixtures, no información de clientes reales.

## Límites

- Estas verificaciones no ejecutan los 50 escenarios contra DeepSeek ni certifican el razonamiento o la latencia global del agente. La nueva presentación y notificación no agregan llamadas LLM.
- El envío conserva semántica de reintentos de outbox. Si Meta acepta un mensaje y el proceso cae antes de persistir su historial, queda una ventana de duplicación; no se promete entrega exactamente una vez. Tampoco se ha certificado exclusión global entre un envío externo y una edición concurrente en otro proceso; se revalida justo antes de enviar y entre fragmentos.
- La ventana de sesión se estima con los mensajes entrantes registrados; Meta conserva la decisión final de aceptación/entrega. Una notificación omitida por ventana cerrada no se reactiva automáticamente al recibir otro mensaje.
- Un pedido actualizado después de una edición solo se notifica si todavía está por preparar o preparando cuando lo consume la cola. Se informa una omisión si ya cambió de revisión/etapa.
- Publicación en curso. Antes de publicar se detectó el servicio Render `srv-db7sqqmq1p3s73elv1eg` suspendido, con causa `billing`, desde `2026-11-05T12:15:15Z`; `/health/ready` devuelve HTTP 503. El último deploy figura `live`, pero eso no acredita disponibilidad del servicio. No se cambian planes ni métodos de pago. El cierre del release debe registrar el resultado efectivo de cada proveedor.

## Release solicitado — bloqueo externo, 5 de noviembre de 2026

| Componente | Commit y rama remota | Resultado |
|---|---|---|
| Backend | `f0ff5f396732d9ea1ea8cad0ea997cdd0b1de131`, `backend/codex/backend-plan-payload-20261020` | Commit y push verificados. Render rechazó la creación del deploy con HTTP 400: `cannot deploy suspended service`. No se creó un nuevo despliegue. |
| Frontend | `db3804712b0d72754db4bb6498920f6d7d604c85`, `frontend/codex/release-frontend-auditor-20261105` | Commit y push verificados; compilación de release exitosa. No se promovió a `frontend/main`, para publicar después del backend compatible. |

Los dos commits tienen el mismo árbol `src/`: `9bd7bf65a591f27b52b6bd19d3b92ed16f763523`. El frontend conserva la configuración publicada; su único archivo cambiado es `src/features/orders/OrderWorkspace.jsx`. Bundle construido: `index-DCd633lu.js`.

Comprobación de Render: servicio suspendido con `suspenders: ["billing"]`, auto-deploy desactivado, rama configurada `main`, plan `free`. `/health/ready` devuelve HTTP 503. No se infiere si se debe a tarjeta, factura, cuota u otra condición de facturación: la respuesta de la API no lo especifica. La suspensión ocurrió después de la verificación del release previo y antes de este intento de publicación. No se modificó el plan ni se intentó cobrar o cambiar métodos de pago.

El conector de Render pide reconexión; la CLI autenticada permitió verificar el estado y solicitar el deploy. Al consultar los despliegues de Vercel, el conector devolvió HTTP 403 por autorización del equipo `team_lMrNrj3Iuv7I2LBt4nm3GQOG`; se generó un enlace temporal de renovación para el usuario. El estado de cualquier preview disparado por el push de la rama de release no quedó verificado. Producción frontend permanece en `de6699b24e5925c7c2d043c3c8f254965b85874f` según el remoto `frontend/main` comprobado; no se asegura disponibilidad del backend basándose en un deploy histórico `live`.

### Continuación cuando se resuelva la facturación

1. Comprobar que Render ya no está suspendido, manteniendo el servicio y workspace de VIA. El usuario ya autorizó este despliegue.
2. Consultar los deploys para evitar duplicados; crear uno con el commit exacto `f0ff5f396732d9ea1ea8cad0ea997cdd0b1de131`:
   `render deploys create srv-db7sqqmq1p3s73elv1eg --commit f0ff5f396732d9ea1ea8cad0ea997cdd0b1de131 --confirm --output json`.
3. Esperar `live`, comprobar SHA, `/health/ready` y registros de inicio. No usar «último commit de main»: la rama de runtime del repositorio es distinta.
4. En `C:/Users/Messi/.codex/worktrees/via-release-20261105/frontend`, hacer fetch y comprobar que `frontend/main` sigue en `de6699b...`. Si no hay cambios remotos, publicar `db380471...` mediante `git push frontend HEAD:main`, sin forzar. Si hubo cambios, integrarlos y verificar antes de publicar.
5. Tras renovar el acceso del equipo Vercel, comprobar el deploy de producción por SHA y alias `via.leanagentbuilder.com`, HTTP de frontend/API y protección de rutas. Registrar IDs y horas reales de cierre aquí.

No se requiere repetir las pruebas locales por estos bloqueos si el código no cambia. Las pruebas de funcionalidad no sustituyen la verificación pendiente de producción.
