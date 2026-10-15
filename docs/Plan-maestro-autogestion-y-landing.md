# Plan maestro de autoservicio y landing de Ventas IA

Actualizado: 2026-10-15.

## 1. Proposito y regla de verdad

Este plan une la promesa comercial, el recorrido de autoservicio y el estado comprobable del repositorio. Su objetivo es que una tienda no tecnica pueda conocer el producto, activar una prueba, conectar sus propios servicios de Google y WhatsApp, y empezar a operar sin depender de asistencia tecnica.

No es un redisenio del agente ni una reescritura de la aplicacion. Ordena los cambios necesarios para que lo ya construido sea coherente, verificable y publicable.

Precedencia de decisiones:

1. Este documento define el objetivo integrado y los criterios de salida.
2. `docs/Decisiones-landing-y-prueba-gratuita.md` conserva las respuestas de producto que dieron origen a la landing.
3. `docs/Decisiones-Mercado-Pago-SaaS.md` define el ciclo de suscripcion y las reglas de cobro.
4. `docs/Calculo-consumo-conversacional-landing.md` conserva los calculos y su evidencia.
5. `docs/Seguimiento-consolidado-planes-vigentes.md` lleva el estado transversal de ejecucion.
6. `docs/Brief-comercial-microapp-Ventas-IA.md` sirve como insumo de posicionamiento, no como fuente de limites tecnicos.

Las cifras historicas de 1.000 domicilios y 5.000 interacciones no se pueden usar en la landing ni en un checkout nuevo.

## 2. Resultado esperado

Al cerrar este plan debe existir una experiencia completa y honesta:

1. Una persona entiende en menos de un minuto que Ventas IA atiende pedidos que llegan por WhatsApp, ordena la solicitud con los datos de su tienda y llama al tendero cuando hace falta criterio humano.
2. Puede iniciar una prueba de siete dias cuando el administrador la habilite, sin registrar tarjeta por adelantado.
3. En la prueba crea su tienda, entra con Google, autoriza Drive y Sheets, recibe una copia editable de la plantilla maestra y carga o revisa su catalogo.
4. Puede configurar WhatsApp Business Platform por tenant o seguir una guia clara si todavia no tiene los requisitos de Meta.
5. Al terminar la prueba se solicita la suscripcion mensual; la operacion no se presenta como activa por un pago no confirmado.
6. El administrador de plataforma controla planes, Mercado Pago, DeepSeek, observabilidad y seguridad sin acceder como si fuera el dueño de la tienda.
7. La promesa comercial, el checkout, los limites del backend y los tableros muestran exactamente el mismo plan.

## 3. Decisiones de producto consolidadas

| Tema | Decision vigente | Implicacion concreta |
| --- | --- | --- |
| Publico | Tiendas de barrio, minimercados, panaderias, restaurantes y distribuidores pequenos | Lenguaje cotidiano, no tecnico |
| Plan inicial | Un plan Basico activo inicialmente; la plataforma puede crear otros y activarlos o desactivarlos | La arquitectura de planes se conserva |
| Precio | COP 89.000 mensuales | Mercado Pago cobra la suscripcion del SaaS |
| Promesa | Hasta 400 domicilios por ciclo mensual | Es el limite comercial que debe verse en todos los canales |
| Prueba | Siete dias, administrable y desactivada por defecto en configuracion | Para una campana publica, el administrador debe habilitarla explicitamente antes de publicar el CTA |
| Cobro tras prueba | Al finalizar se solicita suscripcion; no hay cobro automatico sin autorizacion | El acceso cambia segun el estado confirmado por Mercado Pago |
| Motor IA | DeepSeek global, administrado por la plataforma | El tenant no aporta ni ve una clave del modelo |
| Costo IA objetivo | Cerca de USD 3 mensuales por tenant en el escenario de 400 domicilios | Es un presupuesto interno, no una cuota comercial expuesta |
| WhatsApp/Meta | Conexion, numero y costo por tenant; Meta cobra directamente al cliente | La plataforma no revende ni absorbe ese cobro |
| Meta sin costo | La referencia de aproximadamente 1.000 mensajes de servicio puede cubrir cerca de 200 domicilios segun la muestra estudiada | Se muestra como estimacion condicionada a las reglas vigentes de Meta, nunca como garantia |
| Cambio de plan | Upgrade inmediato; downgrade en el siguiente ciclo; sin devoluciones | Se conserva la politica de Mercado Pago |
| Excedentes | No se cobran excedentes automaticamente en la primera version | Se ofrece upgrade o excepcion administrativa auditada |
| Administrador | `lmcorredor@gmail.com` es administrador de plataforma | Acceso separado de owner de una tienda |

