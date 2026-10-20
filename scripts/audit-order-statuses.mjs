import fs from 'node:fs/promises';
import path from 'node:path';
import { fromGoogleSheetStatus, ORDER_STATUSES } from '../server/domain/orderStatus.js';

const args = new Map(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (!value.startsWith('--')) return pairs;
  pairs.push([value.slice(2), values[index + 1] && !values[index + 1].startsWith('--') ? values[index + 1] : true]);
  return pairs;
}, []));
const inputPath = args.get('input');
if (!inputPath) {
  console.error('Uso: node scripts/audit-order-statuses.mjs --input ./export-pedidos.json');
  process.exit(1);
}

const raw = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
const rows = Array.isArray(raw) ? raw : raw.rows ?? raw.values ?? raw.orders ?? [];
const report = {
  total: rows.length,
  known: 0,
  unknown: 0,
  byCanonicalStatus: Object.fromEntries(Object.values(ORDER_STATUSES).map((status) => [status, 0])),
  unknownValues: {},
  entries: [],
};

for (const [index, row] of rows.entries()) {
  const value = row?.estado ?? row?.status ?? row?.Estado ?? row?.[6] ?? null;
  const canonical = fromGoogleSheetStatus(value);
  if (canonical) {
    report.known += 1;
    report.byCanonicalStatus[canonical] += 1;
  } else {
    report.unknown += 1;
    const key = String(value ?? 'empty');
    report.unknownValues[key] = (report.unknownValues[key] ?? 0) + 1;
    report.entries.push({ index, value });
  }
}

console.log(JSON.stringify(report, null, 2));
