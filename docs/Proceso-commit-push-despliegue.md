# Proceso de commit, push y despliegue

Fecha de ejecución: 2026-10-15  
Proyecto: Ventas IA Ops Store  
Administrador de plataforma: `lmcorredor@gmail.com`

## Objetivo

Publicar la versión validada de la microapp en los dos repositorios oficiales, manteniendo separados frontend y backend:

- Frontend: `lmcorredor0221/ventas-ia-frontend`.
- Backend: `lmcorredor0221/ventas-ia-backend`.
- Frontend independiente: Vercel, `via.leanagentbuilder.com`.
- Backend independiente: Render, `ventas-ia-backend-free.onrender.com`.
- Base de datos independiente: proyecto Supabase Free creado para `via`.

El proyecto existente `www.leanagentbuilder.com` no forma parte de este cambio y no se reutiliza.

## 1. Preflight

Antes de publicar se revisa:

```powershell
npm run build
npm run test:backend
npm run test:plan
npm run test:catalog-import
python tests/verify_ui.py
python tests/verify_landing.py
git diff --check
```

También se ejecuta el smoke test PostgreSQL contra la base local. Las pruebas que requieren OAuth, WhatsApp, Mercado Pago o callbacks públicos se mantienen separadas de este release y se cierran después del despliegue.

## 2. Higiene de release

No se incluyen en Git:

- `.env.google.local`, claves API, secretos OAuth, tokens de Meta o Mercado Pago.
- `.local-logs/`, `.codex-remote-attachments/` y archivos temporales.
- `node_modules/`, `dist/`, cachés y resultados generados no necesarios para ejecutar la aplicación.
- CSV de prospección y capturas de trabajo que no son parte del producto.

Sí se incluyen el código fuente, migraciones, pruebas, documentación vigente y los activos públicos que usa la interfaz.

## 3. Commit y push separados

El checkout de trabajo contiene frontend y backend para facilitar las pruebas locales, pero el push se realiza por alcance:

1. Se crea un checkout temporal desde `main` de `ventas-ia-backend`.
2. Se sincronizan únicamente `server/`, migraciones, scripts, documentación y configuración del backend.
3. Se valida `npm start`, el build del backend y las pruebas de contrato.
4. Se crea un commit de release en `main` y se hace push al remoto `backend`.
5. Se crea un checkout temporal desde `main` de `ventas-ia-frontend`.
6. Se sincronizan únicamente `src/`, `index.html`, `vite.config.js`, `vercel.json`, `tests/` y configuración del frontend.
7. Se valida `npm run build` y la auditoría visual.
8. Se crea un commit de release en `main` y se hace push al remoto `frontend`.

El SHA de cada repositorio se registra al final de este documento. No se fuerza ningún push y no se modifican ramas de los proyectos anteriores.

## 4. Despliegue

### Supabase

Se verifica que el proyecto Supabase independiente esté saludable y que las migraciones PostgreSQL incluyan la migración de alineación del plan básico. Las variables de conexión se configuran solo en Render; nunca se escriben en el frontend ni en Git.

### Render

1. El servicio `ventas-ia-backend-free` debe apuntar a `lmcorredor0221/ventas-ia-backend`, rama `main`.
2. Se ejecuta un deploy manual del SHA publicado para no confundir push con producción.
3. Se espera estado `live` y se comprueba:

```powershell
curl.exe -sS https://ventas-ia-backend-free.onrender.com/health
```

4. Se verifica que `STORAGE_DRIVER=postgres`, `DATABASE_URL`, `DATABASE_SSL=require`, `AUTH_REQUIRED=true`, `CSRF_REQUIRED=true`, `PUBLIC_APP_URL`, Google, DeepSeek, Meta y Mercado Pago estén configurados como variables protegidas. Los valores sensibles no se documentan.

### Vercel

1. El proyecto independiente debe apuntar a `lmcorredor0221/ventas-ia-frontend`, rama `main`.
2. Se espera el deployment `Ready` de producción.
3. Se comprueba la aplicación y el proxy:

```powershell
curl.exe -I https://via.leanagentbuilder.com
curl.exe -sS https://via.leanagentbuilder.com/api/health
```

4. Se confirma que las reglas `/api` y `/webhooks` apuntan al backend nuevo de Render.

## 5. Verificación posterior

- Frontend carga por HTTPS y no presenta errores de build.
- `/api/health` responde por el dominio de Vercel.
- Rutas protegidas responden `401` sin sesión, no `404`.
- El login de Google conserva el administrador de plataforma y el aislamiento por tenant.
- El backend arranca con PostgreSQL y las migraciones aplicadas.
- La landing, el onboarding y la carga CSV del catálogo siguen disponibles.
- Las pruebas públicas de WhatsApp, Mercado Pago y OAuth productivo quedan como etapa posterior porque requieren callbacks y credenciales reales.

## 6. Rollback