## 4. Diagnostico cruzado: documento frente a repositorio

La siguiente tabla no declara como terminado aquello que solo funciona con datos de prueba o contrato local.

| Frente | Evidencia actual en el repositorio | Estado real | GAP para el objetivo |
| --- | --- | --- | --- |
| Plan y limites | `server/services/billingService.js`, `usageService.js`, `saasControlPlane.js`, `src/App.jsx` y smoke tests conservan `ventas_ia_1000_domicilios`, 1.000 domicilios y 5.000 interacciones | Desalineado | Migrar el plan por defecto, datos existentes, textos, UI y pruebas a 400 domicilios |
| Control de costo IA | `recordLlmPlan` ya cuenta llamadas y tokens por tenant; el runner real ya exporta `usageTotals` y trazas | Parcial | No existe presupuesto ejecutable de llamadas/costo ni reporte legible por conversacion |
| Alertas de capacidad | `usageService.js` usa 80%, 90% y 100% | Parcial | Cambiar a 70%, 85% y 100%, y definir accion visible para cada umbral |
| Catalogo del tenant | `ToolRegistry` consulta Sheets vivo cuando hay OAuth live, pero escribe y reutiliza `productsByTenant`; `llmPlanner` usa ese arreglo como pista y fallback | Desalineado con la decision | Google Sheets debe ser fuente operativa; no se puede continuar un pedido con catalogo local desactualizado |
| Cliente y pedidos | Se leen y escriben Sheets live, pero tambien se mantienen copias locales para operacion y auditoria | Parcial | Delimitar que copia es auditoria/estado tecnico y cual es la fuente de verdad; validar reconciliacion |
| Trial | El estado `trial` habilita Google y WhatsApp en `SaasControlPlane` | Base correcta | `createTenant` inicia siempre en `pending_payment`; falta crear el trial automaticamente solo cuando el plan lo tenga habilitado |
| Google | OAuth, refresh token cifrado, provision de Drive/Sheets y rutas live existen; se probaron localmente con una cuenta real | Avanzado local | Probar alta desde cuenta nueva, errores, reconexion y URL publica |
| WhatsApp | Binding por `phoneNumberId`, envio Graph y Embedded Signup por tenant existen como flujo/contrato | Parcial | Completar prueba real de Meta y webhook publico; mejorar textos de prerequisitos y estados |
| Mercado Pago | Checkout de preapproval, webhook firmado, estados, gracia, cambios de plan y UI base existen | Parcial local | Validar suscripcion recurrente y webhook real en sandbox/produccion con URL HTTPS |
| Landing | El frontend es una SPA operativa con `activeView`; no existe una ruta publica o componente de landing | Pendiente | Construir landing aislada de la consola, con CTA, calculadora y conversion a alta |
| Onboarding | Vista guiada, OAuth y provision existen | Parcial | Convertirlo en una secuencia de autoservicio que no revele referencias tecnicas ni requiera interpretarlas |
| Observabilidad | Eventos, auditoria, uso por tenant y panel admin existen | Parcial | Separar claramente datos de seguridad solo para admin, costo IA y consumo comercial para cada rol |

## 5. Arquitectura objetivo y limites de responsabilidad

