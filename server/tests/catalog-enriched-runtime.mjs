import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { catalogImportRanges, enrichedCatalogRange } from '../domain/catalogMetadata.js';

assert.equal(enrichedCatalogRange('Catalogo!A:H'), 'Catalogo!A:Q');
assert.equal(enrichedCatalogRange('RangoNombrado'), 'RangoNombrado');
assert.equal(enrichedCatalogRange('Catalogo!A1:Q2000'), 'Catalogo!A1:Q2000');
assert.deepEqual(catalogImportRanges("'Otra hoja'!A3:J1000", 1200, 1500), {
  read:"'Otra hoja'!A3:Q1503", clear:"'Otra hoja'!A3:Q1503", write:"'Otra hoja'!A3:Q1203",
});
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'via-catalog-attributes-'));
const {store,runtime,integrationOutbox} = await createAppAsync({storageDriver:'json',whatsappMode:'mock',allowLocalCatalogFallback:true,dataFile:path.join(dir,'store.json')});
runtime.planner = {};
const product = {sku:'PANOS',name:'Paños',price:4000,stock:10,presentation:'2 unidades',description:'Reutilizables',attributes:{material:'algodon'}};
try {
  store.mutate(state=>{state.productsByTenant.andina=[product];});
  for (const material of ['algodon','seda']) {
    const id=`attrs-${material}`;
    store.mutate(state=>state.conversations.unshift({id,tenantId:'andina',waId:'573000000001',messages:[],status:'live'}));
    await runtime.handleDeliveryOrder({tenantId:'andina',conversationId:id,
      normalized:{text:`Unos paños de ${material}`,waId:'573000000001'},customerProfile:null,
      plan:{intent:'delivery_order',order:{delivery:true,items:[{skuHint:'PANOS',rawName:'Paños',catalogQuery:'paños',quantity:1,requestedAttributes:{material}}]},missingFields:[]},
    });
    const draft=store.getState().conversations.find(c=>c.id===id).orderDraft;
    if (material==='algodon') {
      assert.equal(draft.items[0].product.sku,'PANOS');
      assert.equal(draft.subtotal,4000);
    } else {
      assert.ok(!draft.items[0].product,'A suggested SKU must not bypass an explicit conflicting attribute');
      assert.equal(store.getState().conversations.find((conversation) => conversation.id === id).status, 'live');
      assert.equal(store.getState().conversations.find((conversation) => conversation.id === id).clarificationState?.attempts, 1);
      assert.ok(!store.getState().pendingRequests.some(r=>r.conversationId===id),'Missing evidence starts a contextual clarification before human escalation');
    }
  }
  console.log('Catalog constraints survive runtime quoting and missing evidence requests clarification');
} finally {
  integrationOutbox?.stop?.();
  await store.close?.();
  fs.rmSync(dir,{recursive:true,force:true});
}
