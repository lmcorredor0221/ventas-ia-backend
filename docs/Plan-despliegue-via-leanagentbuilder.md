# Plan de despliegue independiente: via.leanagentbuilder.com

Fecha de investigacion: 2026-10-14  
Estado: ejecucion parcial verificada el 2026-10-14; frontend y backend publicos responden, OAuth publico configurado, integraciones de negocio pendientes

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

- [x] Crear un proyecto separado en una organizacion Free: `ventas-ia-free`, proyecto `ventas-ia-free`, ref `mmcxphpstxjugxjrdffb`.
- [x] Elegir una region de Americas: `ca-central-1` (Canada Central). La organizacion Pro `leanagentbuilder` y su proyecto existente no fueron modificados.
- [x] Generar y restablecer una contraseña de base de datos fuerte; se conserva solo como secreto operativo.
- [x] Obtener desde `Connect` la cadena Shared Pooler, Session mode, para Render IPv4: `aws-1-ca-central-1.pooler.supabase.com:5432`.
- [x] Usar SSL obligatorio. Render recibe `DATABASE_SSL=require` y la URL no incluye `sslmode=require`, para evitar que Node 24 reemplace la politica SSL del driver.
- [x] Ejecutar las migraciones `001` a `006` en orden. El arranque exitoso del backend confirma la conexion y la ejecucion del migrador incorporado.
- [ ] Validar tablas, `schema_migrations`, `app_state`, tenants, sesiones, eventos, billing y webhooks.
- [x] Inicializar un estado semilla de produccion limpio durante el primer arranque; queda pendiente revisar explicitamente que no entren cuentas `example.local` no autorizadas.
- [ ] No colocar `service_role`, contraseñas ni connection strings en el frontend.
- [x] Mantener RLS automatico habilitado en el proyecto; el frontend no consulta PostgreSQL directamente.
- [ ] Configurar backups y definir el procedimiento de restauracion antes de aceptar datos reales.

### Fase 3: crear servicio backend en Render

- [x] Crear un nuevo Web Service en la misma cuenta/workspace de Render: `ventas-ia-backend-free`, id `srv-db7sqqmq1p3s73elv1eg`.
- [x] Conectarlo al repositorio `ventas-ia-backend`, rama `main`.
- [x] Build command: `npm ci`.
- [x] Start command: `npm start`.
- [x] Configurar health check: `/health`.
- [x] Configurar `HOST=0.0.0.0`, `NODE_ENV=production`, `STORAGE_DRIVER=postgres` y `DATABASE_SSL=require`.
- [x] Agregar el `DATABASE_URL` de Supabase Session Pooler como secreto.
- [x] Agregar `AUTH_REQUIRED=true`, `CSRF_REQUIRED=true`, `ALLOW_DEV_GOOGLE_LOGIN=false`.
- [x] Usar temporalmente `PUBLIC_APP_URL=https://ventas-ia-backend-free.onrender.com`; Render Free no admite dominio personalizado.
- [x] Agregar `FRONTEND_APP_URL=https://via.leanagentbuilder.com`.
- [x] Usar temporalmente `GOOGLE_REDIRECT_URI=https://ventas-ia-backend-free.onrender.com/api/saas/google/oauth/callback`; debe cambiarse si se habilita un dominio API de pago.
- [x] Agregar `PLATFORM_ADMIN_EMAILS=lmcorredor@gmail.com`.
- [x] Agregar `SECRET_ENCRYPTION_KEY`, credenciales OAuth de Google y `DEEPSEEK_API_KEY` mediante Environment, nunca en el repositorio.
- [ ] Agregar credenciales de Meta WhatsApp y Mercado Pago mediante Environment, nunca en el repositorio.
- [x] Confirmar que el servicio permanezca accesible despues del redeploy limpio; `/health` devolvio `200` y `/api/auth/me` devolvio `401` sin sesion.
- [ ] Crear el Custom Domain `api.via.leanagentbuilder.com` cuando el plan de Render lo permita; no se habilita en Free.
- [ ] Obtener de Render el destino DNS exacto del servicio antes de tocar el panel del registrador.

### Fase 4: crear proyecto frontend en Vercel

- [x] Crear un proyecto nuevo en la misma cuenta/equipo Vercel: `ventas-ia-frontend`.
- [x] Importar `ventas-ia-frontend`.
- [x] Seleccionar Vite o configuracion generica de Node.
- [x] Build command: `npm run build`.
- [x] Output directory: `dist`.
- [x] Instalar dependencias con lockfile (`npm ci`).
- [x] Configurar `VITE_GOOGLE_CLIENT_ID` en Production y redeplegar el proyecto.
- [x] Agregar el dominio personalizado `via.leanagentbuilder.com`.
- [x] Verificar el dominio en Vercel; la configuracion aparece valida para Production.
- [x] Configurar la rama de produccion `main`.
- [x] Agregar `vercel.json` con rewrites para `/api`, `/webhooks`, `/health` y `/api/health` hacia Render.
- [x] Validar `https://via.leanagentbuilder.com/api/health` con respuesta `200` del backend.

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

