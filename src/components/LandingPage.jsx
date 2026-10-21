import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Check, CheckCheck, ChevronDown, CircleHelp, Clock3,
  ListChecks, MapPin, MessageCircle, Pause, Play, RotateCcw,
  ShoppingBag, Store, UserCheck,
} from 'lucide-react';
import './LandingPage.css';

const number = new Intl.NumberFormat('es-CO');
const samples = {
  tienda: {
    name: 'Tienda', customer: 'Marta', address: 'Calle 12 # 7-18',
    message: 'Veci, me regala 2 leches de litro y 3 panes para domicilio.',
    items: [
      { name: 'Leche · 1 litro', quantity: 2, price: 4200, icon: '🥛' },
      { name: 'Pan', quantity: 3, price: 600, icon: '🥖' },
    ],
  },
  panaderia: {
    name: 'Panadería', customer: 'Carlos', address: 'Carrera 8 # 15-24',
    message: 'Buenos días, 2 croissants y 4 panes de queso para domicilio.',
    items: [
      { name: 'Croissant', quantity: 2, price: 4500, icon: '🥐' },
      { name: 'Pan de queso', quantity: 4, price: 1800, icon: '🧀' },
    ],
  },
};
const phases = ['Llega el mensaje', 'Se organiza el pedido', 'Tú lo preparas'];

