const fs = require('fs');
const path = require('path');
const {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require('docx');

const outputDirectory = path.join(__dirname, '..', 'docs');
const outputPath = path.join(outputDirectory, 'Plan-implementacion-SaaS-Ventas-IA.docx');
const contentWidth = 9026;
const border = { style: BorderStyle.SINGLE, size: 1, color: 'D7DEE8' };
const borders = { top: border, bottom: border, left: border, right: border };

const run = (text, options = {}) => new TextRun({ text, font: 'Arial', size: 20, ...options });
const cell = (text, width, options = {}) => new TableCell({
  borders,
  width: { size: width, type: WidthType.DXA },
  verticalAlign: VerticalAlign.CENTER,
  margins: { top: 90, bottom: 90, left: 120, right: 120 },
  shading: options.shading ? { fill: options.shading, type: ShadingType.CLEAR } : undefined,
  children: [new Paragraph({ children: [run(text, { bold: options.bold || false, color: options.color || '263548' })] })],
});
const table = (headers, rows, widths) => new Table({
  width: { size: contentWidth, type: WidthType.DXA },
  columnWidths: widths,
  rows: [
    new TableRow({ children: headers.map((header, index) => cell(header, widths[index], { bold: true, color: 'FFFFFF', shading: '1D3A5F' })) }),
    ...rows.map((row, rowIndex) => new TableRow({
      children: row.map((value, index) => cell(value, widths[index], { shading: rowIndex % 2 === 1 ? 'F5F8FB' : undefined })),
    })),
  ],
});
const bullet = (text) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [run(text)] });
const numbered = (text) => new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [run(text)] });
const heading = (text, level = HeadingLevel.HEADING_1) => new Paragraph({ heading: level, children: [run(text)] });

