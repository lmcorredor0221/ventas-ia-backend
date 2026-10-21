export function enrichCatalogReference(product, overrides = {}) {
  const presentation = overrides.presentation ?? product.presentation ?? '';
  const category = overrides.category ?? product.category ?? '';
  const aliases = unique([...(product.aliases ?? []), ...(overrides.aliases ?? [])]);
  const productFamily = overrides.productFamily ?? product.productFamily ?? inferProductFamily({
    name: overrides.name ?? product.name,
    category,
    aliases,
  });
  const normalizedPresentation = overrides.normalizedPresentation
    ?? product.normalizedPresentation
    ?? normalizePresentation(presentation);
  const attributes = {
    ...presentationAttributes(presentation),
    ...(product.attributes ?? {}),
    ...(overrides.attributes ?? {}),
  };
  const tags = unique([
    ...categoryTags(category),
    ...productFamily.split(/[^a-z0-9]+/i),
    ...aliases,
    ...(overrides.tags ?? product.tags ?? []),
  ]).slice(0, 24);

  return {
    ...product,
    ...overrides,
    presentation,
    aliases,
    active: overrides.active ?? product.active ?? true,
    description: overrides.description ?? product.description ?? defaultDescription({
      name: overrides.name ?? product.name,
      category,
      presentation,
    }),
    tags,
    productFamily,
    normalizedPresentation,
    attributes,
    catalogOrigin: overrides.catalogOrigin ?? product.catalogOrigin ?? 'colombia_test_reference',
  };
}

export function normalizePresentation(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/mililitros?/g, 'ml')
    .replace(/litros?/g, 'l')
    .replace(/gramos?/g, 'g')
    .replace(/kilogramos?/g, 'kg')
    .replace(/unidades?/g, 'und')
    .replace(/\s+/g, ' ');
}

function presentationAttributes(presentation) {
  const normalized = normalizePresentation(presentation);
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg|und|rollos?|tacos|cubos|sachets?|par(?:es)?|m)/);
  if (!match) return {};
  const amount = Number(match[1].replace(',', '.'));
  const unit = match[2].replace(/s$/, '');
  const dimension = ['ml', 'l'].includes(unit) ? 'volume'
    : ['g', 'kg'].includes(unit) ? 'weight'
      : unit === 'm' ? 'length' : 'count';
  const canonicalAmount = unit === 'l' ? amount * 1000 : unit === 'kg' ? amount * 1000 : amount;
  const canonicalUnit = dimension === 'volume' ? 'ml' : dimension === 'weight' ? 'g' : unit;
  return { measure: { amount, unit, dimension, canonicalAmount, canonicalUnit } };
}

function inferProductFamily({ name = '', category = '', aliases = [] }) {
  const categoryFamily = {
    dulces_y_chocolates: 'dulce',
    dulces_y_postres: 'dulce',
    snacks: 'snack',
    galletas: 'galleta',
    huevos: 'huevo',
  };
  const categoryMatch = categoryFamily[slug(category)];
  if (categoryMatch) return categoryMatch;

  const text = `${name} ${category} ${aliases.join(' ')}`.toLowerCase();
  const families = [
    ['gaseosa', ['coca-cola', 'pepsi', 'sprite', 'fanta', 'postobon', 'bretaña']],
    ['agua', ['agua', 'brisa', 'cristal']],
    ['jugo', ['jugo', 'cifrut', 'hit', 'frutto', 'mr tea']],
    ['lacteo', ['leche', 'yogurt', 'yogur', 'kumis', 'queso', 'margarina']],
    ['panaderia', ['pan ', 'arepa', 'tortilla', 'tostada']],
    ['carnes_frias', ['jamon', 'salchicha', 'salchichon', 'chorizo', 'mortadela']],
    ['grano', ['arroz', 'frijol', 'lenteja', 'garbanzo', 'maiz']],
    ['pasta', ['pasta', 'fideos', 'spaghetti']],
    ['snack', ['papas', 'doritos', 'tostacos', 'choclitos', 'mani', 'platanitos']],
    ['galleta', ['galleta', 'oreo', 'festival', 'chokis', 'ducales']],
    ['dulce', ['chocolate', 'chocolatina', 'chicle', 'trident', 'jumbo']],
    ['aseo_hogar', ['detergente', 'lavaloza', 'blanqueador', 'papel higienico', 'bolsa', 'ambientador']],
    ['cuidado_personal', ['shampoo', 'desodorante', 'crema dental', 'cuchilla', 'protector', 'panito']],
    ['bebe', ['panal', 'compota', 'toallita']],
    ['mascotas', ['dog chow', 'cat chow', 'arena gato', 'comida perro']],
  ];
  return families.find(([, needles]) => needles.some((needle) => text.includes(needle)))?.[0]
    ?? slug(category || name || 'varios');
}

function categoryTags(category) {
  const normalized = slug(category);
  const tags = {
    bebidas: ['bebida', 'fria', 'sed'],
    gaseosas: ['bebida', 'fria', 'sed'],
    jugos: ['bebida', 'fria', 'lonchera'],
    lacteos: ['desayuno', 'lonchera'],
    panaderia: ['desayuno', 'onces'],
    snacks: ['onces', 'lonchera', 'pasabocas'],
    galletas: ['onces', 'lonchera'],
    despensa: ['cocina', 'mercado'],
    aseo_hogar: ['hogar', 'limpieza'],
    aseo_personal: ['higiene', 'cuidado personal'],
    bebes: ['bebe'],
    mascotas: ['mascota'],
  };
  return tags[normalized] ?? [];
}

function defaultDescription({ name, category, presentation }) {
  return `${name} es una referencia de ${category || 'tienda'} en presentacion ${presentation || 'por validar'} para pruebas locales.`;
}

function unique(values) {
  return [...new Set(values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean))];
}

function slug(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
