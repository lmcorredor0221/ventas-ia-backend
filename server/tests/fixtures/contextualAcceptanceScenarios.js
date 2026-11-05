import { colombiaAgentScenarioSet } from './colombiaAgentScenarios.js';

// Acceptance v2. Product choices belong to the BUYER, fixed before execution.
// They are not instructions for VIA and do not license premature selection.
const specs = [
  ['purchase', [['BOG-PAN-019', 3], ['BOG-BEB-051', 2]], 'Chocoramo normal de 65 g; dos Cifrut granadilla de 250 ml.'],
  ['purchase', [['BOG-PAN-019', 3], ['BOG-BEB-051', 2]], 'Cuando pregunte cantidad del jugo, son dos. Chocoramo de 65 g.'],
  ['purchase', [['BOG-PAN-017', 2]], 'Si aclara la unidad de venta, aceptas DOS PAQUETES de cinco arepas; no dos arepas sueltas.'],
  ['purchase', [['BOG-PAN-017', 2]], 'Aceptas dos paquetes de cinco arepas al aclararlo. Aporta nombre y dirección sin perder el pedido.'],
  ['query', [], 'Solo consultas café tostado premium y su precio. No compras.'],
  ['query', [], 'Buscas café molido para preparar en casa. Solo consulta opciones y precio; no compras.'],
  ['query', [], 'Solo consultas jugos de granadilla, tamaños y precios; no compras.'],
  ['query', [], 'Prefieres agua sin gas o jugo para la sed; solo consulta, no compras.'],
  ['query', [], 'Buscas mecato para onces, dulce o lácteo. Solo consulta.'],
  ['query', [], 'Arroz, aceite O huevos son alternativas; explica que primero comparas, no compras los tres.'],
  ['query', [], 'Papel higiénico y jabón para lavar ropa; consulta ambos, no compres todavía.'],
  ['query', [], 'Consulta alimentos para onces; no compras todavía.'],
  ['query', [], 'Consulta disponibilidad de JAMÓN, QUESO Y PAN para sándwich; no permitas perder dos de las tres necesidades.'],
  ['query', [], 'Quieres opciones DULCES, no saladas; solo consulta.'],
  ['query', [], 'Desayuno rápido de productos empacados; solo consulta, no comida preparada inventada.'],
  ['query', [], 'La temperatura fría importa. Pregunta si realmente está refrigerado; no te basta que sea una bebida.'],
  ['query', [], 'Presupuesto máximo 5000 pesos para comer. Opciones o combo dentro del presupuesto; solo consulta.'],
  ['query', [], 'Gaseosa pequeña para una persona. Compara presentaciones reales, no compras.'],
  ['query', [], 'Leche ENTERA en BOLSA; consulta marca, precio y tamaño; no compras.'],
  ['query', [], 'Papel higiénico para baño; consulta tamaños y precio, no compras.'],
  ['query', [], 'Jabón en barra para LAVAR ROPA; consulta, no compras.'],
  ['purchase', [['BOG-GRA-021', 1], ['BOG-BAS-031', 1], ['BOG-LAC-002', 1]], 'Elige arroz Diana 500 g, aceite Premier 500 ml y leche entera Colanta en bolsa 1 L, uno de cada uno, cuando se aclaren.'],
  ['purchase', [['BOG-ASE-088', 1], ['BOG-ASE-083', 2]], 'Un paquete Familia de cuatro rollos y dos barras Rey de 250 g.'],
  ['purchase', [['BOG-LAC-004', 1], ['BOG-SNA-064', 1]], 'Yogurt Alpina fresa VASO 150 g y un paquete Festival chocolate de 12 unidades. Es para domicilio.'],
  ['query', [], 'Aclara que quieres SHAMPOO Savital sachet de 18 ml, no acondicionador ni botella. Solo consulta.'],
  ['query', [], 'Solo precio del Chocoramo normal de 65 g, NO compra.'],
  ['query', [], 'Lonchera: opciones empacadas dulces o lácteas; no pidas beneficios de salud ni compras.'],
  ['handoff', [], 'Necesitas salmón; acepta hablar con la tienda si no hay, no sustituyas por otro pescado.'],
  ['purchase', [['BOG-BEB-044', 1]], 'Coca-Cola ORIGINAL 1.5 L a 7200, no otra referencia. Si hay dos a distinto precio, elige la original de 7200 de forma explícita.'],
  ['purchase', [['BOG-BEB-041', 1]], 'Una botella de agua Cristal sin gas de 600 ml. Al aceptar cotización usa “Dale, hágale”.'],
  ['query', [], 'Quieres un café preparado; si solo venden empacado, aclara que puedes comparar café molido, sin comprar.'],
  ['purchase', [['BOG-GRA-021', 1], ['BOG-BAS-031', 1], ['BOG-HUE-011', 1]], 'Diana 500 g, Premier 500 ml, un paquete de huevos AA rojos x12.'],
  ['purchase', [['BOG-PAN-019', 2], ['BOG-BEB-051', 1]], 'Dos Chocoramos de 65 g y un Cifrut granadilla 250 ml.'],
  ['purchase', [['BOG-PAN-019', 1], ['BOG-BEB-041', 1]], 'Al preguntar cantidades: UNO de cada uno. Chocoramo 65 g y agua Cristal sin gas 600 ml.'],
  ['purchase', [['BOG-GRA-021', 1], ['BOG-BAS-031', 1], ['BOG-HUE-011', 1]], 'Marcas/tamaños/cantidades no se dijeron aún. Cuando pregunte eliges Diana 500 g, Premier 500 ml y huevos AA x12: un paquete de cada uno.'],
  ['query', [], 'Leche O queso son alternativas: consulta leche entera de bolsa y queso campesino, no compres ambos.'],
  ['handoff', [], 'Solicitas descuento no autorizado; acepta consulta al tendero, sin inventar una compra.'],
  ['payment_notice', [], 'Declaras transferencia sin adjunto: espera acuse y aviso informativo a la tienda, sin verificar dinero, bloquear ni crear una compra.'],
  ['handoff', [], 'Quieres una persona, no más automatización.'],
  ['purchase', [['BOG-PAN-013', 1]], 'Pan Bimbo blanco 500 g. Prefieres pagar por Bre-B.'],
  ['opening', [], 'Solo saludas y abres un domicilio; aún no elegiste productos. No inventes un pedido.'],
  ['purchase', [['BOG-PAN-019', 3]], 'Tres Chocoramos 65 g. Prefieres pagar con tarjeta débito.'],
  ['purchase', [['BOG-PAN-019', 2]], 'Retiras solo el agua; conservas dos Chocoramos de 65 g.'],
  ['purchase', [['BOG-PAN-013', 1], ['BOG-LAC-007', 1]], 'Conserva pan Bimbo blanco 500 g y AGREGA queso campesino Colanta 250 g, uno de cada uno.'],
  ['handoff', [], 'Pides 5000 PESOS de salchichón y una Coca-Cola 350 ml. Venta por valor/peso no acreditada: consulta al tendero, no 5000 unidades.'],
  ['handoff', [], 'Enviaste foto. Si no pueden verla, pide ayuda humana sin inventar contenido.'],
  ['handoff', [], 'Reclamas faltante de jugo de una entrega anterior; no es una compra nueva.'],
  ['payment_notice', [], 'Declaras transferencia sin imagen. Espera aviso informativo, no pago acreditado ni aprobación financiera; luego agradeces.'],
  ['handoff', [], 'Conserva tres Chocoramos y ponqué Ramo de MORA pendiente. No aceptes sustitución silenciosa del ausente.'],
  ['purchase', [['BOG-LAC-004', 1]], 'Un yogurt Alpina fresa vaso150g. Usa “Sí veci, solo eso” tanto al terminar de agregar como al aceptar una cotización completa; son actos distintos.'],
];

