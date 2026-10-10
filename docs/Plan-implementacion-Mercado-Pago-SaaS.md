# Plan tecnico de implementacion Mercado Pago SaaS

Actualizado: 2026-10-10.

## Objetivo

Implementar Mercado Pago como motor de suscripcion automatica mensual para Ventas IA, separando claramente:

- Cobro del SaaS: Mercado Pago.
- Pagos de domicilios de cada tienda: responsabilidad de la tienda.
- WhatsApp Business/Meta: responsabilidad y costo del cliente.

Este plan convierte las decisiones de `docs/Decisiones-Mercado-Pago-SaaS.md` en tareas tecnicas ejecutables.

Nota de gobierno: este documento es anexo tecnico. El tablero rector de prioridades, avance y dependencias vive en `docs/Seguimiento-consolidado-planes-vigentes.md`.

## Alcance inicial

- Suscripcion automatica mensual.
- Un plan activo inicial.
- Soporte para multiples planes activables/desactivables.
- Trial configurable desde administracion, desactivado por defecto.
- Periodo de gracia parametrizable, valor inicial 5 dias.
- Checkout por redireccion externa.
- Recuperacion de checkout abandonado por 7 dias.
- Historial de pagos.
- Notificaciones en microapp, WhatsApp configurable y Centro de control.
- Sin email en primera version.
- Sin excedentes automaticos.
- Sin factura fiscal propia en primera version.

## Estado de ejecucion

Actualizado: 2026-10-10.

Ejecutado local:

- Modelo billing en estado y PostgreSQL.
- Plan default `ventas_ia_1000_domicilios`.
- Endpoints owner `/api/billing/plans`, `/api/billing/status`, `/api/billing/checkout`, `/api/billing/continue-checkout`, `/api/billing/cancel`, `/api/billing/change-plan`, `/api/billing/payments`.
- Endpoints admin `/api/admin/billing/plans`, sync por tenant, descuentos, excepciones, cambio de plan, job local de conciliacion y embudo.
- Checkout `pending_payment` en modo contract-first/local.
- Recuperacion de checkout con expiracion.
- Mock activation con periodo por aniversario, pago aprobado e historial.
- Persistencia PostgreSQL para planes, pagos, eventos, descuentos, excepciones, ciclos y embudo.
- UI owner en onboarding con plan, valor, proximo cobro, consumo del ciclo, ultimo pago y acciones de checkout/cancelacion.
- UI admin en Centro de control con plan principal, flags de trial/gracia, embudo SaaS, estado del cliente seleccionado, sync, excepcion 48h y descuento piloto.
- UI admin para crear, editar, activar/desactivar planes, marcar plan principal, parametrizar trial/gracia y ejecutar conciliacion local.
- Endpoints `/api/admin/billing/*` montados antes del router generico `/api` para evitar precedencia incorrecta.
- Job local `POST /api/admin/billing/jobs/run` para vencer checkouts, iniciar gracia, suspender por gracia vencida, cancelar al fin de periodo y expirar descuentos/excepciones.

Pendiente:

- Consulta real Mercado Pago en sincronizacion manual.
- Cron productivo de reconciliacion y consulta real al proveedor.
- Historial completo de pagos con comprobante real.
- Pruebas sandbox reales con credenciales Mercado Pago.
- Webhooks reales con URL publica.

## Modelo de datos

### `billing_plans`

Campos minimos:

- `id`
- `name`
- `description`
- `currency`
- `amount`
- `billing_frequency`
- `included_deliveries`
- `included_interactions`
- `trial_enabled`
- `trial_days`
- `grace_days`
- `is_active`
- `is_default`
- `mercadopago_plan_id`
- `created_at`
- `updated_at`

Reglas:

- Solo planes activos aparecen para nuevos clientes.
- Debe existir un plan default activo para el piloto.
- Desactivar un plan no cambia suscripciones existentes automaticamente.

### `subscriptions`

Campos minimos:

- `id`
- `tenant_id`
- `plan_id`
- `status`
- `mercadopago_preapproval_id`
- `mercadopago_payer_id`
- `checkout_url`
- `checkout_expires_at`
- `current_period_start`
- `current_period_end`
- `next_billing_date`
- `trial_ends_at`
- `grace_ends_at`
- `cancel_at_period_end`
- `cancelled_at`
- `suspended_at`
- `reactivated_at`
- `last_sync_at`
- `created_at`
- `updated_at`

