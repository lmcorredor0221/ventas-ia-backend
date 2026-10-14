# Plan de despliegue independiente: via.leanagentbuilder.com

Fecha de investigacion: 2026-10-14
Estado: plan preparado, repositorios fuente publicos verificados, sin cambios en Supabase, Render, Vercel ni DNS

## 1. Objetivo

Publicar esta microapp como una instalacion independiente, bajo:

- Frontend: `https://via.leanagentbuilder.com` en Vercel.
- Backend y webhooks: `https://api.via.leanagentbuilder.com` en Render.
- Base operativa: un proyecto Supabase PostgreSQL nuevo, en la misma cuenta del propietario.
- Dominio: `leanagentbuilder.com`, comprado y administrado en Latinoamerica Hosting.
- Administrador de plataforma: `lmcorredor@gmail.com`.

La instalacion nueva no debe modificar el proyecto actual que atiende `https://www.leanagentbuilder.com/`.

## 2. Resultado de la investigacion

### 2.1 Estado del codigo local

El repositorio de trabajo actual es una aplicacion Vite + React + Express + PostgreSQL:

- Frontend en `src/`.
- Backend en `server/`.
- Migraciones PostgreSQL en `server/db/migrations/`.
- `PostgresStore` ejecuta las migraciones pendientes durante el arranque.
- El frontend usa rutas relativas `/api/...` y el proxy de Vite solo existe para desarrollo local.
- El backend expone `/health`, `/api/...`, `/webhooks/whatsapp` y `/webhooks/mercadopago`.
- El backend actual usa `cors()` abierto y no tiene aun una configuracion de origen permitida para produccion.
- El ejemplo local escucha en `127.0.0.1`; Render debe escuchar en `0.0.0.0`.
- El `package.json` del repositorio backend oficial ya tiene `start: node server/index.js`; queda validar el binding de host/puerto para Render.

### 2.2 Repositorios fuente verificados

Los repositorios oficiales de este desarrollo son los dos repositorios confirmados en GitHub con la cuenta autenticada del propietario:

- Frontend: `https://github.com/lmcorredor0221/ventas-ia-frontend`, rama `main`, React/Vite, publico.
- Backend: `https://github.com/lmcorredor0221/ventas-ia-backend`, rama `main`, Node/Express, publico.

Sus README describen la separacion funcional esperada para esta microapp: Tienda viva, onboarding, Centro de control, conversaciones, observabilidad, Mercado Pago, Google Drive/Sheets, WhatsApp Cloud API, DeepSeek global, PostgreSQL y multi-tenancy.

No se deben crear repositorios nuevos para `via`. El despliegue independiente se resolvera creando nuevos proyectos de Vercel y Render conectados a estos repositorios, sin modificar los proyectos existentes.

Las carpetas `Agentes/Asistente/frontend` y `Agentes/Asistente/backend`, enlazadas respectivamente con `LABfrontend` y `backendLab`, son otra aplicacion: Next.js + FastAPI. No deben reutilizarse para esta microapp.

### 2.3 DNS y dominio

El portal de Latinoamerica Hosting no se pudo inspeccionar sin autenticacion: la URL publica del area de clientes devolvio `403`. Por lo tanto, el alta de los registros se hara en su panel DNS autenticado, usando exactamente los destinos que entregue cada plataforma.

El dominio no se transfiere a Vercel ni a Render. Solo se conectan subdominios mediante DNS.

### 2.4 Capacidades verificadas

- Vercel permite asociar un subdominio a un proyecto mediante `CNAME`, configurar variables por entorno y generar HTTPS automaticamente.
- Vercel permite proyectos separados y tambien varios proyectos desde un mismo repositorio, aunque aqui se recomienda un repositorio frontend independiente.
- Render permite agregar dominios personalizados a un Web Service, verificar DNS y generar/renovar TLS automaticamente.
- Supabase crea un PostgreSQL completo por proyecto y ofrece conexion directa o pooler Supavisor. Para un backend persistente en una red IPv4, la recomendacion es Shared Pooler en Session mode.
- Google exige que el `redirect_uri` coincida exactamente, incluyendo esquema, host, path y slash final.

### 2.5 Auditoria de recursos actuales

