# Ventas IA Backend

Backend ejecutable para el agente de ventas definido por el ACP adjunto. Mantiene separadas la lógica del agente, las herramientas, la persistencia multi-tenant y la capa visual.

## Ejecutar

```bash
npm run backend
```

El backend escucha por defecto en `http://127.0.0.1:3001`.

Para la experiencia completa en desarrollo:

```bash
npm run backend
npm run dev
```

Vite proxifica `/api`, `/webhooks` y `/health` hacia el backend.

## Endpoints principales

- `GET /health`
- `GET /api/ops/overview?tenantId=andina`
- `GET /api/tenants`
- `PATCH /api/tenants/:tenantId/config`
- `GET /api/conversations?tenantId=andina`
- `GET /api/events?tenantId=andina`
- `GET /api/pending-requests?tenantId=andina`
- `POST /api/pending-requests/:id/resolve`
- `POST /api/agent/run`
- `POST /api/tools/:toolName/smoke-test`
- `GET /webhooks/whatsapp`
- `POST /webhooks/whatsapp`

## Flujo implementado

- Normaliza mensajes inbound de WhatsApp.
- Deduplica por `message_id`.
- Aísla datos por `tenantId`.
- Ejecuta flujo del agente: recepción, catálogo, Drive, cotización, aprobación, pago y handoff humano.
- Escala imágenes a humano según el ACP.
- Emite eventos ACP: `agent.started`, `tool.call.started`, `tool.call.completed`, `approval.requested`, `approval.granted`, `approval.denied`, `fallback.activated`, `agent.completed`, `agent.failed`.
- Guarda conversaciones, eventos, pendientes, transacciones y mensajes en `server/data/runtime-store.json`.

## Contratos de herramientas

Las herramientas externas están implementadas en modo `mock`/contract-first hasta configurar credenciales reales:

- `whatsapp_business_messaging`
- `google_sheets_read_table`
- `google_drive_file_picker`
- `approval_gate`
- `human_handoff`
- `transactional_write`

El backend no almacena secretos planos desde la interfaz. Usa referencias de secreto por tenant, alineadas con el ACP.

## Pruebas

```bash
npm run test:backend
python C:\Users\Messi\.agents\skills\webapp-testing\scripts\with_server.py --server "npm run backend" --port 3001 --server "npm run dev -- --port 5173" --port 5173 --timeout 45 -- python tests\verify_ui.py
```