Estados internos:

- `pending_payment`
- `trial`
- `active`
- `past_due`
- `grace_period`
- `paused`
- `suspended`
- `cancelled`
- `expired`

### `subscription_payments`

Campos minimos:

- `id`
- `tenant_id`
- `subscription_id`
- `mercadopago_payment_id`
- `mercadopago_preapproval_id`
- `status`
- `amount`
- `currency`
- `paid_at`
- `external_reference`
- `receipt_url`
- `raw_status_detail`
- `created_at`
- `updated_at`

### `subscription_events`

Campos minimos:

- `id`
- `tenant_id`
- `subscription_id`
- `provider`
- `event_type`
- `external_event_id`
- `status_before`
- `status_after`
- `payload_masked`
- `processed_at`
- `created_at`

Uso:

- Idempotencia de webhooks.
- Auditoria de cambios.
- Observabilidad.

### `billing_discounts`

Campos minimos:

- `id`
- `tenant_id`
- `plan_id`
- `discount_type`
- `discount_value`
- `starts_at`
- `ends_at`
- `reason`
- `approved_by`
- `status`
- `created_at`
- `updated_at`

Reglas:

- Manual desde administracion.
- Sin cupones publicos.
- Vencimiento obligatorio.
- Auditoria obligatoria.

### `billing_access_exceptions`

Campos minimos:

- `id`
- `tenant_id`
- `reason`
- `starts_at`
- `expires_at`
- `created_by`
- `status`
- `created_at`
- `revoked_at`

Reglas:

- No cambia estado real de Mercado Pago.
- Al vencer, vuelve a aplicar el estado real.
- Visible en Centro de control.

### `billing_usage_cycles`

Campos minimos:

- `id`
- `tenant_id`
- `subscription_id`
- `period_start`
- `period_end`
- `deliveries_used`
- `interactions_used`
- `llm_tokens_used`
- `tool_calls_used`
- `created_at`
- `updated_at`

Reglas:

- Ciclo por aniversario de suscripcion.
- No usa mes calendario.
- Reinicia con cada nuevo periodo.

## Endpoints backend

### Cliente/owner

- `GET /api/billing/plans`
  - Lista planes activos.

- `GET /api/billing/status?tenantId=...`
  - Devuelve suscripcion, plan, consumo, checkout pendiente, periodo, gracia y acciones disponibles.

- `POST /api/billing/checkout`
  - Crea o recupera checkout Mercado Pago.
  - Usa redireccion externa.
  - Deja tenant en `pending_payment`.

- `POST /api/billing/continue-checkout`
  - Reutiliza checkout pendiente si no expiro.
  - Regenera si pasaron 7 dias.

- `POST /api/billing/cancel`
  - Cancelacion autoservicio para owner.
  - Requiere confirmacion fuerte.
  - Mantiene acceso hasta fin del periodo pagado.

- `POST /api/billing/change-plan`
  - Owner puede hacer upgrade autoservicio.
  - Downgrade requiere confirmacion fuerte.
  - Upgrade aplica inmediato.
  - Downgrade aplica siguiente ciclo.
  - Sin devoluciones.

- `GET /api/billing/payments`
  - Historial de pagos y comprobantes/referencias Mercado Pago.

### Administrador plataforma

- `GET /api/admin/overview`
  - KPIs generales, riesgo de pago, consumo y estado de cada cliente.

- `GET /api/admin/billing/plans`
  - Lista todos los planes activos/inactivos.

- `POST /api/admin/billing/plans`
  - Crear plan.

- `PATCH /api/admin/billing/plans/:planId`
  - Editar plan, activar/desactivar, marcar default.

- `POST /api/admin/billing/tenants/:tenantId/sync`
  - Sincronizar Mercado Pago por cliente.
  - Auditoria y rate limit.

- `POST /api/admin/billing/tenants/:tenantId/discounts`
  - Crear descuento manual.

- `POST /api/admin/billing/tenants/:tenantId/exceptions`
  - Crear excepcion temporal de acceso.

- `POST /api/admin/billing/tenants/:tenantId/change-plan`
  - Admin cambia plan con auditoria.

- `POST /api/admin/billing/jobs/run`
  - Ejecuta mantenimiento local bajo demanda: checkout vencido, inicio de gracia, suspension, cancelacion al cierre de periodo y expiracion de descuentos/excepciones.

- `GET /api/admin/billing/funnel`
  - Embudo de conversion.