Auditoria realizada el 2026-10-14 con la cuenta `lmcorredor@gmail.com`:

| Plataforma | Recurso encontrado | Estado | Conclusion |
|---|---|---|---|
| GitHub | `lmcorredor0221/ventas-ia-frontend` | Publico, `main`, React/Vite, commit `5fc4aa5` | Repositorio fuente oficial del frontend |
| GitHub | `lmcorredor0221/ventas-ia-backend` | Publico, `main`, Node/Express, commit `3a78c55` | Repositorio fuente oficial del backend |
| GitHub | `lmcorredor0221/LABfrontend` | Publico, `main`, Next.js | Pertenece a la aplicacion anterior |
| GitHub | `lmcorredor0221/backendLab` | Publico, `codex/backend-sync-20260821`, FastAPI | Pertenece a la aplicacion anterior |
| GitHub | `lmcorredor0221/antigravity` | Publico, `main` | No corresponde a esta microapp |
| Vercel | `la-bfrontend` | Proyecto existente | Atiende la instalacion anterior; no reutilizar |
| Render | `leanagentbuilder-backend` | Web Service Python, free, `backendLab` | Atiende la instalacion anterior; no reutilizar |
| Supabase | `oacyylgnzwcmtnwoiuak` | `ACTIVE_HEALTHY`, region `us-east-2` | Base actual; no reutilizar para `via` |

El CLI de Render esta autenticado como `lmcorredor@gmail.com` y confirma que el servicio existente despliega `backendLab` con Python/FastAPI. La integracion de Vercel reconoce `la-bfrontend`, pero las consultas detalladas del equipo `leanagentbuildercom` devolvieron `403` y requieren reautenticacion de ese alcance; esto impide confirmar desde la herramienta los dominios y el ultimo deployment del proyecto anterior.

Los repositorios oficiales fueron cambiados a publicos con confirmacion del propietario. La API/conector GitHub utilizado por Codex ya los reconoce con visibilidad `public`, permisos administrativos y rama predeterminada `main`.

La separacion de repositorios ya no es una tarea pendiente. La preparacion debe continuar sobre `ventas-ia-frontend` y `ventas-ia-backend`, revisando sus ramas `main`, scripts de build, variables de entorno y configuraciones de plataforma. Los archivos `render.yaml`, `vercel.json` y configuracion especifica de Supabase se agregaran en esos repositorios solo cuando corresponda al despliegue, sin copiar secretos.

### 2.6 Auditoria complementaria de conexiones

La existencia de una conexion de cuenta no significa que el nuevo despliegue ya este vinculado. La situacion actual es:

| Plataforma | Conexion de cuenta | Recurso conectado actualmente | Repositorio o base | Estado para `via` |
|---|---|---|---|---|
| Vercel | Activa en el equipo `leanagentbuildercom` (`Hobby`) | `la-bfrontend` | `lmcorredor0221/LABfrontend` | No listo; requiere proyecto independiente para `ventas-ia-frontend` |
| Render | CLI autenticado como `lmcorredor@gmail.com`, workspace `Luis's workspace` | `leanagentbuilder-backend` | `lmcorredor0221/backendLab`, rama `codex/backend-sync-20260821` | No listo; requiere Web Service independiente para `ventas-ia-backend` |
| Supabase | Organizacion `leanagentbuilder` visible | `oacyylgnzwcmtnwoiuak` | PostgreSQL 17.6, `us-east-2` | No listo; requiere proyecto PostgreSQL independiente para `via` |

Evidencia de la auditoria del 2026-10-14:

- Vercel muestra solo `la-bfrontend`, con dominio `www.leanagentbuilder.com` y repositorio `LABfrontend`.
- Render muestra solo `leanagentbuilder-backend`, servicio Python/FastAPI en `https://leanagentbuilder-backend.onrender.com`, repositorio `backendLab` y plan Free.
- Supabase muestra un solo proyecto activo y saludable, `oacyylgnzwcmtnwoiuak`, correspondiente a la instalacion anterior.

Conclusion: las conexiones de las cuentas se pueden reutilizar para crear recursos nuevos, pero no se deben reutilizar los recursos existentes. El despliegue de `via` sigue siendo independiente y no modifica `www.leanagentbuilder.com`.

