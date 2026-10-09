import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bot,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  Eye,
  FileImage,
  Gauge,
  KeyRound,
  Layers3,
  Lock,
  MessageCircle,
  Pause,
  Play,
  PlugZap,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Store,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  conversations,
  eventTemplates,
  metricSeed,
  pendingRequests,
  storeZones,
  tenants,
  tools,
} from './data/acpModel.js';

const statusLabel = {
  defined: 'Definido',
  needs_binding: 'Requiere binding',
  sandbox_ready: 'Sandbox',
  production_ready: 'Producción',
  live: 'En curso',
  degraded: 'Degradado',
  blocked: 'Bloqueado',
  fallback_available: 'Fallback',
  approval_required: 'Aprobación',
  resolved: 'Resuelto',
};

const statusIcon = {
  live: Activity,
  approval_required: UserCheck,
  blocked: AlertTriangle,
  degraded: Clock3,
  needs_binding: PlugZap,
  sandbox_ready: ShieldCheck,
  resolved: BadgeCheck,
};

const zoneIcon = {
  entry: MessageCircle,
  agent: Bot,
  tool: Database,
  memory: ShoppingBag,
  approval: UserCheck,
  write: CircleDollarSign,
  event: Activity,
};

function zoneCenter(zoneId) {
  const zone = storeZones.find((item) => item.id === zoneId) ?? storeZones[0];
  return {
    x: zone.x + zone.w / 2,
    y: zone.y + zone.h / 2,
  };
}