export const contextualAcceptanceVersion = '2.5.0';
export const contextualAcceptanceScenarios = colombiaAgentScenarioSet.map((source, index) => {
  const [outcome, basket, goal] = specs[index];
  const first = source.steps?.[0] ?? source;
  return {
    id: source.id, number: index + 1, level: source.level, customer: source.customer,
    initial: { text: first.text, messageType: first.messageType, mediaRef: first.mediaRef },
    extraProducts: source.extraProducts ?? [], outcome, basket: basket.map(([sku, quantity]) => ({ sku, quantity })), goal,
    maxTurns: outcome === 'purchase' ? 9 : outcome === 'query' ? 5 : outcome === 'handoff' ? 4 : 2,
    // Explicit delivery requests in these fixtures must survive later turns,
    // even when the delivery charge is zero and totals cannot expose the loss.
    expectedDelivery: [1, 2, 3, 4, 23, 29, 30, 32, 34, 40, 42, 43, 44, 50].includes(index + 1) ? true : undefined,
    maxBudget: index === 16 ? 5000 : null,
    quantityCaps: index === 44 ? [{ sku: 'AND-COC-350', quantity: 1 }]
      : index === 48 ? [{ sku: 'BOG-PAN-019', quantity: 3 }] : undefined,
    amountCaps: index === 44 ? [{ sku: 'AND-CAR-SAL-250', amount: 5000 }] : [],
    confirmText: index === 29 ? 'Dale, hágale' : index === 49 ? 'Sí veci, solo eso' : 'Sí, confirmo ese pedido con ese total.',
    finishCollectionText: index === 49 ? 'Sí veci, solo eso' : null,
    buyer: { name: 'Laura Prueba', address: 'Calle E2E 100 # 10-20, Bogota',
      payment: index === 39 ? 'Bre-B' : [41, 49].includes(index) ? 'Tarjeta débito' : 'Efectivo' },
    // These edits are deliberately sent before resolving older questions.
    followUp: [42, 43].includes(index) ? source.steps[1].text : null,
    critical: [1, 3, 4, 23, 29, 30, 32, 33, 34, 35, 40, 42, 43, 44, 49, 50].includes(index + 1),
  };
});