### 5.1 Separacion por tenant

Cada tienda debe tener, como minimo, un `tenantId` distinto para sus datos, configuracion y eventos. Ninguna consulta de catalogo, cliente, pedido, numero de WhatsApp, suscripcion o auditoria puede cruzar ese limite.

| Recurso | Propietario | Fuente de verdad | Acceso de plataforma |
| --- | --- | --- | --- |
| Cuenta y sesion | Plataforma | Base de datos de la plataforma | Autenticacion y roles |
| Perfil de tienda y plan | Plataforma | Base de datos de la plataforma | Owner y administrador segun rol |
| Catalogo, clientes y pedidos operativos | Tenant | Google Sheets del tenant aprovisionado desde plantilla maestra | OAuth delegado, solo dentro de su tenant |
| Archivos operativos | Tenant | Google Drive del tenant | OAuth delegado, solo dentro de su tenant |
| Cuenta, WABA y numero WhatsApp | Tenant | Meta/WhatsApp del tenant | La aplicacion global de Meta solo facilita Embedded Signup y webhooks |
| Cobro de Ventas IA | Plataforma | Mercado Pago y base de facturacion de la plataforma | Owner ve su estado; admin opera todos |
| Cobro de mensajes Meta | Tenant | Meta o proveedor del tenant | Solo se informa y se estima; no se factura desde Ventas IA |
| DeepSeek | Plataforma | Configuracion global y vault de plataforma | No se expone al tenant; uso se atribuye por tenant |

La aplicacion global de Meta no comparte cuentas ni mensajes entre tiendas: es la infraestructura que permite a cada tenant autorizar su propio recurso. La App Review, los permisos y el webhook general pertenecen a la plataforma; el WABA, `phoneNumberId` y token de cada tienda pertenecen a cada tenant.

### 5.2 Politica de datos Google

La plantilla maestra pertenece a la plataforma. Durante el onboarding se crea una copia en el Google del tenant, y esa copia es la que el tenant modifica.

Para produccion se adopta esta regla:

1. El catalogo usado para cotizar o confirmar se lee de la hoja `Catalogo` del tenant.
2. No se usa `productsByTenant` ni otra copia persistente como respuesta de disponibilidad cuando Google no responda.
3. Se permite cache transitorio de una lectura exitosa solo para rendimiento tecnico, con `tenantId`, fecha de lectura y vencimiento corto; nunca puede confirmar stock, precio o un pedido si Drive/Sheets esta caido.
4. Si la lectura live falla, esta vencida o no hay OAuth valido, el agente explica que necesita validacion de la tienda y crea una decision humana. El caso se marca en la bandeja y auditoria.
5. Los datos locales de producto solo sobreviven como fixtures de pruebas o registros de auditoria claramente etiquetados; no como espejo operativo.

La misma separacion debe aplicarse gradualmente a clientes y pedidos: Google conserva el dato operativo del negocio; la plataforma mantiene identificadores, estado de ejecucion y trazabilidad necesarios para el SaaS.

## 6. Capacidad, costo y mensaje comercial

### 6.1 Definiciones que no se deben mezclar

| Concepto | Definicion | Visibilidad |
| --- | --- | --- |
| Domicilio | Pedido confirmado que pasa a preparacion o entrega humana | Promesa comercial y tableros del tenant |
| Mensaje Meta | Mensaje sujeto a las reglas de cobro de Meta | Calculadora explicativa; Meta cobra al tenant |
| Llamada IA | Una ejecucion del planner para entender un mensaje o continuar un caso | Control interno y admin |
| Token | Unidad de consumo de DeepSeek | Solo control interno y administracion |
| Interaccion tecnica | Contador actual por mensaje entrante procesado por el agente | No debe ser la promesa comercial |

### 6.2 Base de calculo vigente

