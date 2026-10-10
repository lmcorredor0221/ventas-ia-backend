# Seguimiento consolidado de planes vigentes

Actualizado: 2026-10-10.

## Fuentes revisadas

- `docs/Plan-implementacion-SaaS-Ventas-IA.docx`
- `docs/Plan-redisenio-experiencia-dashboard-premium.md`
- `docs/Checklist-piloto-produccion.md`
- `BACKEND.md`
- `docs/Decisiones-Mercado-Pago-SaaS.md`
- `docs/Plan-implementacion-Mercado-Pago-SaaS.md`

Este documento no reemplaza los planes originales. Los organiza como tablero maestro para saber que esta cerrado, que esta parcial y que falta antes de publicar.

## Lectura ejecutiva

La implementacion local ya cubre gran parte del plan SaaS y del redisenio premium: multi-tenant, Google auth contract-first, Mercado Pago contract-first, Google Drive/Sheets contract-first y ruta live, WhatsApp por tienda, DeepSeek como motor global, PostgreSQL inicial, Centro de control, Observabilidad, Onboarding premium y Tienda viva sin inspector fijo.

La decision de facturacion queda precisada: Mercado Pago se usara para suscripcion automatica mensual del SaaS, no para los pagos de domicilios de cada tienda.

El proyecto todavia no esta listo para piloto publico porque faltan validaciones reales con credenciales productivas/sandbox y URL publica: DeepSeek real, Google live end-to-end, Mercado Pago webhook real, WhatsApp Cloud API/Embedded Signup y endurecimiento de secretos/observabilidad.

La publicacion debe quedar al final, como se definio. Antes de publicar hay trabajo local valioso: cerrar pruebas con PostgreSQL local, normalizar datos persistidos, formalizar el sistema visual y preparar la matriz de validacion.

## Estado del plan SaaS

| Frente | Estado | Evidencia actual | Falta principal |
| --- | --- | --- | --- |
| Multi-tenant | Implementado local | `tenantId`, configuracion por tenant, bloqueo si no esta activo | Reforzar pruebas de aislamiento con auth real |
| Identidad Google | Parcial avanzado | Login Google contract-first, sesion httpOnly, CSRF, roles, membresias | Probar Google Sign-In real con `AUTH_REQUIRED=true` y `CSRF_REQUIRED=true` |
| PostgreSQL | Parcial avanzado | Migraciones, tablas espejo, lecturas/escrituras SQL criticas | Reducir dependencia restante del snapshot JSONB |
| Mercado Pago | Parcial avanzado local | Checkout, webhook, HMAC cuando hay secret, cambios de estado, UI owner/admin, job local de mantenimiento y persistencia PostgreSQL | Validar suscripcion automatica mensual con `preapproval`/`preapproval_plan`, cron y eventos reales sandbox/produccion |
| Google Drive/Sheets | Parcial avanzado | OAuth, tokens cifrados, provisioning sandbox/live, herramientas Sheets | Ejecutar E2E real con cuenta Google de cliente |
| Aprovisionamiento | Parcial avanzado | Carpetas, hojas, encabezados, validaciones e idempotencia por contrato | Validar creacion real en Drive/Sheets |
| WhatsApp por tienda | Parcial avanzado | Routing por `phoneNumberId`, outbound Graph API, wizard de alta | Probar Cloud API/Embedded Signup con URL publica |
| DeepSeek global | Contract-first | Contrato API JSON, simulacion Codex, medicion de tokens | Cargar API key real y desactivar simulador en produccion |
| Agente comercial | Implementado local | Razonamiento tipo tendero, herramientas, escalamiento humano, cuotas | Evaluar calidad con DeepSeek real y catalogo vivo |
| Seguridad de secretos | Parcial | `secret_references` y vault local cifrado | Conectar secret manager administrado |
| Observabilidad backend | Parcial | Eventos, auditoria, uso, admin webhooks | Alertas productivas y politica de retencion |

## Estado del plan de experiencia premium

