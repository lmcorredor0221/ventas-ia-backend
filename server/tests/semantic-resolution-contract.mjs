import assert from 'node:assert/strict';
import {
  advanceOrderDraft,
  catalogSearchTextForItem,
  nextInteractionMissingFields,
  requiredCustomerFields,
  resolveCatalogItem,
  semanticFrameFromPlan,
  semanticFrameToLegacyPlan,
} from '../domain/semanticContracts.js';

const chocoramo = {
  sku: 'BOG-PAN-019',
  name: 'Ponque Chocoramo',
  productFamily: 'chocoramo',
  presentation: '65 g',
  normalizedPresentation: '65 g',
  price: 2800,
  stock: 18,
  active: true,
  matchScore: 11,
  matchType: 'exact_or_alias',
  aliases: ['chocorramo', 'chocramos'],
};

const cocaPersonal = {
  sku: 'BOG-BEB-041',
  name: 'Coca-Cola original',
  productFamily: 'coca cola',
  presentation: '400 ml',
  normalizedPresentation: '400 ml',
  price: 3500,
  stock: 10,
  active: true,
  matchScore: 14,
  matchType: 'exact_or_alias',
};

const cocaFamiliar = {
  sku: 'BOG-BEB-044',
  name: 'Coca-Cola original',
  productFamily: 'coca cola',
  presentation: '1.5 L',
  normalizedPresentation: '1.5 l',
  price: 7200,
  stock: 10,
  active: true,
  matchScore: 14,
  matchType: 'exact_or_alias',
};

const legacy = {
  intent: 'delivery_order',
  order: {
    delivery: true,
    items: [{ rawName: 'dos chocramos', catalogQuery: 'chocoramo', quantity: 2, skuHint: 'NO-DEBE-SALIR' }],
  },
  toolPlan: [{ tool: 'google_sheets_read_table', filters: { sku: 'NO-DEBE-SALIR' } }],
  missingFields: ['payment_method'],
};

const frame = semanticFrameFromPlan(legacy, {
  text: 'Para domicilio, me regalas dos chocramos',
  messageId: 'wamid.contract.1',
});

assert.equal(frame.schemaVersion, 'semantic-frame.v1');
assert.equal(frame.items.length, 1);
assert.equal(frame.items[0].rawText, 'dos chocramos');
assert.equal(frame.items[0].productHypothesis, 'chocoramo');
assert.match(frame.items[0].rawItemId, /^turn-wamid-contract-1:item-1$/);

const shorthandMeasureFrame = semanticFrameFromPlan({
  intent: 'delivery_order',
  order: {
    delivery: true,
    items: [{ rawName: 'una coca cola 350', catalogQuery: 'Coca-Cola 350ml', quantity: 1 }],
  },
}, { text: 'Una coca cola 350 para domicilio', messageId: 'wamid.contract.1b' });
assert.equal(
  shorthandMeasureFrame.items[0].presentationSignal,
  '350 ml',
  'Una medida que el interprete ya expreso con unidad debe conservarse como restriccion semantica.',
);

const eggPresentationFrame = semanticFrameFromPlan({
  intent: 'delivery_order',
  order: {
    delivery: true,
    items: [{ rawName: 'huevos AA x12', quantity: 1 }],
  },
}, { text: 'Unos huevos AA x12 para domicilio', messageId: 'wamid.contract.1c' });
assert.equal(eggPresentationFrame.items[0].presentationSignal, 'x12');

const bundleWithoutQuantityFrame = semanticFrameFromPlan({
  intent: 'delivery_order',
  order: {
    delivery: true,
    items: [{ rawName: 'huevos AA x12', presentationSignal: 'x12 unidades', quantity: 12 }],
  },
}, { text: 'Necesito huevos AA x12', messageId: 'wamid.contract.1d' });
assert.equal(
  bundleWithoutQuantityFrame.items[0].quantity,
  null,
  'x12 es una presentacion del producto cuando no hay una cantidad de paquetes explicita.',
);

