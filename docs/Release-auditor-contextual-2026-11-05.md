# Release de grounding, auditor y condiciones de domicilio — 2026-11-05

## Autorización y alcance

El usuario solicitó commit, push y despliegue, aceptando expresamente que las pruebas no estén certificadas al 100%. Esta autorización sustituye la restricción de despliegue de las iteraciones locales anteriores. No equivale a una certificación funcional ni de latencia.

Se consolidan los cambios locales del 4–5 de noviembre: intérprete y resolución contextual con LLM, búsquedas con evidencia del catálogo, auditor de datos antes del resumen confirmable, coherencia entre respuesta y botones, venta por valor condicionada al catálogo, costo y mínimo de domicilio por tenant y avisos de comprobantes al tendero. VIA registra la forma de pago; no verifica ni acredita pagos.

## Conservación de lo publicado

- Backend: el despliegue anterior `2be5bd8029320f3c17a285d4e35743b9914b792b` es ancestro de la rama de trabajo `codex/backend-plan-payload-20261020`. Se publica esa rama y se despliega su SHA exacto. Render tiene auto-deploy desactivado; no se reemplaza `main`, que tiene una historia divergente.
- Frontend: se parte de `frontend/main` (`198dc6e`) en un worktree de release y se incorpora únicamente el delta nuevo de `src/`, resolviendo conflictos. Se conservan el Embedded Signup extraído, el diálogo de pedidos manuales, el nombre del agente, los medios de pago, los activos de verificación y la configuración de Vercel que ya estaban publicados. No se reemplaza `src/` por una copia antigua del checkout mixto.
- Servicios exclusivos de VIA: Render `srv-db7sqqmq1p3s73elv1eg`, Vercel `ventas-ia-frontend`, dominio `via.leanagentbuilder.com`. Los servicios de Lean Agent Builder no pertenecen a este release.
- No se purgan datos, no se cambian precios/catálogos de tenants y no se envían mensajes reales durante la verificación técnica.

## Validación previa

| Verificación | Resultado |
|---|---|
| Build del checkout de trabajo | Aprobado |
| Build del frontend integrado sobre `frontend/main` | Aprobado; bundle `index-CgBzmc1a.js` |
| Contratos frontend de Meta Embedded Signup | 4/4 aprobados |
| Navegación desktop/móvil (`verify_ui.py`) | Aprobado contra el frontend integrado |
| Landing (`verify_landing.py`) | Aprobado; oferta, cinco tamaños, interacción, accesibilidad y errores/reintentos |
| Plan autoservicio y carga de catálogo | Aprobados |
| PostgreSQL real | Aprobado en clon local `ventas_ia_e2e_release_20261105`; base de desarrollo conservada |
| Proveedor LLM, autenticación, Google, WhatsApp y Embedded Signup del backend | Aprobados |
| Suite general backend | No aprobada: `backend-smoke.mjs:351` exige vocabulario de validación en una respuesta; la ejecución independiente de Colombia también falla al exigir la cantidad literal `3 Ponque Chocoramo` en el fallback de escalamiento. No se alteraron las expectativas para aprobar el release. |
| Higiene | Sin errores en `git diff --check`; revisión de patrones de secretos sin hallazgos en los archivos nuevos/modificados. Credenciales, resultados temporales y dependencias excluidos por `.gitignore`. |

Las pruebas locales usaron Meta/Google simulados y almacenamiento temporal o PostgreSQL clonado. La campaña E2E con DeepSeek real y sus limitaciones se documenta en [Resultado de los 50 casos](Resultado-50-casos-auditor-corregido-2026-11-05.md).

## Límites que se mantienen

- Campaña completa: 41/50 aprobados automáticamente; 182 turnos, 17 pedidos y 17 ciclos del tendero. Hay errores del evaluador y defectos funcionales; el aprobado automático no exonera los hallazgos manuales.
- Dos correcciones posteriores se comprobaron en cinco conversaciones, sin repetir toda la campaña de 50.
- Latencia total observada en la campaña completa: mediana 6,761 s, p95 12,062 s; 61/182 turnos exceden 8 s. No se garantiza todavía el objetivo de 8 s.
- Persisten oportunidades de mejora en completitud inicial de productos, pertinencia de recomendaciones, precios vinculados a variantes y continuidad de atención humana. El informe E2E conserva la clasificación y la evidencia por caso.

## Activación y verificación de producción

Para activar el código validado deben establecerse `LLM_GROUNDING_ENABLED=true` y `LLM_ORDER_AUDIT_ENABLED=true` en el servicio de VIA. Se mantiene el redactor contextual activado (`LLM_RESPONSE_COMPOSER_ENABLED=true`), con timeout del auditor de 5000 ms. Los límites por llamada no representan una garantía de latencia total.

Se conservan PostgreSQL, autenticación/CSRF obligatorios, acceso local deshabilitado, entrada asíncrona y outbox ya configurados. Las variables se actualizan individualmente, sin reemplazar el conjunto de credenciales del servicio.

Pendiente de completar en el cierre del release: SHAs publicados, IDs/estados de los despliegues y resultados HTTP. El frontend debe responder por HTTPS, el proxy `/api/health` y el backend `/health` deben responder 200 y una ruta protegida sin sesión debe responder 401. No se confunde un push o un build aprobado con un despliegue terminado.

## Reversión

Si aparece una regresión de operación, volver al SHA backend `2be5bd8029320f3c17a285d4e35743b9914b792b` (deploy previo `dep-dbllecgae00c73c8avhg`) y promover el deployment anterior de Vercel. Desactivar grounding/auditor permite retirar esas capacidades; no revierte por sí solo todos los cambios de esta versión. No borrar datos ni forzar Git. Conservar los registros de pedidos y outbox para investigar.
