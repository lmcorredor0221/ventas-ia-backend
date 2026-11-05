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

### Cierre verificado

| Componente | Commit publicado | Despliegue | Estado |
|---|---|---|---|
| Backend | `2ecbe26c97ff1a9a23a1f7ff42e071731c06de29`, rama `codex/backend-plan-payload-20261020` del remoto backend | `dep-dbm1se56e07s73asq6h0` | `live`, terminado 2026-11-05 06:15:49 UTC / 01:15:49 Colombia |
| Frontend | `d097eb685d82e67d35d446902393687c1aa3a463`, `main` del remoto frontend | `dpl_BJxiwQ1iDPVk1EKZVrfW7bQ3G8WE` | `READY`, producción; alias `via.leanagentbuilder.com` confirmado por API |

Se comprobaron ambos commits remotos, el SHA del despliegue Render y el SHA Git/alias del despliegue Vercel. Los commits posteriores de documentación no cambian el código ejecutado por Render; su auto-deploy continúa desactivado.

Las cuatro variables descritas arriba quedaron guardadas y verificadas antes del despliegue. La configuración preexistente mantiene entrada asíncrona y outbox habilitados, PostgreSQL y autenticación/CSRF activos, y acceso de desarrollo deshabilitado. No se cambiaron las credenciales ni los métodos de pago de los clientes.

Verificación HTTP posterior (06:16–06:18 UTC):

- `https://via.leanagentbuilder.com/` y `/?app=1`: **200**.
- `https://via.leanagentbuilder.com/api/health`: **200**.
- `https://ventas-ia-backend-free.onrender.com/health`: **200**.
- `https://ventas-ia-backend-free.onrender.com/health/ready`: **200**, `production=true`, `storageDriver=postgres`, `whatsappMode=live`, sin errores ni advertencias de configuración.
- `/api/auth/me` directo y mediante VIA: **401** sin sesión, como corresponde.
- Bundle publicado `index-C1hPk_IW.js`: **200**, tipo JavaScript, 477.803 bytes; contiene condiciones de domicilio, avisos de comprobante, Embedded Signup y el diálogo «Confirmar y alistar pedido». El hash de producción difiere del build local; se verificó el archivo que referencia el HTML publicado y el SHA fuente de Vercel.

La comprobación de salud confirma disponibilidad y configuración, no una conversación E2E real ni tiempos de respuesta garantizados. No se enviaron mensajes a WhatsApp durante este release.

### Incidencias observadas durante el release

- El primer arranque tuvo un timeout PostgreSQL `57014` en `PostgresStore.save`, al insertar/actualizar `app_state`. Render reinició la instancia; el segundo arranque escuchó en el puerto 10000 con PostgreSQL y quedó `live`. No se encontraron errores nuevos en la consulta de logs desde 06:15:50 UTC hasta el cierre. Queda pendiente analizar la contención del snapshot durante reinicios; este despliegue no demuestra que esté corregida.
- `npm ci` del backend informó dos avisos de dependencias: `body-parser` (alto) y `qs` (moderado). `npm audit --omit=dev` los confirmó, ambos transitivos y con corrección disponible. Este release no cambia el lockfile ni aplica automáticamente `npm audit fix`; quedan registrados para un parche controlado. El frontend integrado instaló sin vulnerabilidades reportadas.
- La máquina local tuvo fallos DNS transitorios al consultar `api.render.com`; las operaciones se reintentaron y su resultado se verificó, sin crear despliegues duplicados.

## Reversión

Si aparece una regresión de operación, volver al SHA backend `2be5bd8029320f3c17a285d4e35743b9914b792b` (deploy previo `dep-dbllecgae00c73c8avhg`) y promover el deployment anterior de Vercel `dpl_414bShhSSayWzUtqsFqvm4APQmbx` (frontend `198dc6ebe3c3296a15d4a5caec23670b24dc9bc5`). Desactivar grounding/auditor permite retirar esas capacidades; no revierte por sí solo todos los cambios de esta versión. No borrar datos ni forzar Git. Conservar los registros de pedidos y outbox para investigar.
