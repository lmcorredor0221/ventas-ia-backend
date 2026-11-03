# Subtotal cero al completar los datos del comprador

## Evidencia y causa

Tenant: `demo-de-tienda`. Conversación: `wa-241381eb`. Pedido de prueba: `ord-20a1c0ca-6`.

1. La cotización inicial del 3 de noviembre a las 15:11 reconoció Coca-Cola original 1.5 L (COP 7.200) y Ponque Chocoramo (COP 2.800): COP 10.000.
2. Se seleccionó Bre-B. Al proporcionar nombre y dirección a las 15:13, `reasoningPlan.order` conservaba `subtotal: 10000`, SKU y cantidades, pero no los objetos `product` ni `lineTotal`.
3. `handleOrderClarification` clonaba exclusivamente `plan.order` y reemplazaba el borrador ya cotizado. Sumaba `lineTotal ?? 0`: resultado cero. La confirmación posterior reutilizó ese borrador dañado.
4. SELECT de PostgreSQL verificó `orders.payload.subtotal = 0`, ambos `unitPrice` y `lineTotal` nulos. No era solamente un error de texto.
5. La tarjeta mostraba COP 10.000 porque `enrichOrderForDisplay` reconstruye importes ausentes desde el catálogo al consultar. Esa corrección visual no repara la fila ni el mensaje de WhatsApp.

El cálculo del cero se introducía en el backend; no fue un importe calculado por DeepSeek, un fallo de Meta ni una expiración de token.

## Cambio acotado

- Se mantiene la cotización verificada en aclaraciones de nombre, dirección y pago. El plan del LLM aporta intención y cambios, pero no reemplaza los precios del catálogo.
- Se asocian líneas por SKU o coincidencia exacta inequívoca con la línea anterior; no se copian precios por posición ni entre productos.
- Cambios de cantidad recalculan importes; referencias nuevas o cambiadas vuelven al catálogo. No se suma dos veces el borrador cuando se revalida una aclaración.
- Un precio ausente o no válido requiere revisión humana. Un carrito vacío no ofrece confirmación. Un borrador antiguo sin precios debe cotizarse de nuevo y obtener confirmación, antes de escribir otro pedido.
- El mensaje final, la tarea humana y el consumo utilizan el subtotal e ítems devueltos por la escritura del pedido.
- No se cambian prompts, proveedor LLM, permisos Meta, credenciales, Google, esquema de datos ni frontend.

## Validación

`server/tests/agent-runtime-quote-continuity.mjs` reproduce el resultado estructurado observado del proveedor, usando runtime, herramientas, catálogo local, persistencia y botones reales del backend. Las fronteras externas operan en modo local: no envía WhatsApp y no llama DeepSeek.

Antes del arreglo falla con `0 !== 10000`. Tras corregir, cubre cotización → botón Bre-B → nombre/dirección → botón Confirmar, importes por línea, subtotal de pedido/tarea/mensaje, carrito omitido, cambio de cantidad con precio inválido propuesto por el plan, eliminación, producto inexistente, precio ausente y recuperación de borrador histórico dañado.

Se integra a `npm run test:backend`. La suite de 50 escenarios Colombia utiliza interpretación simulada; no equivale a repetir los E2E con DeepSeek real.

Resultado local con Node 24.22.1: `test:backend` completo aprobado; después del ajuste final de asociación por SKU se repitieron exitosamente smoke, la nueva regresión y los 50 escenarios/60 pasos. `test:architecture`: siete contratos aprobados. `git diff --check`: sin errores.

## Datos históricos y prueba posterior

El arreglo evita nuevos casos; no modifica automáticamente la conversación ni el pedido ya confirmado con subtotal cero. Se conservan como evidencia. No se envía una corrección al comprador ni se repite un pedido sin una acción explícita en el flujo de prueba.

Para comprobar en vivo: terminar el pedido de prueba por el flujo habitual y enviar un pedido nuevo, completar pago/datos y confirmar. Verificar que cotización, WhatsApp, fila PostgreSQL, tarea del tendero y proyección Sheets comparten COP 10.000. El despliegue saludable por sí solo no acredita esta repetición E2E.

Base de código: backend `b16aa63`; documentación posterior hasta `11a4f1b`. Worktree: `via-meta-autoservicio-20261103/backend`, no el checkout principal antiguo.

## Publicación verificada

- Commit `0f479eacfdfc650cba2a6f6b22cc9df6534d7000` publicado en `backend/main`.
- Render `dep-dbl49gui0phs738ehio0`: `Deploy succeeded | Live`, 3 de noviembre de 2026 a las 15:33:03 Colombia. Node 24.22.2, PostgreSQL, instancia `r7hhm`.
- Captura local: `docs/evidencias/auditoria-preparacion-20261103/demo-subtotal-corregido-live.png`.
- Pendiente: nueva conversación real posterior al despliegue. No se confundirá la aprobación de contratos locales con una nueva prueba E2E real.
