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

## Evidencia final

- Commit backend: pendiente de ejecución.
- Commit frontend: pendiente de ejecución.
- Deployment Render: pendiente de ejecución.
- Deployment Vercel: pendiente de ejecución.
- Verificación Supabase: pendiente de ejecución.