const sourcePreservationFrame = semanticFrameFromPlan({
  intent: 'catalog_query',
  items: [{ rawText: 'bebida hidratante en sobre', productHypothesis: 'bebida hidratante en sobre' }],
}, { text: 'Tiene Savital en sobrecito?', messageId: 'wamid.contract.1e' });
assert.equal(
  sourcePreservationFrame.items[0].rawText,
  'Tiene Savital en sobrecito?',
  'El texto del cliente prevalece si la hipotesis del interprete no aparece en el mensaje.',
);
assert.equal(
  sourcePreservationFrame.items[0].retrievalText,
  null,
  'Una hipotesis con palabras no dichas por el cliente no puede alterar la consulta al catalogo.',
);

const qualifierRetrievalFrame = semanticFrameFromPlan({
  intent: 'delivery_order',
  order: {
    delivery: true,
    items: [{ rawText: 'cifrut', productHypothesis: 'Cifrut granadilla', quantity: 2 }],
  },
}, { text: 'Buenas, me regala 2 cifrut de granadilla para domicilio', messageId: 'wamid.contract.1f' });
assert.equal(qualifierRetrievalFrame.items[0].rawText, 'cifrut');
assert.equal(
  qualifierRetrievalFrame.items[0].retrievalText,
  'Cifrut granadilla',
  'Los calificativos escritos por el cliente deben conservarse para recuperar el catalogo.',
);
assert.equal(catalogSearchTextForItem(qualifierRetrievalFrame.items[0]), 'Cifrut granadilla');
assert.equal(
  semanticFrameToLegacyPlan(qualifierRetrievalFrame).order.items[0].retrievalText,
  'Cifrut granadilla',
  'La conversion de compatibilidad debe conservar una pista ya validada.',
);

const pluralQualifierFrame = semanticFrameFromPlan({
  intent: 'delivery_order',
  order: {
    delivery: true,
    items: [{ rawText: 'arepas', productHypothesis: 'Arepa boyacense', quantity: 2 }],
  },
}, { text: 'Me regalas 2 arepas boyacenses pa domicilio', messageId: 'wamid.contract.1g' });
assert.equal(
  pluralQualifierFrame.items[0].retrievalText,
  'Arepa boyacense',
  'La evidencia debe reconocer pluralizacion simple sin aceptar terminos ajenos al mensaje.',
);

const duplicateCatalogQueryFrame = semanticFrameFromPlan({
  intent: 'catalog_query',
  items: [
    { rawText: 'cafe', productHypothesis: 'Cafe Sello Rojo molido' },
    { rawText: 'cafe tostado premium', productHypothesis: 'Cafe premium tostado' },
  ],
}, { text: 'Para un domicilio, tienes cafe tostado premium?', messageId: 'wamid.contract.1h' });
assert.deepEqual(
  duplicateCatalogQueryFrame.items.map((item) => item.rawText),
  ['cafe tostado premium'],
  'Una consulta especifica debe reemplazar el duplicado generico sin cantidad.',
);

const evidenceBackedDuplicateFrame = semanticFrameFromPlan({
  intent: 'delivery_order',
  items: [
    { rawText: 'galletas festival', productHypothesis: 'Galletas Festival vainilla', quantity: 1 },
    { rawText: 'Galletas Festival chocolate', productHypothesis: 'Galletas Festival chocolate', quantity: 1 },
  ],
}, { text: 'Me regala 1 galletas festival chocolate', messageId: 'wamid.contract.1i' });
assert.deepEqual(
  evidenceBackedDuplicateFrame.items.map((item) => item.rawText),
  ['Galletas Festival chocolate'],
  'Una variante inventada sin evidencia no puede duplicar una solicitud especifica del cliente.',
);