La evidencia del chat SuperMarket agrupada en pedidos arroja aproximadamente 7,11 mensajes entrantes y 4,89 mensajes salientes por pedido. Con una llamada del agente por mensaje entrante, 400 domicilios equivalen a unas 2.844 llamadas. El objetivo de costo de 2.700 llamadas requiere reducir aproximadamente 5,1% de llamadas o de tokens por llamada antes de convertirlo en una garantia interna.

Por tanto:

- **La oferta publica es:** hasta 400 domicilios al mes por COP 89.000.
- **La estimacion Meta es:** el saldo gratuito puede cubrir alrededor de 200 domicilios, segun el tipo de conversacion, los mensajes enviados y las politicas vigentes de Meta. Despues Meta puede cobrar directamente al tenant.
- **El objetivo interno IA es:** no superar aproximadamente USD 3 por tenant/mes en el escenario definido. No se muestra como token, llamada o cupo en la landing.
- **El valor 5.000:** no puede seguir apareciendo como capacidad incluida al cliente. Solo podra permanecer como fusible tecnico interno si las mediciones reales demuestran que no contradice el presupuesto y se documenta que ocurre al alcanzarlo.

### 6.3 Limites y comportamiento requerido

| Umbral | Domicilios | Control interno IA | Experiencia del tenant |
| --- | --- | --- | --- |
| 70% | Aviso preventivo | Alerta al administrador | Ve consumo simple y recomendacion de revisar el mes |
| 85% | Aviso prioritario | Revision de eficiencia/costo | Ve que se acerca al limite y puede consultar plan |
| 100% | No se confirman nuevos domicilios por agente | Se abre incidente o escalamiento interno segun presupuesto | Conversaciones basicas siguen disponibles; se ofrece upgrade o excepcion auditada |

No se bloquea la operacion por superar una estimacion de mensajes gratuitos de Meta. Es un cargo y una relacion contractual entre Meta y el tenant.

## 7. Recorrido de autoservicio objetivo

| Etapa | Que hace el usuario | Que hace el sistema | Salida comprobable |
| --- | --- | --- | --- |
| 1. Landing | Lee que resuelve, para quien es, limites y precio | Muestra calculadora orientativa y CTA | Entiende que no capta clientes ni reemplaza al tendero |
| 2. Registro | Inicia sesion con Google y nombra su tienda | Crea tenant, rol owner y evento de embudo | No hay acceso cruzado entre tiendas |
| 3. Prueba | Activa siete dias cuando la politica esta habilitada | Crea suscripcion `trial` con fecha de fin y sin checkout | Puede continuar a Google sin pago anticipado |
| 4. Google | Autoriza la cuenta donde quiere guardar sus datos | Solicita scopes minimos, guarda refresh token cifrado y explica el proposito | Cuenta conectada o error accionable |
| 5. Estructura | Pide crear la estructura de la tienda | Copia plantilla maestra y crea carpeta/Sheets con Catalogo, Clientes, Pedidos y Configuracion | Enlaces claros para abrir y editar su copia |
| 6. Catalogo | Carga CSV o completa la hoja | Importa a su `Catalogo`, valida columnas, precios y stock | Catalogo apto o lista corta de correcciones |
| 7. WhatsApp | Declara si ya tiene Cloud API, usa Business App o empieza de cero | Abre Embedded Signup cuando procede o muestra guia por pasos | Binding verificado por tenant o estado pendiente explicito |
| 8. Prueba operativa | Simula un pedido con su catalogo | Lee su Sheet y muestra que entendio, que pregunto y cuando escalo | No se envia mensaje real sin conexion/consentimiento |
| 9. Activacion | Contrata al terminar trial o desde el flujo de pago | Mercado Pago confirma, activa ciclo y conserva avances | Estado `active` y checklist completo |

Regla UX: el tenant ve instrucciones y resultados, no IDs de hoja, referencias de secretos, nombres de variables ni estados de proveedor sin traducir. Los detalles tecnicos permanecen en Configuracion avanzada y solo cuando el owner los necesite.

## 8. Plan de ejecucion

