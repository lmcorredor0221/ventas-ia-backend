export default function PaymentNotices({ notices = [] }) {
  if (!notices.length) return null;
  return <section className="approval-context" aria-label="Comprobantes y avisos de pago">
    <details open>
      <summary><strong>Comprobantes y avisos de pago ({notices.length})</strong></summary>
      <p>Son avisos del cliente. VIA no verifica pagos y estos avisos no bloquean alistamiento ni envío.</p>
      {notices.map(notice => <article className="event-card" key={notice.id}>
        <strong>{notice.attachment ? 'Comprobante adjunto recibido' : 'El cliente informa que pagó'} · {notice.customerName || notice.customerWaId}</strong>
        <p>{notice.text || 'Adjunto recibido en la conversación.'}</p>
        <p>{notice.orderId ? `Referencia: ${notice.orderId}` : 'Sin pedido asociado; consultar el contexto con el cliente.'}</p>
        <small>{new Date(notice.createdAt).toLocaleString('es-CO')}</small>{' '}
        <a href={`https://wa.me/${String(notice.customerWaId ?? '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
          {notice.attachment ? 'Ver comprobante en WhatsApp' : 'Ver conversación en WhatsApp'}
        </a>
      </article>)}
    </details>
  </section>;
}
