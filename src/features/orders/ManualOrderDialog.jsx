import React, { useEffect, useRef, useState } from 'react';
import { getJson } from '../../core/api/client.js';
import './ManualOrderDialog.css';

const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const searchable = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default function ManualOrderDialog({ conversationId, onClose, onSubmit, onOpenOrder }) {
  const dialog = useRef(null);
  const initialized = useRef(false);
  const [context, setContext] = useState(null);
  const [form, setForm] = useState({ customerName: '', deliveryAddress: '', paymentMethod: '', items: [] });
  const [query, setQuery] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getJson(`/api/conversations/${encodeURIComponent(conversationId)}/manual-order`, { signal: controller.signal, timeoutMs: 30000 })
      .then(data => {
        if (controller.signal.aborted) return;
        setContext(data);
        if (!initialized.current && data.draft) { setForm(data.draft); initialized.current = true; }
        setConfirmed(false);
        setError('');
      })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [conversationId, revision]);

  const products = context?.products ?? [];
  const lines = form.items.map(item => ({ ...item, product: products.find(product => product.sku === item.sku) }));
  const validLine = line => line.product && Number.isFinite(line.product.price) && line.product.price > 0
    && Number.isInteger(Number(line.quantity)) && Number(line.quantity) > 0 && Number(line.quantity) <= 999
    && Number.isFinite(line.product.stock) && line.product.stock >= Number(line.quantity);
  const validCart = lines.length > 0 && lines.every(validLine);
  const total = lines.reduce((sum, line) => sum + (line.product?.price ?? 0) * Number(line.quantity || 0), 0);
  const results = query.trim() ? products.filter(product => searchable(`${product.name} ${product.presentation} ${product.description} ${product.sku}`).includes(searchable(query))).slice(0, 20) : [];
  const change = patch => { setForm(current => ({ ...current, ...patch })); setConfirmed(false); };
  const add = product => {
    const exists = form.items.find(item => item.sku === product.sku);
    change({ items: exists ? form.items.map(item => item.sku === product.sku ? { ...item, quantity: Number(item.quantity) + 1 } : item)
      : [...form.items, { sku: product.sku, quantity: 1 }] });
    setQuery('');
  };
  const submit = async event => {
    event.preventDefault();
    if (busy || !validCart || !confirmed) return;
    setBusy(true); setError('');
    try {
      await onSubmit(conversationId, { ...form, customerConfirmed: confirmed,
        items: lines.map(line => ({ sku: line.sku, quantity: Number(line.quantity), unitPrice: line.product.price })) });
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  return (
    <dialog ref={dialog} className="manual-order-dialog" aria-labelledby="manual-order-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <header>
        <div><span className="eyebrow">PEDIDO ATENDIDO POR LA TIENDA</span><h2 id="manual-order-title">Confirmar y alistar pedido</h2></div>
        <button type="button" className="ghost-btn compact" onClick={onClose} disabled={busy} aria-label="Cerrar formulario de pedido">✕</button>
      </header>
      <p>Registra lo acordado con el cliente por WhatsApp. Revisa productos y total antes de pasarlo a alistamiento.</p>
      {error && <p role="alert" className="manual-order-error">{error}</p>}
      {context?.conversation?.messages?.length > 0 && (
        <section className="manual-order-conversation" aria-label="Mensajes de la conversación escalada">
          <h3>Lo que acordaste con el cliente</h3>
          <div className="manual-order-conversation-list">
            {context.conversation.messages.slice(-8).map((message, index) => (
              <div key={message.id ?? `${message.createdAt ?? 'message'}-${index}`} className={`manual-order-message manual-order-message-${message.role ?? 'unknown'}`}>
                <strong>{message.label ?? (message.role === 'assistant' ? 'Asistente' : 'Cliente')}</strong>
                <span>{message.text ?? ''}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {loading ? <p role="status">Consultando el catálogo de tu tienda…</p> : context?.order ? (
        <div><p>Esta conversación ya tiene un pedido registrado.</p><button className="approve-btn" onClick={() => onOpenOrder(context.order.id)}>Ver pedido</button></div>
      ) : context ? (
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <div className="manual-order-fields">
              <label>Nombre del cliente<input required maxLength={160} value={form.customerName} onChange={event => change({ customerName: event.target.value })} autoComplete="off" /></label>
              <label>Dirección de entrega<input required maxLength={500} value={form.deliveryAddress} onChange={event => change({ deliveryAddress: event.target.value })} autoComplete="off" /></label>
              <label>Forma de pago<select aria-label="Forma de pago" required value={form.paymentMethod} onChange={event => change({ paymentMethod: event.target.value })}><option value="">Selecciona una opción</option>{context.paymentMethods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}</select></label>
            </div>
            <label className="manual-order-search">Agregar productos del catálogo<input type="search" placeholder="Nombre, presentación o descripción" value={query} onChange={event => setQuery(event.target.value)} /></label>
            {query.trim() && <ul className="manual-order-results" aria-label="Productos encontrados">
              {results.map(product => <li key={product.sku}><button type="button" disabled={!(product.price > 0 && product.stock > 0)} onClick={() => add(product)}>
                <strong>{product.name} {product.presentation}</strong><span>{money(product.price)} · {product.stock > 0 ? `${product.stock} disponibles` : 'Sin existencias'}</span><span>Agregar</span>
              </button></li>)}
              {!results.length && <li>No hay coincidencias. Revisa el nombre o actualiza el catálogo en Tienda viva.</li>}
            </ul>}
            <div className="manual-order-lines" aria-label="Productos del pedido">
              {!lines.length && <p>Agrega al menos un producto.</p>}
              {lines.map(line => <div key={line.sku} className="manual-order-line">
                <div><strong>{line.product?.name ?? line.sku} {line.product?.presentation}</strong><small>{money(line.product?.price ?? 0)} por unidad</small>{!validLine(line) && <small className="manual-order-error">Revisa la cantidad, el precio o las existencias.</small>}</div>
                <label>Cantidad<input aria-label={`Cantidad de ${line.product?.name ?? line.sku}`} type="number" min="1" max="999" step="1" required value={line.quantity} onChange={event => change({ items: form.items.map(item => item.sku === line.sku ? { ...item, quantity: event.target.value } : item) })} /></label>
                <strong>{money((line.product?.price ?? 0) * Number(line.quantity || 0))}</strong>
                <button className="ghost-btn compact" type="button" aria-label={`Quitar ${line.product?.name ?? line.sku}`} onClick={() => change({ items: form.items.filter(item => item.sku !== line.sku) })}>Quitar</button>
              </div>)}
            </div>
            <p className="manual-order-total"><span>Subtotal de productos</span><strong>{money(total)}</strong></p>
            <label className="manual-order-consent"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required />El cliente confirmó estos productos, cantidades, dirección, forma de pago y total.</label>
            <p className="manual-order-help">Quedará en Alistando. Cuando lo despaches, usa «Marcar en camino» para avisar al cliente y cerrar el pedido.</p>
            <footer><button className="ghost-btn" type="button" onClick={() => setRevision(value => value + 1)}>Recargar catálogo</button><button className="approve-btn" type="submit" disabled={!validCart || !confirmed || busy}>{busy ? 'Guardando pedido…' : 'Confirmar y alistar pedido'}</button></footer>
          </fieldset>
        </form>
      ) : <button className="ghost-btn" onClick={() => setRevision(value => value + 1)}>Reintentar</button>}
    </dialog>
  );
}
