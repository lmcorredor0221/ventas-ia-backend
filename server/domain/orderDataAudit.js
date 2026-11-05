import { createHash } from 'node:crypto';
import { catalogLineTotal, deliveryPolicyRevision } from './deliveryPolicy.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function orderDataRevision(draft, tenant) {
  return hash([tenant.id, deliveryPolicyRevision(tenant), draft.delivery, draft.customerName ?? null,
    draft.deliveryAddress ?? null, draft.paymentMethod ?? null, (draft.items ?? []).map(i =>
      [i.rawItemId, i.product?.sku, i.quantity ?? null, i.saleMode ?? null, i.requestedAmount ?? null,
        i.product?.price, i.product?.stock, i.product?.active, i.product?.allowsSaleByAmount === true])]);
}

const fail = code => { throw Object.assign(new Error(code), { code }); };
const keysOnly = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) fail('audit_invalid_fields');
};

// The model owns interpretation. This boundary validates provenance, tenant
// ownership and commercial invariants; it never infers intent from keywords.
export function applyOrderDataAudit({ result, draft, tenant, messages, catalog, paymentMethods }) {
  keysOnly(result, ['verdict', 'purchaseIntent', 'corrections', 'reason']);
  if (!['purchase', 'inquiry', 'uncertain'].includes(result.purchaseIntent)) fail('audit_missing_purchase_intent');
  if (['approve', 'correct'].includes(result.verdict) && result.purchaseIntent !== 'purchase') fail('audit_no_purchase_intent');
  if (!['approve', 'correct', 'clarify', 'human_review'].includes(result.verdict)
    || !Array.isArray(result.corrections) || result.corrections.length > 20) fail('audit_invalid_contract');
  if (result.verdict !== 'correct' && result.corrections.length) fail('audit_unexpected_corrections');
  if (result.verdict === 'correct' && !result.corrections.length) fail('audit_empty_correction');
  const next = structuredClone(draft);
  const products = new Map(catalog.filter(p => p.tenantId === tenant.id).map(p => [p.sku, p]));
  const receipts = [];
  for (const [index, patch] of result.corrections.entries()) {
    keysOnly(patch, ['op', 'rawItemId', 'sku', 'changes', 'field', 'value', 'evidence', 'reason']);
    if (!Array.isArray(patch.evidence) || !patch.evidence.length || typeof patch.reason !== 'string') fail('audit_missing_evidence');
    for (const ref of patch.evidence) {
      const source = messages.find(m => m.id === ref.messageId && m.role === 'user');
      if (!source || typeof ref.quote !== 'string' || !ref.quote.trim() || !source.text.includes(ref.quote)) fail('audit_invalid_evidence');
    }
    const position = next.items.findIndex(i => i.rawItemId === patch.rawItemId);
    if (patch.op === 'set_field') {
      if (!['delivery', 'customerName', 'deliveryAddress', 'paymentMethod'].includes(patch.field)) fail('audit_forbidden_field');
      if (patch.field === 'delivery' ? typeof patch.value !== 'boolean'
        : typeof patch.value !== 'string' || !patch.value.trim() || patch.value.length > 500) fail('audit_invalid_value');
      if (patch.field === 'paymentMethod' && !paymentMethods.some(m => m.id === patch.value)) fail('audit_invalid_payment');
      next[patch.field] = patch.value;
    } else if (patch.op === 'remove_line') {
      if (position < 0) fail('audit_unknown_line');
      next.items.splice(position, 1);
    } else if (['update_line', 'add_line'].includes(patch.op)) {
      if (patch.op === 'update_line' && position < 0) fail('audit_unknown_line');
      keysOnly(patch.changes, ['quantity', 'saleMode', 'requestedAmount']);
      const old = position >= 0 ? next.items[position] : {};
      const product = products.get(patch.sku ?? old.product?.sku);
      if (!product || product.active === false) fail('audit_unknown_product');
      const line = { ...old, ...patch.changes, product: structuredClone(product),
        rawItemId: old.rawItemId ?? `audit:${hash([patch.evidence, index]).slice(0, 20)}` };
      if (!['amount', 'units', null, undefined].includes(line.saleMode)) fail('audit_invalid_sale_mode');
      if (line.saleMode === 'amount' && product.allowsSaleByAmount !== true) fail('audit_amount_not_authorized');
      line.lineTotal = catalogLineTotal(line);
      if (line.lineTotal === null) fail('audit_unpriced_line');
      if (!(product.stock >= (line.quantity ?? 1))) fail('audit_insufficient_stock');
      line.available = true;
      line.catalogQuery = product.name;
      line.resolution = { status: 'resolved', reason: 'audited_customer_evidence' };
      line.presentationOptions = [];
      if (patch.op === 'add_line') {
        line.rawText = patch.evidence.map(e => e.quote).join(' ');
        next.items.push(line);
      } else next.items[position] = line;
    } else fail('audit_invalid_operation');
    receipts.push(structuredClone(patch));
  }
  if (!next.items.length && ['correct', 'approve'].includes(result.verdict)) fail('audit_empty_basket');
  return { draft: next, verdict: result.verdict, reason: String(result.reason ?? '').slice(0, 1000), corrections: receipts,
    revision: orderDataRevision(next, tenant) };
}