| Frente | Estado | Evidencia actual | Falta principal |
| --- | --- | --- | --- |
| Lenguaje visible | Implementado | Menos jerga: tenant, webhook, LLM, ACP y estados crudos salen de negocio | Barrido final en pantallas nuevas |
| Tienda viva | Implementado parcial | Inspector fijo eliminado; ficha contextual por caso | Pulir estilo visual/personajes si se vuelve a tocar escena |
| Centro de control | Implementado parcial | Dashboard para plataforma, clientes, pagos, consumo, Motor IA, Mercado Pago y acciones admin | Conectar todos los datos a PostgreSQL normalizado y sandbox real |
| Observabilidad | Implementado parcial | Vista separada con filtros, KPIs, detalle tecnico y eventos | Alertas, retencion y datos reales de webhooks |
| Onboarding premium | Implementado parcial | Flujo guiado, franja de activacion, prueba guiada, WhatsApp asistido | Validacion real con Google/WhatsApp/MP |
| Configuracion global/tienda | Implementado parcial | DeepSeek global; Google y WhatsApp por tienda | Pantalla admin con parametros reales persistidos |
| Sistema visual | Parcial | Ajustes de jerarquia, overflow y densidad | Crear guia formal de tokens y reglas visuales |
| Normalizacion de datos | Pendiente | Normalizacion visual puntual | Normalizar datos persistidos en PostgreSQL/semillas |
| Pruebas visuales | Parcial | `tests/verify_ui.py`, build y revision local | Stress responsive con mas datos y navegacion completa |

## Subplan Mercado Pago dentro del plan unificado

El detalle tecnico vive en `docs/Plan-implementacion-Mercado-Pago-SaaS.md`, pero el control de avance pertenece a este plan unificado.

### Objetivo Mercado Pago

Implementar Mercado Pago como motor de suscripcion automatica mensual del SaaS, sin mezclarlo con los pagos de domicilios de cada tienda.

### Decisiones cerradas

- Suscripcion automatica mensual.
- Un plan activo inicial, con soporte para multiples planes activables/desactivables.
- Trial configurable desde administracion, desactivado por defecto.
- Periodo de gracia inicial de 5 dias, parametrizable.
- Durante gracia opera normal con avisos progresivos; al vencer se suspende.
- Cancelacion autoservicio con acceso hasta fin del periodo pagado.
- Downgrade al siguiente ciclo; upgrade inmediato; sin devoluciones.
- Suspendido conserva acceso restringido; cancelado conserva solo lectura por 30 dias.
- Reactivacion autoservicio segun causa y antiguedad.
- Notificaciones por microapp, Centro de control y WhatsApp configurable; sin email.
- Cobro y ciclo de consumo por aniversario de suscripcion.
- Plan inicial con 1.000 domicilios y 5.000 interacciones por ciclo.
- Sin excedentes automaticos; upgrade o excepcion admin.
- Descuentos manuales por cliente, sin cupones publicos.
- Historial de pagos con referencia/comprobante Mercado Pago; sin factura fiscal propia inicial.
- Precio final unico; comision Mercado Pago incluida en el precio comercial.
- Sincronizacion manual admin y reconciliacion automatica.
- Diagnostico pre-pago liviano; configuracion completa despues de suscripcion activa.
- Checkout externo por redireccion; checkout abandonado recuperable por 7 dias.
- Embudo SaaS y motivos de abandono/bloqueo.

### Fases Mercado Pago

| Fase | Resultado | Dependencia | Estado |
| --- | --- | --- | --- |
| MP-01 Modelo billing | Tablas/entidades de planes, suscripciones, pagos, descuentos, excepciones y ciclos | PostgreSQL local | Ejecutado local |
| MP-02 Planes admin | Crear, editar, activar/desactivar planes y default | MP-01 | Ejecutado local backend/UI |
| MP-03 Checkout | Crear/continuar checkout externo y `pending_payment` | MP-01, credenciales MP sandbox | Ejecutado contract-first; falta sandbox real |
| MP-04 Webhooks | Webhook idempotente, validacion y consulta al proveedor | Credenciales MP sandbox; URL publica para prueba real | Parcial: firma/idempotencia base; falta prueba real |
| MP-05 Sincronizacion | Boton admin de sync por cliente con auditoria | MP-03 | Ejecutado contract-first; falta consulta real proveedor |
| MP-06 Pagos/historial | Historial owner/admin y comprobantes/referencias | MP-04/MP-05 | Ejecutado local |
| MP-07 Ciclos/limites | Ciclo por aniversario, 1.000 domicilios, 5.000 interacciones, avisos 80/90/100 | MP-01 | Parcial: ciclo/modelo local listo; falta enforcement completo UI/operacion |
| MP-08 Gracia/suspension | 5 dias de gracia, avisos y suspension automatica | MP-07 | Parcial local: job inicia gracia y suspende al vencimiento; faltan avisos progresivos |
| MP-09 Cancelacion/reactivacion | Cancelar, solo lectura 30 dias y reactivar segun antiguedad | MP-08 | Pendiente |
| MP-10 Descuentos/excepciones | Descuentos manuales y excepciones temporales auditadas | MP-01 | Ejecutado local backend/UI admin rapida |
| MP-11 Reconciliacion | Jobs diarios y frecuentes para estados sensibles | MP-04/MP-05 | Parcial local: endpoint admin ejecuta conciliacion; falta cron y proveedor real |
| MP-12 Embudo | Funnel cuenta-diagnostico-checkout-pago-Google-WhatsApp-activacion | Eventos onboarding | Pendiente |
| MP-13 UI cliente/admin | Facturacion owner y Centro de control admin | MP-01 a MP-12 | Ejecutado local; falta sandbox real e historial/comprobantes completos |
| MP-14 Pruebas | Unitarias, integracion, seguridad, UI y sandbox | Implementacion completa | Parcial: backend/PostgreSQL/build/UI local verdes |

