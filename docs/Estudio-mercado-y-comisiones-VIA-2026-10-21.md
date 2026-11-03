# Estudio de mercado, planes y comisiones de VIA

**Fecha:** 21 de octubre de 2026  
**Modelo ejecutable:** [Dashboard-financiero-VIA-2026-10-21-mercado-y-comisiones.xlsx](Dashboard-financiero-VIA-2026-10-21-mercado-y-comisiones.xlsx)

## Resumen ejecutivo

VIA se dirige a un mercado amplio, pero sensible a precio, facilidad de activación y resultado inmediato. DANE estimó **540.233 micronegocios de panaderías y tiendas de barrio en Colombia en 2024**; el 88,4 % de sus propietarios trabajaba por cuenta propia. La oferta debe reducir trabajo operativo, no exigir conocimiento técnico. [DANE — EMICRON](https://www.dane.gov.co/index.php/estadisticas-por-tema/mercado-laboral/micronegocios)

WhatsApp es el canal correcto para el primer segmento: el 94 % de las empresas reportó usar WhatsApp o WhatsApp Business en 2025 y la adopción entre empresas pequeñas fue 95 %. [Postdata — Informe empresarial 2025](https://www.postdata.gov.co/sites/default/files/story/Informe_EMPRESARIAL_v3.pdf)

El esquema propuesto de comisión es viable como adquisición variable si se condiciona a cobro acreditado, suscripción activa y onboarding terminado. No debe evaluarse como “pago por lead” ni como garantía de ingreso para el vendedor.

## Oferta comercial de seis planes

| Plan | Domicilios incluidos | Precio mensual VIA | Comisión M1 | Comisión M2 | Comisión M3-M5 | Máximo por cliente |
|---|---:|---:|---:|---:|---:|---:|
| Inicio | 100 | COP 29.900 | COP 15.000 | COP 6.000 | COP 3.000 | COP 30.000 |
| Base | 200 | COP 49.900 | COP 25.000 | COP 10.000 | COP 5.000 | COP 50.000 |
| Crecimiento | 300 | COP 69.900 | COP 35.000 | COP 14.000 | COP 7.000 | COP 70.000 |
| Pro | 500 | COP 99.000 | COP 50.000 | COP 20.000 | COP 10.000 | COP 100.000 |
| Escala | 1.000 | COP 169.000 | COP 85.000 | COP 34.000 | COP 17.000 | COP 170.000 |
| Red | 2.000 | COP 279.000 | COP 141.000 | COP 56.000 | COP 28.000 | COP 281.000 |

La adaptación es proporcional al precio del plan Pro y se redondea a COP 1.000. Así se conserva el incentivo económico sin conceder al plan Inicio el mismo CAC que al Pro.

## Política de comisión

1. **Mes 1:** se liquida cuando el primer cobro está acreditado, el tenant está al día y completó la activación acordada.
2. **Meses 2 a 5:** se liquidan después de cada renovación exitosa, únicamente si el tenant permanece activo y sin saldo vencido.
3. **Cancelación, devolución, contracargo o mora:** suspenden cualquier tramo pendiente. Si la venta fue anulada antes de que el pago sea definitivo, no se causa el primer tramo.
4. **Tope:** no existe comisión después del quinto mes para esa adquisición.
5. **Trazabilidad:** el CRM debe guardar vendedor, tenant, plan adquirido, fecha de pago, estado de onboarding, renovación, motivo de baja y comisión causada/pagada.

El contrato laboral, comercial y tributario del canal debe revisarse con asesoría local antes de operar el esquema. El modelo no presupone relación laboral ni sustituye esa revisión.

## CAC y margen por cohorte

Con churn mensual de 5 %, un cliente Pro tiene una comisión máxima de COP 100.000, pero una comisión esperada de **COP 94.744** durante sus primeros cinco meses: los tramos futuros no se pagan si deja de estar activo. El ingreso esperado de esos cinco meses es COP 447.914 y el de doce meses COP 910.087.

| Métrica Pro | Valor |
|---|---:|
| Comisión máxima | COP 100.000 |
| Comisión esperada a 5 meses, con 5 % churn | COP 94.744 |
| Comisión / ingreso esperado de 5 meses | 21,2 % |
| Comisión / ingreso esperado de 12 meses | 10,4 % |
| Contribución esperada de 5 meses antes de infraestructura compartida | COP 325.160 |

El CAC de vendedores es la **comisión causada por alta pagada**, no el total de inversión comercial. Para el costo de adquisición completo aún deben sumarse herramientas, gestión del vendedor, marketing, demos, onboarding humano y costo de oportunidad.

## Proyección por productividad de vendedor

El modelo usa el mix inicial de 100 % Pro, el costo operativo real modelado de DeepSeek, Mercado Pago, infraestructura escalonada y provisión de 10 %. No incluye marketing, soporte, administración, impuestos, devoluciones ni nómina fija.

| Escenario | Vendedores | Altas pagadas por vendedor/mes | Altas anuales | Activos mes 12 | Ingresos 12m | Comisiones 12m | Resultado 12m antes de gastos generales |
|---|---:|---:|---:|---:|---:|---:|---:|
| Piloto | 1 | 3 | 36 | 27,6 | COP 19,4 M | COP 3,1 M | **COP 10,5 M** |
| Base | 2 | 6 | 144 | 110,3 | COP 77,6 M | COP 12,5 M | **COP 52,9 M** |
| Escala | 2 | 10 | 240 | 183,9 | COP 129,4 M | COP 20,8 M | **COP 90,2 M** |

El escenario Piloto es mensual positivo desde el mes 3 y recupera el acumulado en el mes 4. Base y Escala son positivos desde el primer mes bajo estas hipótesis. La causa no es un costo fijo bajo de adquisición: es que se asume cobro y activación efectivos desde el primer mes. Si la activación o el recaudo se retrasa, la caja real será peor.

## Punto de equilibrio comercial

En el plan Pro y con el primer tramo de comisión, el primer mes necesita aproximadamente **10 altas pagadas** para cubrir el tramo mínimo de infraestructura y la provisión de 10 %. Eso equivale a:

- Un vendedor: alrededor de 10 altas Pro pagadas al mes.
- Dos vendedores: alrededor de 5 altas Pro pagadas al mes por vendedor.

El escenario Base fija una meta de seis altas pagadas por vendedor al mes. Es una cuota útil para el piloto porque supera ese mínimo sin exigir el ritmo de Escala antes de medir conversión, activación y churn.

## Viabilidad y competitividad del incentivo

El esquema es atractivo por su **pago temprano**: COP 50.000 cuando un Pro se convierte realmente en cliente pagado, con continuidad de COP 20.000 y COP 10.000. Para VIA es sostenible solo bajo tres condiciones:

1. La tasa de churn debe permanecer cerca o debajo del 5 % mensual.
2. El vendedor debe vender clientes que completen catálogo, Google y WhatsApp, no suscripciones que se cancelan tras el primer mes.
3. La comisión debe calcularse desde eventos de facturación y estado del tenant, nunca desde capturas manuales de ventas.

No hay aún una fuente comparable y verificable sobre comisiones de vendedores de SaaS para tenderos colombianos. Por eso no se afirma que sea una comisión “de mercado”. Se propone un piloto de 90 días y revisión al cierre de las cohortes de 30, 60 y 90 días.

## Recomendación

1. Lanzar el piloto con **dos vendedores y meta Base**: seis altas pagadas por vendedor al mes.
2. Usar el esquema proporcional de la tabla, con Pro como referencia contractual de COP 50.000, COP 20.000 y COP 10.000.
3. Pagar el primer tramo después de pago confirmado y activación; pagar continuidad contra cada renovación efectivamente cobrada.
4. Medir semanalmente altas pagadas, activadas, renovadas, churn, comisión causada, CAC completo y margen por cohorte.
5. Recalibrar el ratio proporcional o los tramos de los planes Inicio y Red si la mezcla real se desvía del 100 % Pro que usa el modelo inicial.

## Fuentes y límites

- Mercado Pago publica para suscripciones en Colombia 3,29 % + COP 800 + IVA al recibir el dinero al instante. El libro lo trata como costo de VIA hasta que la liquidación real demuestre una tarifa distinta. [Mercado Pago — Suscripciones](https://www.mercadopago.com.co/herramientas-para-vender/suscripciones?device=c)
- Los costos de DeepSeek e infraestructura proceden del modelo financiero y la telemetría E2E, no de un promedio de mercado. [Modelo financiero consolidado](Modelo-financiero-consolidado-VIA-2026-10-21.md)
- La mezcla por plan, la cuota comercial, el churn y los escenarios son supuestos editables, no resultados ya observados.
