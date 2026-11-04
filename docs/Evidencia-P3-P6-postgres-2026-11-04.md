# Evidencia P3/P6 — PostgreSQL, lease distribuido y revalidación

Fecha: 2026-11-04
Entorno: PostgreSQL local 18, Windows, `127.0.0.1:5432`
Rama: `codex/backend-plan-payload-20261020`

## Objetivo

Validar la migración `012_inbound_batch_leases.sql`, la persistencia de mensajes entrantes, el lease distribuido de ráfagas y la regresión operativa del store PostgreSQL sin modificar la base de desarrollo `ventas_ia_dev`.

## Aislamiento

- Base de desarrollo protegida: `ventas_ia_dev`.
- Se verificó antes de la prueba que la instancia local estaba disponible y que `ventas_ia_dev` tenía 33 tablas públicas.
- Se creó exclusivamente la base temporal `ventas_ia_contract_20261104`, con propietario `usrventas`.
- Se ejecutó `npm run test:postgres` con `POSTGRES_TEST_DATABASE_URL` apuntando a esa base temporal.
- La base temporal se eliminó al finalizar con `DROP DATABASE ventas_ia_contract_20261104`.
- Verificación posterior: `ventas_ia_dev` continúa con 33 tablas y la base temporal ya no existe.

## Resultado

`Postgres smoke tests passed (tienda-pg-smoke-mw25isx6)`.

El smoke cubrió, entre otros puntos:

- creación/migración de las 33 tablas esperadas, incluida `inbound_batch_leases`;
- persistencia idempotente de mensajes entrantes;
- generación del outbox de procesamiento inbound;
- flujo de alta de tenant, suscripción, OAuth de Google, workspace y binding de WhatsApp;
- persistencia de conversación, perfil, pedido, handoff, transacción y auditoría;
- métricas de uso y endpoints operativos;
- ejecución del agente y deduplicación de un `messageId` repetido.

## Conclusión

La integración PostgreSQL de P3 queda validada en una base aislada. La implementación no alteró la base local existente. P6 queda validada a nivel de contrato y store; todavía falta un replay E2E real con mensajes en ráfaga y concurrencia para cerrar la evidencia de extremo a extremo.

## Pendientes no cubiertos por esta evidencia

- Reejecutar la matriz E2E con DeepSeek real y configuración explícita de `.env.e2e.local`.
- Medir replay de ráfagas/concurrencia y supresión de respuestas obsoletas dentro del flujo completo.
- Completar la deduplicación de respuestas en outbox si la revisión E2E demuestra una ventana adicional.
- No se hizo commit, push ni despliegue.