- Render: volver al deployment anterior que figure como `live`.
- Vercel: promover el deployment anterior `Ready`.
- GitHub: revertir el commit de release con un nuevo commit; no usar `reset --hard` sobre ramas compartidas.
- Supabase: no borrar el proyecto; revisar migraciones y restaurar desde backup si una operación de datos lo exige.
- El dominio `www.leanagentbuilder.com` permanece intacto durante todo el proceso.

## Evidencia final de esta ejecución

- Backend publicado: commit `71f2e3eba8daab064f8e0666ddc0ccc3467ac7b8` en `main`.
- Frontend publicado: commits `63a9b70aad9094ede6be15941025ab941176808a` y `a12181672eec2f8faf90aa6a018097404630504a` en `main`.
- Render: deployment `dep-db8ifi0u01pc738arm9g`, estado `live`, servicio `srv-db7sqqmq1p3s73elv1eg`.
- Render directo: `https://ventas-ia-backend-free.onrender.com/health` respondió `200`.
- Seguridad backend: `/api/auth/me` sin sesión respondió `401 Authentication required`.
- Vercel: deployment `dpl_6z8yg2SsdwdU5RxGySz3UAhNeJr8`, estado `READY`, asociado a `via.leanagentbuilder.com` y al commit `a121816`.
- Vercel SPA: `/landing` y sus assets respondieron `200` después de agregar el fallback a `/index.html`.
- Proxy: `https://via.leanagentbuilder.com/api/health` respondió `200` y llegó al backend nuevo de Render.
- Supabase: el servicio Render inició correctamente con PostgreSQL configurado. La conexión Supabase disponible en esta sesión solo mostró el proyecto anterior y devolvió permiso insuficiente al consultar el ref independiente `mmcxphpstxjugxjrdffb`; no se aplicó SQL manual ni se expusieron credenciales.
- Integridad: no se detectaron secretos en los diffs publicados y `www.leanagentbuilder.com` no fue modificado.

## Pendientes explícitos

- Reautenticar el conector de Supabase con acceso al proyecto independiente y confirmar migraciones/backup desde su panel.
- Completar OAuth público de Google Drive/Sheets.
- Configurar y probar callbacks reales de WhatsApp Cloud API y Mercado Pago.
- Rotar la API key de DeepSeek compartida durante la conversación antes de abrir producción a clientes.

## Actualización: revisión integral de operación — 2026-10-17

Se publicó la revisión de experiencia para el dueño y el ciclo persistente de pedidos:

- Frontend: commit `9c91258a3a5e1e4f77f3b137ca533916acf6c25d` en `main` de `ventas-ia-frontend`.
- Backend: commit `32c9c2fbb9ee6833cbae629735e117087251f301` en `main` de `ventas-ia-backend`.
- Render: deployment `dep-db9p1rjbc2fs73cndps0`, estado `live`, servicio `srv-db7sqqmq1p3s73elv1eg`.
- Vercel: `via.leanagentbuilder.com` respondió `200` y sirvió el bundle de la nueva navegación, landing y flujo de pedidos.
- Proxy y backend directo: `/api/health` y `/health` respondieron `200`; `/api/ops/overview` sin sesión respondió `401`.
- Validación pública: `tests/verify_landing.py` pasó contra el dominio de producción en cinco tamaños, con interacción del ejemplo, precio real, prueba gratuita, estados de indisponibilidad, teclado y reduced motion.

La documentación de uso quedó separada por rol en [Manuales de usuario](Manuales-de-usuario.md). La documentación técnica del ciclo de pedidos está en [Revisión integral UX](Revision-integral-UX-tendero-2026-10-17.md) y en `BACKEND.md`.

## Actualización: Meta Embedded Signup — 2026-10-16

Se publicó la mejora de conexión autoservicio de WhatsApp con commits separados:

- Backend: `f26ca1287f3aec5b50bb7fc1dc16609f4c9c9231` (`feat: harden Meta Embedded Signup completion`).
- Frontend: `3fb8f72c4bfd1e694265889a180ebc342504ccd6` (`feat: simplify WhatsApp self-service onboarding`).

Validación previa al release:

- Backend: `npm run test:backend` y `npm run test:plan` aprobados.
- Frontend: `npm run build`, `tests/verify_ui.py` y `tests/verify_landing.py` aprobados.
- Se comprobó la página pública `https://via.leanagentbuilder.com/eliminar-datos` después del despliegue de Vercel.

Despliegue y comprobaciones públicas:

- Vercel publicó automáticamente el frontend desde `main`.
- Render tiene el auto-deploy desactivado; se publicó manualmente el backend con el deploy `dep-db946rvt5n8s73e88r7g`, estado `live`.
- `https://ventas-ia-backend-free.onrender.com/health` y `https://via.leanagentbuilder.com/api/health` respondieron `200`.
- La verificación de webhook con un token inválido respondió `403`.

El release no completa por sí solo la habilitación pública de Meta. Quedan fuera de Git y deben configurarse en Render/Meta: `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` y la URL HTTPS pública del webhook. También se debe completar la publicación y revisión de la aplicación global de Meta antes de incorporar tiendas externas.