function usePublicPlan() {
  const [offer, setOffer] = useState({ status: 'loading', plan: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let controller;
    let timeout;
    async function refresh() {
      controller?.abort();
      clearTimeout(timeout);
      controller = new AbortController();
      const request = controller;
      timeout = setTimeout(() => request.abort(), 10000);
      try {
        const response = await fetch('/api/billing/plans', { signal: request.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Plan unavailable');
        const payload = await response.json();
        const active = Array.isArray(payload.plans) ? payload.plans.filter((plan) => plan.isActive) : [];
        const plan = active.find((item) => item.isDefault) ?? active[0];
        if (!plan || !Number.isFinite(plan.amount) || plan.amount < 0
          || !/^[A-Z]{3}$/.test(plan.currency ?? '') || plan.billingFrequency !== 'monthly'
          || !Number.isFinite(plan.includedDeliveries) || plan.includedDeliveries <= 0
          || !Number.isFinite(plan.includedInteractions) || plan.includedInteractions <= 0) {
          throw new Error('Invalid plan');
        }
        // Never invent a price or a free trial when the billing service is unavailable.
        if (!disposed && controller === request) setOffer({ status: 'ready', plan });
      } catch {
        if (!disposed && controller === request) setOffer({ status: 'error', plan: null });
      } finally {
        if (controller === request) clearTimeout(timeout);
      }
    }
    function onVisible() { if (!document.hidden) refresh(); }
    refresh();
    const interval = setInterval(onVisible, 60000);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timeout);
      clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [attempt]);
  return { ...offer, retry: () => { setOffer({ status: 'loading', plan: null }); setAttempt((value) => value + 1); } };
}

function PlanPrice({ offer, compact = false }) {
  if (offer.status !== 'ready') {
    return <div className="shop-offer-status" role="status">
      <span>{offer.status === 'loading' ? 'Consultando precio y condiciones…' : 'No pudimos consultar el precio actual.'}</span>
      {offer.status === 'error' && <button type="button" onClick={offer.retry}>Volver a consultar</button>}
    </div>;
  }
  const { plan } = offer;
  const amount = new Intl.NumberFormat('es-CO', { style: 'currency', currency: plan.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(plan.amount);
  return <div className={compact ? 'shop-offer shop-offer-compact' : 'shop-offer'}>
    <div className="shop-price"><strong>{amount}</strong><span>{plan.currency} / mes</span></div>
    <p className="shop-limits">Hasta <b>{number.format(plan.includedDeliveries)} domicilios</b> y <b>{number.format(plan.includedInteractions)} mensajes atendidos</b> al mes.</p>
    <p className="shop-extra">WhatsApp cobra su uso aparte. <a href="#condiciones">Ver límites y condiciones <ArrowRight size={12} aria-hidden="true" /></a></p>
  </div>;
}

function OrderDemo({ demoRef, stage, setStage, running, setRunning, reducedMotion, replay, taken, setTaken }) {
  const [sampleKey, setSampleKey] = useState('tienda');
  const sample = samples[sampleKey];
  const total = sample.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  function selectSample(key) {
    setSampleKey(key);
    setTaken(false);
    setRunning(false);
    setStage(2);
  }
  function restart() { setTaken(false); replay(); }
  return <section className="shop-demo" id="demostracion" ref={demoRef} tabIndex={-1} aria-label="Demostración de un pedido de WhatsApp">
    <div className="shop-demo-top">
      <span className="shop-example-tag"><span aria-hidden="true" /> Ejemplo · datos ficticios</span>
      <div className="shop-demo-controls">
        {!reducedMotion && running && <button type="button" onClick={() => setRunning(false)} aria-label="Pausar demostración"><Pause size={16} aria-hidden="true" /></button>}
        <button type="button" onClick={restart} aria-label={reducedMotion ? 'Mostrar pedido completo' : 'Repetir demostración'}><RotateCcw size={16} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="shop-samples" role="group" aria-label="Elige un negocio para el ejemplo">
      {Object.entries(samples).map(([key, value]) => <button key={key} type="button" aria-pressed={sampleKey === key} onClick={() => selectSample(key)}>{value.name}</button>)}
    </div>
    <div className="shop-demo-scene" data-stage={stage}>
      <div className="shop-chat">
        <div className="shop-chat-heading"><span className="shop-chat-icon"><MessageCircle size={19} aria-hidden="true" /></span><div><b>Así te escribe tu cliente</b><span>Pedido por WhatsApp</span></div></div>
        <div className="shop-message" key={sampleKey}><p>{sample.message}</p><span>10:24 <CheckCheck size={13} aria-hidden="true" /></span></div>
        <div className={`shop-chat-reply ${stage >= 1 ? 'is-revealed' : ''}`}><b>El asistente pregunta lo que falta</b><span>“Claro. ¿A qué dirección te lo llevamos?”</span></div>
        <div className={`shop-address-reply ${stage === 2 ? 'is-revealed' : ''}`}><MapPin size={13} aria-hidden="true" />{sample.address}</div>
      </div>
      <div className="shop-transform" aria-hidden="true"><ArrowRight size={24} /></div>
      <div className={`shop-receipt ${taken ? 'is-taken' : ''}`}>
        <div className="shop-receipt-head"><span className="shop-receipt-icon"><ShoppingBag size={22} aria-hidden="true" /></span><div><span>Lo que recibes tú</span><h2>{taken ? 'Pedido tomado' : 'Listo para preparar'}</h2></div><CheckCircleMark /></div>
        <div className="shop-receipt-items">{sample.items.map((item) => <div className="shop-receipt-item" key={item.name}><span className="shop-product-emoji" aria-hidden="true">{item.icon}</span><span><b>{item.quantity} × {item.name}</b><small>Precio unitario: ${number.format(item.price)}</small></span><strong>${number.format(item.quantity * item.price)}</strong></div>)}</div>
        <div className="shop-receipt-customer"><span><UserCheck size={14} aria-hidden="true" />{sample.customer}</span><span><MapPin size={14} aria-hidden="true" />{sample.address}</span></div>
        <div className="shop-receipt-total"><span>Subtotal productos</span><strong>${number.format(total)}</strong></div>
        <button className="shop-take-order" type="button" onClick={() => { setTaken((value) => !value); setStage(2); setRunning(false); }} aria-pressed={taken}><Check size={17} aria-hidden="true" />{taken ? 'Tomado · volver al ejemplo' : 'Marcar tomado'}</button>
        <p className="shop-demo-feedback" role="status">{taken ? 'Así confirmas que tú te encargas de prepararlo.' : 'Prueba el botón. Este pedido es de ejemplo.'}</p>
      </div>
    </div>
    <div className="shop-demo-steps" role="group" aria-label="Pasos del pedido">
      {phases.map((phase, index) => <button type="button" key={phase} aria-pressed={stage === index} onClick={() => { setStage(index); setRunning(false); }}><span>{index < stage ? <Check size={12} aria-hidden="true" /> : index + 1}</span>{phase}</button>)}
    </div>
    <p className="shop-demo-disclaimer">Demostración con datos ficticios. No envía mensajes ni crea pedidos reales.</p>
  </section>;
}

function CheckCircleMark() {
  return <span className="shop-ready-mark" aria-hidden="true"><Check size={16} /></span>;
}

export default function LandingPage() {
  const offer = usePublicPlan();
  const plan = offer.plan;
  const trial = offer.status === 'ready' && plan.trialEnabled && Number.isFinite(plan.trialDays) && plan.trialDays > 0;
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [stage, setStage] = useState(() => reducedMotion ? 2 : 0);
  const [running, setRunning] = useState(() => !reducedMotion);
  const [taken, setTaken] = useState(false);
  const demoRef = useRef(null);
  const appHref = '/?app=1';
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    function update() { setReducedMotion(preference.matches); if (preference.matches) { setRunning(false); setStage(2); } }
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!running || reducedMotion || stage >= 2) return undefined;
    const timer = setTimeout(() => { setStage(stage + 1); if (stage === 1) setRunning(false); }, 1500);
    return () => clearTimeout(timer);
  }, [stage, running, reducedMotion]);
  function replay() { setTaken(false); setStage(reducedMotion ? 2 : 0); setRunning(!reducedMotion); }
  function tryDemo() { replay(); demoRef.current?.focus({ preventScroll: true }); }
  const trialNote = trial
    ? `${plan.trialDays} días gratis, sin tarjeta. Después, suscripción autorizada por ti.`
    : offer.status === 'ready'
      ? 'Demo gratis. Servicio por suscripción, sin prueba gratuita activa.'
      : offer.status === 'loading'
        ? 'El ejemplo es gratis. Estamos consultando las condiciones del servicio.'
        : 'El ejemplo es gratis. Consulta las condiciones antes de suscribirte.';

  return <main className="shop-landing">
    <a className="shop-skip" href="#contenido">Saltar al contenido</a>
    <header className="shop-nav shop-wrap">
      <a className="shop-brand" href="/landing" aria-label="Ventas IA, inicio"><span className="shop-brand-symbol"><Store size={24} aria-hidden="true" /></span><span>Ventas <b>IA</b><small>Una mano para tu negocio</small></span></a>
      <nav aria-label="Navegación principal"><a href="#demostracion">Ver un pedido</a><a href="#precio">Precio y límites</a></nav>
      <a className="shop-login" href={appHref}>Entrar a mi tienda <ArrowRight size={15} aria-hidden="true" /></a>
    </header>

    <section className="shop-hero shop-wrap" id="contenido" aria-labelledby="shop-title">
      <div className="shop-hero-copy">
        <span className="shop-eyebrow"><span aria-hidden="true" /> Para tiendas, minimercados y panaderías</span>
        <h1 id="shop-title">Tus pedidos de <span>WhatsApp,</span> listos para preparar.</h1>
        <p className="shop-hero-description">El asistente organiza el pedido y pregunta lo que falta. <strong>Tú atiendes tu negocio y decides cuando hace falta.</strong></p>
        <PlanPrice offer={offer} compact />
        <div className="shop-actions">
          <a className="shop-button shop-button-primary" href={trial ? appHref : '#demostracion'} onClick={trial ? undefined : tryDemo}>{trial ? `Probar ${plan.trialDays} días gratis` : 'Probar un pedido'}<ArrowRight size={18} aria-hidden="true" /></a>
          <a className="shop-text-link" href="#precio">Qué incluye <ChevronDown size={15} aria-hidden="true" /></a>
        </div>
        <p className="shop-trial-note" data-testid="trial-conditions" aria-live="polite">{trialNote}</p>
      </div>
      <OrderDemo demoRef={demoRef} stage={stage} setStage={setStage} running={running} setRunning={setRunning} reducedMotion={reducedMotion} replay={replay} taken={taken} setTaken={setTaken} />
    </section>

    <section className="shop-daily shop-wrap" aria-label="Lo que cambia en tu día">
      <div><MessageCircle aria-hidden="true" /><span>El cliente escribe<b>Como lo hace siempre.</b></span></div><ArrowRight className="shop-daily-arrow" aria-hidden="true" />
      <div><ListChecks aria-hidden="true" /><span>El asistente organiza<b>Productos, cantidades y dirección.</b></span></div><ArrowRight className="shop-daily-arrow" aria-hidden="true" />
      <div><ShoppingBag aria-hidden="true" /><span>Tú preparas<b>Con el pedido claro, en un lugar.</b></span></div>
    </section>

    <section className="shop-help shop-wrap" aria-labelledby="shop-help-title">
      <div className="shop-section-intro"><span className="shop-eyebrow">Menos mensajes por resolver</span><h2 id="shop-help-title">Una ayuda donde<br />más la necesitas.</h2></div>
      <div className="shop-help-cards">
        <article><span className="shop-feature-icon"><Clock3 size={25} aria-hidden="true" /></span><h3>Mientras atiendes el mostrador</h3><p>El asistente consulta tus productos y responde las preguntas del pedido.</p><span className="shop-small-label">Menos respuestas repetidas</span></article>
        <article><span className="shop-feature-icon"><ListChecks size={25} aria-hidden="true" /></span><h3>Todo junto para preparar</h3><p>Productos, cantidades, dirección y subtotal. Sin buscar entre mensajes.</p><span className="shop-small-label">Un pedido fácil de revisar</span></article>
        <article><span className="shop-feature-icon"><UserCheck size={25} aria-hidden="true" /></span><h3>Tu criterio sigue al mando</h3><p>Si falta un producto, llega una imagen o hay una duda, el caso pasa a tus pendientes.</p><span className="shop-small-label">Tú resuelves y continúas</span></article>
      </div>
    </section>

    <section className="shop-pricing shop-wrap" id="precio" aria-labelledby="shop-pricing-title">
      <div className="shop-pricing-copy"><span className="shop-eyebrow">Las cuentas, claras</span><h2 id="shop-pricing-title">Sabes qué pagas.<br />Sabes qué recibes.</h2><p>Una suscripción para organizar los pedidos de tu tienda. El asistente está incluido.</p><div className="shop-setup"><Store size={23} aria-hidden="true" /><span><b>Para comenzar</b>Necesitas tu cuenta de Google, tus productos con precios y un número de WhatsApp compatible. La conexión se revisa durante la activación.</span></div></div>
      <div className="shop-plan-card">
        <span className="shop-plan-label">Plan para tu tienda</span>
        <PlanPrice offer={offer} />
        <ul className="shop-included"><li><Check size={17} aria-hidden="true" />Asistente para atender y organizar pedidos</li><li><Check size={17} aria-hidden="true" />Consulta de tu catálogo y precios</li><li><Check size={17} aria-hidden="true" />Pedidos y casos pendientes en un lugar</li><li><Check size={17} aria-hidden="true" />Intervención humana cuando hace falta</li></ul>
        {offer.status === 'ready' && <a className="shop-button shop-button-primary" href={appHref}>{trial ? `Probar ${plan.trialDays} días gratis` : 'Crear mi tienda'}<ArrowRight size={18} aria-hidden="true" /></a>}
        <p className="shop-trial-note">{trialNote}</p>
        <div className="shop-conditions" id="condiciones">
          <details><summary>¿Qué pasa si llego al límite?<ChevronDown size={16} aria-hidden="true" /></summary><p>Ambos límites aplican por ciclo mensual. Al agotar los mensajes atendidos, se detiene la atención automática. Al agotar los domicilios, no se confirman nuevos pedidos. No se cobran excedentes automáticamente: debes revisar un cambio de plan o solicitar ayuda.</p><p>Las consultas que no terminan en pedido también consumen mensajes atendidos. Un domicilio puede necesitar varios mensajes.</p></details>
          <details><summary>¿Qué pago aparte?<ChevronDown size={16} aria-hidden="true" /></summary><p>El uso de WhatsApp lo cobra Meta o tu proveedor según sus tarifas y los mensajes enviados. No está incluido en esta suscripción. La activación y la conexión de tu número deben completarse antes de recibir pedidos reales.</p></details>
          <details><summary>¿Cómo puedo probarlo?<ChevronDown size={16} aria-hidden="true" /></summary><p>El ejemplo de esta página es gratuito, no requiere registro y no conecta tu WhatsApp.</p><p>{trial ? `La prueba del servicio dura ${plan.trialDays} días desde que creas tu tienda, sin registrar tarjeta por adelantado. Durante ese periodo debes conectar Google, preparar tu catálogo y conectar WhatsApp. Al terminar, necesitas autorizar la suscripción para continuar.` : offer.status === 'ready' ? 'Actualmente no hay prueba gratuita del servicio habilitada. Crear la cuenta no activa la atención real: necesitas una suscripción y completar las conexiones.' : 'Consulta de nuevo el precio para confirmar si hay una prueba gratuita del servicio disponible.'}</p></details>
        </div>
      </div>
    </section>

    <section className="shop-faq shop-wrap" aria-labelledby="shop-faq-title">
      <div><CircleHelp size={27} aria-hidden="true" /><span className="shop-eyebrow">Antes de empezar</span><h2 id="shop-faq-title">Tus dudas, resueltas.</h2></div>
      <div>
        <details><summary>¿Tengo que saber de tecnología?<ChevronDown size={18} aria-hidden="true" /></summary><p>No necesitas programar ni diseñar conversaciones. La puesta en marcha te guía para conectar tus cuentas y cargar tus productos. Necesitas poder autorizar tu cuenta de Google y los permisos de WhatsApp.</p></details>
        <details><summary>¿Cómo pongo mis productos y precios?<ChevronDown size={18} aria-hidden="true" /></summary><p>Al conectar Google se crea una hoja para tu tienda. Puedes completar allí productos, precios y existencias, o importar un archivo CSV desde la aplicación. Después mantienes los datos actualizados en esa hoja.</p></details>
        <details><summary>¿Puedo usar mi número de siempre?<ChevronDown size={18} aria-hidden="true" /></summary><p>La posibilidad de conectar tu número depende de su estado y de los requisitos de WhatsApp. Durante la activación debes revisar la modalidad de conexión y si permite seguir usando la aplicación del celular.</p></details>
        <details><summary>¿Qué pasa si el asistente no puede resolver algo?<ChevronDown size={18} aria-hidden="true" /></summary><p>El caso aparece en tus pendientes con el contexto para que respondas o decidas. Tú sigues a cargo de preparar el pedido y coordinar su entrega.</p></details>
      </div>
    </section>

    <section className="shop-closing shop-wrap"><span className="shop-closing-icon"><ShoppingBag size={33} aria-hidden="true" /></span><div><h2>Tu negocio en marcha.<br />Tus pedidos, en orden.</h2><p>Empieza viendo cómo se organiza un pedido.</p></div><a className="shop-button shop-button-light" href="#demostracion" onClick={tryDemo}><Play size={17} aria-hidden="true" />Probar el ejemplo</a></section>
    <footer className="shop-footer shop-wrap"><a className="shop-brand" href="/landing"><Store size={20} aria-hidden="true" /><span>Ventas <b>IA</b></span></a><span>El asistente organiza. Tú preparas y decides.</span><nav aria-label="Información legal"><a href="/privacidad">Privacidad</a><a href="/terminos">Términos</a><a href="/eliminar-datos">Eliminar datos</a></nav></footer>
  </main>;
}