### Avance ejecutado 2026-10-10

- Se agrego migracion `006_billing_subscriptions.sql` con tablas de planes, pagos, eventos, descuentos, excepciones, ciclos y embudo.
- Se agrego modelo billing en estado local/PostgreSQL con plan default `ventas_ia_1000_domicilios`.
- Se agregaron endpoints owner en `/api/billing`: planes, estado, checkout, continuar checkout, cancelar, cambiar plan e historial de pagos.
- Se agregaron endpoints admin en `/api/admin/billing`: planes, sync, descuentos, excepciones, cambio de plan y embudo.
- `pending_payment` queda como estado canonico para checkout pendiente.
- Checkout abandonado queda recuperable con `checkoutExpiresAt`.
- Mock activation crea periodo por aniversario, pago local aprobado y ciclo de consumo.
- Descuentos y excepciones temporales quedan auditables en backend.
- Embudo registra cuenta creada, checkout, pago, Google, WhatsApp y activacion.
- PostgreSQL persiste las nuevas entidades de billing en tablas dedicadas.
- Onboarding owner muestra plan, valor, proximo cobro, uso de domicilios/interacciones, ultimo pago y acciones de checkout/cancelacion.
- Centro de control admin muestra plan principal, estado de prueba/gracia, embudo de activacion, estado de pago del cliente seleccionado y acciones de sincronizacion, excepcion 48h y descuento piloto.
- Centro de control admin permite crear, editar, activar/desactivar y marcar plan principal; tambien parametriza trial y dias de gracia.
- Centro de control admin permite ejecutar conciliacion local de facturacion: vence checkouts, abre gracia, suspende al finalizar gracia, cancela al cierre de periodo y expira descuentos/excepciones temporales.
- Se corrigio el orden de routers para que `/api/admin/billing/*` responda antes del router generico `/api`.
- Se corrigio duplicidad de encabezado en Conversaciones para mantener jerarquia accesible y evitar ambiguedad en pruebas UI.

Evidencia:

- `npm run build`
- `npm run test:backend`
- `POSTGRES_TEST_DATABASE_URL=postgres://usrventas:usrventas@127.0.0.1:5432/ventas_ia_dev DATABASE_SSL=disable npm run test:postgres`
- `python .../with_server.py --server "npm run backend" --port 3001 --server "npm run dev -- --port 5173" --port 5173 --timeout 45 -- python tests\verify_ui.py`

### Corte de ejecucion local

Antes de publicar, este subplan debe llegar como minimo a:

- Modelo billing creado.
- Plan activo inicial configurado.
- Checkout sandbox/contract-first funcionando.
- `pending_payment` y continuar pago funcionando.
- Historial de pagos preparado.
- Ciclos de consumo por aniversario.
- Reglas de gracia, limites, cancelacion y reactivacion probadas localmente.
- UI admin/owner con estados principales.

Las pruebas reales de webhook Mercado Pago quedan para la etapa de URL publica.

## Brechas consolidadas

### P0 - Cerrar localmente antes de publicar

| ID | Pendiente | Cierre esperado |
| --- | --- | --- |
| P0-01 | Ejecutar matriz local completa: build, backend, UI y PostgreSQL local | Cerrado 2026-10-10: build, backend, PostgreSQL y UI pasaron |
| P0-02 | Revisar `.env.example` contra el checklist piloto | Cerrado 2026-10-10: variables minimas presentes sin secretos reales |
| P0-03 | Normalizar datos persistidos y semillas visibles | No quedan textos viejos como `tenant`, `ACP`, `sandbox_ready` en vistas de negocio |
| P0-04 | Crear guia visual formal | Documento de tokens, colores, tipografia, jerarquia, componentes y reglas responsive |
| P0-05 | Revisar pantallas con listas largas y textos reales | Sin overflow horizontal ni superposiciones |
| P0-06 | Probar PostgreSQL local como fuente principal | Cerrado 2026-10-10: `npm run test:postgres` paso con `usrventas/usrventas` |
| P0-07 | Documentar matriz de pruebas del agente | Casos por grupo: claro, ambiguo, errores ortograficos, categoria, sin stock, escalamiento |

