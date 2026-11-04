# Evidencia P9 — preflight del replay E2E

Fecha: 2026-11-04
Rama: `codex/backend-plan-payload-20261020`

## Resultado del preflight

El replay de los 40 casos no se ejecutó porque falta la configuración local requerida para usar DeepSeek real:

- `.env.e2e.local` no existe en el repositorio local.
- `DEEPSEEK_API_KEY` no está disponible en el entorno del proceso.
- `LLM_SIMULATOR` está ausente, por lo que no hay un simulador habilitado accidentalmente.
- El runner `server/tests/e2e-local-deepseek-40.mjs` rechaza explícitamente ejecutar sin `DEEPSEEK_API_KEY` para evitar presentar respuestas simuladas como una validación real.

## Comando preparado

```powershell
npm run test:e2e:local
```

Este comando carga el archivo local no versionado `.env.e2e.local`, mantiene Meta/WhatsApp simulado y permite únicamente la salida hacia el proveedor DeepSeek configurado.

## Seguridad y alcance

- No se expuso ni se solicitó la clave en el chat.
- No se hicieron llamadas a DeepSeek durante este preflight.
- No se enviaron mensajes reales a Meta/WhatsApp.
- No se modificó PostgreSQL ni el frontend.

## Acción requerida para continuar

Crear localmente `.env.e2e.local` a partir de `.env.e2e.local.example`, introducir la clave real de DeepSeek fuera del chat y volver a ejecutar el comando. El límite recomendado inicial es `E2E_MAX_DEEPSEEK_CALLS=160`.
