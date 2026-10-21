import assert from 'node:assert/strict';
import { selectDistinctOrderProduct } from '../services/agentRuntime.js';

const chocoramo = { sku: 'BOG-PAN-019', name: 'Ponque Chocoramo', aliases: ['chocorramo', 'chocoramo'], stock: 20, price: 2800 };
const cifrut = { sku: 'BOG-BEB-051', name: 'Cifrut granadilla', aliases: ['cifrut', 'jugo granadilla'], stock: 20, price: 1800 };

const first = selectDistinctOrderProduct([chocoramo], { rawName: 'chocorramo', catalogQuery: 'chocorramo' }, []);
assert.equal(first?.sku, chocoramo.sku);

const secondWhenOnlyWrongSkuRemains = selectDistinctOrderProduct([chocoramo], { rawName: 'cifrut de granadilla', catalogQuery: 'cifrut granadilla' }, [{ rawName: 'chocorramo', catalogQuery: 'chocorramo', product: first }]);
assert.equal(secondWhenOnlyWrongSkuRemains, null, 'No debe reutilizar Chocoramo para una solicitud de Cifrut.');

const secondWithOwnCandidate = selectDistinctOrderProduct([chocoramo, cifrut], { rawName: 'cifrut de granadilla', catalogQuery: 'cifrut granadilla' }, [{ rawName: 'chocorramo', catalogQuery: 'chocorramo', product: first }]);
assert.equal(secondWithOwnCandidate?.sku, cifrut.sku);

const repeatedExplicitProduct = selectDistinctOrderProduct([chocoramo], { rawName: 'chocorramo', catalogQuery: 'chocorramo' }, [{ rawName: 'chocorramo', catalogQuery: 'chocorramo', product: first }]);
assert.equal(repeatedExplicitProduct?.sku, chocoramo.sku, 'El mismo producto puede repetirse cuando el cliente lo pidio explicitamente.');

console.log('Order item isolation contract checks passed');