### Fase 0. Cerrar decisiones operativas

| ID | Trabajo | Responsable | Criterio de cierre |
| --- | --- | --- | --- |
| M0-01 | Confirmar activacion publica del trial de siete dias antes de abrir el CTA | Administrador de plataforma | Plan Basico habilitado para trial en produccion; en entornos internos permanece desactivado si se requiere |
| M0-02 | Aprobar que 2.700 llamadas es presupuesto interno y no limite mostrado al cliente | Producto y administrador | Copy, plan y UI eliminan el termino como beneficio comercial |
| M0-03 | Aprobar politica de cache: sin fallback operativo a catalogo local y escalamiento humano si Google falla | Producto y arquitectura | Caso de error documentado y aceptado |
| M0-04 | Definir fuente oficial y fecha de revision de la estimacion gratuita de Meta | Producto | Calculadora muestra nota de vigencia y enlace a fuente primaria |

### Fase 1. Alinear plan, facturacion y consumo

| ID | Cambio concreto | Archivos/areas afectadas | Prueba de cierre |
| --- | --- | --- | --- |
| M1-01 | Crear o migrar el plan por defecto a `ventas_ia_400_domicilios`; COP 89.000; 400 domicilios | `billingService`, `saasControlPlane`, semillas, migracion y UI | Tenant nuevo y tenant migrado muestran el mismo plan |
| M1-02 | Retirar 1.000/5.000 de copy, fallbacks de UI y smoke tests | `usageService`, `App.jsx`, etiquetas, fixtures y tests | Busqueda de repo sin mensaje comercial heredado |
| M1-03 | Separar `deliveries`, `agent_interactions`, `llm_calls`, tokens y costo estimado | modelo de uso, panel admin y APIs | Admin ve serie por tenant/ciclo; owner no ve jerga innecesaria |
| M1-04 | Implementar presupuesto interno configurable de IA con accion definida | configuracion global, auditoria y alertas | Umbrales 70/85/100 generan eventos una sola vez y accionan el flujo definido |
| M1-05 | Ajustar trial en `createTenant` cuando el plan este habilitado | control plane, billing y pruebas | Registro crea `trial`, fecha de fin y permite Google/WhatsApp |
| M1-06 | Actualizar checkout, upgrade, downgrade, gracia, cancelacion y reactivacion con el nuevo plan | billing, Mercado Pago, owner/admin UI | Pruebas locales y sandbox cubren todos los estados |

### Fase 2. Hacer que Google sea la fuente operativa

| ID | Cambio concreto | Riesgo que elimina | Prueba de cierre |
| --- | --- | --- | --- |
| M2-01 | Cambiar `google_sheets_read_table` para devolver fallo controlado, no `local_mirror`, cuando no exista contexto Google live | Cotizar con stock/precio desactualizado | Caida simulada de Google termina en decision humana |
| M2-02 | Eliminar `productsByTenant` del camino productivo de `llmPlanner` y runtime | Inferencia anclada a datos locales viejos | Planner conserva termino crudo e invoca herramienta live |
| M2-03 | Mantener fixtures de producto solo en pruebas aisladas | Contaminacion de tenants reales | Tests no modifican store de produccion |
| M2-04 | Disenar cache transitorio opcional con TTL, tenant y revision | Latencia sin perder veracidad | Cache vencido nunca confirma disponibilidad |
| M2-05 | Registrar estado de sincronizacion y dos fallos consecutivos solo para admin | Fallas silenciosas | Admin ve incidente; tenant recibe instruccion simple |
| M2-06 | Ejecutar sincronizacion al entrar el owner y cada cuatro horas en segundo plano, sin bloquear la interfaz | Catalogo no actualizado | Auditoria muestra inicio, resultado y fallo si aplica |

### Fase 3. Cerrar onboarding autoservicio

