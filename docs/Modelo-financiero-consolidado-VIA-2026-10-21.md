# Modelo financiero consolidado de VIA

**Fecha:** 21 de octubre de 2026  
**Libro canónico:** [Dashboard-financiero-VIA-2026-10-21-consolidado.xlsx](Dashboard-financiero-VIA-2026-10-21-consolidado.xlsx)

## Decisión de modelado

El libro conserva los seis planes comerciales existentes. El caso de negocio contiene proyecciones de altas y clientes activos, pero no una distribución de clientes por plan. Por eso el modelo incorpora una **mezcla comercial editable**; su estado inicial es 100 % plan Pro para respetar el precio vigente de referencia de COP 99.000, sin eliminar los demás planes.

| Plan | Domicilios incluidos | Precio mensual VIA | Reserva DeepSeek mensual |
|---|---:|---:|---:|
| Inicio | 100 | COP 29.900 | COP 273 |
| Base | 200 | COP 49.900 | COP 545 |
| Crecimiento | 300 | COP 69.900 | COP 818 |
| Pro | 500 | COP 99.000 | COP 1.363 |
| Escala | 1.000 | COP 169.000 | COP 2.726 |
| Red | 2.000 | COP 279.000 | COP 5.451 |

La celda de mix de cada plan está en amarillo y debe sumar 100 %. Al modificarla, el libro vuelve a calcular el precio medio por tenant, cupo medio de domicilios, DeepSeek, recaudo, infraestructura y los dos escenarios comerciales.

## Corrección de las referencias históricas

- **COP 89.000:** es el precio que usó el caso de negocio del 15 de octubre. No es la referencia comercial vigente en el modelo consolidado; el plan Pro parte de **COP 99.000**.
- **COP 19.000 por activo/mes:** fue una estimación histórica conjunta de infraestructura, DeepSeek y recaudo. No se usa como costo técnico actual.
- El modelo lo conserva únicamente como una entrada de separación: resta esa porción de los egresos históricos para recuperar el componente comercial, CAC y otros costos del caso original. Después agrega los costos técnicos actuales por separado. Así se evita duplicar costos.

## Costos y responsables

| Concepto | Quién lo asume | Tratamiento en el modelo |
|---|---|---|
| DeepSeek | VIA | Reserva operativa basada en telemetría E2E y el plan de domicilios. |
| Mercado Pago | VIA | 3,29 % + COP 800, más IVA sobre la comisión, por pago exitoso. Debe conciliase contra la liquidación real. |
| Render, Supabase y Vercel | VIA | Presupuesto compartido por tramo de capacidad. |
| Provisión | VIA | 10 % adicional sobre costos antes de provisión. |
| Meta / WhatsApp Business | Tenant | Pago directo. Se presenta como referencia, pero no se incorpora como ingreso ni costo de VIA. |
| Impuestos, soporte y administración | VIA | Excluidos del resultado porque aún no tienen una base verificable. |

La tarifa de Mercado Pago es una referencia pública para suscripciones en Colombia y no sustituye la liquidación contractual de la cuenta del comercio. El uso productivo de Mercado Pago aún debe conciliarse con los cobros realmente abonados.

## Resultado con la mezcla inicial: 100 % Pro

Las proyecciones de clientes activos y gastos históricos se mantienen como fuente del caso de negocio. Solo se reexpresan ingresos y costos técnicos con el precio de COP 99.000, los costos actuales calculados y la provisión.

| Escenario de 12 meses | Ingresos por suscripción | Costos antes de provisión | Provisión 10 % | Resultado antes de gastos generales e impuestos | Margen |
|---|---:|---:|---:|---:|---:|
| Bogotá | COP 114.414.300 | COP 32.571.913 | COP 3.257.191 | **COP 78.585.196** | **68,7 %** |
| Nacional escalonado | COP 129.105.900 | COP 41.723.528 | COP 4.172.353 | **COP 83.210.019** | **64,5 %** |

Estos resultados no son utilidad neta. Aún faltan impuestos, soporte, administración, devoluciones, morosidad, costes legales y cualquier costo comercial que no estuviera recogido por la separación del presupuesto histórico.

## Infraestructura y escalamiento

La infraestructura se toma del escenario de capacidad documentado y se escoge según los tenants equivalentes al plan Pro de 500 domicilios. Si el mix migra hacia Escala o Red, el equivalente sube y el modelo adelanta el siguiente tramo de infraestructura. El modelo no interpreta esa capacidad como garantía: debe contrastarse con pruebas de carga y métricas del proyecto Supabase real antes de superar el piloto.

## Uso operativo del libro

1. En `Modelo consolidado`, cambie únicamente las celdas amarillas: provisión, recaudo, separación histórica, mix, clientes activos y gastos históricos si hay nueva evidencia.
2. Revise que `Mix válido` indique 100 %.
3. Consulte `Planes` para comparar contribución por plan después de DeepSeek y Mercado Pago.
4. Consulte `Consolidado VIA` para escenarios de 10 a 1.000 tenants, con infraestructura y provisión.
5. Consulte `Dashboard` para el resumen ejecutivo.

## Fuentes y límites

- El consumo DeepSeek procede de la corrida E2E de 40 casos y de [Informe-financiero-costos-y-rentabilidad-VIA-2026-10-21.md](Informe-financiero-costos-y-rentabilidad-VIA-2026-10-21.md).
- Los tramos de infraestructura proceden de [Informe-capacidad-y-costos-infraestructura-VIA-2026-10-21.md](Informe-capacidad-y-costos-infraestructura-VIA-2026-10-21.md).
- Las altas y clientes activos proceden de [Caso-de-negocio-Ventas-IA.md](Caso-de-negocio-Ventas-IA.md), no de ventas cobradas observadas.
- Las tarifas públicas de recaudo deben validarse contra la liquidación de Mercado Pago antes de usarlas para caja o facturación contractual.
- La mezcla real de planes todavía no existe en la proyección comercial. El supuesto inicial 100 % Pro es intencional y editable, no una predicción de ventas.