- `PATCH /api/admin/billing/funnel/:tenantId/reason`
  - Motivo manual de abandono/bloqueo.

### Webhooks

- `POST /webhooks/mercadopago`
  - Verificar firma cuando exista secret.
  - Registrar evento.
  - Aplicar idempotencia.
  - Consultar objeto real en Mercado Pago antes de cambiar estado.
  - Actualizar suscripcion/pagos.
  - Emitir auditoria y observabilidad.

## UI implementada localmente

### Owner

- Panel de facturacion dentro del onboarding.
- Muestra plan contratado, precio mensual, proximo cobro, ultimo pago y consumo del ciclo.
- Permite iniciar checkout, continuar checkout pendiente o cancelar al final del periodo.
- El lenguaje separa el cobro de plataforma de los pagos de domicilios de la tienda.

### Administrador plataforma

- Panel Mercado Pago dentro del Centro de control.
- Muestra plan principal, planes activos, estado de prueba, dias de gracia y embudo de activacion.
- Permite crear y editar planes, activar/desactivar, marcar el plan principal, definir prueba gratis, ajustar dias de gracia y ejecutar conciliacion local bajo demanda.
- Para el cliente seleccionado permite sincronizar, abrir excepcion temporal de 48 horas o aplicar descuento piloto.
- Es una consola local inicial; el historial detallado con comprobantes reales sigue pendiente.

## Jobs

### Reconciliacion general diaria

Frecuencia:

- Una vez al dia.

Acciones:

- Ejecutable localmente desde `POST /api/admin/billing/jobs/run`.
- Consultar suscripciones activas, pendientes, vencidas, en gracia, suspendidas y canceladas recientes.
- Consultar Mercado Pago.
- Corregir estado local si corresponde.
- Registrar auditoria/eventos.

### Reconciliacion frecuente de estados sensibles

Frecuencia:

- Cada 2 a 4 horas.

Estados:

- `pending_payment`
- `past_due`
- `grace_period`
- `suspended`

Acciones:

- Detectar pagos confirmados.
- Reactivar suspendidos por pago.
- Mover a gracia si aplica.
- Suspender al vencer gracia.

### Vencimiento de checkout abandonado

Frecuencia:

- Diario.

Reglas:

- Si `pending_payment` supera 7 dias, marcar intento como expirado.
- Si el cliente vuelve, regenerar checkout.

### Cierre de periodo y ciclo de consumo

Frecuencia:

- Diario.

Reglas:

- Detectar suscripciones cuyo ciclo por aniversario termina.
- Crear nuevo `billing_usage_cycles`.
- Reiniciar domicilios/interacciones/tokens/herramientas.

## Transiciones de estado

### Checkout inicial

1. `account_created`
2. `diagnosis_completed`
3. `pending_payment`
4. `active` cuando webhook/sync confirma pago

La vuelta desde Mercado Pago no activa el tenant.

### Cobro fallido

1. `active`
2. `past_due`
3. `grace_period`
4. Dia 1-3: opera normal con aviso suave.
5. Dia 4-5: opera normal con aviso fuerte.
6. Dia 6: `suspended` si no hay pago confirmado.

### Cancelacion

1. Owner solicita cancelacion.
2. Confirmacion fuerte.
3. `cancel_at_period_end = true`.
4. Acceso normal hasta fin del periodo pagado.
5. Luego `cancelled`.
6. Solo lectura durante 30 dias.

### Reactivacion

- Suspendido por pago: reactivar automaticamente al confirmar pago.
- Cancelado <= 30 dias: reactivacion autoservicio con validacion rapida.
- Cancelado > 30 dias: reactivacion autoservicio con validacion completa.

### Cambio de plan

- Upgrade:
  - Owner autoservicio.
  - Aplica inmediato.
  - Sin devoluciones.

- Downgrade:
  - Owner con confirmacion fuerte.
  - Aplica siguiente ciclo.
  - Sin devoluciones.

- Admin:
  - Puede ambos con auditoria.

## UI cliente

### Antes del pago

- Google Sign-In.
- Nombre comercial.
- Ciudad.
- Diagnostico liviano:
  - Google: identidad solamente.
  - WhatsApp: clasificar ruta.
  - Datos minimos: preparar expectativas.
- Plan mensual.
- Boton "Activar suscripcion".
- Redireccion a Mercado Pago.

### Despues del pago

