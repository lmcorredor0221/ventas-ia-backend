# Mercado, expansion y ROI de VIA

**Fecha:** 21 de octubre de 2026  
**Modelo asociado:** [Dashboard estrategico VIA](Dashboard-estrategico-VIA-2026-10-21-mercado-ROI.xlsx)  
**Alcance:** seis planes comerciales, Bogota desde el mes 1 y captacion digital en Medellin, Cali, Bucaramanga y Barranquilla desde el mes 6.

## Decision ejecutiva

El escenario base es economicamente positivo, pero no debe confundirse con una previsión de ventas observada. Con dos vendedores en Bogota, CAC digital de COP 120.000, churn mensual de 5 % y una rampa que no comercializa Escala ni Red durante los primeros seis meses, VIA proyecta **296 tenants activos al mes 12**, **COP 94,6 M** de ingresos acumulados y **COP 44,9 M** de resultado antes de soporte, administracion, desarrollo, impuestos y otros gastos generales.

La inversion comercial modelada es de **COP 31,9 M**: COP 9,2 M de comisiones y COP 22,7 M de CAC digital. El resultado proyectado equivale a un **ROI de 140,6 %** sobre esa inversion. El resultado mensual se vuelve positivo en el mes 3 y el acumulado se recupera en el mes 4. Estos resultados dependen de cobrar y activar las altas en el mes previsto; se deben contrastar contra cohortes reales antes de aumentar el gasto digital.

## Que significan TAM, SAM, SOM y ROI

Se interpreta la expresion "SON" solicitada como **SOM**, *serviceable obtainable market* o mercado obtenible.

| Medida | Definicion en VIA | Resultado del modelo | Uso correcto |
|---|---|---:|---|
| TAM | Todas las tiendas y panaderias medidas en Colombia, sin filtrar adopcion ni capacidad de pago. | 540.233 negocios; COP 485,1 mil M de ARR potencial | Referencia de oportunidad nacional, no pronostico de ventas. |
| SAM | Mercado priorizado para Bogota, Medellin, Cali, Bucaramanga y Barranquilla. Fuera de Bogota es un proxy geografico, no un conteo oficial de tiendas. | 288.418 negocios proxy; COP 259,0 mil M de ARR potencial | Dimensionar la prioridad de expansion y validar luego por ciudad. |
| SOM | Tenants activos alcanzables en el mes 12 con el plan comercial y presupuesto definidos. | 296,1 activos; COP 21,0 M de MRR; COP 251,9 M de ARR anualizado | Meta operativa que se debe medir mensualmente. |
| ROI comercial | Resultado antes de gastos generales dividido entre comisiones y CAC digital invertidos. | 140,6 % acumulado a 12 meses | Evaluar captacion; no representa utilidad neta contable. |