- [x] Authorized JavaScript origins: `https://via.leanagentbuilder.com`.
- [x] Authorized redirect URI temporal: `https://ventas-ia-backend-free.onrender.com/api/saas/google/oauth/callback`.
- [ ] Reemplazar el redirect temporal por `https://api.via.leanagentbuilder.com/api/saas/google/oauth/callback` solo si se habilita el dominio API en Render.
- [ ] Conservar las URLs locales solo mientras duren las pruebas.
- [ ] Revisar scopes de Drive/Sheets y estado de verificacion/usuarios de prueba.
- [ ] Guardar el client secret solo en Render.
- [ ] Completar login Google, OAuth Drive/Sheets, refresh token, provisioning y escritura real en Sheets. El selector de cuenta de Google ya se abre desde `via.leanagentbuilder.com`, pero el callback completo aun no esta validado.

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

1. DNS y TLS: frontend resuelve por HTTPS; el dominio API queda pendiente porque Render Free no admite custom domains.
2. Backend: `/health` devuelve `200`, arranque, migraciones y conexion Supabase verificadas; `/api/auth/me` exige autenticacion con `401`.
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

- [x] Dos repositorios nuevos creados y publicados: `ventas-ia-frontend` y `ventas-ia-backend`.
- [x] Frontend desplegado en Vercel como proyecto independiente.
- [x] Backend desplegado en Render como servicio independiente.
- [ ] Supabase nuevo con migraciones, SSL y backup verificados; migraciones y SSL ya verificados, backup pendiente.
- [x] `via.leanagentbuilder.com` responde por HTTPS.
- [ ] `api.via.leanagentbuilder.com/health` responde por HTTPS; pendiente porque Render Free no admite custom domains.
- [ ] `https://via.leanagentbuilder.com/api/health` requiere una verificacion final desde una red con resolucion DNS disponible; la app publica ya muestra la puerta de autenticacion Google en lugar del fallback local.
- [ ] DNS conserva intactos los servicios actuales del dominio.
- [ ] `lmcorredor@gmail.com` entra como administrador de plataforma.
- [ ] Google OAuth productivo validado.
- [ ] Google Drive/Sheets productivo validado.
- [ ] WhatsApp y Mercado Pago quedan configurados para los webhooks nuevos.
- [ ] DeepSeek funciona como motor global y mide consumo por tenant.
- [ ] Prueba E2E de pedido, escalamiento humano y alistamiento aprobada.
- [ ] No hay secretos en GitHub, bundle frontend, logs ni documentos publicos.

## 8.1. Registro de ejecución 2026-10-14

- Supabase Free creado en organización independiente `ventas-ia-free`; ref `mmcxphpstxjugxjrdffb`; estado `Healthy`; region `ca-central-1`.
- Render creó `ventas-ia-backend-free` en plan Free; URL `https://ventas-ia-backend-free.onrender.com`; commit live `8625df30c7ffa5acbce7eb22fd3dc7cdb1212afc`.
- El primer arranque falló por `SELF_SIGNED_CERT_IN_CHAIN`, causado por la combinación de `sslmode=require` en la URL y Node 24; se corrigió usando `DATABASE_SSL=require` en el backend y una URL pooler sin ese query parameter. El segundo arranque observado en logs llegó a `Ventas IA backend listening` y `Your service is live`.
- Durante la recuperacion, Render devolvio temporalmente `502` (`x-render-routing: no-deploy`) y el deploy normal mostro un error interno. Un redeploy con cache limpia genero el deployment `dep-db7tj9g473hc73fv4h80`; el build termino correctamente y el health directo posterior devolvio `200`.
- Frontend Vercel commit `4db70ba` agregó el proxy y commit `95cc1b1` corrigió el mapeo especial de `/api/health` -> `/health`.
- Health publico verificado: `https://via.leanagentbuilder.com/api/health` -> `200`.
- Rutas protegidas verificadas: `/api/auth/me`, `/api/admin/overview` y `/api/ops/overview` responden `401 Authentication required`, no `404`.
- Render Environment conserva las variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SECRET_ENCRYPTION_KEY`, `DEEPSEEK_API_KEY` y `LLM_SIMULATOR`.
- Google Cloud guardo el origen `https://via.leanagentbuilder.com` y el callback temporal de Render. Desde la URL publica se abrio el selector de cuenta para `lmcorredor@gmail.com`; falta completar la seleccion y validar el callback.
- El frontend Vercel tiene un deployment de Production listo y asociado a `via.leanagentbuilder.com`; el sitio existente `www.leanagentbuilder.com` no fue modificado.
- La URL publica ahora presenta el acceso seguro de Google para `lmcorredor@gmail.com`, en lugar del mensaje de fallback local observado durante la indisponibilidad de Render.
- No se modificaron `www.leanagentbuilder.com`, el proyecto Vercel `la-bfrontend`, la organización Supabase Pro ni el servicio Render existente `leanagentbuilder-backend`.

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

Completar la verificacion final del proxy Vercel y el callback de login Google. Como la API key de DeepSeek fue compartida en la conversacion, debe rotarse antes de usarla en produccion. Despues completar OAuth Drive-Sheets, WhatsApp y Mercado Pago; la publicación real de webhooks y la configuración de `api.via.leanagentbuilder.com` quedan para el cierre.