const nonContiguousPresentationFrame = semanticFrameFromPlan({
  intent: 'delivery_order',
  items: [{ rawText: 'huevos x12', productHypothesis: 'Huevos AA rojos', quantity: 1 }],
}, { text: 'Me regalas unos huevos AA x12 para domicilio', messageId: 'wamid.contract.1j' });
assert.equal(nonContiguousPresentationFrame.items[0].rawText, 'huevos x12');
assert.equal(nonContiguousPresentationFrame.items[0].presentationSignal, 'x12');

const clarificationFrame = semanticFrameFromPlan({
  intent: 'order_clarification',
  order: {
    items: [{ rawItemId: 'turn-previous:item-1', rawName: 'Ponque Chocoramo', productHypothesis: 'Ponque Chocoramo', quantity: 2 }],
  },
}, {
  text: 'Bueno entonces sin el agua',
  conversation: {
    orderDraft: {
      items: [{ rawItemId: 'turn-previous:item-1', rawText: 'chocorramo', catalogQuery: 'Ponque Chocoramo', quantity: 2 }],
    },
  },
});
assert.equal(
  clarificationFrame.items[0].rawText,
  'chocorramo',
  'Una aclaracion conserva el texto estable del item existente y no lo reemplaza por el ultimo mensaje.',
);

const compatibilityPlan = semanticFrameToLegacyPlan(frame, { sourcePlan: legacy });
assert.equal(compatibilityPlan.order.items[0].skuHint, undefined);
assert.deepEqual(compatibilityPlan.toolPlan, []);
assert.equal(compatibilityPlan.order.items[0].rawText, 'dos chocramos');
assert.equal(compatibilityPlan.order.items[0].productHypothesis, 'chocoramo');
assert.equal(
  catalogSearchTextForItem({
    rawName: 'dos chocramos',
    catalogQuery: 'Ponque Chocoramo (producto de panaderia con cobertura de chocolate)',
  }),
  'dos chocramos',
  'La busqueda debe partir de las palabras del cliente, no de una parafrasis del interprete.',
);

const typoResolution = resolveCatalogItem({ item: frame.items[0], rows: [chocoramo] });
assert.equal(typoResolution.status, 'resolved');
assert.equal(typoResolution.product.sku, 'BOG-PAN-019');

const variantFrame = semanticFrameFromPlan({
  intent: 'delivery_order',
  order: { delivery: true, items: [{ rawName: 'una coca cola', catalogQuery: 'coca cola', quantity: 1 }] },
}, { text: 'Una Coca-Cola para domicilio', messageId: 'wamid.contract.2' });
const variantResolution = resolveCatalogItem({ item: variantFrame.items[0], rows: [cocaPersonal, cocaFamiliar] });
assert.equal(variantResolution.status, 'needs_selection');
assert.equal(variantResolution.options.length, 2);
assert.deepEqual(variantResolution.options.map((item) => item.sku), ['BOG-BEB-041', 'BOG-BEB-044']);

const ponqueGala = {
  sku: 'BOG-PAN-020',
  name: 'Ponque Gala vainilla',
  productFamily: 'ponque',
  presentation: '60 g',
  normalizedPresentation: '60 g',
  price: 2400,
  stock: 10,
  active: true,
  matchScore: 10,
  matchType: 'similar',
};
const chocoramoFamilyResolution = resolveCatalogItem({
  item: frame.items[0],
  rows: [
    { ...chocoramo, productFamily: 'ponque', matchScore: 13 },
    { ...chocoramo, sku: 'COL-226', name: 'Chocoramo mini', presentation: '35 g', normalizedPresentation: '35 g', matchScore: 9, matchType: 'similar' },
    ponqueGala,
  ],
});
assert.equal(
  chocoramoFamilyResolution.status,
  'resolved',
  'Productos distintos en una familia amplia no deben presentarse como variantes intercambiables.',
);
assert.equal(chocoramoFamilyResolution.product.sku, 'BOG-PAN-019');

