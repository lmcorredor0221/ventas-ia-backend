const DEFAULT_GOOGLE_SHEET_RANGES = Object.freeze({
  catalogRange: 'Catalogo!A1:Q1000',
  customerProfilesRange: 'Clientes!A1:H1000',
  ordersRange: 'Pedidos!A1:M1000',
});

export function googleSheetRangesForTenant(tenant) {
  const configured = tenant?.config?.googleSheets ?? {};
  return {
    catalogRange: configured.catalogRange ?? configured.range ?? DEFAULT_GOOGLE_SHEET_RANGES.catalogRange,
    customerProfilesRange: configured.customerProfilesRange ?? DEFAULT_GOOGLE_SHEET_RANGES.customerProfilesRange,
    ordersRange: configured.ordersRange ?? DEFAULT_GOOGLE_SHEET_RANGES.ordersRange,
  };
}

export function googleSheetRangeParts(range, fallbackSheet = 'Sheet1', fallbackStart = 'A', fallbackEnd = 'A') {
  const text = String(range ?? '').trim();
  const bang = text.lastIndexOf('!');
  const sheet = bang >= 0 ? text.slice(0, bang) : fallbackSheet;
  const coordinates = bang >= 0 ? text.slice(bang + 1) : text;
  const [startCell, endCell] = coordinates.split(':');
  const startColumn = startCell?.match(/[A-Za-z]+/)?.[0]?.toUpperCase() ?? fallbackStart;
  const endColumn = endCell?.match(/[A-Za-z]+/)?.[0]?.toUpperCase() ?? fallbackEnd;
  return { sheet, startColumn, endColumn };
}

export function googleSheetAppendRange(range, fallbackSheet, fallbackStart, fallbackEnd) {
  const parts = googleSheetRangeParts(range, fallbackSheet, fallbackStart, fallbackEnd);
  return `${parts.sheet}!${parts.startColumn}:${parts.endColumn}`;
}

export function googleSheetColumnRange(range, column = 'start', fallbackSheet, fallbackStart, fallbackEnd) {
  const parts = googleSheetRangeParts(range, fallbackSheet, fallbackStart, fallbackEnd);
  const selected = column === 'end' ? parts.endColumn : parts.startColumn;
  return `${parts.sheet}!${selected}:${selected}`;
}

export function googleSheetRowRange(range, rowNumber, fallbackSheet, fallbackStart, fallbackEnd) {
  const parts = googleSheetRangeParts(range, fallbackSheet, fallbackStart, fallbackEnd);
  return `${parts.sheet}!${parts.startColumn}${rowNumber}:${parts.endColumn}${rowNumber}`;
}

export function googleSheetOrderStatusRowRange(range, rowNumber) {
  const { sheet } = googleSheetRangeParts(range, 'Pedidos', 'A', 'M');
  return `${sheet}!G${rowNumber}:J${rowNumber}`;
}

export { DEFAULT_GOOGLE_SHEET_RANGES };