| ID | Cambio concreto | Criterio de cierre |
| --- | --- | --- |
| M3-01 | Redactar cada paso de Google en lenguaje de negocio: conectar, crear estructura, revisar catalogo, corregir | Un usuario entiende que su informacion queda en su Google |
| M3-02 | Exponer boton para abrir la hoja, importar CSV y ver validaciones de Catalogo | Catalogo apto sin soporte tecnico |
| M3-03 | Mantener una sola plantilla maestra y crear una copia por tenant | Ningun tenant modifica la plantilla base |
| M3-04 | Mostrar rutas de WhatsApp segun la situacion real del tenant y prerequisitos de Meta | No se promete activacion inmediata cuando depende de Meta |
| M3-05 | Resolver errores de OAuth, token revocado, permisos, hoja borrada y binding incompleto con accion directa | Cada bloqueo tiene siguiente paso entendible |
| M3-06 | Crear prueba con catalogo propio antes de enviar por WhatsApp | El usuario valida valor sin gastar mensajes ni requerir webhook publico |
| M3-07 | Separar informacion de seguridad/fallos repetidos para administrador de plataforma | Owner no recibe ruido tecnico ni datos globales |

### Fase 4. Construir landing y calculadora

La landing debe ser una experiencia publica independiente de la consola operativa. No hereda el sidebar, los datos de tenants ni las pantallas administrativas.

| Bloque | Contenido | Criterio de cierre |
| --- | --- | --- |
| Hero | “Recibe pedidos por WhatsApp sin estar pegado al celular.” CTA `Probar gratis` y acceso a demostracion | Explica valor sin prometer captar clientes |
| Problema | Mensajes mezclados, pedidos incompletos, productos ambiguos y falta de seguimiento | Habla de situaciones reconocibles de una tienda |
| Funcionamiento | Cliente escribe, asistente organiza, tendero prepara/decide | Tres pasos, lenguaje simple |
| Para quien | Tiendas de barrio y comercios con domicilios por WhatsApp | No se presenta como ERP universal |
| Control humano | No inventa disponibilidad; pregunta y escala cuando no puede confirmar | Diferencia automatizacion de decision humana |
| Precio | COP 89.000/mes, hasta 400 domicilios | Muestra que WhatsApp/Meta es cobro separado del tenant |
| Calculadora | 100, 200, 300 y 400 domicilios; escenario promedio/alto; estimacion Meta | Declara supuestos, no garantias |
| Prueba | Siete dias, sin pago anticipado si esta habilitada | Aclara que para seguir se requiere suscripcion |
| Confianza | Datos en Google del cliente, DeepSeek administrado por plataforma, separacion por tienda | No revela secretos ni tecnicismos innecesarios |
| Referencias | Fuentes primarias de Meta y una nota sobre la muestra conversacional usada | Toda cifra tiene fecha y limitacion |

La landing debe usar un recurso visual real del producto, por ejemplo una captura cuidadosamente anonimizada de Tienda viva y de un pedido claro, no una ilustracion que sugiera funciones inexistentes.

### Fase 5. Validacion y salida publica

| Nivel | Casos minimos | Evidencia requerida |
| --- | --- | --- |
| Unitario/local | Plan 400, trial, limites, Google caido, catalogo ambiguo, handoff, pedido confirmado | Tests verdes sin llamadas pagas innecesarias |
| Datos reales controlados | Muestra de los 40/50 casos colombianos y chat SuperMarket segmentado | Reporte de intentos, escalaciones, errores y costo por caso |
| Google live | Cuenta nueva, OAuth, provision, CSV, edicion de catalogo, reconexion | Sheet y Drive reales del tenant de prueba |
| Mercado Pago sandbox | Checkout, preapproval mensual, webhook firmado, reintento, cancelacion y reactivacion | Referencias de sandbox y estados persistidos |
| WhatsApp/Meta | Embedded Signup, binding, webhook, mensaje entrante/saliente y deduplicacion | Prueba con numero controlado y URL HTTPS |
| UX | Landing desktop/movil, onboarding movil, accesibilidad de formularios y copia | Capturas, navegacion por teclado y sin scroll horizontal accidental |
| Seguridad | Aislamiento tenant, roles, CSRF, secretos, fallos repetidos solo admin | Prueba negativa y auditoria |