const unavailableQualifierResolution = resolveCatalogItem({
  item: { rawItemId: 'turn-contract:ponque-mora', rawText: 'ponque ramo mora', productHypothesis: 'ponque ramo mora', quantity: 1 },
  rows: [{ ...chocoramo, productFamily: 'ponque', matchScore: 11, matchType: 'exact_or_alias' }],
});
assert.equal(
  unavailableQualifierResolution.status,
  'human_review',
  'Una coincidencia parcial no puede sustituir un atributo explicito que no existe en el catalogo.',
);
assert.equal(unavailableQualifierResolution.reason, 'unmatched_customer_qualifier');

const chocoramoBaseAndMiniResolution = resolveCatalogItem({
  item: frame.items[0],
  rows: [
    { ...chocoramo, productFamily: 'ponque', matchScore: 7 },
    { ...chocoramo, sku: 'COL-226', name: 'Chocoramo mini', presentation: '35 g', normalizedPresentation: '35 g', matchScore: 7 },
  ],
});
assert.equal(chocoramoBaseAndMiniResolution.status, 'resolved');
assert.equal(chocoramoBaseAndMiniResolution.reason, 'unqualified_canonical_variant');
assert.equal(chocoramoBaseAndMiniResolution.product.sku, 'BOG-PAN-019');

const panBlancoResolution = resolveCatalogItem({
  item: { rawItemId: 'turn-contract:pan', rawText: 'un pan tajado Bimbo blanco', brandHint: 'Bimbo', quantity: 1 },
  rows: [
    { sku: 'PAN-BLANCO', name: 'Pan tajado Bimbo blanco', presentation: '500 g', stock: 10, active: true, price: 7600, matchScore: 14, matchType: 'exact_or_alias' },
    { sku: 'PAN-INTEGRAL', name: 'Pan tajado Bimbo integral', presentation: '500 g', stock: 10, active: true, price: 8400, matchScore: 11, matchType: 'exact_or_alias' },
  ],
});
assert.equal(panBlancoResolution.status, 'resolved');
assert.equal(panBlancoResolution.product.sku, 'PAN-BLANCO');

const genericArepaResolution = resolveCatalogItem({
  item: { rawItemId: 'turn-contract:arepa', rawText: 'dos arepas', productHypothesis: 'arepas', quantity: 2 },
  rows: [
    { sku: 'ARE-001', name: 'Arepa con queso', presentation: '5 und', stock: 10, active: true, price: 7600, matchScore: 11, matchType: 'exact_or_alias' },
    { sku: 'ARE-002', name: 'Arepa boyacense', presentation: '5 und', stock: 10, active: true, price: 7800, matchScore: 11, matchType: 'exact_or_alias' },
  ],
});
assert.equal(genericArepaResolution.status, 'human_review');
assert.equal(genericArepaResolution.reason, 'ambiguous_or_cross_family_candidates');

const aguaCristalSinGas = {
  sku: 'BOG-BEB-041',
  name: 'Agua Cristal sin gas',
  brand: 'Cristal',
  presentation: '600 ml',
  normalizedPresentation: '600 ml',
  price: 2200,
  stock: 48,
  active: true,
  matchScore: 12,
  matchType: 'exact_or_alias',
};
const aguaCristalConGas = {
  ...aguaCristalSinGas,
  sku: 'COL-109',
  name: 'Agua Cristal con gas',
  matchScore: 10,
};
const aguaBrisaSinGas = {
  ...aguaCristalSinGas,
  sku: 'BOG-BEB-042',
  name: 'Agua Brisa sin gas',
  brand: 'Brisa',
  matchScore: 10,
};
const aguaFrame = semanticFrameFromPlan({
  intent: 'delivery_order',
  order: { delivery: true, items: [{ rawName: 'una agua cristal sin gas de 600 ml', brandHint: 'Cristal', quantity: 1 }] },
}, { text: 'Me regala una agua Cristal sin gas de 600 ml', messageId: 'wamid.contract.2b' });
const aguaResolution = resolveCatalogItem({ item: aguaFrame.items[0], rows: [aguaCristalSinGas, aguaCristalConGas, aguaBrisaSinGas] });
assert.equal(aguaResolution.status, 'resolved');
assert.equal(aguaResolution.product.sku, 'BOG-BEB-041');
assert.equal(
  semanticFrameToLegacyPlan(aguaFrame).order.items[0].brandHint,
  'Cristal',
  'El adaptador debe entregar la marca inferida al resolutor, sin entregar SKU ni filtros comerciales.',
);