- Estado "validando pago" hasta webhook/sync.
- Onboarding completo:
  - Google Drive/Sheets.
  - Aprovisionamiento.
  - WhatsApp.
  - Prueba guiada.
  - Activacion.

### Facturacion del owner

Debe mostrar:

- Estado de suscripcion.
- Plan.
- Precio final unico.
- Proxima fecha de cobro.
- Ciclo actual.
- Domicilios e interacciones usados.
- Avisos 80/90/100.
- Historial de pagos.
- Comprobante/referencia Mercado Pago si existe.
- Cancelar suscripcion.
- Cambiar plan.
- Continuar pago si `pending_payment`.

## UI administrador

### Centro de control

Debe mostrar:

- Clientes activos.
- Pendientes de pago.
- En gracia.
- Suspendidos.
- Cancelados.
- Riesgo de pago.
- Clientes con limite alcanzado.
- Suscripciones con excepcion activa.
- Descuentos activos.
- Checkout abandonado.

### Acciones admin

- Sincronizar Mercado Pago.
- Crear excepcion temporal.
- Crear descuento manual.
- Cambiar plan.
- Reenviar/continuar checkout.
- Ver historial de pagos.
- Ver eventos Mercado Pago.
- Ver embudo.
- Ver motivos de abandono/bloqueo.

## Notificaciones

Canales:

- Microapp: obligatorio.
- Centro de control: obligatorio.
- WhatsApp al owner: configurable.
- Email: fuera de primera version.

Eventos:

- Suscripcion creada.
- Checkout pendiente.
- Pago confirmado.
- Proximo cobro.
- Cobro fallido.
- Inicio de gracia.
- Aviso fuerte antes de suspension.
- Suspension.
- Reactivacion.
- Cancelacion solicitada.
- Cancelacion efectiva.
- Cambio de plan.
- Limite 80/90/100.

## Pruebas

### Unitarias

- Calculo de ciclo por aniversario.
- Estados de gracia.
- Vencimiento de checkout 7 dias.
- Reglas upgrade/downgrade.
- Limites 80/90/100.
- Excepciones vencidas.
- Descuentos vencidos.

### Integracion backend

- Crear checkout.
- Continuar checkout.
- Procesar webhook duplicado.
- Procesar webhook firmado.
- Sincronizar manualmente.
- Reconciliacion diaria.
- Reactivacion por pago.
- Cancelacion autoservicio.
- Historial de pagos.

### Seguridad

- Owner solo ve su tenant.
- Owner no puede sincronizar Mercado Pago.
- Owner no puede crear excepciones.
- Admin requiere auditoria.
- Retorno de Mercado Pago no activa tenant.
- Estado local no se marca activo sin consulta/proveedor.

### UI

- Pago pendiente.
- Validando pago.
- Gracia dia 1-3.
- Gracia dia 4-5.
- Suspendido.
- Cancelado solo lectura.
- Limite 80/90/100.
- Checkout abandonado.
- Embudo admin.

## Orden de ejecucion

1. Crear/ajustar tablas de billing.
2. Implementar planes administrables.
3. Implementar checkout externo y `pending_payment`.
4. Implementar webhook idempotente.
5. Implementar sincronizacion manual.
6. Implementar historial de pagos.
7. Implementar ciclo de consumo por aniversario.
8. Implementar gracia y suspension.
9. Implementar cancelacion autoservicio.
10. Implementar reactivacion.
11. Implementar descuentos y excepciones.
12. Implementar reconciliacion automatica.
13. Implementar embudo y motivos.
14. Implementar UI cliente.
15. Implementar UI admin.
16. Ejecutar pruebas locales.
17. Ejecutar pruebas sandbox Mercado Pago.
18. Dejar pruebas con URL publica para etapa final.

## Criterios de cierre

- Un cliente puede crear cuenta, diagnosticar, iniciar checkout y quedar `pending_payment`.
- Un pago confirmado por webhook/sync activa la suscripcion.
- La vuelta de Mercado Pago no activa por si sola.
- El ciclo de consumo se calcula por aniversario.
- El limite de domicilios bloquea nuevos domicilios al 100%.
- Interacciones operan como uso justo.
- Grace period opera normal 5 dias con avisos y suspende despues.
- Cancelacion deja acceso hasta fin del periodo pagado.
- Reactivacion respeta antiguedad y validaciones.
- Admin puede sincronizar, descontar y crear excepciones con auditoria.
- Centro de control muestra embudo y riesgo de pago.