Los webhooks publicos se habilitan al final. Google OAuth, Meta y Mercado Pago necesitan URL HTTPS real, pero la mayor parte de las fases 1 a 4 se puede cerrar localmente.

## 9. Criterios de aceptacion de salida

- [ ] El plan nuevo se llama y se cobra como Plan Basico de COP 89.000 y hasta 400 domicilios.
- [ ] Ninguna pantalla comercial ni checkout nuevo anuncia 1.000 domicilios o 5.000 interacciones.
- [ ] El owner entiende que Meta puede facturarle por separado y por que.
- [ ] La calculadora usa los supuestos de mensajes documentados y muestra que son estimaciones.
- [ ] Un trial habilitado crea acceso de prueba y permite completar Google sin pago anticipado.
- [ ] El onboarding crea una copia del modelo de Google en el entorno del tenant y permite editarla.
- [ ] El agente no confirma catalogo, precio o stock desde un espejo local cuando Google falle.
- [ ] Cada pedido que dependa de datos no disponibles en Drive/Sheets se escala a humano y queda en la bandeja.
- [ ] Los pedidos confirmados llegan a una accion humana clara para alistar y entregar.
- [ ] El administrador puede ver uso, costo estimado, errores repetidos y estado de integraciones por tenant.
- [ ] El owner solo ve su tienda y explicaciones apropiadas para negocio.
- [ ] Landing, alta, onboarding, billing y consola son navegables en movil y escritorio.
- [ ] Mercado Pago, Meta y Google se validan con proveedores reales antes de declarar piloto publico.

## 10. Riesgos y controles

| Riesgo | Control requerido |
| --- | --- |
| El costo real de DeepSeek supera USD 3 | Medir con proveedor real, reducir contexto/llamadas antes de abrir el plan y activar presupuesto interno |
| La estimacion de Meta cambia | Fecha de revision, fuente primaria y texto condicional en calculadora |
| Google no responde durante un pedido | No usar espejo; escalar a humano y auditar |
| Cliente abandona onboarding | Guardar avance, permitir reanudar y mostrar una sola accion siguiente |
| Meta demora App Review o Embedded Signup | Mantener guia manual sin fingir que el canal esta activo |
| Webhook duplicado o fuera de orden | Idempotencia, trazabilidad y reintentos ya previstos; validar con proveedor real |
| Mezcla de tenants | Pruebas de autorizacion y filtros por `tenantId` en cada recurso |
| La landing promete mas de lo medido | Revision de copy contra esta tabla de decisiones antes de publicar |

## 11. Orden recomendado de trabajo

1. Ejecutar M0-01 a M0-04 y dejar sus decisiones en este documento.
2. Ejecutar Fase 1: el plan 400 y su enforcement deben existir antes de hablar de precio publico.
3. Ejecutar Fase 2: eliminar el espejo operativo y asegurar escalamiento humano por indisponibilidad Google.
4. Ejecutar Fase 3: completar el flujo de prueba, plantilla, CSV y guia WhatsApp.
5. Ejecutar Fase 4: landing y calculadora sobre reglas ya verdaderas.
6. Ejecutar Fase 5 local y con proveedores en entorno controlado.
7. Solo entonces configurar webhooks publicos, dominio, despliegue y piloto.

## 12. Mantenimiento documental

Al cerrar cada item M1 a M3 se debe actualizar:

- Este plan con estado y evidencia.
- `docs/Seguimiento-consolidado-planes-vigentes.md` con el avance transversal.
- `docs/Calculo-consumo-conversacional-landing.md` cuando cambie la muestra, el modelo o la tarifa.
- `docs/Decisiones-Mercado-Pago-SaaS.md` cuando cambie una regla de cobro, gracia, cancelacion o plan.
- `docs/Brief-comercial-microapp-Ventas-IA.md` cuando cambie una afirmacion visible al mercado.