## 3. Arquitectura objetivo

```text
Usuario
  |
  v
via.leanagentbuilder.com
  |
  | Vercel: frontend estatico y proxy /api opcional
  v
api.via.leanagentbuilder.com
  |
  | Render Web Service: Express
  +--> Supabase PostgreSQL nuevo
  +--> Google OAuth / Drive / Sheets por tenant
  +--> Meta WhatsApp Cloud API
  +--> Mercado Pago webhooks
  +--> DeepSeek global de plataforma
```

### Decisiones recomendadas

1. Mantener el frontend publico en `via.leanagentbuilder.com`.
2. Usar `api.via.leanagentbuilder.com` para backend, OAuth callback y webhooks.
3. Mantener el frontend con rutas relativas `/api` y agregar rewrites de Vercel hacia el backend para reducir cambios y evitar CORS en la operacion normal.
4. Mantener los webhooks directamente en `api.via.leanagentbuilder.com`.
5. No crear un subdominio por tienda en esta fase. El aislamiento sigue siendo por `tenant_id`, membresia, sesion y autorizacion.
6. Crear un proyecto Supabase separado para no mezclar datos, migraciones, credenciales ni auditoria con otra instalacion.

## 4. Plan por fases

### Fase 0: congelar alcance y proteger lo existente

- [ ] Confirmar que `www.leanagentbuilder.com` no se toca.
- [x] Confirmar repositorios fuente: `ventas-ia-frontend` y `ventas-ia-backend`.
- [ ] Confirmar que `lmcorredor@gmail.com` tiene acceso a GitHub, Vercel, Render y Supabase.
- [ ] Crear un inventario de variables y secretos sin copiar valores en Git.
- [ ] Exportar/respaldar la configuracion local y el estado de pruebas antes de separar repositorios.
- [ ] Definir que el proyecto nuevo inicia con datos semilla controlados y no con datos reales de otros tenants.

### Fase 1: preparar los repositorios fuente

#### Frontend

- [ ] Revisar el contenido actual de `ventas-ia-frontend` contra el estado local aprobado.
- [ ] Incluir o ajustar `src/`, `public/` si existe, `index.html`, `vite.config.js`, `package.json` y `package-lock.json` sin sobrescribir trabajo existente.
- [ ] Agregar `vercel.json` al repositorio `ventas-ia-frontend` con rewrite de `/api/:path*` hacia `https://api.via.leanagentbuilder.com/api/:path*` y de `/health` hacia el backend.
- [ ] Revisar que las rutas SPA funcionen al recargar una URL interna.
- [ ] Mantener `VITE_GOOGLE_CLIENT_ID` como unica credencial Google expuesta al navegador; nunca incluir secretos de backend.

#### Backend

- [ ] Revisar el contenido actual de `ventas-ia-backend` contra el estado local aprobado.
- [ ] Mantener `server/`, `server/db/migrations/`, `scripts/` estrictamente necesarios, `package.json` y `package-lock.json` en `ventas-ia-backend`.
- [x] Confirmar script de arranque: `"start": "node server/index.js"`.
- [ ] Confirmar que el servicio API pueda arrancar sin servir el `dist` del frontend, o hacer que el fallback estatico sea opcional para produccion.
- [ ] Cambiar la politica CORS para aceptar solo `https://via.leanagentbuilder.com` y el origen local necesario durante pruebas.
- [ ] Hacer que la aplicacion respete `HOST=0.0.0.0` y `PORT` asignado por Render.
- [ ] Agregar una variable separada para la URL del frontend, por ejemplo `FRONTEND_APP_URL`, para redirecciones de experiencia sin confundirla con la URL del API.
- [ ] Mantener la resolucion de secretos en backend y conservar `PLATFORM_ADMIN_EMAILS=lmcorredor@gmail.com`.

### Fase 2: crear Supabase nuevo