### P1 - Requiere credenciales reales, pero no URL publica

| ID | Pendiente | Cierre esperado |
| --- | --- | --- |
| P1-01 | Cargar API key real de DeepSeek en entorno local seguro | Respuesta real del proveedor y trazabilidad de tokens |
| P1-02 | Desactivar simulador Codex para prueba real | `executionMode` refleja llamada real, no simulada |
| P1-03 | Probar Google Sign-In real con el proyecto creado | Owner entra con Google y solo ve sus tiendas |
| P1-04 | Activar `AUTH_REQUIRED=true` y `CSRF_REQUIRED=true` en local | 401/403 correctos y mutaciones con token CSRF |
| P1-05 | Ejecutar OAuth Drive/Sheets real local | Refresh token cifrado y workspace en modo live |
| P1-06 | Probar lectura/escritura real en Sheets | Catalogo leido, cliente upsert, pedido escrito |
| P1-07 | Evaluar calidad del agente con DeepSeek real | Tool plan correcto y respuestas no deterministicas/hardcodeadas |
| P1-08 | Implementar prueba local de creacion de suscripcion Mercado Pago en sandbox | Parcial: checkout contract-first local implementado; falta credencial sandbox real |
| P1-09 | Agregar configuracion admin de periodo de prueba | Parcial: UI/backend local listo; falta aplicar avisos/flujo productivo |
| P1-10 | Agregar configuracion admin de periodo de gracia | Parcial: UI/backend local listo con valor inicial 5 y suspension por job local; faltan avisos progresivos |
| P1-11 | Implementar cancelacion autoservicio | Owner cancela desde microapp, con confirmacion y acceso hasta fin del periodo pagado |
| P1-12 | Implementar administracion de planes | Ejecutado local: backend y UI para crear, editar, activar/desactivar y marcar principal |
| P1-13 | Implementar reglas de cambio de plan | Upgrade autoservicio para owner, downgrade con confirmacion fuerte al siguiente ciclo, admin con auditoria |
| P1-14 | Implementar politica de acceso suspendido/cancelado | Suspendido con acceso restringido; cancelado solo lectura 30 dias; Drive del cliente no se elimina |
| P1-15 | Implementar reactivacion autoservicio | Suspendido por pago reactiva al confirmar; cancelado <=30 dias validacion rapida; >30 dias validacion completa |
| P1-16 | Implementar notificaciones de facturacion | Microapp y Centro de control obligatorios; WhatsApp owner configurable; sin email |
| P1-17 | Implementar facturacion por aniversario | Cobro mensual segun fecha de suscripcion/activacion de cada cliente |
| P1-18 | Implementar ciclo de consumo por aniversario | Domicilios/interacciones/tokens se reinician con el ciclo de facturacion del cliente |
| P1-19 | Implementar politica de limite de consumo | Plan inicial 1.000 domicilios + 5.000 interacciones; sin excedentes automaticos; upgrade o excepcion admin |
| P1-20 | Implementar descuentos manuales | Parcial: backend local y accion admin de descuento piloto; falta gestion completa |
| P1-21 | Implementar historial de pagos | Parcial: backend local y ultimo pago en owner; falta historial completo/comprobante real |
| P1-22 | Implementar precio final unico | Comisiones Mercado Pago incluidas en el precio comercial, no como cargo separado |
| P1-23 | Implementar sincronizacion manual Mercado Pago | Parcial: endpoint admin/auditoria y accion UI local; falta consulta real proveedor y rate limit |
| P1-24 | Implementar excepciones manuales de acceso | Parcial: backend local y accion UI 48h; falta gestion completa/revocacion |
| P1-25 | Implementar reconciliacion automatica Mercado Pago | Parcial: endpoint admin `/api/admin/billing/jobs/run` ejecuta mantenimiento local; falta cron diario/reintentos y consulta real Mercado Pago |
| P1-26 | Dividir onboarding por momento de cobro | Diagnostico inicial gratis antes de pago; configuracion completa despues de suscripcion activa |
| P1-27 | Implementar diagnostico liviano de WhatsApp pre-pago | Clasifica Cloud API, Business App, WhatsApp normal o no sabe; sin tokens ni webhooks antes del pago |
| P1-28 | Implementar separacion Google identidad/datos | Google Sign-In antes de pago; OAuth Drive/Sheets y provisioning despues de suscripcion activa |
| P1-29 | Implementar datos minimos pre-pago | Capturar nombre comercial y ciudad antes de pago; datos operativos despues de suscripcion activa |
| P1-30 | Implementar checkout por redireccion externa | Mercado Pago externo en primera version; retorno solo muestra validacion, no activa tenant |
| P1-31 | Implementar recuperacion de checkout abandonado | Parcial: `pending_payment` con continuar pago por 7 dias y expiracion por job local; falta UX completa de recuperacion |
| P1-32 | Implementar embudo de conversion SaaS | Parcial: eventos backend y visualizacion admin local; falta eventos reales/sandbox |
| P1-33 | Implementar motivos de abandono/bloqueo | Motivos automaticos y nota manual admin opcional, visibles en embudo |

