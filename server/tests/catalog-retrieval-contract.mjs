import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../index.js';
import { colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-catalog-retrieval-'));

try {
  const { store, tools } = createApp({ dataFile: path.join(tempDir, 'store.json') });
  store.mutate((state) => {
    state.productsByTenant.andina = structuredClone(colombiaCatalogTestSeed300);
  });

  const salmon = await tools.googleSheetsReadTable('andina', { filters: { query: 'salmon' } });
  assert.equal(salmon.rows.length, 0, 'Un producto ausente no puede convertirse en Saltin o sal por similitud debil.');

  const arroz = await tools.googleSheetsReadTable('andina', { filters: { query: 'arroz diana' } });
  assert.match(arroz.rows[0]?.name ?? '', /^Arroz Diana\b/i, 'La marca solicitada debe prevalecer sobre un arroz generico.');

  const jabon = await tools.googleSheetsReadTable('andina', { filters: { query: 'jabon para lavar ropa' } });
  assert.match(jabon.rows[0]?.name ?? '', /^Jabon\b/i, 'El nombre del producto debe prevalecer sobre un accesorio que solo comparte el uso.');

  const queso = await tools.googleSheetsReadTable('andina', { filters: { query: 'queso' } });
  assert.match(queso.rows[0]?.name ?? '', /^Queso\b/i, 'Queso debe priorizar queso y no una arepa con queso.');

  const chocoramoTypo = await tools.googleSheetsReadTable('andina', { filters: { query: 'chocramos' } });
  assert.match(chocoramoTypo.rows[0]?.name ?? '', /Chocoramo/i, 'Un typo colombiano de distancia dos en una marca larga debe conservar evidencia recuperable.');

  const pan = await tools.googleSheetsReadTable('andina', { filters: { query: 'pan' } });
  assert.match(pan.rows[0]?.name ?? '', /^Pan\b/i, 'Pan debe priorizar pan y no un ponque por etiquetas secundarias.');

  const snacks = await tools.googleSheetsReadTable('andina', { filters: { category: 'snacks' } });
  assert.ok(snacks.rows.some((product) => /galleta/i.test(product.category ?? '') || /galleta/i.test(product.name ?? '')), 'La categoria snacks debe abarcar galletas.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Catalog retrieval contract checks passed');