const sections = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1120, after: 220 }, children: [run('PLAN DE IMPLEMENTACION', { bold: true, size: 38, color: '1D3A5F' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run('SaaS multicliente para Ventas IA', { bold: true, size: 30, color: 'AF682C' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [run('Versión 1.0 | 9 de octubre de 2026', { color: '5D6B7B' })] }),
  new Paragraph({ spacing: { after: 240 }, children: [run('Propósito. ', { bold: true }), run('Convertir el prototipo del agente comercial en un producto SaaS autoservicio, cobrable, seguro y aislado por comercio. La plataforma usará autenticación con Google, suscripción mensual por Mercado Pago, operación de datos en Google Drive y Google Sheets del cliente, WhatsApp Business propio de cada comercio y DeepSeek como motor de razonamiento.')]}),
  heading('1. Resultado objetivo'),
  new Paragraph({ children: [run('Un comercio podrá crear su cuenta con Google, pagar la suscripción, autorizar el acceso a su Drive, recibir automáticamente las plantillas operativas, conectar su WhatsApp Business y activar el agente sin requerir asistencia técnica.')]}),
  new Paragraph({ spacing: { before: 160, after: 120 }, children: [run('Flujo objetivo', { bold: true, color: '1D3A5F' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run('Google login  ->  Suscripción activa  ->  OAuth Drive/Sheets  ->  Aprovisionamiento  ->  WhatsApp validado  ->  Agente activo', { bold: true, color: 'AF682C' })] }),
  table(['Componente', 'Responsabilidad', 'Regla de aislamiento'], [
    ['Identidad', 'Usuarios, sesiones y roles mediante Google.', 'La sesión determina el tenant; el navegador no lo elige libremente.'],
    ['Facturación', 'Planes, pagos, renovaciones y suspensión.', 'Solo Mercado Pago confirmado habilita operación.'],
    ['Datos del comercio', 'Catálogo, clientes, pedidos y archivos del cliente.', 'Cada tenant autoriza su propia cuenta Google.'],
    ['Agente', 'DeepSeek, herramientas, trazabilidad y límites.', 'Cada ejecución usa configuración, datos y cuota del tenant.'],
  ], [1700, 4000, 3326]),
  heading('2. Principios de arquitectura'),
  bullet('Google Sign-In identifica a la persona. Una sesión segura propia de la aplicación controla el acceso posterior.'),
  bullet('OAuth de Google para Drive y Sheets es un consentimiento separado: autoriza a operar los datos del comercio y conserva refresh tokens cifrados en el servidor.'),
  bullet('PostgreSQL será la fuente de verdad para identidad, suscripción, permisos, consumo y auditoría. Google Sheets conservará los datos operativos del negocio.'),
  bullet('DeepSeek será una capacidad de plataforma: la clave API no se expone al tenant; cada comercio configura políticas y límites, no secretos.'),
  bullet('Meta/WhatsApp Business es una cuenta y un costo del cliente. La suscripción cubre solamente la plataforma Ventas IA.'),
  heading('3. Plan por fases'),
  table(['Fase', 'Entregable', 'Dependencia', 'Criterio de cierre'], [
    ['0. Fundaciones', 'Decisiones de plan, estados y arquitectura.', 'Aprobación de producto.', 'Estados y reglas comerciales documentados.'],
    ['1. Identidad', 'Google login, roles, sesiones y base PostgreSQL.', 'Proyecto Google Cloud.', 'Usuario entra, crea tenant y no ve datos ajenos.'],
    ['2. Suscripción', 'Mercado Pago, webhooks e ingresos controlados.', 'Cuenta productiva Mercado Pago.', 'Pago confirmado activa; pago vencido bloquea operación.'],
    ['3. Google operativo', 'OAuth, cifrado de tokens y conexión Drive/Sheets.', 'Consent screen y APIs habilitadas.', 'Tenant autoriza y puede reconectar si revoca permisos.'],
    ['4. Aprovisionamiento', 'Carpetas, archivos, hojas y validaciones automáticas.', 'Fase 3.', 'Reintento no duplica recursos ni información.'],
    ['5. Activación', 'Onboarding, WhatsApp y prueba integral.', 'Fases 2 a 4.', 'Checklist completo habilita al agente.'],
    ['6. Operación SaaS', 'Cuotas, soporte, monitoreo y resiliencia.', 'Fase 5.', 'Uso medido, alarmas y recuperación comprobados.'],
  ], [1050, 2550, 2200, 3226]),
  heading('4. Fase 0 - Fundaciones'),
  numbered('Aprobar el plan comercial inicial: $89.000 COP/mes, hasta 1.000 domicilios o 5.000 interacciones del agente por periodo, lo que ocurra primero.'),
  numbered('Definir roles: owner administra facturación e integraciones; operator opera pedidos; viewer consulta resultados.'),
  numbered('Definir estados de suscripción: trial, pending_payment, active, past_due, grace_period, suspended y cancelled.'),
  numbered('Definir estados de onboarding: account_created, subscribed, google_connected, provisioned, whatsapp_validated y active.'),
  numbered('Seleccionar el proveedor de PostgreSQL, el gestor de secretos y el entorno de despliegue antes de almacenar datos reales.'),
  heading('5. Fase 1 - Identidad y multicliente'),
  new Paragraph({ children: [run('Implementación. ', { bold: true }), run('Integrar Google Sign-In en la interfaz; validar el ID token en Express; crear una sesión httpOnly/SameSite; registrar user, tenant y tenant_members; y reemplazar el almacenamiento JSON actual por PostgreSQL.')]}),
  table(['Entidad', 'Campos mínimos'], [
    ['users', 'id, google_subject, email, name, created_at'],
    ['tenants', 'id, legal_name, display_name, lifecycle_state, created_at'],
    ['tenant_members', 'tenant_id, user_id, role, status'],
    ['sessions', 'id, user_id, expires_at, revoked_at'],
    ['audit_events', 'tenant_id, actor_id, action, resource, metadata, created_at'],
  ], [2100, 6926]),
  new Paragraph({ children: [run('Aceptación. ', { bold: true }), run('Una persona autenticada crea o entra a su comercio; un operador no puede modificar cobros; y ningún endpoint acepta un tenant_id sin comprobar pertenencia en la sesión.')]}),
  heading('6. Fase 2 - Suscripción y Mercado Pago'),
  new Paragraph({ children: [run('Implementación. ', { bold: true }), run('Crear el plan recurrente, generar la suscripción, guardar la relación con el tenant y procesar webhooks idempotentes. Tras recibir un evento, el backend consulta el objeto en Mercado Pago antes de cambiar el estado local.')]}),
  bullet('POST /api/billing/checkout crea o recupera una suscripción para el tenant autenticado.'),
  bullet('POST /webhooks/mercadopago registra el evento, evita repeticiones y sincroniza estado real.'),
  bullet('GET /api/billing/status expone plan, consumo, fecha de renovación y acciones disponibles.'),
  new Paragraph({ children: [run('Regla de activación. ', { bold: true }), run('La URL de retorno del pago solo informa al usuario. Únicamente el webhook verificado y la consulta al proveedor pueden marcar una suscripción como active.')]}),
  heading('7. Fase 3 - Google Drive y Google Sheets'),
  new Paragraph({ children: [run('Implementación. ', { bold: true }), run('Crear rutas de inicio y callback OAuth, usar state antifraude, autorización incremental y acceso offline. Cifrar refresh tokens, guardar fecha de vencimiento, scopes y estado de la conexión.')]}),
  bullet('Login: openid, email y profile.'),
  bullet('Operación: scopes mínimos necesarios para crear y actualizar los recursos Drive/Sheets del comercio.'),
  bullet('Recuperación: si el usuario revoca permisos o expira el token, el panel presenta una reconexión guiada sin perder la configuración.') ,
  new Paragraph({ children: [run('Referencia técnica. ', { bold: true }), run('El flujo OAuth de servidor requiere credenciales confidenciales, estado y redirecciones autorizadas; Google recomienda librerías de servidor y autorización incremental.')]}),
  new Paragraph({ children: [new ExternalHyperlink({ link: 'https://developers.google.com/identity/protocols/oauth2/web-server', children: [run('Guía oficial de OAuth 2.0 de Google', { color: '0563C1', underline: {} })] })] }),
  heading('8. Fase 4 - Aprovisionamiento de recursos'),
  new Paragraph({ children: [run('Proceso idempotente por tenant', { bold: true })] }),
  numbered('Crear o recuperar la carpeta raíz Ventas IA - nombre del comercio.'),
  numbered('Crear o recuperar Catálogo, Clientes, Pedidos, Configuración y Auditoría.'),
  numbered('Aplicar encabezados, formatos, validaciones y datos de ejemplo versionados.'),
  numbered('Guardar IDs de Drive, spreadsheet y sheet en provisioned_resources.'),
  numbered('Ejecutar lectura de catálogo, consulta de cliente y escritura de pedido de prueba.'),
  numbered('Marcar provisioned solo al superar todas las validaciones.'),
  new Paragraph({ children: [run('Aceptación. ', { bold: true }), run('Ejecutar el proceso dos veces no crea dos carpetas ni dos archivos. Los nombres son informativos; los IDs de Google son la referencia real.')]}),
  heading('9. Fase 5 - WhatsApp, agente y experiencia de activación'),
  new Paragraph({ children: [run('Implementación. ', { bold: true }), run('Cada tenant registra de forma segura su phone_number_id, cuenta WhatsApp y referencias de credenciales. El webhook ubica al comercio exclusivamente por phone_number_id y rechaza mensajes no asociados.')]}),
  table(['Paso de onboarding', 'Validación automática'], [
    ['1. Cuenta y comercio', 'Usuario owner, tenant y datos básicos creados.'],
    ['2. Suscripción', 'Estado active o trial vigente.'],
    ['3. Google conectado', 'Token vigente y permisos requeridos concedidos.'],
    ['4. Datos preparados', 'Carpeta, hojas y catálogo mínimo validados.'],
    ['5. WhatsApp conectado', 'Webhook y mensaje de prueba exitosos.'],
    ['6. Activación', 'Prueba del agente y cuota disponible.'],
  ], [2500, 6526]),
  heading('10. Fase 6 - Uso, límites y operación'),
  bullet('Medir cada interacción: tenant, conversación, modelo, tokens de entrada/salida, costo estimado, herramientas y resultado.'),
  bullet('Aplicar límites antes de procesar un mensaje. Al superar una cuota, el agente pausa y el panel ofrece ampliar plan o esperar renovación.'),
  bullet('Mantener empleos de fondo para reintentos de webhooks, renovación de tokens, revalidación de conexiones y alertas de consumo.'),
  bullet('Registrar auditoría de ingresos, cambios de configuración, pagos, pedidos y acciones de herramientas.'),
  heading('11. Seguridad y riesgos a controlar'),
  table(['Riesgo', 'Control'], [
    ['Cruce de datos entre clientes', 'tenant_id obligatorio, validado desde sesión y pruebas de aislamiento.'],
    ['Pérdida o exposición de tokens', 'Cifrado, gestor de secretos, mínimo privilegio y rotación.'],
    ['Webhook fraudulento o repetido', 'Verificación de firma, consulta al proveedor e idempotencia por evento.'],
    ['Permiso Google revocado', 'Detección de error, estado needs_reauth y reparación guiada.'],
    ['Costo LLM inesperado', 'Cuotas, presupuestos por tenant y alertas antes de excederlas.'],
    ['Configuración incompleta', 'Agente bloqueado hasta que el checklist de activación pase.'],
  ], [2500, 6526]),
  heading('12. Pruebas de aceptación de lanzamiento'),
  bullet('Dos tenants activos no pueden leer, editar ni consultar recursos del otro.'),
  bullet('Un webhook de Mercado Pago repetido no duplica pagos ni cambia un estado válido por error.'),
  bullet('Una suscripción vencida impide que el agente use DeepSeek o responda por WhatsApp.'),
  bullet('Un aprovisionamiento reintentado reutiliza los recursos existentes.'),
  bullet('La revocación de Google no expone información y permite reconexión segura.'),
  bullet('Los 40 escenarios colombianos del agente siguen pasando con recursos reales del tenant.'),
  heading('13. Cronograma sugerido'),
  table(['Semanas', 'Resultado'], [
    ['1-2', 'Modelo PostgreSQL, Google login, sesiones, roles y aislamiento.'],
    ['3-4', 'Mercado Pago, suscripción, webhooks y bloqueo por estado.'],
    ['5-6', 'OAuth Drive/Sheets, cifrado de tokens y provisión de recursos.'],
    ['7-8', 'Onboarding guiado, conexión WhatsApp y validación integral.'],
    ['9-10', 'Medición DeepSeek, cuotas, suspensión y pruebas end-to-end.'],
    ['11-12', 'Observabilidad, recuperación, piloto controlado y ajustes.'],
  ], [1800, 7226]),
  heading('14. Registro de decisiones'),
  table(['Decisión', 'Estado', 'Notas'], [
    ['Autenticación', 'Aprobada', 'Google como proveedor de identidad.'],
    ['Datos operativos', 'Aprobada', 'Cada comercio usa su propio Google Drive y Sheets.'],
    ['Facturación', 'Aprobada', 'Suscripción mensual con Mercado Pago.'],
    ['Canal de mensajería', 'Aprobada', 'WhatsApp Business, facturado por Meta al cliente.'],
    ['LLM', 'Aprobada', 'DeepSeek como motor comercial inicial.'],
    ['Base de producción', 'Pendiente', 'Elegir PostgreSQL administrado y gestor de secretos.'],
    ['Infraestructura', 'Pendiente', 'Elegir proveedor de despliegue y ambiente productivo.'],
  ], [2600, 1600, 4826]),
  new Paragraph({ spacing: { before: 360 }, children: [run('Próximo hito recomendado: ', { bold: true, color: '1D3A5F' }), run('implementar Fase 1: PostgreSQL, autenticación Google, sesiones y modelo de tenant/roles. Esta capa habilita de forma segura todas las fases posteriores.')] }),
];

const document = new Document({
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 550, hanging: 240 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 550, hanging: 240 } } } }] },
    ],
  },
  styles: {
    default: { document: { run: { font: 'Arial', size: 20, color: '263548' } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 29, bold: true, font: 'Arial', color: '1D3A5F' }, paragraph: { spacing: { before: 350, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: 'Arial', color: '1D3A5F' }, paragraph: { spacing: { before: 260, after: 120 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, right: 1440, bottom: 1000, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AF682C', space: 1 } }, children: [run('Ventas IA | Plan de implementación SaaS', { size: 18, bold: true, color: '1D3A5F' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run('Confidencial | Página ', { size: 16, color: '5D6B7B' }), new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: '5D6B7B' })] })] }) },
    children: sections,
  }],
});

fs.mkdirSync(outputDirectory, { recursive: true });
Packer.toBuffer(document).then((buffer) => {
  fs.writeFileSync(outputPath, buffer);
  console.log(outputPath);
});