assert.deepEqual(
  requiredCustomerFields({
    requiredFields: ['name', 'defaultAddress'],
    delivery: true,
    customerProfile: null,
    customerDelta: {},
  }),
  ['customer_name', 'delivery_address'],
  'Los requisitos de un domicilio se derivan de la politica y el perfil, no de si el LLM los enumero.',
);
assert.deepEqual(
  nextInteractionMissingFields(['payment_method', 'quantity:arroz', 'presentation:item-1']),
  ['presentation:item-1'],
  'La conversacion no pide pago mientras aun deba resolver una presentacion.',
);
assert.deepEqual(
  nextInteractionMissingFields(['payment_method', 'quantity:arroz']),
  ['quantity:arroz'],
  'La cantidad se solicita antes de datos comerciales posteriores.',
);
assert.deepEqual(
  nextInteractionMissingFields(['payment_method', 'order_items']),
  ['order_items'],
  'Sin productos el siguiente paso es preguntar la canasta, no el pago.',
);

const paperRollFrame = semanticFrameFromPlan({
  intent: 'delivery_order',
  order: { delivery: true, items: [{ rawName: 'papel higienico Familia x4 rollos', quantity: 1 }] },
}, { text: 'Papel higienico Familia x4 rollos', messageId: 'wamid.contract.2c' });
const paperRollResolution = resolveCatalogItem({
  item: paperRollFrame.items[0],
  rows: [{ sku: 'BOG-ASE-001', name: 'Papel higienico Familia', presentation: '4 rollos', normalizedPresentation: '4 rollos', stock: 10, active: true, price: 9000, matchScore: 12, matchType: 'exact_or_alias' }],
});
assert.equal(paperRollResolution.status, 'resolved');
assert.deepEqual(
  requiredCustomerFields({
    requiredFields: ['name', 'defaultAddress'],
    delivery: true,
    customerProfile: null,
    customerDelta: { name: 'Laura Gomez', address: 'Carrera 7 # 20-10' },
  }),
  [],
  'Los datos que el interprete extrajo del mensaje satisfacen la politica sin inventar un perfil previo.',
);

const outOfStockResolution = resolveCatalogItem({
  item: frame.items[0],
  rows: [{ ...chocoramo, stock: 0 }],
});
assert.equal(outOfStockResolution.status, 'unavailable');
assert.equal(outOfStockResolution.reason, 'insufficient_stock');

const initialDraft = {
  version: 4,
  items: [{ rawItemId: frame.items[0].rawItemId, product: chocoramo, quantity: 2, lineTotal: 5600 }],
  subtotal: 5600,
  paymentMethod: 'cash',
  deliveryAddress: 'Calle 1',
};
const updatedDraft = advanceOrderDraft(initialDraft, {
  paymentMethod: 'bre_b',
  missingFields: [],
});
assert.equal(updatedDraft.version, 5);
assert.equal(updatedDraft.items[0].product.sku, 'BOG-PAN-019');
assert.equal(updatedDraft.subtotal, 5600);
assert.equal(updatedDraft.deliveryAddress, 'Calle 1');

console.log('Semantic frame, catalog resolution, and versioned draft contract passed.');