- [ ] Crear un proyecto nuevo en la misma cuenta, con nombre sugerido `ventas-ia-via-prod`.
- [ ] Elegir una region de Americas; validar costo, latencia y disponibilidad antes de confirmar. Supabase recomienda elegir la region mas cercana a los usuarios.
- [ ] Generar una contraseña de base de datos fuerte y almacenarla en un gestor seguro.
- [ ] Obtener desde `Connect` la cadena Shared Pooler, Session mode, para Render IPv4.
- [ ] Usar SSL obligatorio. El backend debe recibir `DATABASE_SSL=require` o una configuracion equivalente.
- [ ] Ejecutar las migraciones `001` a `006` en orden. El arranque del backend tambien valida/aplica migraciones pendientes.
- [ ] Validar tablas, `schema_migrations`, `app_state`, tenants, sesiones, eventos, billing y webhooks.
- [ ] Inicializar un estado semilla de produccion limpio y revisar que no entren cuentas `example.local` no autorizadas.
- [ ] No colocar `service_role`, contraseñas ni connection strings en el frontend.
- [ ] Mantener RLS como defensa adicional si se habilita el Data API de Supabase; el frontend no debe consultar PostgreSQL directamente.
- [ ] Configurar backups y definir el procedimiento de restauracion antes de aceptar datos reales.

### Fase 3: crear servicio backend en Render

- [ ] Crear un nuevo Web Service en la misma cuenta/workspace de Render.
- [ ] Conectarlo al repositorio `ventas-ia-backend` y a la rama `main` o a una rama de release definida.
- [ ] Build command: `npm ci`.
- [ ] Start command: `npm start`.
- [ ] Configurar health check: `/health`.
- [ ] Configurar `HOST=0.0.0.0`, `NODE_ENV=production`, `STORAGE_DRIVER=postgres` y `DATABASE_SSL=require`.
- [ ] Agregar el `DATABASE_URL` de Supabase Session Pooler.
- [ ] Agregar `AUTH_REQUIRED=true`, `CSRF_REQUIRED=true`, `ALLOW_DEV_GOOGLE_LOGIN=false`.
- [ ] Agregar `PUBLIC_APP_URL=https://api.via.leanagentbuilder.com`.
- [ ] Agregar `FRONTEND_APP_URL=https://via.leanagentbuilder.com`.
- [ ] Agregar `GOOGLE_REDIRECT_URI=https://api.via.leanagentbuilder.com/api/saas/google/oauth/callback`.
- [ ] Agregar `PLATFORM_ADMIN_EMAILS=lmcorredor@gmail.com`.
- [ ] Agregar las referencias/secretos de DeepSeek, Google, Meta WhatsApp, Mercado Pago y `SECRET_ENCRYPTION_KEY` mediante Environment, nunca en el repositorio.
- [ ] Crear un Custom Domain temporal o definitivo: `api.via.leanagentbuilder.com`.
- [ ] Obtener de Render el destino DNS exacto del servicio antes de tocar el panel del registrador.

### Fase 4: crear proyecto frontend en Vercel

- [ ] Crear un proyecto nuevo en la misma cuenta/equipo Vercel.
- [ ] Importar `ventas-ia-frontend`.
- [ ] Seleccionar Vite o configuracion generica de Node.
- [ ] Build command: `npm run build`.
- [ ] Output directory: `dist`.
- [ ] Instalar dependencias con lockfile (`npm ci` si la configuracion lo permite).
- [ ] Configurar `VITE_GOOGLE_CLIENT_ID` para Preview y Production segun corresponda.
- [ ] Agregar el dominio personalizado `via.leanagentbuilder.com`.
- [ ] Obtener de Vercel el CNAME exacto para ese subdominio.
- [ ] Configurar la rama de produccion y previews para no publicar accidentalmente ramas de trabajo.
- [ ] Validar que los rewrites `/api` y `/health` lleguen a Render.

### Fase 5: configurar DNS en Latinoamerica Hosting

Crear los registros despues de tener los destinos exactos de Vercel y Render:

| Host | Tipo | Destino | Uso |
|---|---|---|---|
| `via` | CNAME | valor entregado por Vercel | Frontend Vercel |
| `api.via` | CNAME | host `onrender.com` entregado por Render | Backend Render |

Reglas:

- [ ] No adivinar valores CNAME ni A; usar los valores que muestre cada dashboard.
- [ ] No eliminar registros MX, TXT, SPF, DKIM o DMARC existentes.
- [ ] Revisar si existen registros AAAA que interfieran con Render y retirarlos solo si pertenecen al host `api.via` y el diagnostico de Render lo solicita.
- [ ] Mantener TTL razonable durante la migracion y aumentarlo despues de validar.
- [ ] Esperar propagacion y verificar con `nslookup`/`Resolve-DnsName`.
- [ ] Confirmar HTTPS valido en ambos subdominios.

### Fase 6: actualizar Google Cloud

Usar preferiblemente un cliente OAuth web separado para esta instalacion, dentro del proyecto Google Cloud administrado por la plataforma.

- [ ] Authorized JavaScript origins: `https://via.leanagentbuilder.com`.
- [ ] Authorized redirect URI: `https://api.via.leanagentbuilder.com/api/saas/google/oauth/callback`.
- [ ] Conservar las URLs locales solo mientras duren las pruebas.
- [ ] Revisar scopes de Drive/Sheets y estado de verificacion/usuarios de prueba.
- [ ] Guardar el client secret solo en Render.
- [ ] Probar login Google, OAuth Drive/Sheets, refresh token, provisioning y escritura real en Sheets.

Google exige coincidencia exacta del redirect URI; un cambio de dominio, path, esquema o slash final genera `redirect_uri_mismatch`.

### Fase 7: actualizar integraciones externas

#### WhatsApp Cloud API

- [ ] Callback de verificacion: `https://api.via.leanagentbuilder.com/webhooks/whatsapp`.
- [ ] URL de mensajes: el mismo endpoint POST.
- [ ] Configurar verify token y app secret en Render.
- [ ] Validar que el `phone_number_id` se relacione con un tenant.
- [ ] Probar firma HMAC, deduplicacion y respuesta saliente.

#### Mercado Pago

- [ ] Webhook: `https://api.via.leanagentbuilder.com/webhooks/mercadopago`.
- [ ] Configurar firma/secreto y access token en Render.
- [ ] Confirmar que la suscripcion se relacione con tenant mediante referencia externa.
- [ ] Probar evento duplicado, evento invalido, pago aprobado, pago pendiente y pago rechazado.

#### DeepSeek

- [ ] Configurar una sola credencial global de plataforma.
- [ ] Mantener el consumo medido por tenant y conversacion.
- [ ] No exponer `DEEPSEEK_API_KEY` a Vercel ni al navegador.
- [ ] Ejecutar una prueba de costo y latencia antes de abrir el servicio a clientes.

### Fase 8: validacion por capas

1. DNS y TLS: ambos hostnames resuelven y responden por HTTPS.
2. Backend: `/health`, arranque, migraciones y conexion Supabase.
3. Frontend: carga de Vercel, assets, rutas SPA y proxy `/api`.
4. Identidad: login Google real como `lmcorredor@gmail.com` y rol `platform_admin`.
5. Tenant: owner de una tienda no puede consultar otra.
6. Google: OAuth, Drive/Sheets, catalogo, clientes y pedidos.
7. WhatsApp: verificacion, entrada, salida y handoff humano.
8. Mercado Pago: checkout, webhook y estados de suscripcion.
9. DeepSeek: plan, herramientas, tokens y fallback controlado.
10. Observabilidad: errores, webhooks, consumo y auditoria visibles en Centro de control.
11. Seguridad: no hay secretos en bundles, logs, GitHub ni respuestas HTTP.
12. UX: desktop, movil, tabs, Tienda viva, conversaciones y aprobaciones sin overflow.

## 5. Matriz de variables

### Vercel frontend

| Variable | Tipo | Valor esperado |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Publica | Client ID OAuth web |

### Render backend

