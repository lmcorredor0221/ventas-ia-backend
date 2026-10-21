import React from 'react';
import { AlertTriangle, Check, Clock3, Store, UserCheck } from 'lucide-react';
import { ORDER_STAGE_LABELS, orderStageIndex, orderStatusLabel } from '../../domain/orders/status.js';

export default function OrderProgressCard({ order, conversationAvailable, onSelectConversation, onAdvance, busy, selected }) {
  const stageIndex = orderStageIndex(order.status);
  return (
    <article className={`request-card order-progress-card ${selected ? 'is-selected' : ''}`} data-order-id={order.id} tabIndex={selected ? -1 : undefined}>
      <div className="request-top">
        <span className={`order-status-chip is-${order.status}`}>{orderStatusLabel(order.status)}</span>
        <span className="request-kind">{formatDateShort(order.updatedAt ?? order.createdAt)}</span>
      </div>
      <h3>{order.customerName || 'Cliente'} · {formatCurrency(order.subtotal)}</h3>
      <p className="order-progress-reference">Pedido {order.id}</p>
      {order.status === 'cancelled' ? (
        <p className="order-cancelled-note">Este pedido no se pudo alistar. Conservamos el registro para que puedas revisarlo.</p>
      ) : (
        <ol className="order-journey" aria-label="Estado del pedido">
          {ORDER_STAGE_LABELS.map((label, index) => (
            <li className={index < stageIndex ? 'is-done' : index === stageIndex ? 'is-current' : ''} key={label}>
              {index <= stageIndex ? <Check size={13} aria-hidden="true" /> : <Clock3 size={13} aria-hidden="true" />}{label}
            </li>
          ))}
        </ol>
      )}
      <div className="delivery-items">
        {(order.items ?? []).slice(0, 5).map((item, index) => (
          <div key={`${item.name}-${index}`}><strong>{item.quantity ?? 1}x</strong><span>{item.name ?? item.catalogQuery ?? 'Producto'}</span></div>
        ))}
        {(order.items ?? []).length > 5 && <em>+ {(order.items ?? []).length - 5} productos más</em>}
      </div>
      <div className="delivery-destination">
        <InfoLine icon={Store} label="Entrega" value={order.deliveryAddress || 'Dirección pendiente'} />
        <InfoLine icon={UserCheck} label="Responsable" value="Tu tienda" />
      </div>
      {order.sheetSyncStatus === 'pending' && <p className="order-sync-note"><AlertTriangle size={15} aria-hidden="true" /> El cambio quedó guardado aquí, pero la hoja de Google no estaba conectada. Revísala al reconectar.</p>}
      <div className="order-progress-actions">
        {order.status === 'pending_human_preparation' && <button className="approve-btn" type="button" disabled={busy} onClick={() => onAdvance(order.id, 'preparing')}>{busy ? 'Guardando…' : 'Marcar tomado'}</button>}
        {order.status === 'preparing' && <button className="approve-btn" type="button" disabled={busy} onClick={() => onAdvance(order.id, 'dispatched')}>{busy ? 'Guardando…' : 'Marcar en camino'}</button>}
        {order.status === 'dispatched' && <button className="approve-btn" type="button" disabled={busy} onClick={() => onAdvance(order.id, 'delivered')}>{busy ? 'Guardando…' : 'Marcar entregado'}</button>}
        {conversationAvailable && <button className="text-btn" type="button" onClick={() => onSelectConversation(order.conversationId)}>Abrir conversación</button>}
      </div>
    </article>
  );
}

function InfoLine({ icon: Icon, label, value }) {
  return (
    <div className="info-line">
      <Icon size={17} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function formatDateShort(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}
