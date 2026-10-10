# Checklist piloto Ventas IA

## 1. Seguridad local antes de publicar

- Ejecutar backend con `AUTH_REQUIRED=true` y `CSRF_REQUIRED=true`.
- Para el piloto local Google/PostgreSQL, usar:

```bash
npm run backend:google
npm run dev:google
```

- Confirmar que sin sesión `/api/ops/overview?tenantId=andina` devuelve `401`.
- Confirmar que un usuario owner de `andina` recibe `403` al consultar `norte`.
- Confirmar que una mutación autenticada sin `X-CSRF-Token` devuelve `403`.
- Ejecutar:

```bash
npm run test:backend
POSTGRES_TEST_DATABASE_URL=postgres://usrventas:usrventas@127.0.0.1:5432/ventas_ia_dev DATABASE_SSL=disable npm run test:postgres
npm run build
```

## 2. Variables mínimas para ambiente piloto

- `PUBLIC_APP_URL=https://<dominio-publico>`
- `AUTH_REQUIRED=true`
- `CSRF_REQUIRED=true`
- `STORAGE_DRIVER=postgres`
- `DATABASE_URL=<postgres-managed-url>`
- `DATABASE_SSL=require`
- `GOOGLE_CLIENT_ID=<google-oauth-client-id>`
- `VITE_GOOGLE_CLIENT_ID=<google-oauth-client-id>`
- `GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>`
- `GOOGLE_REDIRECT_URI=https://<dominio-publico>/api/saas/google/oauth/callback`
- `DEEPSEEK_API_KEY=<deepseek-key>`
- `MERCADOPAGO_ACCESS_TOKEN=<mercado-pago-token>`
- `MERCADOPAGO_WEBHOOK_SECRET=<mercado-pago-webhook-secret>`

## 3. Configuración Google Cloud

- Authorized JavaScript origins:
  - `https://<dominio-publico>`
- Authorized redirect URIs:
  - `https://<dominio-publico>/api/saas/google/oauth/callback`
- APIs habilitadas:
  - Google Drive API
  - Google Sheets API
- Scopes del producto:
  - `openid`
  - `email`
  - `profile`
  - `https://www.googleapis.com/auth/drive.file`
  - `https://www.googleapis.com/auth/spreadsheets`

## 4. Criterios de salida del piloto

- Owner entra con Google y solo ve sus tenants.
- Tenant nuevo queda asociado al owner autenticado.
- Suscripción activa habilita el onboarding.
- OAuth Drive/Sheets conecta el Google del cliente.
- Herramientas live leen `Catalogo` desde Sheets y escriben/leen `Clientes` y `Pedidos`.
- Aprovisionamiento reintentado no duplica recursos.
- El agente no responde si el tenant está suspendido o sin checklist completo.
- Webhook WhatsApp rechaza `phone_number_id` no asociado a un tenant.
- Activación exige `phoneNumberId` real configurado para WhatsApp, no solo referencia de secreto.
- Envío WhatsApp live usa `phoneNumberId` y token del tenant contra Graph API.
- Onboarding WhatsApp guía si el cliente ya tiene Cloud API, WhatsApp Business App o empieza desde cero, y deja listo el contrato para Embedded Signup.
- Webhook Mercado Pago valida `x-signature` HMAC con `data.id`, `x-request-id` y `ts`.
- DeepSeek queda administrado como configuración global de plataforma y registra proveedor, modelo, tokens y resultado por tenant/conversación.
- Admin Plataforma permite revisar tenants, pagos, consumo, estado operativo y webhooks por cliente, proveedor, estado y búsqueda.