### P2 - Requiere URL publica o callbacks externos

| ID | Pendiente | Cierre esperado |
| --- | --- | --- |
| P2-01 | Publicar backend con URL HTTPS estable | `PUBLIC_APP_URL` real configurada |
| P2-02 | Configurar redirect URI publico en Google Cloud | OAuth callback productivo funcionando |
| P2-03 | Probar WhatsApp webhook real | Meta verifica webhook y mensajes entrantes enrutan por `phoneNumberId` |
| P2-04 | Probar envio WhatsApp live | Mensaje saliente usa token y numero del tenant |
| P2-05 | Probar Embedded Signup o guia asistida WhatsApp | Ruta clara segun si el cliente ya tiene Cloud API, App o empieza desde cero |
| P2-06 | Probar Mercado Pago webhook real | HMAC valida eventos y estados de suscripcion |
| P2-07 | Prueba E2E publica | Pago, Google, WhatsApp, agente, pedido y handoff humano funcionando |

### P3 - Endurecimiento productivo

| ID | Pendiente | Cierre esperado |
| --- | --- | --- |
| P3-01 | Conectar secret manager administrado | Secretos resueltos por referencia, no por vault local |
| P3-02 | Retirar dependencia restante de snapshot JSONB | Rutas criticas leen/escriben SQL directamente |
| P3-03 | Convertir validaciones pendientes a SQL puro | `resolveHumanRequest` y control plane sin memoria local |
| P3-04 | Definir retencion de eventos y auditoria | Politica por tipo de dato y ventana de consulta |
| P3-05 | Crear alertas productivas | Pago, Google, WhatsApp, DeepSeek, consumo y errores criticos |
| P3-06 | Backups y restauracion PostgreSQL | Procedimiento probado de recuperacion |
| P3-07 | Runbook de soporte | Como diagnosticar tenant, pago, Google, WhatsApp, agente y webhook |

## Orden recomendado

1. Cerrar P0-01 con la matriz local completa.
2. Cerrar P0-02 revisando `.env.example` contra `docs/Checklist-piloto-produccion.md`.
3. Cerrar P0-03 normalizando semillas/datos persistidos visibles.
4. Cerrar P0-04 creando la guia visual formal.
5. Ejecutar `docs/Plan-implementacion-Mercado-Pago-SaaS.md` hasta pruebas locales/sandbox que no requieran URL publica.
6. Cerrar P1-03 y P1-04: Google Sign-In real local con auth y CSRF obligatorios.
7. Cerrar P1-05 y P1-06: OAuth Drive/Sheets real y escritura de `Catalogo`, `Clientes`, `Pedidos`.
8. Cerrar P1-01, P1-02 y P1-07: DeepSeek real y evaluacion heuristica del agente.
9. Preparar publicacion solo cuando P0 y P1 esten cerrados o aceptados con deuda explicita.
10. Ejecutar P2 con URL publica: WhatsApp, Mercado Pago y OAuth publico.
11. Entrar a P3 para hardening productivo y operacion continua.

## Criterios para pasar a piloto publico