function formatTime(offsetSeconds = 0) {
  const date = new Date(Date.now() - offsetSeconds * 1000);
  return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function createEvent(index, tenantId, conversation) {
  const type = eventTemplates[index % eventTemplates.length];
  const tool = conversation?.lastTool ?? 'planner';
  return {
    id: `evt-${Date.now()}-${index}`,
    at: formatTime(index * 17),
    type,
    tenantId,
    conversationId: conversation?.id ?? 'system',
    detail:
      type === 'approval.requested'
        ? 'Solicitud humana creada desde approval_gate'
        : type === 'fallback.activated'
          ? 'Ruta alternativa registrada sin ejecutar herramientas reales'
          : `${tool} emitió ${type}`,
  };
}

function App() {
  const [tenantList, setTenantList] = useState(tenants);
  const [toolList, setToolList] = useState(tools);
  const [conversationList, setConversationList] = useState(conversations);
  const [backendStatus, setBackendStatus] = useState('connecting');
  const [tenantId, setTenantId] = useState(tenants[0].id);
  const [activeView, setActiveView] = useState('store');
  const [selectedId, setSelectedId] = useState(conversations[0].id);
  const [isPlaying, setIsPlaying] = useState(true);
  const [tick, setTick] = useState(0);
  const [events, setEvents] = useState(() =>
    conversations.slice(0, 5).map((conversation, index) => createEvent(index, conversation.tenantId, conversation)),
  );
  const [requests, setRequests] = useState(pendingRequests);
  const [draftReply, setDraftReply] = useState('Producto identificado. Continuar con cotización preliminar.');

  const tenant = tenantList.find((item) => item.id === tenantId) ?? tenantList[0] ?? tenants[0];
  const visibleConversations = conversationList.filter((item) => item.tenantId === tenantId);
  const selectedConversation =
    visibleConversations.find((item) => item.id === selectedId) ?? visibleConversations[0] ?? conversationList[0] ?? conversations[0];
  const visibleRequests = requests.filter((item) => item.tenantId === tenantId);
  const visibleEvents = events.filter((item) => item.tenantId === tenantId).slice(0, 9);

  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      try {
        const response = await fetch(`/api/ops/overview?tenantId=${encodeURIComponent(tenantId)}`);
        if (!response.ok) throw new Error(`Backend ${response.status}`);
        const overview = await response.json();
        if (cancelled) return;
        setTenantList(overview.tenants?.length ? overview.tenants : tenants);
        setToolList(overview.tools?.length ? overview.tools : tools);
        setConversationList(overview.conversations?.length ? overview.conversations : conversations);
        setRequests(overview.pendingRequests ?? []);
        setEvents(overview.events ?? []);
        setBackendStatus('connected');
      } catch {
        if (!cancelled) setBackendStatus('offline');
      }
    }

    loadOverview();
    const timer = window.setInterval(loadOverview, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tenantId]);

  useEffect(() => {
    if (!visibleConversations.find((item) => item.id === selectedId) && visibleConversations[0]) {
      setSelectedId(visibleConversations[0].id);
    }
  }, [tenantId, selectedId, visibleConversations]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
      setEvents((current) => {
        const pool = conversationList.filter((item) => item.tenantId === tenantId);
        const conversation = pool[Math.floor(Math.random() * Math.max(pool.length, 1))];
        if (backendStatus === 'connected') return current;
        return [createEvent(current.length, tenantId, conversation), ...current].slice(0, 36);
      });
    }, 2300);
    return () => window.clearInterval(timer);
  }, [isPlaying, tenantId, conversationList, backendStatus]);

  const metrics = useMemo(() => {
    const active = visibleConversations.filter((item) => ['live', 'degraded'].includes(item.status)).length;
    const pending = visibleRequests.length;
    const blocked = visibleConversations.filter((item) => item.status === 'blocked').length;
    const binding = toolList.filter((item) => item.status === 'needs_binding').length;
    return {
      ...metricSeed,
      active: active + 14,
      pending,
      failed: blocked + 1,
      binding,
    };
  }, [visibleConversations, visibleRequests, toolList]);

  async function resolveRequest(id, outcome) {
    const request = requests.find((item) => item.id === id);
    try {
      if (backendStatus === 'connected') {
        await fetch(`/api/pending-requests/${encodeURIComponent(id)}/resolve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ outcome, note: draftReply, approverId: 'micro-app-user' }),
        });
        const response = await fetch(`/api/ops/overview?tenantId=${encodeURIComponent(tenantId)}`);
        const overview = await response.json();
        setConversationList(overview.conversations ?? conversationList);
        setRequests(overview.pendingRequests ?? []);
        setEvents(overview.events ?? []);
        return;
      }
    } catch {
      setBackendStatus('offline');
    }
    setRequests((current) => current.filter((item) => item.id !== id));
    setEvents((current) => [
      {
        id: `evt-${Date.now()}-${outcome}`,
        at: formatTime(),
        type: outcome === 'approved' ? 'approval.granted' : 'approval.denied',
        tenantId,
        conversationId: request?.conversationId ?? 'system',
        detail: outcome === 'approved' ? 'Intervención humana resuelta y flujo reanudado' : 'Operación rechazada por usuario humano',
      },
      ...current,
    ]);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Navegación principal">
        <div className="brand-block">
          <div className="brand-mark">
            <Store size={22} />
          </div>
          <div>
            <span className="eyebrow">Ventas IA</span>
            <strong>Ops Store</strong>
          </div>
        </div>

        <label className="tenant-picker">
          <span>Cliente activo</span>
          <select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
            {tenantList.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <nav className="nav-stack">
          {[
            ['store', Store, 'Tienda viva'],
            ['queue', UserCheck, 'Pendientes'],
            ['config', Settings2, 'Configuración'],
            ['trace', Activity, 'Trazabilidad'],
          ].map(([key, Icon, label]) => (
            <button
              className={activeView === key ? 'nav-item is-active' : 'nav-item'}
              key={key}
              onClick={() => setActiveView(key)}
              type="button"
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="tenant-card" style={{ '--tenant-accent': tenant.accent }}>
          <div className="tenant-ring">
            <Building2 size={20} />
          </div>
          <h2>{tenant.name}</h2>
          <p>{tenant.industry}</p>
          <div className="mini-row">
            <span>{tenant.plan}</span>
            <StatusPill status={tenant.status} />
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Centro multicliente</span>
            <h1>Operación visual del agente comercial</h1>
          </div>
          <div className="top-actions">
            <button className="icon-btn" type="button" title={isPlaying ? 'Pausar eventos' : 'Reproducir eventos'} onClick={() => setIsPlaying((value) => !value)}>
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="ghost-btn" type="button">
              <ShieldCheck size={17} />
              {backendStatus === 'connected' ? 'Backend conectado' : 'Modo local'}
            </button>
          </div>
        </header>

        <section className="metric-strip" aria-label="Indicadores operativos">
          <Metric icon={Activity} label="Activas" value={metrics.active} tone="green" />
          <Metric icon={UserCheck} label="Human-in-loop" value={metrics.pending} tone="gold" />
          <Metric icon={PlugZap} label="Bindings faltantes" value={metrics.binding} tone="red" />
          <Metric icon={Gauge} label="Primera respuesta" value={metrics.response} tone="mint" />
          <Metric icon={CircleDollarSign} label="Conversión" value={metrics.conversion} tone="ink" />
        </section>

        {activeView === 'store' && (
          <section className="main-grid">
            <StoreMap
              conversations={visibleConversations}
              selectedId={selectedConversation?.id}
              onSelect={setSelectedId}
              tick={tick}
              pendingIds={new Set(visibleRequests.map((item) => item.conversationId))}
            />
            <ConversationPanel conversation={selectedConversation} events={visibleEvents} />
          </section>
        )}

        {activeView === 'queue' && (
          <HumanQueue
            requests={visibleRequests}
            conversations={visibleConversations}
            onSelectConversation={setSelectedId}
            onResolve={resolveRequest}
            draftReply={draftReply}
            setDraftReply={setDraftReply}
          />
        )}

        {activeView === 'config' && <Configuration tenant={tenant} tools={toolList} />}

        {activeView === 'trace' && <Traceability events={visibleEvents} conversations={visibleConversations} />}
      </section>
    </main>
  );
}

function StatusPill({ status }) {
  const Icon = statusIcon[status] ?? Layers3;
  return (
    <span className={`status-pill status-${status}`}>
      <Icon size={13} />
      {statusLabel[status] ?? status}
    </span>
  );
}

function Metric({ icon: Icon, label, value, tone }) {
  return (
    <article className={`metric metric-${tone}`}>
      <Icon size={19} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function StoreMap({ conversations, selectedId, onSelect, tick, pendingIds }) {
  return (
    <section className="store-map-shell">
      <div className="map-header">
        <div>
          <span className="eyebrow">Mapa vivo ACP</span>
          <h2>Tienda comercial interactiva</h2>
        </div>
        <div className="legend">
          <span><i className="dot live" /> En curso</span>
          <span><i className="dot approval" /> Intervención</span>
          <span><i className="dot blocked" /> Bloqueo</span>
        </div>
      </div>

      <div className="store-map" role="img" aria-label="Plano interactivo de tienda con conversaciones del agente">
        <div className="floor-grid" />
        <div className="checkout-belt" />
        {storeZones.map((zone) => {
          const Icon = zoneIcon[zone.kind] ?? Store;
          return (
            <button
              className={`zone zone-${zone.kind}`}
              key={zone.id}
              style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%` }}
              type="button"
              title={`${zone.label} · ${zone.source}`}
            >
              <Icon size={20} />
              <strong>{zone.short}</strong>
              <span>{zone.label}</span>
            </button>
          );
        })}

        <svg className="route-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M17 59 C28 48 34 56 39 54 C51 49 58 33 65 30 C75 24 82 27 85 31" />
          <path d="M39 54 C50 59 57 62 64 64 C73 67 80 64 85 65" />
          <path d="M65 64 C56 75 49 86 44 86 C34 86 25 86 16 86" />
        </svg>

        {conversations.map((conversation, index) => {
          const currentZoneIndex = Math.min(
            conversation.path.length - 1,
            Math.abs((tick + index) % (conversation.path.length + 2)) >= conversation.path.length
              ? conversation.path.length - 1
              : Math.abs((tick + index) % (conversation.path.length + 2)),
          );
          const currentZone = conversation.status === 'approval_required' || pendingIds.has(conversation.id)
            ? 'approval'
            : conversation.status === 'blocked'
              ? 'approval'
              : conversation.path[currentZoneIndex];
          const center = zoneCenter(currentZone);
          return (
            <button
              className={`avatar avatar-${conversation.status} ${selectedId === conversation.id ? 'is-selected' : ''}`}
              key={conversation.id}
              style={{
                left: `calc(${center.x}% + ${(index % 3) * 12 - 12}px)`,
                top: `calc(${center.y}% + ${(index % 2) * 12 - 6}px)`,
                transitionDelay: `${index * 45}ms`,
              }}
              onClick={() => onSelect(conversation.id)}
              type="button"
              title={`${conversation.customer} · ${statusLabel[conversation.status]}`}
            >
              <span>{conversation.avatar}</span>
              <i />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ConversationPanel({ conversation, events }) {
  if (!conversation) return null;
  const timeline = [
    ['Consulta recibida', 'agent.started'],
    ['Búsqueda de catálogo', 'tool.call.started'],
    ['Decisión comercial', conversation.status === 'approval_required' ? 'approval.requested' : 'decision.resolved'],
    ['Próximo paso', conversation.nextStep],
  ];
  return (
    <aside className="detail-panel">
      <div className="panel-heading">
        <span className="eyebrow">Conversación</span>
        <h2>{conversation.customer}</h2>
        <StatusPill status={conversation.status} />
      </div>
      <div className="conversation-value">
        <span>Valor estimado</span>
        <strong>{conversation.value}</strong>
      </div>
      <div className="progress-block">
        <div className="mini-row">
          <span>Progreso</span>
          <b>{conversation.progress}%</b>
        </div>
        <div className="progress-track">
          <span style={{ width: `${conversation.progress}%` }} />
        </div>
      </div>
      <div className="info-stack">
        <InfoLine icon={Search} label="Necesidad" value={conversation.need} />
        <InfoLine icon={PlugZap} label="Última herramienta" value={conversation.lastTool} />
        <InfoLine icon={ChevronRight} label="Siguiente paso" value={conversation.nextStep} />
        {conversation.humanReason && <InfoLine icon={UserCheck} label="Intervención" value={conversation.humanReason} />}
      </div>
      <div className="timeline">
        {timeline.map(([label, value], index) => (
          <div className="timeline-row" key={label}>
            <i>{index + 1}</i>
            <div>
              <strong>{label}</strong>
              <span>{value}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="event-card">
        <div className="mini-row">
          <strong>Eventos recientes</strong>
          <Eye size={16} />
        </div>
        {events.slice(0, 4).map((event) => (
          <p key={event.id}>
            <span>{event.at}</span> {event.type}
          </p>
        ))}
      </div>
    </aside>
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

function HumanQueue({ requests, conversations, onSelectConversation, onResolve, draftReply, setDraftReply }) {
  return (
    <section className="queue-layout">
      <div className="section-title">
        <span className="eyebrow">Human-in-the-loop</span>
        <h2>Centro de atención de pendientes</h2>
      </div>
      <div className="queue-grid">
        {requests.length === 0 && (
          <article className="empty-state">
            <BadgeCheck size={28} />
            <h3>Sin pendientes humanos</h3>
            <p>Las solicitudes resueltas emiten eventos de aprobación o rechazo y liberan el flujo del agente.</p>
          </article>
        )}
        {requests.map((request) => {
          const conversation = conversations.find((item) => item.id === request.conversationId);
          return (
            <article className="request-card" key={request.id}>
              <div className="request-top">
                <span className={`urgency urgency-${request.urgency.toLowerCase()}`}>{request.urgency}</span>
                <code>{request.type}</code>
              </div>
              <h3>{request.title}</h3>
              <p>{request.context}</p>
              <div className="impact-box">
                <strong>Después de responder</strong>
                <span>{request.consequence}</span>
              </div>
              <div className="mini-row">
                <button className="text-btn" type="button" onClick={() => onSelectConversation(request.conversationId)}>
                  Ver {conversation?.customer ?? request.conversationId}
                </button>
                <span>{request.conversationId}</span>
              </div>
              <textarea value={draftReply} onChange={(event) => setDraftReply(event.target.value)} rows={3} />
              <div className="button-row">
                <button className="approve-btn" type="button" onClick={() => onResolve(request.id, 'approved')}>
                  <Check size={16} />
                  Aprobar
                </button>
                <button className="deny-btn" type="button" onClick={() => onResolve(request.id, 'denied')}>
                  <X size={16} />
                  Rechazar
                </button>
                <button className="ghost-btn compact" type="button" onClick={() => onResolve(request.id, 'approved')}>
                  <Send size={16} />
                  Responder
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Configuration({ tenant, tools: toolList }) {
  const fields = [
    ['WhatsApp phone_number_id', 'WHATSAPP_PHONE_NUMBER_ID_REF', MessageCircle],
    ['Webhook verify token', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN_REF', KeyRound],
    ['Google spreadsheet', 'SPREADSHEET_ID_REF', Database],
    ['Drive folder policy', 'GOOGLE_DRIVE_ALLOWED_SCOPE_REF', FileImage],
    ['Secret source', 'needs_review', Lock],
  ];
  return (
    <section className="config-layout">
      <div className="section-title">
        <span className="eyebrow">Configuración sin código</span>
        <h2>{tenant.name}</h2>
      </div>
      <div className="config-grid">
        <article className="settings-panel">
          <h3>Parámetros de tenant</h3>
          {fields.map(([label, value, Icon]) => (
            <label className="config-field" key={label}>
              <span>
                <Icon size={16} />
                {label}
              </span>
              <input value={value} readOnly />
            </label>
          ))}
          <div className="isolation-note">
            <ShieldCheck size={18} />
            <span>Los secretos se guardan como referencias por cliente; la app no muestra valores planos.</span>
          </div>
        </article>
        <article className="tools-panel">
          <h3>Contratos y bindings ACP</h3>
          <div className="tool-list">
            {toolList.map((tool) => (
              <div className="tool-row" key={tool.key}>
                <div>
                  <strong>{tool.name}</strong>
                  <span>{tool.purpose}</span>
                  <code>{tool.source}</code>
                </div>
                <div className="tool-meta">
                  <StatusPill status={tool.status} />
                  <span className={`risk risk-${tool.risk}`}>{tool.risk}</span>
                  {tool.sideEffects && <span className="side-effect">side effect</span>}
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function Traceability({ events, conversations }) {
  return (
    <section className="trace-layout">
      <div className="section-title">
        <span className="eyebrow">Observabilidad ACP</span>
        <h2>Eventos, decisiones y herramientas</h2>
      </div>
      <div className="trace-grid">
        <article className="event-stream">
          {events.map((event) => (
            <div className="stream-row" key={event.id}>
              <time>{event.at}</time>
              <div>
                <strong>{event.type}</strong>
                <span>{event.detail}</span>
              </div>
              <code>{event.conversationId}</code>
            </div>
          ))}
        </article>
        <article className="audit-panel">
          <h3>Cobertura operativa</h3>
          {conversations.map((conversation) => (
            <div className="audit-row" key={conversation.id}>
              <span>{conversation.customer}</span>
              <StatusPill status={conversation.status} />
              <b>{conversation.progress}%</b>
            </div>
          ))}
          <div className="gap-card">
            <AlertTriangle size={18} />
            <div>
              <strong>Brecha detectada</strong>
              <span>Los contratos del ZIP no incluyen bindings operativos ni secretos reales. La capa visual queda preparada para consumir eventos reales cuando existan endpoints.</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

export default App;
