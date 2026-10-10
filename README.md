# Ventas IA Backend

Backend multi-tenant para Ventas IA: agente comercial, SaaS control plane, Mercado Pago, Google Drive/Sheets, WhatsApp Cloud API, DeepSeek global, PostgreSQL y observabilidad.

## Desarrollo

```bash
npm install
npm run dev
```

El servicio escucha por defecto en `http://127.0.0.1:3001`.

## Pruebas

```bash
npm run test:backend
```

Para PostgreSQL local:

```bash
POSTGRES_TEST_DATABASE_URL=postgres://usrventas:usrventas@127.0.0.1:5432/ventas_ia_dev
DATABASE_SSL=disable
npm run test:postgres
```

Consulta `BACKEND.md` y `docs/Seguimiento-consolidado-planes-vigentes.md` para el estado funcional y el plan vigente.