- `AUTH_REQUIRED=true` y `CSRF_REQUIRED=true` validados.
- PostgreSQL operando como fuente principal.
- DeepSeek real configurado como motor global de plataforma.
- Google OAuth live funcionando con lectura/escritura real de Sheets.
- Tenant isolation probado: un owner no ve ni opera tenants ajenos.
- Onboarding completa suscripcion, Google, aprovisionamiento, WhatsApp y prueba guiada.
- Webhook WhatsApp rechaza numeros no asociados.
- Mercado Pago valida firma y no duplica eventos.
- Observabilidad permite filtrar por tienda, proveedor, estado y rango de fechas.
- UI sin overflow horizontal en desktop, laptop y movil.

## Decisiones vigentes

- Autenticacion: Google.
- Base de datos: PostgreSQL.
- Datos operativos del comercio: Google Drive/Sheets propio de cada cliente.
- Facturacion: Mercado Pago.
- Modalidad de facturacion: suscripcion automatica mensual para el uso de la plataforma.
- Periodo de prueba: configurable desde administracion, desactivado por defecto.
- Periodo de gracia por cobro fallido: 5 dias iniciales, parametrizable desde administracion. Opera normal con avisos progresivos y suspende automaticamente al vencer.
- Cancelacion: autoservicio desde microapp para owner, con confirmacion y acceso hasta fin del periodo pagado.
- Planes: un solo plan activo inicialmente, con soporte administrativo para crear, activar y desactivar multiples planes.
- Cambios de plan: modelo mixto. Owner puede hacer upgrade autoservicio; downgrade con confirmacion fuerte al siguiente ciclo; admin puede ambos con auditoria. Sin devoluciones.
- Acceso suspendido/cancelado: suspendido con acceso restringido; cancelado solo lectura por 30 dias; recursos Google del cliente no se eliminan automaticamente.
- Reactivacion: autoservicio segun causa y antiguedad. Pago confirmado reactiva suspendidos; cancelados recientes conservan configuracion; cancelados antiguos requieren validacion completa.
- Notificaciones de facturacion: microapp y Centro de control obligatorios; WhatsApp al owner configurable; email excluido en primera version.
- Fecha de cobro: aniversario de suscripcion de cada cliente, sin corte fijo global inicial.
- Ciclo de consumo: limites del plan se reinician con el ciclo de facturacion por aniversario, no por mes calendario.
- Limite de consumo: plan inicial con 1.000 domicilios y 5.000 interacciones por ciclo; domicilios como limite comercial y interacciones como uso justo.
- Excedentes: no hay cobro automatico en primera version; se resuelve con upgrade o excepcion administrativa auditada.
- Descuentos: manuales por cliente desde administracion, con vencimiento, motivo y auditoria; sin cupones publicos inicialmente.
- Comprobantes: historial de pagos y referencia/comprobante Mercado Pago si existe; factura fiscal propia fuera del alcance inicial.
- Comisiones Mercado Pago: incluidas en el precio comercial; el cliente ve un precio final unico.
- Sincronizacion Mercado Pago: accion admin por cliente, con auditoria y control de uso.
- Excepciones manuales: acceso temporal por admin con motivo, vencimiento y auditoria; no cambia estado real de Mercado Pago.
- Reconciliacion Mercado Pago: job automatico diario y reintentos frecuentes para estados pendientes/vencidos/en gracia.
- Onboarding y cobro: diagnostico inicial antes del pago; Google operativo, aprovisionamiento, WhatsApp y prueba guiada despues de suscripcion activa.
- WhatsApp pre-pago: solo diagnostico de ruta; conexion real, tokens y webhooks despues de suscripcion activa.
- Google pre-pago: solo identidad con Google Sign-In; Drive/Sheets despues de suscripcion activa.
- Datos pre-pago: nombre comercial y ciudad; datos operativos completos despues de suscripcion activa.
- Checkout: redireccion externa a Mercado Pago en primera version; embebido queda como mejora futura.
- Checkout abandonado: `pending_payment`, recuperable por 7 dias con continuar pago; luego expira o se regenera.
- Embudo SaaS: Centro de control debe mostrar conversion desde cuenta creada hasta tienda activada.
- Motivos de abandono/bloqueo: automaticos y nota manual admin opcional para entender fricciones del onboarding.
- WhatsApp Business: propio y pagado por cada cliente.
- LLM: DeepSeek global administrado por la plataforma.
- Publicacion: al final, despues de cerrar pruebas locales que no requieren callbacks externos.

## Nota de seguimiento

Cada pendiente debe cerrarse con evidencia: comando ejecutado, captura, endpoint probado, registro en observabilidad o documento actualizado. Si un pendiente se difiere, debe quedar marcado con razon, riesgo y condicion para retomarlo.
