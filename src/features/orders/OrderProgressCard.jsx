import React from 'react';
import { AlertTriangle, Check, CircleDollarSign, Clock3, Store, UserCheck } from 'lucide-react';
import { ORDER_STAGE_LABELS, orderStageIndex, orderStatusLabel } from '../../domain/orders/status.js';

export default function OrderProgressCard({ order, conversationAvailable, onSelectConversation, onAdvance, onOpenWorkspace, busy, selected }) {
  const stageIndex = orderStageIndex(order.status);
  return (
    <article className={`request-card order-progress-card ${selected ? 'is-selected' : ''}`} data-order-id={order.id} tabIndex={selected ? -1 : undefined}>
      <div className="request-top">
        <span className={`order-status-chip is-${order.status}`}>{orderStatusLabel(order.status)}</span>
        <span className="request-kind">{formatDateShort(order.updatedAt ?? order.createdAt)}</span>
      </div>
      <h3>{order.customerName || 'Cliente'}</h3>
      <p className="order-progress-reference">Pedido {order.id}</p>
      <OrderPricingSummary pricing={order.pricing} subtotal={order.subtotal} />
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
          <div key={`${item.name}-${index}`} className={item.saleMode === 'amount' ? 'is-amount-sale' : undefined}><strong>{item.saleMode === 'amount' ? formatCurrency(item.requestedAmount) : `${item.quantity ?? 1}x`}</strong><span>{item.name ?? item.catalogQuery ?? 'Producto'}{item.saleMode === 'amount' ? ' · por valor' : ''}</span></div>
        ))}
        {(order.items ?? []).length > 5 && <em>+ {(order.items ?? []).length - 5} productos más</em>}
      </div>
      <div className="delivery-destination">
        <InfoLine icon={Store} label="Entrega" value={order.deliveryAddress || 'Dirección pendiente'} />
        {order.paymentMethodLabel && <InfoLine icon={CircleDollarSign} label="Pago" value={order.paymentMethodLabel} />}
        <InfoLine icon={UserCheck} label="Responsable" value="Tu tienda" />
      </div>
      {order.sheetSyncStatus === 'pending' && <p className="order-sync-note"><AlertTriangle size={15} aria-hidden="true" /> El cambio quedó guardado aquí, pero la hoja de Google no estaba conectada. Revísala al reconectar.</p>}
      <div className="order-progress-actions">
        {onOpenWorkspace && <button className="ghost-btn" type="button" onClick={() => onOpenWorkspace(order.id)}>Ver pedido y conversación</button>}
        {order.status === 'pending_human_preparation' && <button className="approve-btn" type="button" disabled={busy} onClick={() => onAdvance(order.id, 'preparing')}>{busy ? 'Guardando…' : 'Marcar tomado'}</button>}
        {order.status === 'preparing' && <button className="approve-btn" type="button" disabled={busy} onClick={() => onAdvance(order.id, 'dispatched')}>{busy ? 'Guardando…' : 'Marcar en camino'}</button>}
        {order.status === 'dispatched' && <button className="approve-btn" type="button" disabled={busy} onClick={() => onAdvance(order.id, 'delivered')}>{busy ? 'Guardando…' : 'Marcar entregado'}</button>}
        {conversationAvailable && <button className="text-btn" type="button" onClick={() => onSelectConversation(order.conversationId)}>Abrir conversación</button>}
      </div>
    </article>
  );
}

export function OrderPricingSummary({ pricing, subtotal, showMinimum = false }) {
  const amount = (value, unknown = 'Por definir') => Number.isSafeInteger(value) && value >= 0 ? formatCurrency(value) : unknown;
  return (
    <div className="delivery-destination order-pricing-summary" aria-label="Desglose del pedido en COP">
      <InfoLine icon={CircleDollarSign} label={pricing?.status === 'basket_incomplete' ? 'Subtotal parcial de productos' : 'Subtotal de productos'} value={amount(pricing ? pricing.subtotal : subtotal, 'No registrado')} />
      <InfoLine icon={CircleDollarSign} label={pricing?.delivery === false ? 'Domicilio (no aplica al retiro)' : 'Domicilio'} value={pricing ? amount(pricing.deliveryFee) : 'Desglose de domicilio no registrado'} />
      <InfoLine icon={CircleDollarSign} label="Total" value={pricing ? amount(pricing.total, 'Pendiente de cotizar') : 'No registrado'} />
      {pricing?.status === 'basket_incomplete' && <p>Canasta incompleta. Estos importes aún no son una cotización final.</p>}
      {pricing?.status === 'configuration_incomplete' && <p>Condiciones del domicilio pendientes de definir antes de confirmar.</p>}
      {showMinimum && pricing && (
        <>
          <InfoLine icon={CircleDollarSign} label="Mínimo de productos" value={amount(pricing.minimumSubtotal)} />
          <InfoLine icon={CircleDollarSign} label="Faltante para el mínimo" value={amount(pricing.shortfall)} />
          <p>{pricing.status === 'exception_approved' ? 'Excepción al mínimo autorizada para este pedido.' : pricing.delivery === false ? 'Mínimo de domicilio no aplicable al retiro.' : pricing.minimumMet === true ? 'Mínimo cumplido.' : pricing.minimumMet === false ? 'Mínimo sin cumplir. Requiere completar productos o una excepción autorizada.' : 'Condiciones pendientes de validar.'}</p>
        </>
      )}
    </div>
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