No se declara una etapa cerrada por tener una maqueta: requiere codigo integrado, prueba relevante y evidencia acorde con el nivel local, sandbox o proveedor real.

## 13. Ejecucion local registrada 2026-10-15

| Bloque | Estado comprobable | Evidencia |
| --- | --- | --- |
| M1-01 / M1-02 | Cerrado localmente | Plan por defecto `ventas_ia_400_domicilios`, COP 89.000, 400 domicilios y 2.700 interacciones de referencia; migracion `007_align_basic_plan.sql`; smoke tests actualizados |
| M1-05 | Cerrado localmente | Trial configurable y desactivado por defecto; `server/tests/autoservicio-plan.mjs` comprueba alta de 7 dias y vencimiento a `pending_payment` |
| M1-06 | Cerrado como contrato local | Checkout, cambios de plan, cancelacion, gracia y mantenimiento siguen cubiertos por `npm run test:backend`; Mercado Pago real queda para URL HTTPS |
| M2-01 | Cerrado localmente | Con `allowLocalCatalogFallback=false`, Google ausente devuelve `google_connection_required`, crea handoff y deja el caso en bandeja |
| M2-02 | Cerrado localmente | `llmPlanner` ya no carga `productsByTenant` cuando `allowLocalCatalogFallback=false`; el prompt productivo conserva la solicitud y deja la resolucion al catalogo live de Google |
| M2-04 | Parcial | La respuesta productiva ya no confirma desde espejo local cuando Google falla; queda definir y medir cache transitorio con TTL, sin convertirlo en fuente de verdad |
| M3 | Parcial avanzado | Onboarding mantiene tabs de Pago, Google, WhatsApp y Prueba; la ruta Google explica autorizar, crear estructura, validar/importar CSV y editar hoja; queda completar el recorrido con una cuenta nueva y proveedores reales |
| M3-02 | Cerrado localmente | Endpoint de validacion/importacion CSV, reglas de SKU/nombre/precio/stock/duplicados, escritura a `Catalogo` cuando Google esta live y fixture explicito en local; cubierto por `server/tests/catalog-import.mjs` y `server/tests/google-live-contract.mjs` |
| M4 | Primera entrega cerrada localmente | `/landing` independiente de la consola, copy comercial simple, calculadora 100-400 domicilios, precio y CTA; validada desktop/movil con `tests/verify_landing.py` |
| M5 | Pendiente | Validacion con Google, Meta, Mercado Pago y OAuth en URL publica; por decision del proyecto se deja para el cierre |

### Evidencia de regresion ejecutada

- `npm run build` paso.
- `npm run test:backend` paso: backend, escenarios Colombia, proveedor LLM, auth y contratos Google/WhatsApp.
- `npm run test:plan` paso: trial, vencimiento y Google sin fallback operativo.
- `tests/verify_landing.py` paso en 1440 px y 390 px, incluyendo calculadora y ausencia de overflow horizontal.
- `tests/verify_ui.py` paso con backend local; sus expectativas fueron ajustadas a la navegacion por tabs y al rol owner/admin vigente.
- `npm run test:catalog-import` paso: validacion de encabezados, duplicados, precio/stock, fixture local y ruta de importacion.
- `node server/tests/google-live-contract.mjs` paso incluyendo validacion y escritura CSV en la hoja live simulada.

### Deuda aceptada antes de publicar

La plataforma ya puede demostrarse localmente, pero no se debe presentar como piloto publico terminado hasta validar URLs HTTPS, OAuth callback, Mercado Pago recurrente, Meta/WhatsApp real, aislamiento con auth obligatoria, secretos administrados y una corrida controlada con DeepSeek real. Esta deuda permanece ordenada en la Fase 5 y no se resuelve simulando proveedor.