| Variable | Tipo | Valor esperado |
|---|---|---|
| `NODE_ENV` | Publica | `production` |
| `HOST` | Publica | `0.0.0.0` |
| `PORT` | Plataforma | Valor de Render o puerto compatible |
| `STORAGE_DRIVER` | Publica | `postgres` |
| `DATABASE_URL` | Secreta | Supabase Session Pooler |
| `DATABASE_SSL` | Publica | `require` |
| `AUTH_REQUIRED` | Publica | `true` |
| `CSRF_REQUIRED` | Publica | `true` |
| `ALLOW_DEV_GOOGLE_LOGIN` | Publica | `false` |
| `PUBLIC_APP_URL` | Publica | `https://api.via.leanagentbuilder.com` |
| `FRONTEND_APP_URL` | Publica | `https://via.leanagentbuilder.com` |
| `GOOGLE_CLIENT_ID` | Secreta/identidad | Client ID OAuth |
| `GOOGLE_CLIENT_SECRET` | Secreta | Secret OAuth |
| `GOOGLE_REDIRECT_URI` | Publica | Callback del backend |
| `PLATFORM_ADMIN_EMAILS` | Publica | `lmcorredor@gmail.com` |
| `SECRET_ENCRYPTION_KEY` | Secreta | Clave nueva de produccion |
| `DEEPSEEK_API_KEY` | Secreta | API key global |
| WhatsApp | Secreta | Tokens, app secret y verify token |
| Mercado Pago | Secreta | Access token y webhook secret |

## 6. Bloqueadores tecnicos detectados antes de publicar

- El codigo actual no esta separado en los dos repositorios nuevos.
- El frontend depende de rutas relativas y no tiene aun rewrite de produccion.
- El backend tiene CORS abierto; debe restringirse.
- El backend no tiene `npm start` explicito.
- El backend debe escuchar en `0.0.0.0` en Render.
- Debe definirse como se comportara el callback Google despues de completar OAuth: respuesta JSON en API o redireccion guiada a la pantalla de onboarding.
- El portal DNS requiere acceso autenticado; no se puede confirmar la zona desde fuera.
- No se deben reutilizar datos, refresh tokens ni `SECRET_ENCRYPTION_KEY` de otro entorno.

## 7. Estrategia de rollback

- Mantener `www.leanagentbuilder.com` y sus registros intactos.
- Desactivar el dominio `via` en Vercel si el frontend falla.
- Desactivar `api.via` en Render o retirar el CNAME si el backend falla.
- Restaurar variables a la version anterior sin borrar el proyecto Supabase.
- Para datos: restaurar backup de Supabase y conservar evidencia de migraciones.
- No eliminar el nuevo proyecto hasta confirmar que no quedan datos de clientes ni webhooks pendientes.

## 8. Criterios de salida

- [ ] Dos repositorios nuevos creados y protegidos.
- [ ] Frontend desplegado en Vercel como proyecto independiente.
- [ ] Backend desplegado en Render como servicio independiente.
- [ ] Supabase nuevo con migraciones, SSL y backup verificados.
- [ ] `via.leanagentbuilder.com` responde por HTTPS.
- [ ] `api.via.leanagentbuilder.com/health` responde por HTTPS.
- [ ] DNS conserva intactos los servicios actuales del dominio.
- [ ] `lmcorredor@gmail.com` entra como administrador de plataforma.
- [ ] Google OAuth productivo validado.
- [ ] Google Drive/Sheets productivo validado.
- [ ] WhatsApp y Mercado Pago quedan configurados para los webhooks nuevos.
- [ ] DeepSeek funciona como motor global y mide consumo por tenant.
- [ ] Prueba E2E de pedido, escalamiento humano y alistamiento aprobada.
- [ ] No hay secretos en GitHub, bundle frontend, logs ni documentos publicos.

## 9. Fuentes consultadas

- [Vercel: dominios personalizados](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Vercel: despliegue desde CLI](https://vercel.com/docs/projects/deploy-from-cli)
- [Vercel: variables de entorno](https://vercel.com/docs/environment-variables)
- [Render: custom domains](https://render.com/docs/custom-domains)
- [Render: environment variables](https://render.com/docs/configure-environment-variables)
- [Supabase: regiones](https://supabase.com/docs/guides/platform/regions)
- [Supabase: conexion a PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Google: OAuth 2.0 para aplicaciones web](https://developers.google.com/identity/protocols/oauth2/web-server)

## 10. Siguiente accion recomendada

Antes de crear recursos externos, cerrar la Fase 0 y ejecutar la separacion de repositorios. Luego crear Supabase, porque su connection string sera necesaria para configurar Render. El DNS se modifica al final de la preparacion, cuando Vercel y Render hayan entregado sus destinos exactos.