El TAM parte de los **540.233 micronegocios de panaderias y tiendas de barrio** estimados por DANE para 2024. [DANE, EMICRON](https://www.dane.gov.co/index.php/estadisticas-por-tema/mercado-laboral/micronegocios). Para priorizar las ciudades se usa la participacion de valor agregado de micronegocios reportada por DANE en 2025. Esa proporcion no mide cuantas tiendas hay en cada ciudad; por ello el libro la etiqueta como proxy y no como censo. La referencia de 119.982 negocios con potencial de intervencion en Bogota proviene de una estimacion historica de la CCB y debe renovarse antes de comprometer presupuesto masivo. [CCB, potencial de comerciantes](https://bibliotecadigital.ccb.org.co/bitstreams/c378c4ce-f04e-4abd-88f4-06e8407d79a2/download).

## Mezcla de seis planes y rampa comercial

La mezcla no supone que todos los clientes contratan Pro. La hoja `Proyección por plan` contiene la rampa mensual y es la fuente del resultado financiero. `Mercado TAM SAM SOM` conserva la mezcla objetivo estabilizada para el mes 7 en adelante. Ambas son editables en amarillo y deben actualizarse con conversiones reales por plan.

| Plan | Domicilios incluidos | Precio mensual | Mix meses 1-6 | Mix objetivo mes 7+ | Reserva DeepSeek mensual | Comision maxima por alta |
|---|---:|---:|---:|---:|---:|---:|
| Inicio | 100 | COP 29.900 | 30 % | 20 % | COP 1.503 | COP 30.000 |
| Base | 200 | COP 49.900 | 30 % | 25 % | COP 3.005 | COP 50.000 |
| Crecimiento | 300 | COP 69.900 | 25 % | 25 % | COP 4.508 | COP 70.000 |
| Pro | 500 | COP 99.000 | 15 % | 20 % | COP 7.513 | COP 100.000 |
| Escala | 1.000 | COP 169.000 | **0 %** | 8 % | COP 15.026 | COP 170.000 |
| Red | 2.000 | COP 279.000 | **0 %** | 2 % | COP 30.052 | COP 281.000 |
| **Promedio objetivo M7+** | **365** | **COP 74.830** | **100 %** | **100 %** | **COP 5.474** | **COP 75.220** |

La reserva DeepSeek es una cobertura prudencial, no el gasto de la API realizado. Los costos de WhatsApp que paga directamente cada tenant no se reconocen como ingreso ni gasto de VIA. El recaudo de VIA incorpora la tarifa publica de suscripciones de Mercado Pago usada en el modelo: [Mercado Pago Colombia](https://www.mercadopago.com.co/herramientas-para-vender/suscripciones?device=c).

La rampa deja el siguiente resultado anual por plan. Las fracciones representan proyecciones de cohortes; las ventas reales seran tenants enteros y deben reemplazar estas hipotesis cuando se observen.

| Plan | Altas año 1 | Activos mes 12 | Ingresos 12 meses | DeepSeek | Mercado Pago | Comisiones directas |
|---|---:|---:|---:|---:|---:|---:|
| Inicio | 80,0 | 65,5 | COP 10,6 M | COP 0,10 M | COP 0,75 M | COP 1,00 M |
| Base | 93,0 | 77,2 | COP 19,6 M | COP 0,21 M | COP 1,14 M | COP 1,87 M |
| Crecimiento | 88,3 | 74,0 | COP 25,1 M | COP 0,29 M | COP 1,32 M | COP 2,41 M |
| Pro | 65,9 | 56,1 | COP 25,0 M | COP 0,34 M | COP 1,22 M | COP 2,46 M |
| Escala | 20,7 | 18,7 | COP 10,1 M | COP 0,16 M | COP 0,45 M | COP 1,07 M |
| Red | 5,2 | 4,7 | COP 4,2 M | COP 0,08 M | COP 0,18 M | COP 0,44 M |
| **Total** | **353,0** | **296,1** | **COP 94,6 M** | **COP 1,19 M** | **COP 5,07 M** | **COP 9,24 M** |

## Estrategia geografica y SOM anual

Bogota concentra los dos vendedores y su adquisicion digital durante todo el año. Las otras cuatro ciudades no agregan vendedores ni comisiones en este escenario; comienzan campanas digitales ligeras en el mes 6, con volumen relativo segun prioridad geografica.

| Ciudad | Canal | Inicio | Altas digitales del mes 6 al 12 | Activos mes 12 | MRR mes 12 | Nota de mercado |
|---|---|---:|---:|---:|---:|---|
| Bogota | Dos vendedores y digital | Mes 1 | 7, 8, 9, 10, 11, 12, 14 | 207,6 | COP 15,5 M | SAM historico CCB. |
| Medellin A.M. | Solo digital | Mes 6 | 2, 3, 4, 5, 6, 7, 8 | 31,4 | COP 2,3 M | Primer mercado digital fuera de Bogota. |
| Cali A.M. | Solo digital | Mes 6 | 1, 2, 3, 4, 5, 6, 7 | 25,4 | COP 1,9 M | Escala tras validar Medellin. |
| Bucaramanga A.M. | Solo digital | Mes 6 | 1, 1, 2, 3, 4, 4, 5 | 18,1 | COP 1,4 M | Campana liviana y medible. |
| Barranquilla A.M. | Solo digital | Mes 6 | 1, 1, 1, 2, 3, 3, 4 | 13,6 | COP 1,0 M | Campana liviana y medible. |
| **Total** |  |  | **353 altas anuales** | **296,1** | **COP 21,0 M** | SOM año 1; MRR calculado desde cohortes por plan. |

La entrada simultanea en el mes 6 no significa aumentar el gasto sin control. Se debe liberar cada ciudad por cohortes: medir leads, suscripciones pagadas, activacion completa, CAC, churn a 30 dias y calidad del onboarding. Si una ciudad excede COP 120.000 de CAC o supera 5 % de churn mensual, se pausa la siguiente cohorte antes de ampliar la campaña.

## Resultado financiero y ROI de la expansion

| Concepto 12 meses | COP | Responsable o naturaleza |
|---|---:|---|
| Ingresos por suscripcion | 94.633.567 | VIA |
| Comisiones de ventas Bogota | (9.242.423) | VIA, condicionadas a cobro y permanencia |
| CAC digital | (22.680.000) | VIA |
| DeepSeek proyectado | (1.193.911) | VIA |
| Mercado Pago | (5.070.615) | VIA |
| Infraestructura escalonada | (7.029.000) | VIA |
| Provision operativa de 10 % | (4.521.595) | VIA |
| **Resultado antes de gastos generales** | **44.896.022** | No es utilidad neta contable |
| Inversion de adquisicion | **31.922.423** | Comisiones mas CAC digital |
| **ROI comercial** | **140,6 %** | Resultado / inversion de adquisicion |

Los costos variables estan vinculados al modelo financiero consolidado: uso esperado y reserva DeepSeek, recaudo, infraestructura por tramo y provision de 10 %. Soporte humano, marketing no atribuido, administracion, desarrollo, impuestos, devoluciones y costos de atencion al cliente no estan incluidos, por lo que el resultado presentado es una contribucion operativa y no una utilidad neta.

## Diferencia frente al caso de negocio inicial

El caso de negocio de 15 de octubre mantiene valor como fuente de altas, CAC y churn, pero no es el modelo financiero vigente. Sus resultados usaban COP 89.000 como precio unico, COP 19.000 como costo tecnico por cliente y expansion nacional escalonada desde el mes 7. El nuevo modelo usa los seis planes, una rampa que excluye Escala y Red durante los meses 1 a 6, costos tecnicos calculados desde telemetria y reservas, provision de 10 %, y expansion digital a las cuatro ciudades desde el mes 6.

Esto explica que no sea correcto comparar directamente los COP 61,4 M del escenario historico con los COP 44,9 M de este escenario: cambian precio promedio, mezcla, costos, estructura de comisiones y calendario geografico. El libro conserva las hipotesis editables para analizar ambos casos sin reescribir la logica.

## Recomendacion operativa

1. Mantener los dos vendedores solo en Bogota durante el primer año y tratar las demas ciudades como experimentos digitales con presupuesto por cohorte.
2. Aprobar mas inversion digital por ciudad solo si se cumplen activacion completa, CAC menor o igual a COP 120.000, churn mensual menor o igual a 5 % y contribucion positiva despues de costos variables.
3. Medir la mezcla real de planes desde el primer cobro. Un desplazamiento hacia Inicio reduce ARPU; uno hacia Escala o Red puede adelantar infraestructura y consumo DeepSeek.
4. Separar en el tablero el ROI comercial de la rentabilidad de la empresa. Para esta ultima faltan gastos de soporte, administracion, desarrollo, impuestos y marketing no atribuible.
5. Renovar el SAM con conteos de tiendas o padrones comerciales por ciudad antes de convertir esta proyeccion en un presupuesto de ventas comprometido.

## Como usar el dashboard

- `Dashboard`: resumen de capacidad, finanzas, mercado y ROI.
- `Mercado TAM SAM SOM`: cambia la mezcla objetivo desde el mes 7 y consulta TAM, SAM, SOM y dos graficos de mix y precio.
- `Proyección por plan`: detalla altas, activos, ingresos, DeepSeek, recaudo y comisiones para cada plan. Controla que Escala y Red sean cero en los primeros seis meses y aporta dos graficos por plan.
- `ROI y expansion`: ajusta CAC, churn y altas mensuales; toma ingresos y costos desde las cohortes por plan, y muestra dos graficos de clientes activos por ciudad e ingresos frente a resultado mensual.
- `Planes`, `Comisiones`, `Modelo consolidado`, `Infraestructura` y `Capacidad`: sostienen la economia unitaria, las comisiones y los tramos de costo.

Las celdas amarillas son entradas editables. Las formulas fueron recalculadas en Excel y validadas sin errores de formula.
