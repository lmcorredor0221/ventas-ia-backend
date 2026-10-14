import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Bell,
  Bot,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  Database,
  Eye,
  FileImage,
  Gauge,
  KeyRound,
  Layers3,
  LayoutDashboard,
  ListChecks,
  ListFilter,
  Lock,
  MessageCircle,
  MessageSquareText,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  PlugZap,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Store,
  UserCheck,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  conversations,
  createConversationLoadFixture,
  eventTemplates,
  metricSeed,
  pendingRequests,
  storeZones,
  tenants,
  tools,
} from './data/acpModel.js';

const statusLabel = {
  defined: 'Definido',
  needs_binding: 'Conexión pendiente',
  sandbox_ready: 'Listo para operar',
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

const navigationItems = [
  ['summary', LayoutDashboard, 'Resumen'],
  ['store', Store, 'Tienda viva'],
  ['conversations', MessageSquareText, 'Conversaciones'],
  ['onboarding', ShieldCheck, 'Onboarding'],
  ['admin', Gauge, 'Centro de control'],
  ['observability', Activity, 'Observabilidad'],
  ['approvals', ListChecks, 'Aprobaciones'],
  ['analytics', BarChart3, 'Analítica'],
  ['config', Settings2, 'Configuración'],
];

const viewHeader = {
  summary: ['Centro multicliente', 'Resumen operativo'],
  store: ['Tienda viva', 'Operación comercial en tiempo real'],
  conversations: ['Atención comercial', 'Conversaciones supervisables'],
  onboarding: ['Activación guiada', 'Puesta en marcha de la tienda'],
  admin: ['Centro de control', 'Salud comercial de la plataforma'],
  observability: ['Observabilidad', 'Eventos de conexión e integraciones'],
  approvals: ['Apoyo humano', 'Bandeja de decisiones'],
  analytics: ['Analítica', 'Uso y desempeño operativo'],
  config: ['Configuración', 'Parámetros de la tienda'],
};

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const loadFixtureSize = typeof window !== 'undefined'
  ? Number(new URLSearchParams(window.location.search).get('loadFixture') ?? 0)
  : 0;
const initialConversations = loadFixtureSize ? createConversationLoadFixture(loadFixtureSize) : conversations;

function zoneCenter(zoneId) {
  const zone = storeZones.find((item) => item.id === zoneId) ?? storeZones[0];
  return {
    x: zone.x + zone.w / 2,
    y: zone.y + zone.h / 2,
  };
}

const semanticStageZone = {
  catalog: 'catalog',
  approval: 'approval',
  handoff: 'approval',
  binding: 'catalog',
  payment: 'payment',
  off_hours: 'observability',
  quote: 'quote',
};

const semanticToolZone = {
  approval_gate: 'approval',
  human_handoff: 'approval',
  transactional_write: 'payment',
  google_sheets_read_table: 'catalog',
  google_drive_file_picker: 'drive',
  google_sheets_customer_profile_lookup: 'drive',
  google_sheets_customer_profile_upsert: 'drive',
  google_sheets_order_write: 'payment',
  whatsapp_business_messaging: 'whatsapp',
  scheduler: 'observability',
  planner: 'agent',
};

function eventZoneForConversation(event, conversation) {
  if (!event) return null;
  const type = String(event.type ?? '');
  if (type.includes('human_handoff')) return 'approval';
  if (type.includes('failed') || type.includes('error')) return 'observability';
  if (type.includes('binding')) return 'catalog';
  if (type.includes('approval') || type.includes('decision')) {
    if (type === 'approval.granted' && conversation?.stage && semanticStageZone[conversation.stage]) {
      return semanticStageZone[conversation.stage];
    }
    return 'approval';
  }
  if (type.includes('fallback')) return 'observability';
  if (type === 'agent.started') return 'agent';
  if (type === 'agent.completed') return semanticStageZone[conversation?.stage] ?? 'payment';
  if (type.startsWith('tool.call')) {
    return semanticToolZone[conversation?.lastTool] ?? semanticStageZone[conversation?.stage] ?? 'agent';
  }
  return null;
}

const priorityEventTypes = new Set([
  'approval.requested',
  'decision.requested',
  'fallback.activated',
  'agent.failed',
  'human_handoff',
  'tool.binding.changed',
]);

function isPriorityMapEvent(event) {
  const type = String(event?.type ?? '');
  return priorityEventTypes.has(type)
    || type.includes('failed')
    || type.includes('error')
    || type.includes('human_handoff');
}

function semanticZoneForConversation(conversation, pendingIds, latestEvent) {
  if (pendingIds.has(conversation.id) || ['approval_required', 'blocked', 'degraded'].includes(conversation.status)) {
    return {
      zone: 'approval',
      source: `Estado: ${statusLabel[conversation.status] ?? conversation.status}`,
    };
  }
  const eventZone = eventZoneForConversation(latestEvent, conversation);
  if (eventZone) {
    return {
      zone: eventZone,
      source: `Evento: ${eventTypeLabel(latestEvent.type)}`,
    };
  }
  if (semanticStageZone[conversation.stage]) {
    return {
      zone: semanticStageZone[conversation.stage],
      source: `Etapa: ${stageLabel(conversation.stage)}`,
    };
  }
  if (semanticToolZone[conversation.lastTool]) {
    return {
      zone: semanticToolZone[conversation.lastTool],
      source: `Herramienta: ${toolLabel(conversation.lastTool)}`,
    };
  }
  const path = Array.isArray(conversation.path) && conversation.path.length ? conversation.path : ['agent'];
  return {
    zone: path[Math.max(0, path.length - 1)],
    source: 'Ruta operativa configurada',
  };
}

function prioritySignalForStore(events, conversationItems, pendingIds, requestItems = []) {
  const conversationsById = new Map(conversationItems.map((conversation) => [conversation.id, conversation]));
  const requestsByConversationId = new Map(requestItems.map((request) => [request.conversationId, request]));
  const requestsById = new Map(requestItems.map((request) => [request.id, request]));
  const priorityEvent = events.find((event) => {
    const conversation = conversationsById.get(event?.conversationId);
    return conversation && isPriorityMapEvent(event);
  });
  if (priorityEvent) {
    const conversation = conversationsById.get(priorityEvent.conversationId);
    const request = requestsById.get(priorityEvent.metadata?.requestId) ?? requestsByConversationId.get(priorityEvent.conversationId);
    const semanticZone = semanticZoneForConversation(conversation, pendingIds, priorityEvent);
    const needsHuman = ['approval', 'approval_required', 'blocked'].includes(semanticZone.zone)
      || String(priorityEvent.type).includes('approval')
      || String(priorityEvent.type).includes('decision')
      || String(priorityEvent.type).includes('human_handoff');
    return {
      id: priorityEvent.id,
      zone: semanticZone.zone,
      conversation,
      title: eventTypeLabel(priorityEvent.type),
      detail: priorityEvent.detail || conversation.nextStep || conversation.need,
      request,
      actionLabel: request ? 'Abrir decisión' : needsHuman ? 'Ver caso crítico' : 'Ver caso',
      needsHuman,
      source: 'event',
    };
  }

  const criticalConversation = conversationItems.find((conversation) => (
    pendingIds.has(conversation.id) || ['approval_required', 'blocked', 'degraded'].includes(conversation.status)
  ));
  if (!criticalConversation) return null;
  const semanticZone = semanticZoneForConversation(criticalConversation, pendingIds, null);
  const request = requestsByConversationId.get(criticalConversation.id);
  return {
    id: `status-${criticalConversation.id}-${criticalConversation.status}`,
    zone: semanticZone.zone,
    conversation: criticalConversation,
    title: statusLabel[criticalConversation.status] ?? 'Atencion requerida',
    detail: criticalConversation.humanReason || criticalConversation.nextStep || criticalConversation.need,
    request,
    actionLabel: request ? 'Abrir decisión' : 'Ver caso crítico',
    needsHuman: true,
    source: 'status',
  };
}

function stableAvatarOffset(id, index = 0) {
  const seed = Array.from(String(id)).reduce((sum, char) => sum + char.charCodeAt(0), index * 17);
  return {
    x: ((seed % 5) - 2) * 7,
    y: (((Math.floor(seed / 5) % 5) - 2) * 5),
  };
}

function conversationBelongsToZone(conversation, zoneId, pendingIds) {
  if (zoneId === 'approval') {
    return pendingIds.has(conversation.id) || ['approval_required', 'blocked', 'degraded'].includes(conversation.status);
  }
  const path = Array.isArray(conversation.path) ? conversation.path : [];
  return path.includes(zoneId) || conversation.stage === zoneId;
}

function zoneRiskLabel(conversationItems, pendingIds) {
  const criticalCount = conversationItems.filter((conversation) => (
    pendingIds.has(conversation.id) || ['approval_required', 'blocked', 'degraded'].includes(conversation.status)
  )).length;
  if (criticalCount) return `${criticalCount} requieren apoyo`;
  const liveCount = conversationItems.filter((conversation) => ['live', 'degraded'].includes(conversation.status)).length;
  if (liveCount) return `${liveCount} activos`;
  return 'Sin riesgo visible';
}

function zoneForGrouping(conversation, pendingIds) {
  if (pendingIds.has(conversation.id) || ['approval_required', 'blocked', 'degraded'].includes(conversation.status)) return 'approval';
  if (conversation.zone) return conversation.zone;
  const path = Array.isArray(conversation.path) && conversation.path.length ? conversation.path : ['agent'];
  return path[Math.max(0, path.length - 1)];
}

function uniqueConversations(conversationItems) {
  const seen = new Set();
  return conversationItems.filter((conversation) => {
    if (!conversation || seen.has(conversation.id)) return false;
    seen.add(conversation.id);
    return true;
  });
}

function pointerDistance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function pointerCenter(left, right) {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
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
        ? 'Solicitud humana creada desde aprobación operativa'
        : type === 'fallback.activated'
          ? 'Ruta alternativa registrada sin ejecutar acciones reales'
          : `${toolLabel(tool)} registró ${eventTypeLabel(type)}`,
  };
}

function csrfHeaders(auth) {
  const token = auth?.session?.csrfToken;
  return token ? { 'x-csrf-token': token } : {};
}

function loadFacebookSdk(appId, version) {
  if (window.FB) return Promise.resolve(window.FB);
  if (window.__ventasIaFacebookSdkPromise) return window.__ventasIaFacebookSdkPromise;
  window.__ventasIaFacebookSdkPromise = new Promise((resolve, reject) => {
    const previousInit = window.fbAsyncInit;
    window.fbAsyncInit = () => {
      previousInit?.();
      window.FB.init({ appId, cookie: true, xfbml: false, version });
      resolve(window.FB);
    };
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.onerror = () => reject(new Error('No fue posible cargar la conexión segura de Meta.'));
    document.head.appendChild(script);
    window.setTimeout(() => reject(new Error('Meta no respondió a tiempo. Intenta de nuevo.')), 15000);
  });
  return window.__ventasIaFacebookSdkPromise;
}

async function launchMetaEmbeddedSignup(launch) {
  if (!launch?.appId || !launch?.configId) throw new Error('Falta la configuración de Meta Embedded Signup.');
  const FB = await loadFacebookSdk(launch.appId, launch.graphApiVersion ?? 'v21.0');
  return new Promise((resolve, reject) => {
    let loginCode = '';
    let sessionInfo = null;
    let settled = false;
    const finish = () => {
      if (settled || !loginCode || !sessionInfo?.wabaId || !sessionInfo?.phoneNumberId) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      resolve({ code: loginCode, ...sessionInfo });
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      reject(error);
    };
    const onMessage = (event) => {
      if (!event.origin.includes('facebook.com') && !event.origin.includes('meta.com')) return;
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { return; }
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      const payload = data.data ?? data;
      const eventName = String(payload.event ?? '').toUpperCase();
      if (eventName === 'CANCEL' || eventName === 'ERROR') {
        fail(new Error('La autorización de WhatsApp fue cancelada o reportó un error.'));
        return;
      }
      sessionInfo = {
        wabaId: payload.waba_id ?? payload.wabaId,
        phoneNumberId: payload.phone_number_id ?? payload.phoneNumberId,
        displayPhoneNumber: payload.display_phone_number ?? payload.displayPhoneNumber,
      };
      finish();
    };
    window.addEventListener('message', onMessage);
    FB.login((response) => {
      const code = response?.authResponse?.code;
      if (!code) {
        fail(new Error('Meta no devolvió el código de autorización.'));
        return;
      }
      loginCode = code;
      finish();
    }, {
      config_id: launch.configId,
      response_type: launch.responseType ?? 'code',
      override_default_response_type: true,
      extras: { sessionInfoVersion: '3' },
    });
    window.setTimeout(() => fail(new Error('La autorización de WhatsApp tardó demasiado.')), 180000);
  });
}

function firstActiveTenantId(auth) {
  return auth?.memberships?.find((item) => item.status === 'active')?.tenantId ?? auth?.memberships?.[0]?.tenantId ?? '';
}

function canAccessPlatformAdmin(auth) {
  return Boolean(auth?.isPlatformAdmin || auth?.user?.platformRole === 'platform_admin');
}

function App() {
  const [tenantList, setTenantList] = useState(tenants);
  const [toolList, setToolList] = useState(tools);
  const [conversationList, setConversationList] = useState(initialConversations);
  const [backendStatus, setBackendStatus] = useState('connecting');
  const [tenantId, setTenantId] = useState(tenants[0].id);
  const [activeView, setActiveView] = useState('summary');
  const [selectedId, setSelectedId] = useState(initialConversations[0]?.id ?? conversations[0].id);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversationQuery, setConversationQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isPlaying, setIsPlaying] = useState(true);
  const [events, setEvents] = useState(() =>
    conversations.slice(0, 5).map((conversation, index) => createEvent(index, conversation.tenantId, conversation)),
  );
  const [requests, setRequests] = useState(pendingRequests);
  const [draftReply, setDraftReply] = useState('Producto identificado. Continuar con cotización preliminar.');
  const [humanReplyMode, setHumanReplyMode] = useState('whatsapp');
  const [conversationDetailCollapsed, setConversationDetailCollapsed] = useState(false);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [conversationWorkspaceTab, setConversationWorkspaceTab] = useState('list');
  const [conversationTab, setConversationTab] = useState('chat');
  const [auth, setAuth] = useState(null);
  const [authStatus, setAuthStatus] = useState('checking');
  const [authRequired, setAuthRequired] = useState(false);
  const [authError, setAuthError] = useState('');
  const [usageSummary, setUsageSummary] = useState(() => defaultUsageSummary(tenants[0].id));
  const [onboardingBundle, setOnboardingBundle] = useState(null);
  const [onboardingBusy, setOnboardingBusy] = useState('');
  const [onboardingError, setOnboardingError] = useState('');
  const [adminOverview, setAdminOverview] = useState(null);
  const [adminError, setAdminError] = useState('');
  const [billingStatus, setBillingStatus] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedHumanRequestId, setSelectedHumanRequestId] = useState('');
  const conversationSearchRef = useRef(null);

  const tenant = tenantList.find((item) => item.id === tenantId) ?? tenantList[0] ?? tenants[0];
  const visibleConversations = conversationList.filter((item) => item.tenantId === tenantId);
  const selectedConversation =
    visibleConversations.find((item) => item.id === selectedId) ?? visibleConversations[0] ?? conversationList[0] ?? conversations[0];
  const visibleRequests = requests.filter((item) => item.tenantId === tenantId);
  const visibleEvents = events.filter((item) => item.tenantId === tenantId).slice(0, 9);
  const pendingIds = useMemo(() => new Set(visibleRequests.map((item) => item.conversationId)), [visibleRequests]);
  const [headerEyebrow, headerTitle] = viewHeader[activeView] ?? viewHeader.summary;
  const isPlatformAdmin = canAccessPlatformAdmin(auth);
  const sessionTenantId = isPlatformAdmin ? '' : firstActiveTenantId(auth);

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (!response.ok) {
          if (!cancelled) {
            setAuth(null);
            if (response.status === 401) {
              setAuthRequired(true);
              setBackendStatus('auth_required');
            }
            setAuthStatus('guest');
          }
          return;
        }
        const session = await response.json();
        if (!cancelled) {
          setAuth(session);
          setAuthStatus('signed_in');
          setAuthRequired(false);
          setAuthError('');
          if (session.memberships?.[0]?.tenantId) setTenantId(session.memberships[0].tenantId);
        }
      } catch {
        if (!cancelled) setAuthStatus('guest');
      }
    }
    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      if (authStatus === 'checking') return;
      if (authStatus === 'guest' && authRequired) return;
      const effectiveTenantId = sessionTenantId || tenantId;
      if (sessionTenantId && tenantId !== sessionTenantId) {
        setTenantId(sessionTenantId);
        return;
      }
      try {
        const response = await fetch(`/api/ops/overview?tenantId=${encodeURIComponent(effectiveTenantId)}`, { credentials: 'include' });
        if (response.status === 401) {
          setAuthRequired(true);
          setBackendStatus('auth_required');
          return;
        }
        if (response.status === 403 && firstActiveTenantId(auth)) {
          setTenantId(firstActiveTenantId(auth));
          return;
        }
        if (!response.ok) throw new Error(`Backend ${response.status}`);
        const overview = await response.json();
        if (cancelled) return;
        setTenantList(overview.tenants?.length ? overview.tenants : tenants);
        setToolList(overview.tools?.length ? overview.tools : tools);
        if (!loadFixtureSize) setConversationList(overview.conversations?.length ? overview.conversations : conversations);
        setRequests(overview.pendingRequests ?? []);
        setEvents(overview.events ?? []);
        setUsageSummary(overview.usage ?? defaultUsageSummary(effectiveTenantId));
        const statusResponse = await fetch(`/api/saas/tenants/${encodeURIComponent(effectiveTenantId)}/status`, { credentials: 'include' });
        if (!cancelled && statusResponse.ok) {
          setOnboardingBundle(await statusResponse.json());
        } else if (!cancelled) {
          setOnboardingBundle(null);
        }
        const billingResponse = await fetch(`/api/billing/status?tenantId=${encodeURIComponent(effectiveTenantId)}`, { credentials: 'include' });
        if (!cancelled && billingResponse.ok) {
          setBillingStatus(await billingResponse.json());
        } else if (!cancelled) {
          setBillingStatus(null);
        }
        if (isPlatformAdmin) {
          const adminResponse = await fetch('/api/admin/overview', { credentials: 'include' });
          if (!cancelled && adminResponse.ok) {
            setAdminOverview(await adminResponse.json());
            setAdminError('');
          } else if (!cancelled && adminResponse.status !== 403 && adminResponse.status !== 401 && adminResponse.status !== 404) {
            setAdminOverview(null);
            setAdminError(`Admin ${adminResponse.status}`);
          }
        } else {
          setAdminOverview(null);
          setAdminError('');
        }
        setBackendStatus('connected');
      } catch {
        if (!cancelled) {
          setUsageSummary(defaultUsageSummary(effectiveTenantId));
          setOnboardingBundle(null);
          setBillingStatus(null);
          setAdminOverview(null);
          setBackendStatus('offline');
        }
      }
    }

    loadOverview();
    const timer = window.setInterval(loadOverview, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tenantId, auth, authRequired, authStatus, isPlatformAdmin, refreshKey, sessionTenantId]);

  useEffect(() => {
    if (!visibleConversations.find((item) => item.id === selectedId) && visibleConversations[0]) {
      setSelectedId(visibleConversations[0].id);
    }
  }, [tenantId, selectedId, visibleConversations]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = window.setInterval(() => {
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

  const filteredConversations = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    return visibleConversations.filter((conversation) => {
      const matchesQuery = !query
        || conversation.customer.toLowerCase().includes(query)
        || conversation.id.toLowerCase().includes(query)
        || conversation.need.toLowerCase().includes(query)
        || conversation.lastTool.toLowerCase().includes(query);
      const matchesStatus = statusFilter === 'all' || conversation.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [conversationQuery, statusFilter, visibleConversations]);

  function focusConversation(id, nextView = activeView) {
    setSelectedId(id);
    setActiveView(nextView);
  }

  function openWhatsAppConversation(id) {
    focusConversation(id, 'conversations');
    setConversationWorkspaceTab('detail');
    setMobileConversationOpen(true);
  }

  useEffect(() => {
    if (activeView !== 'conversations') return undefined;
    function handleConversationKeys(event) {
      const tagName = event.target?.tagName?.toLowerCase();
      const isTyping = ['input', 'select', 'textarea'].includes(tagName) || event.target?.isContentEditable;
      if (event.key === '/' && !isTyping) {
        event.preventDefault();
        setConversationWorkspaceTab('list');
        conversationSearchRef.current?.focus();
        return;
      }
      if (isTyping || !filteredConversations.length) return;
      const currentIndex = Math.max(0, filteredConversations.findIndex((item) => item.id === selectedConversation?.id));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (currentIndex + delta + filteredConversations.length) % filteredConversations.length;
        setSelectedId(filteredConversations[nextIndex].id);
      }
      if (event.key === 'Enter' && selectedConversation?.id) {
        event.preventDefault();
        setConversationWorkspaceTab('detail');
        setMobileConversationOpen(true);
      }
    }
    window.addEventListener('keydown', handleConversationKeys);
    return () => window.removeEventListener('keydown', handleConversationKeys);
  }, [activeView, filteredConversations, selectedConversation?.id]);

  function openApprovals(requestId = '') {
    setSelectedHumanRequestId(requestId);
    setActiveView('approvals');
  }

  async function updateTenantConfig(configPatch) {
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/config`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...csrfHeaders(auth) },
        credentials: 'include',
        body: JSON.stringify(configPatch),
      });
      if (!response.ok) throw new Error(`Config update ${response.status}`);
      const updatedTenant = await response.json();
      setTenantList((current) => current.map((item) => (item.id === updatedTenant.id ? updatedTenant : item)));
      setBackendStatus('connected');
      setRefreshKey((value) => value + 1);
    } catch {
      setBackendStatus('offline');
    }
  }

  async function runOnboardingAction(action) {
    setOnboardingError('');
    if (action === 'activate' && !isPlatformAdmin) {
      setOnboardingError('La activacion final requiere una revision del administrador de plataforma.');
      return;
    }
    if (action === 'config-whatsapp') {
      setActiveView('config');
      return;
    }
    if (action === 'config-llm') {
      setActiveView('admin');
      return;
    }
    const postRoutes = {
      subscription: `/api/saas/tenants/${encodeURIComponent(tenantId)}/subscription/mock-activate`,
      'billing-checkout': '/api/billing/checkout',
      'billing-continue': '/api/billing/continue-checkout',
      'billing-cancel': '/api/billing/cancel',
      provision: `/api/saas/tenants/${encodeURIComponent(tenantId)}/google/provision`,
      validate: `/api/saas/tenants/${encodeURIComponent(tenantId)}/validate`,
      activate: `/api/admin/tenants/${encodeURIComponent(tenantId)}/activate`,
    };
    setOnboardingBusy(action);
    try {
      if (action === 'google-oauth') {
        const response = await fetch(`/api/saas/tenants/${encodeURIComponent(tenantId)}/google/oauth/start`, { credentials: 'include' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? `OAuth ${response.status}`);
        if (result.authorizationUrl) window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer');
      } else {
        if (!postRoutes[action]) throw new Error(`Acción no configurada: ${action}`);
        const body = ['billing-checkout', 'billing-continue', 'billing-cancel'].includes(action)
          ? { tenantId, payerEmail: tenant.lifecycle?.ownerEmail, reason: action === 'billing-cancel' ? 'owner_requested' : undefined }
          : {};
        const response = await fetch(postRoutes[action], {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...csrfHeaders(auth) },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? `Acción ${response.status}`);
        if (result.status) setOnboardingBundle(result);
        if (result.subscription || result.plan || result.payments) setRefreshKey((value) => value + 1);
      }
      setBackendStatus('connected');
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setBackendStatus((current) => (current === 'offline' ? current : 'connected'));
      setOnboardingError(error.message);
    } finally {
      setOnboardingBusy('');
    }
  }

  async function runWhatsAppOnboarding(action, payload = {}) {
    setOnboardingError('');
    const routes = {
      intent: `/api/saas/tenants/${encodeURIComponent(tenantId)}/whatsapp/intent`,
      start: `/api/saas/tenants/${encodeURIComponent(tenantId)}/whatsapp/embedded-signup/start`,
      complete: `/api/saas/tenants/${encodeURIComponent(tenantId)}/whatsapp/embedded-signup/complete`,
      binding: `/api/saas/tenants/${encodeURIComponent(tenantId)}/whatsapp/binding`,
    };
    setOnboardingBusy(`whatsapp-${action}`);
    try {
      if (!routes[action]) throw new Error(`Acción WhatsApp no configurada: ${action}`);
      const response = await fetch(routes[action], {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...csrfHeaders(auth) },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? `WhatsApp ${response.status}`);
      if (action === 'start' && result.launch?.authorizationUrl) {
        window.open(result.launch.authorizationUrl, '_blank', 'noopener,noreferrer');
      }
      if (action === 'start' && result.mode === 'embedded_signup' && result.launch) {
        const signup = await launchMetaEmbeddedSignup(result.launch);
        const completionResponse = await fetch(routes.complete, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...csrfHeaders(auth) },
          credentials: 'include',
          body: JSON.stringify(signup),
        });
        const completion = await completionResponse.json().catch(() => ({}));
        if (!completionResponse.ok) throw new Error(completion.error ?? `WhatsApp ${completionResponse.status}`);
      }
      setRefreshKey((value) => value + 1);
      const statusResponse = await fetch(`/api/saas/tenants/${encodeURIComponent(tenantId)}/status`, { credentials: 'include' });
      if (statusResponse.ok) setOnboardingBundle(await statusResponse.json());
      return result;
    } catch (error) {
      setOnboardingError(error.message);
      return null;
    } finally {
      setOnboardingBusy('');
    }
  }

  async function updatePlatformSettings(settingsPatch) {
    setAdminError('');
    if (!isPlatformAdmin) {
      setAdminError('Esta consola requiere rol de administrador de plataforma.');
      return;
    }
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...csrfHeaders(auth) },
        credentials: 'include',
        body: JSON.stringify(settingsPatch),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? `Admin ${response.status}`);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setAdminError(error.message);
    }
  }

  async function resolveRequest(id, outcome, options = {}) {
    const request = requests.find((item) => item.id === id);
    const note = options.note ?? draftReply;
    const responseMode = options.responseMode ?? 'none';
    if (selectedHumanRequestId === id) setSelectedHumanRequestId('');
    try {
      if (backendStatus === 'connected') {
        await fetch(`/api/pending-requests/${encodeURIComponent(id)}/resolve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...csrfHeaders(auth) },
          credentials: 'include',
          body: JSON.stringify({ outcome, note, responseMode, approverId: 'micro-app-user' }),
        });
        const response = await fetch(`/api/ops/overview?tenantId=${encodeURIComponent(tenantId)}`, { credentials: 'include' });
        const overview = await response.json();
        setConversationList(overview.conversations ?? conversationList);
        setRequests(overview.pendingRequests ?? []);
        setEvents(overview.events ?? []);
        setUsageSummary(overview.usage ?? defaultUsageSummary(tenantId));
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

  async function handleGoogleCredential(idToken) {
    setAuthStatus('checking');
    setAuthError('');
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ idToken }),
      });
      const session = await response.json();
      if (!response.ok) throw new Error(session.error ?? `Login ${response.status}`);
      applySession(session);
    } catch (error) {
      setAuthStatus('guest');
      setAuthError(error.message);
    }
  }

  async function handleSandboxLogin() {
    setAuthStatus('checking');
    setAuthError('');
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          idToken: 'dev-google-id-token',
          profile: {
            sub: `dev-${tenantId}`,
            email: `${tenantId}@example.local`,
            name: tenant.name,
          },
        }),
      });
      const session = await response.json();
      if (!response.ok) throw new Error(session.error ?? `Login ${response.status}`);
      applySession(session);
    } catch (error) {
      setAuthStatus('guest');
      setAuthError(error.message);
    }
  }

  function applySession(session) {
    setAuth(session);
    setAuthStatus('signed_in');
    setAuthRequired(false);
    setAuthError('');
    if (session.memberships?.[0]?.tenantId) setTenantId(session.memberships[0].tenantId);
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeaders(auth),
    }).catch(() => {});
    setAuth(null);
    setAuthStatus('guest');
  }

  if (authRequired && !auth?.user) {
    return (
      <AuthGate
        authError={authError}
        authStatus={authStatus}
        onGoogleCredential={handleGoogleCredential}
        onSandboxLogin={handleSandboxLogin}
      />
    );
  }

  if (auth?.user && !isPlatformAdmin && !sessionTenantId) {
    return (
      <TenantCreationView
        auth={auth}
        onCreated={(session) => applySession(session)}
      />
    );
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`} aria-label="Navegación principal">
        <div className="brand-block">
          <div className="brand-mark">
            <Store size={22} />
          </div>
          <div>
            <span className="eyebrow">Ventas IA</span>
            <strong>Ops Store</strong>
          </div>
          <button
            aria-label={sidebarCollapsed ? 'Mostrar menú lateral' : 'Ocultar menú lateral'}
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={sidebarCollapsed ? 'Mostrar menú' : 'Ocultar menú'}
            type="button"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
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
          {navigationItems.map(([key, Icon, label]) => (
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
            <span>{planLabel(tenant.plan)}</span>
            <StatusPill status={tenant.status} />
          </div>
        </div>
      </aside>

      <section className={`workspace ${activeView === 'store' ? 'workspace-compact' : ''} ${activeView === 'conversations' && mobileConversationOpen ? 'mobile-conversation-detail' : ''}`}>
        <header className="topbar">
          <div>
            <span className="eyebrow">{headerEyebrow}</span>
            <h1>{headerTitle}</h1>
          </div>
          <div className="top-actions">
            <label className="global-search">
              <Search size={16} />
              <input
                aria-label="Buscar conversación"
                onChange={(event) => setConversationQuery(event.target.value)}
                placeholder="Buscar cliente, ID o herramienta"
                value={conversationQuery}
              />
            </label>
            <button className="icon-btn" type="button" title={`${visibleRequests.length} aprobaciones pendientes`} onClick={() => openApprovals()}>
              <Bell size={18} />
              {visibleRequests.length > 0 && <span>{visibleRequests.length}</span>}
            </button>
            <button className="icon-btn" type="button" title={isPlaying ? 'Pausar eventos' : 'Reproducir eventos'} onClick={() => setIsPlaying((value) => !value)}>
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="ghost-btn" type="button">
              <ShieldCheck size={17} />
              {backendStatus === 'connected' ? 'Backend conectado' : 'Modo local'}
            </button>
            <AuthBadge
              auth={auth}
              authStatus={authStatus}
              onGoogleCredential={handleGoogleCredential}
              onLogout={handleLogout}
              onSandboxLogin={handleSandboxLogin}
            />
          </div>
        </header>

        <section className="metric-strip" aria-label="Indicadores operativos">
          <Metric icon={Activity} label="Activas" value={metrics.active} tone="green" />
          <Metric icon={UserCheck} label="Requiere apoyo" value={metrics.pending} tone="gold" />
          <Metric icon={PlugZap} label="Conexiones pendientes" value={metrics.binding} tone="red" />
          <Metric icon={Gauge} label="Primera respuesta" value={metrics.response} tone="mint" />
          <Metric icon={ShoppingBag} label="Domicilios del plan" value={formatUsageRatio(usageSummary.metrics.deliveries_confirmed, usageSummary.limits.includedDeliveries)} tone="ink" />
        </section>

        {activeView === 'summary' && (
          <SummaryView
            conversations={visibleConversations}
            events={visibleEvents}
            metrics={metrics}
            onNavigate={setActiveView}
            onSelectConversation={focusConversation}
            requests={visibleRequests}
            tools={toolList}
            usage={usageSummary}
          />
        )}

        {activeView === 'store' && (
          <section className="main-grid store-grid-full">
            <StoreMap
              conversations={visibleConversations}
              events={visibleEvents}
              selectedId={selectedConversation?.id}
              onOpenApprovals={openApprovals}
              onOpenList={() => {
                setConversationWorkspaceTab('list');
                setActiveView('conversations');
              }}
              onReset={() => {
                setSelectedId(visibleConversations[0]?.id);
              }}
              onSelect={openWhatsAppConversation}
              pendingIds={pendingIds}
              requests={visibleRequests}
            />
          </section>
        )}

        {activeView === 'conversations' && (
          <ConversationsView
            backendStatus={backendStatus}
            conversations={filteredConversations}
            detailCollapsed={conversationDetailCollapsed}
            events={visibleEvents}
            onSelectConversation={openWhatsAppConversation}
            onOpenApprovals={openApprovals}
            onToggleDetail={() => setConversationDetailCollapsed((value) => !value)}
            pendingRequest={visibleRequests.find((request) => request.conversationId === selectedConversation?.id)}
            query={conversationQuery}
            searchInputRef={conversationSearchRef}
            selectedConversation={selectedConversation}
            selectedId={selectedConversation?.id}
            setQuery={setConversationQuery}
            setStatusFilter={setStatusFilter}
            statusFilter={statusFilter}
            workspaceTab={conversationWorkspaceTab}
            setWorkspaceTab={setConversationWorkspaceTab}
            mobileDetailOpen={mobileConversationOpen}
            onOpenMobileDetail={() => setMobileConversationOpen(true)}
            onCloseMobileDetail={() => setMobileConversationOpen(false)}
            tab={conversationTab}
            setTab={setConversationTab}
          />
        )}

        {activeView === 'approvals' && (
          <HumanQueue
            requests={visibleRequests}
            conversations={visibleConversations}
            onSelectConversation={openWhatsAppConversation}
            onResolve={resolveRequest}
            draftReply={draftReply}
            setDraftReply={setDraftReply}
            replyMode={humanReplyMode}
            setReplyMode={setHumanReplyMode}
            selectedRequestId={selectedHumanRequestId}
          />
        )}

        {activeView === 'onboarding' && (
          <OnboardingView
            bundle={onboardingBundle}
            billingStatus={billingStatus}
            busyAction={onboardingBusy}
            error={onboardingError}
            isPlatformAdmin={isPlatformAdmin}
            onAction={runOnboardingAction}
            onWhatsAppAction={runWhatsAppOnboarding}
            onNavigate={setActiveView}
            tenant={tenant}
          />
        )}

        {activeView === 'admin' && (
          isPlatformAdmin ? (
            <PlatformAdminView
              auth={auth}
              error={adminError}
              overview={adminOverview}
              onSaveSettings={updatePlatformSettings}
              onRefresh={() => setRefreshKey((value) => value + 1)}
              onOpenObservability={() => setActiveView('observability')}
            />
          ) : (
            <RestrictedAdminPanel />
          )
        )}

        {activeView === 'observability' && (
          isPlatformAdmin ? <ObservabilityView overview={adminOverview} /> : <RestrictedAdminPanel />
        )}

        {activeView === 'analytics' && (
          <AnalyticsView conversations={visibleConversations} events={visibleEvents} requests={visibleRequests} tools={toolList} usage={usageSummary} />
        )}

        {activeView === 'config' && <Configuration onNavigate={setActiveView} onSaveConfig={updateTenantConfig} tenant={tenant} tools={toolList} />}
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

function defaultUsageSummary(tenantId) {
  return {
    tenantId,
    period: new Date().toISOString().slice(0, 7),
    planCode: 'ventas_ia_1000_domicilios',
    limits: {
      includedDeliveries: 1000,
      includedInteractions: 5000,
      includedLlmTokens: null,
    },
    metrics: {
      agent_interactions: 0,
      deliveries_confirmed: 0,
      tool_calls: 0,
      llm_calls: 0,
      llm_prompt_tokens: 0,
      llm_completion_tokens: 0,
      llm_total_tokens: 0,
    },
    percentages: {
      interactions: 0,
      deliveries: 0,
      llmTokens: null,
    },
    status: 'ok',
    counters: {},
  };
}

function formatUsageRatio(value, limit) {
  if (!limit) return formatCompactNumber(value);
  return `${formatCompactNumber(value)}/${formatCompactNumber(limit)}`;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat('es-CO', { notation: Number(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

function formatCurrency(value, currency = 'COP') {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function formatDateShort(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

function initials(value = '') {
  const text = String(value).trim();
  if (!text) return 'IA';
  const [namePart] = text.split('@');
  const words = namePart.split(/[\s._-]+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('') || 'IA';
}

function usageTone(percent) {
  if (percent >= 100) return 'limit';
  if (percent >= 90) return 'danger';
  if (percent >= 80) return 'warn';
  return 'ok';
}

function AuthGate({ authError, authStatus, onGoogleCredential, onSandboxLogin }) {
  const showSandboxLogin = !googleClientId;
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-mark auth-mark">
          <Store size={26} />
        </div>
        <span className="eyebrow">Ventas IA</span>
        <h1>Acceso seguro al centro multicliente</h1>
        <p>Inicia sesión con Google para ver únicamente las tiendas donde tienes membresía activa.</p>
        <GoogleSignInButton onCredential={onGoogleCredential} />
        {showSandboxLogin && (
          <button className="ghost-btn auth-dev-btn" type="button" onClick={onSandboxLogin} disabled={authStatus === 'checking'}>
            <ShieldCheck size={17} />
            Usar acceso local de desarrollo
          </button>
        )}
        {authError && (
          <div className="auth-error">
            <AlertTriangle size={17} />
            {authError}
          </div>
        )}
      </section>
    </main>
  );
}

function TenantCreationView({ auth, onCreated }) {
  const [draft, setDraft] = useState({ storeName: '', whatsappNumber: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!draft.storeName.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/saas/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...csrfHeaders(auth) },
        credentials: 'include',
        body: JSON.stringify({ storeName: draft.storeName.trim(), whatsappNumber: draft.whatsappNumber.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'No fue posible crear la tienda');
      const sessionResponse = await fetch('/api/auth/me', { credentials: 'include' });
      const session = sessionResponse.ok ? await sessionResponse.json() : null;
      onCreated(session ?? { ...auth, memberships: [{ tenantId: payload.tenant.id, role: 'owner', status: 'active' }] });
    } catch (submitError) {
      setError(submitError.message ?? 'No fue posible crear la tienda');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel tenant-create-panel">
        <div className="brand-mark auth-mark"><Store size={26} /></div>
        <span className="eyebrow">Primer paso</span>
        <h1>Configura tu tienda</h1>
        <p>Tu cuenta de Google ya está identificada. Crea la tienda y después podrás conectar su Drive, Sheets y WhatsApp desde Onboarding.</p>
        <form onSubmit={submit}>
          <label className="config-field">
            <span><Store size={16} /> Nombre de la tienda</span>
            <input autoFocus value={draft.storeName} onChange={(event) => setDraft((current) => ({ ...current, storeName: event.target.value }))} placeholder="Ej. Tienda La 26" />
          </label>
          <label className="config-field">
            <span><MessageCircle size={16} /> WhatsApp de la tienda <small>(opcional)</small></span>
            <input value={draft.whatsappNumber} onChange={(event) => setDraft((current) => ({ ...current, whatsappNumber: event.target.value }))} placeholder="Ej. +57 300 000 0000" />
          </label>
          <button className="approve-btn" type="submit" disabled={!draft.storeName.trim() || busy}>
            <Check size={16} />
            {busy ? 'Creando tienda...' : 'Crear tienda y comenzar'}
          </button>
        </form>
        {error && <div className="auth-error"><AlertTriangle size={17} />{error}</div>}
      </section>
    </main>
  );
}

function AuthBadge({ auth, authStatus, onGoogleCredential, onLogout, onSandboxLogin }) {
  const showSandboxLogin = !googleClientId;
  if (auth?.user) {
    return (
      <div className="auth-badge">
        <span className="avatar-token small">{initials(auth.user.name ?? auth.user.email)}</span>
        <div>
          <strong>{auth.user.name ?? auth.user.email}</strong>
          <span>{auth.memberships?.[0]?.role ?? 'sin rol'}</span>
        </div>
        <button className="icon-btn mini" type="button" onClick={onLogout} title="Cerrar sesión">
          <X size={15} />
        </button>
      </div>
    );
  }
  return (
    <div className="auth-actions-inline">
      <GoogleSignInButton compact onCredential={onGoogleCredential} />
      {showSandboxLogin && (
        <button className="ghost-btn compact" type="button" onClick={onSandboxLogin} disabled={authStatus === 'checking'}>
          <ShieldCheck size={15} />
          Dev
        </button>
      )}
    </div>
  );
}

function GoogleSignInButton({ compact = false, onCredential }) {
  const containerRef = useRef(null);
  const onCredentialRef = useRef(onCredential);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onCredentialRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    if (!googleClientId) return undefined;
    let cancelled = false;
    const existing = document.querySelector('script[data-google-identity]');
    const script = existing ?? document.createElement('script');
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = 'true';
      document.head.appendChild(script);
    }
    const handleLoad = () => {
      if (!cancelled) setReady(true);
    };
    if (window.google?.accounts?.id) {
      handleLoad();
    } else {
      script.addEventListener('load', handleLoad);
    }
    return () => {
      cancelled = true;
      script.removeEventListener('load', handleLoad);
    };
  }, []);

  useEffect(() => {
    if (!ready || !googleClientId || !containerRef.current || !window.google?.accounts?.id) return;
    containerRef.current.innerHTML = '';
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: (response) => onCredentialRef.current(response.credential),
    });
    window.google.accounts.id.renderButton(containerRef.current, {
      theme: 'outline',
      size: compact ? 'medium' : 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: compact ? 150 : 260,
    });
  }, [compact, ready]);

  if (!googleClientId) {
    return (
      <button className={compact ? 'ghost-btn compact' : 'approve-btn auth-google-fallback'} type="button" disabled title="Define VITE_GOOGLE_CLIENT_ID para Google Sign-In real">
        <UserCheck size={16} />
        Google
      </button>
    );
  }
  return <div className={compact ? 'google-signin compact' : 'google-signin'} ref={containerRef} />;
}

const characterProfiles = [
  {
    skin: '#d89b72',
    hair: '#3a2b23',
    shirt: '#70c889',
    pants: '#314a61',
    accent: '#f2c15d',
    accessory: 'bag',
    motion: 'curious',
  },
  {
    skin: '#b9785f',
    hair: '#1f1a18',
    shirt: '#e1746b',
    pants: '#2d415b',
    accent: '#86d6e7',
    accessory: 'phone',
    motion: 'waiting',
  },
  {
    skin: '#e0b08c',
    hair: '#6d4430',
    shirt: '#77b8df',
    pants: '#513b63',
    accent: '#f4d17a',
    accessory: 'glasses',
    motion: 'talking',
  },
  {
    skin: '#8f5f4d',
    hair: '#26201d',
    shirt: '#d7a857',
    pants: '#35524a',
    accent: '#ef8b61',
    accessory: 'badge',
    motion: 'steady',
  },
  {
    skin: '#c98b67',
    hair: '#8b5a36',
    shirt: '#cf7fb2',
    pants: '#30445c',
    accent: '#8ee0bd',
    accessory: 'scarf',
    motion: 'curious',
  },
];

const ambientCharacters = [
  { className: 'person-a', role: 'shopper', profile: characterProfiles[0], mood: 'interested', label: 'Cliente observando productos' },
  { className: 'person-b', role: 'shopper', profile: characterProfiles[2], mood: 'waiting', label: 'Cliente esperando respuesta' },
  { className: 'person-c', role: 'supervisor', profile: { ...characterProfiles[3], shirt: '#455b72', accent: '#f0c15d' }, mood: 'steady', label: 'Supervisor humano disponible' },
  { className: 'person-d', role: 'shopper', profile: characterProfiles[4], mood: 'satisfied', label: 'Cliente satisfecho' },
];

function getCharacterProfile(conversation, index) {
  const seed = Array.from(conversation.id).reduce((sum, char) => sum + char.charCodeAt(0), index);
  return characterProfiles[seed % characterProfiles.length];
}

function getCharacterMood(conversation, pendingIds) {
  if (conversation.status === 'approval_required' || pendingIds.has(conversation.id)) return 'waiting';
  if (conversation.status === 'blocked' || conversation.status === 'degraded' || conversation.status === 'needs_binding') return 'confused';
  if (conversation.progress >= 82 || conversation.stage === 'payment') return 'satisfied';
  if (conversation.stage === 'catalog' || conversation.stage === 'quote') return 'interested';
  return 'talking';
}

function getOperationalPose(conversation, pendingIds, latestEvent) {
  const eventType = String(latestEvent?.type ?? '');
  const tool = String(conversation.lastTool ?? '');
  if (
    pendingIds.has(conversation.id)
    || conversation.status === 'approval_required'
    || eventType.includes('decision')
    || eventType.includes('approval')
    || eventType.includes('human_handoff')
  ) {
    return {
      state: 'human',
      label: 'Decidir',
      reason: 'Requiere criterio humano',
      icon: UserCheck,
    };
  }
  if (
    ['blocked', 'degraded', 'needs_binding', 'fallback_available'].includes(conversation.status)
    || eventType.includes('failed')
    || eventType.includes('error')
    || eventType.includes('fallback')
  ) {
    return {
      state: 'blocked',
      label: 'Revisar',
      reason: 'Hay bloqueo o conexion pendiente',
      icon: AlertTriangle,
    };
  }
  if (
    conversation.stage === 'catalog'
    || tool.includes('read_table')
    || tool.includes('catalog')
    || eventType.startsWith('tool.call')
  ) {
    return {
      state: 'searching',
      label: 'Buscando',
      reason: 'Consulta catalogo o soporte',
      icon: Search,
    };
  }
  if (conversation.stage === 'quote' || conversation.stage === 'drive' || tool.includes('profile')) {
    return {
      state: 'basket',
      label: 'Canasta',
      reason: 'Construye pedido o valida cliente',
      icon: ShoppingBag,
    };
  }
  if (conversation.stage === 'payment' || tool.includes('order_write') || tool.includes('transactional')) {
    return {
      state: 'checkout',
      label: 'Caja',
      reason: 'Registra pedido o pago',
      icon: CircleDollarSign,
    };
  }
  if (conversation.stage === 'whatsapp' || eventType.includes('message')) {
    return {
      state: 'message',
      label: 'Mensaje',
      reason: 'Conversacion entrante',
      icon: MessageCircle,
    };
  }
  return {
    state: 'working',
    label: 'IA',
    reason: 'Agente procesando la conversacion',
    icon: Bot,
  };
}

function CharacterFigure({
  className = '',
  profile,
  role = 'client',
  mood = 'talking',
  operationState = 'working',
  label,
  interactive = false,
  selected = false,
  style,
  onClick,
  children,
  ...rest
}) {
  const Tag = interactive ? 'button' : 'div';
  return (
    <Tag
      className={`character-actor ${interactive ? 'avatar iso-avatar' : 'ambient-people'} role-${role} mood-${mood} motion-${profile.motion} state-${operationState} ${selected ? 'is-selected' : ''} ${className}`}
      style={{
        '--skin': profile.skin,
        '--hair': profile.hair,
        '--shirt': profile.shirt,
        '--pants': profile.pants,
        '--accent': profile.accent,
        ...style,
      }}
      onClick={onClick}
      type={interactive ? 'button' : undefined}
      title={label}
      aria-label={label}
      {...rest}
    >
      <span className="character-shadow" />
      <span className="character-head">
        <span className="hair-cap" />
        <span className="face">
          <span className="brow brow-left" />
          <span className="brow brow-right" />
          <span className="eye eye-left" />
          <span className="eye eye-right" />
          <span className="nose" />
          <span className="cheek cheek-left" />
          <span className="cheek cheek-right" />
          <span className="mouth" />
        </span>
        <span className={`character-accessory accessory-${profile.accessory}`} />
      </span>
      <span className="character-body">
        <span className="arm arm-left" />
        <span className="arm arm-right" />
        <span className="torso" />
        <span className="leg leg-left" />
        <span className="leg leg-right" />
      </span>
      {children}
    </Tag>
  );
}

function StoreMap({ conversations, events = [], selectedId, onSelect, onOpenApprovals, onOpenList, onReset, pendingIds, requests = [] }) {
  const [showRoutes, setShowRoutes] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [activeZoneId, setActiveZoneId] = useState('approval');
  const [zonePanelCollapsed, setZonePanelCollapsed] = useState(true);
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [cameraGesture, setCameraGesture] = useState('idle');
  const mapRef = useRef(null);
  const cameraStageRef = useRef(null);
  const dragRef = useRef(null);
  const activePointersRef = useRef(new Map());
  const suppressStageClickRef = useRef(false);
  const cameraWheelTimerRef = useRef(null);
  const pendingCount = conversations.filter((conversation) => pendingIds.has(conversation.id) || conversation.status === 'approval_required').length;
  const activeZone = storeZones.find((zone) => zone.id === activeZoneId) ?? storeZones[0];
  const activeZoneConversations = conversations.filter((conversation) => conversationBelongsToZone(conversation, activeZone.id, pendingIds));
  const activeZoneCount = activeZoneConversations.length;
  const activeZoneRisk = zoneRiskLabel(activeZoneConversations, pendingIds);
  const visibleZoneCases = activeZoneConversations.slice(0, 3);
  const hasZoneFocus = activeZoneCount > 0;
  const lodMode = conversations.length > 200 ? 'enterprise' : conversations.length > 24 ? 'zone' : 'individual';
  const criticalConversations = conversations.filter((conversation) => (
    pendingIds.has(conversation.id) || ['approval_required', 'blocked', 'degraded'].includes(conversation.status)
  ));
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId);
  const visibleAvatars = lodMode === 'individual'
    ? conversations
    : uniqueConversations([
      ...criticalConversations.slice(0, lodMode === 'enterprise' ? 8 : 12),
      selectedConversation,
      ...activeZoneConversations.slice(0, lodMode === 'enterprise' ? 6 : 14),
    ]).slice(0, lodMode === 'enterprise' ? 14 : 26);
  const hiddenConversationCount = Math.max(0, conversations.length - visibleAvatars.length);
  const latestEventByConversation = useMemo(() => {
    const latestEvents = new Map();
    events.forEach((event) => {
      if (event?.conversationId && !latestEvents.has(event.conversationId)) {
        latestEvents.set(event.conversationId, event);
      }
    });
    return latestEvents;
  }, [events]);
  const prioritySignal = useMemo(() => prioritySignalForStore(events, conversations, pendingIds, requests), [events, conversations, pendingIds, requests]);
  const autoFocusedSignalRef = useRef('');
  const zoneSummaries = storeZones.map((zone) => {
    const zoneItems = conversations.filter((conversation) => zoneForGrouping(conversation, pendingIds) === zone.id || conversationBelongsToZone(conversation, zone.id, pendingIds));
    return {
      ...zone,
      count: zoneItems.length,
      critical: zoneItems.filter((conversation) => (
        pendingIds.has(conversation.id) || ['approval_required', 'blocked', 'degraded'].includes(conversation.status)
      )).length,
    };
  }).filter((zone) => zone.count);

  function clampCamera(nextCamera) {
    const scale = Math.min(1.6, Math.max(0.9, Number(nextCamera.scale) || 1));
    const rect = mapRef.current?.getBoundingClientRect();
    const maxX = rect ? Math.max(36, rect.width * (scale - 1) * 0.6) : 220;
    const maxY = rect ? Math.max(28, rect.height * (scale - 1) * 0.56) : 160;
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, Number(nextCamera.x) || 0)),
      y: Math.min(maxY, Math.max(-maxY, Number(nextCamera.y) || 0)),
    };
  }

  function updateCamera(nextCamera) {
    setCamera((current) => clampCamera({ ...current, ...nextCamera }));
  }

  function zoomCamera(delta) {
    setCamera((current) => {
      const nextScale = Math.round((current.scale + delta) * 100) / 100;
      return clampCamera({ ...current, scale: nextScale });
    });
  }

  function panCamera(dx, dy) {
    setCamera((current) => clampCamera({ ...current, x: current.x + dx, y: current.y + dy }));
  }

  function resetCamera() {
    setCamera({ x: 0, y: 0, scale: 1 });
  }

  function focusZone(zoneId) {
    setActiveZoneId(zoneId);
    const center = zoneCenter(zoneId);
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextScale = zoneId === 'approval' ? 1.14 : 1.12;
    updateCamera({
      scale: nextScale,
      x: ((50 - center.x) / 100) * rect.width * nextScale,
      y: ((50 - center.y) / 100) * rect.height * nextScale,
    });
  }

  function handleCameraPointerDown(event) {
    if (event.target.closest('button, input, select, textarea, a')) return;
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...activePointersRef.current.values()];
    if (pointers.length === 2) {
      dragRef.current = {
        mode: 'pinch',
        distance: pointerDistance(pointers[0], pointers[1]),
        center: pointerCenter(pointers[0], pointers[1]),
        camera,
      };
      setCameraGesture('pinch');
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    dragRef.current = {
      mode: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      camera,
      moved: false,
    };
    setCameraGesture('pan');
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleCameraPointerMove(event) {
    if (!dragRef.current || !activePointersRef.current.has(event.pointerId)) return;
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (dragRef.current.mode === 'pinch') {
      const pointers = [...activePointersRef.current.values()];
      if (pointers.length < 2 || !dragRef.current.distance) return;
      const distance = pointerDistance(pointers[0], pointers[1]);
      const center = pointerCenter(pointers[0], pointers[1]);
      const nextScale = Math.round((dragRef.current.camera.scale * (distance / dragRef.current.distance)) * 100) / 100;
      suppressStageClickRef.current = true;
      setCamera(clampCamera({
        ...dragRef.current.camera,
        scale: nextScale,
        x: dragRef.current.camera.x + (center.x - dragRef.current.center.x) * 0.72,
        y: dragRef.current.camera.y + (center.y - dragRef.current.center.y) * 0.72,
      }));
      return;
    }
    if (dragRef.current.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) {
      dragRef.current.moved = true;
      suppressStageClickRef.current = true;
    }
    setCamera(clampCamera({
      ...dragRef.current.camera,
      x: dragRef.current.camera.x + dx * 0.86,
      y: dragRef.current.camera.y + dy * 0.86,
    }));
  }

  function handleCameraPointerEnd(event) {
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size === 1) {
      const remaining = [...activePointersRef.current.entries()][0];
      dragRef.current = {
        mode: 'pan',
        pointerId: remaining[0],
        startX: remaining[1].x,
        startY: remaining[1].y,
        camera,
        moved: false,
      };
      return;
    }
    if (dragRef.current?.pointerId === event.pointerId || dragRef.current?.mode === 'pinch') {
      dragRef.current = null;
    }
    setCameraGesture('idle');
    window.setTimeout(() => {
      suppressStageClickRef.current = false;
    }, 160);
  }

  function handleCameraWheel(event) {
    if (event.target.closest('button, input, select, textarea, a')) return;
    event.preventDefault();
    setCameraGesture('wheel');
    const delta = Math.max(-0.16, Math.min(0.16, -event.deltaY / 900));
    if (!delta) return;
    setCamera((current) => {
      const nextScale = Math.round((current.scale + delta) * 100) / 100;
      return clampCamera({ ...current, scale: nextScale });
    });
    window.clearTimeout(cameraWheelTimerRef.current);
    cameraWheelTimerRef.current = window.setTimeout(() => setCameraGesture('idle'), 180);
  }

  function handleStageClickCapture(event) {
    if (!suppressStageClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function openZoneCases() {
    if (visibleZoneCases[0]) {
      onSelect(visibleZoneCases[0].id);
      return;
    }
    onOpenList();
  }

  function openPrioritySignal() {
    if (!prioritySignal) return;
    if (prioritySignal.request?.id) {
      onOpenApprovals(prioritySignal.request.id);
      return;
    }
    if (prioritySignal.needsHuman) {
      onOpenApprovals();
      return;
    }
    if (prioritySignal.conversation?.id) {
      onSelect(prioritySignal.conversation.id);
    }
  }

  useEffect(() => {
    if (!prioritySignal || autoFocusedSignalRef.current === prioritySignal.id) return;
    autoFocusedSignalRef.current = prioritySignal.id;
    focusZone(prioritySignal.zone);
  }, [prioritySignal?.id]);

  useEffect(() => {
    const stage = cameraStageRef.current;
    if (!stage) return undefined;
    stage.addEventListener('wheel', handleCameraWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleCameraWheel);
  });

  return (
    <section className="store-map-shell">
      <div className="map-header">
        <div>
          <span className="eyebrow">Tienda viva</span>
          <h2>Operación comercial en tiempo real</h2>
        </div>
        <div className="map-toolbar">
          <div className="legend">
            <span><i className="dot live" /> En curso</span>
            <span><i className="dot approval" /> Requiere apoyo</span>
            <span><i className="dot blocked" /> Bloqueo</span>
          </div>
          <button className="map-chip" type="button" aria-pressed={showRoutes} onClick={() => setShowRoutes((value) => !value)}>
            {showRoutes ? 'Rutas visibles' : 'Rutas ocultas'}
          </button>
          <button className="map-chip" type="button" onClick={onOpenList}>
            Vista lista
          </button>
          <button className="map-chip" type="button" onClick={() => {
            resetCamera();
            onReset();
          }}>
            <RotateCcw size={13} />
            Centrar vista
          </button>
          <button className="map-chip" type="button" aria-pressed={reducedMotion} onClick={() => setReducedMotion((value) => !value)}>
            {reducedMotion ? 'Movimiento reducido' : 'Animación viva'}
          </button>
        </div>
      </div>
      <div className="zone-quick-nav" aria-label="Navegación rápida por zonas de la tienda">
        {storeZones.map((zone) => (
          <button
            className={`zone-jump zone-jump-${zone.id} ${activeZoneId === zone.id ? 'is-active' : ''}`}
            key={zone.id}
            aria-current={activeZoneId === zone.id ? 'true' : undefined}
            aria-label={`Enfocar ${zone.label}: ${zone.source}`}
            onClick={() => focusZone(zone.id)}
            type="button"
          >
            <span>{zone.short}</span>
            <small>{zone.label}</small>
          </button>
        ))}
      </div>

      <div
        ref={mapRef}
        className={`store-map iso-store lod-${lodMode} camera-${cameraGesture} ${lodMode !== 'individual' ? 'performance-mode' : ''} ${showRoutes ? 'show-routes' : 'hide-routes'} ${reducedMotion ? 'reduce-motion' : ''}`}
        data-camera-scale={camera.scale.toFixed(2)}
        data-camera-gesture={cameraGesture}
        role="region"
        aria-label="Tienda isométrica interactiva con conversaciones reales del agente"
      >
        <div className="camera-dock" role="toolbar" aria-label="Controles de cámara de Tienda viva">
          <button type="button" onClick={() => zoomCamera(0.12)} aria-label="Acercar cámara">
            <ZoomIn size={15} />
          </button>
          <button type="button" onClick={() => zoomCamera(-0.12)} aria-label="Alejar cámara">
            <ZoomOut size={15} />
          </button>
          <button type="button" onClick={() => panCamera(-72, 0)} aria-label="Mover cámara a la izquierda">←</button>
          <button type="button" onClick={() => panCamera(72, 0)} aria-label="Mover cámara a la derecha">→</button>
          <button type="button" onClick={() => panCamera(0, -58)} aria-label="Mover cámara arriba">↑</button>
          <button type="button" onClick={() => panCamera(0, 58)} aria-label="Mover cámara abajo">↓</button>
          <button type="button" onClick={resetCamera} aria-label="Restablecer cámara">
            <Move size={15} />
          </button>
        </div>
        <button
          className={`intervention-sign ${pendingCount ? 'is-hot' : ''}`}
          type="button"
          onClick={pendingCount ? onOpenApprovals : undefined}
          aria-label={pendingCount ? `Abrir ${pendingCount} solicitudes que requieren apoyo humano` : 'Sin solicitudes humanas pendientes'}
        >
          <strong>Requiere apoyo</strong>
          <span>{pendingCount ? `${pendingCount} casos` : 'sin pendientes'}</span>
        </button>

        <div
          className={`zone-focus-panel ${activeZoneRisk.includes('apoyo') ? 'has-risk' : ''} ${zonePanelCollapsed ? 'is-collapsed' : 'is-expanded'}`}
          aria-live="polite"
          data-zone={activeZone.id}
        >
          <button
            className="zone-focus-summary"
            type="button"
            aria-expanded={!zonePanelCollapsed}
            onClick={() => setZonePanelCollapsed((value) => !value)}
          >
            <span>Zona enfocada</span>
            <strong>{activeZone.label}</strong>
            <small>{activeZoneCount} casos · {activeZoneRisk}</small>
            {zonePanelCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
          {!zonePanelCollapsed && (
            <div className="zone-focus-body">
              {lodMode !== 'individual' && (
                <small className="lod-caption">
                  LOD {lodMode === 'enterprise' ? 'empresa' : 'zona'} · {visibleAvatars.length} visibles · {hiddenConversationCount} agrupados
                </small>
              )}
              <div className="zone-case-list" aria-label={`Casos relacionados con ${activeZone.label}`}>
                {visibleZoneCases.length ? visibleZoneCases.map((conversation) => (
                  <button
                    className={selectedId === conversation.id ? 'is-selected' : ''}
                    key={conversation.id}
                    onClick={() => onSelect(conversation.id)}
                    type="button"
                  >
                    <b>{conversation.avatar}</b>
                    <span>{conversation.customer}</span>
                    <i>{statusLabel[conversation.status] ?? conversation.status}</i>
                  </button>
                )) : (
                  <p>Sin casos en esta zona</p>
                )}
              </div>
              <button className="text-btn zone-open-btn" type="button" onClick={openZoneCases}>Ver casos de esta zona</button>
            </div>
          )}
        </div>

        {prioritySignal && (
          <div
            className={`priority-event-card ${prioritySignal.needsHuman ? 'needs-human' : ''}`}
            data-priority-event-id={prioritySignal.id}
            data-priority-source={prioritySignal.source}
            data-priority-zone={prioritySignal.zone}
            data-priority-request-id={prioritySignal.request?.id ?? ''}
            data-priority-conversation-id={prioritySignal.conversation?.id ?? ''}
            role="status"
          >
            <span>{prioritySignal.source === 'event' ? 'Evento prioritario' : 'Caso requiere atención'}</span>
            <strong>{prioritySignal.title}</strong>
            <small>{prioritySignal.conversation?.customer} · {prioritySignal.detail}</small>
            <button type="button" onClick={openPrioritySignal}>
              {prioritySignal.actionLabel}
            </button>
          </div>
        )}

        <div
          ref={cameraStageRef}
          className="store-camera-stage"
          data-camera-x={Math.round(camera.x)}
          data-camera-y={Math.round(camera.y)}
          onClickCapture={handleStageClickCapture}
          onPointerCancel={handleCameraPointerEnd}
          onPointerDown={handleCameraPointerDown}
          onPointerMove={handleCameraPointerMove}
          onPointerUp={handleCameraPointerEnd}
          style={{
            transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`,
          }}
        >
          <div className="iso-back-wall">
            <span className="wall-display display-left">Canales</span>
            <span className="wall-display display-center">Catálogo</span>
            <span className="wall-display display-right">Servicio</span>
          </div>
          <div className="iso-side-wall" />
          <div className="floor-grid" />
          <div className="iso-floor-glow" />
          <div className="checkout-belt" />

          {lodMode !== 'individual' && (
            <div className="zone-cluster-layer" aria-label="Agrupación de conversaciones por zona">
              {zoneSummaries.map((zone) => {
                const center = zoneCenter(zone.id);
                return (
                  <button
                    className={`zone-cluster cluster-${zone.id} ${activeZoneId === zone.id ? 'is-active' : ''} ${zone.critical ? 'has-risk' : ''}`}
                    key={zone.id}
                    onClick={() => focusZone(zone.id)}
                    style={{
                      left: `calc(${center.x}% + ${zone.id === 'approval' ? -18 : 18}px)`,
                      top: `calc(${center.y}% + ${zone.id === 'approval' ? -24 : -18}px)`,
                    }}
                    type="button"
                  >
                    <strong>{zone.count}</strong>
                    <span>{zone.short}</span>
                    {zone.critical ? <i>{zone.critical}</i> : null}
                  </button>
                );
              })}
            </div>
          )}

          {storeZones.map((zone) => {
            const Icon = zoneIcon[zone.kind] ?? Store;
            return (
              <button
                className={`zone iso-zone zone-${zone.kind} zone-${zone.id} ${activeZoneId === zone.id ? 'is-focused' : ''} ${zone.id === 'approval' && pendingCount ? 'has-risk' : ''}`}
                key={zone.id}
                onClick={() => focusZone(zone.id)}
                style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%` }}
                type="button"
                aria-label={`Enfocar zona ${zone.label}. ${zone.source}`}
                title={`${zone.short} · ${zone.label}`}
              >
                {renderZoneInterior(zone, Icon)}
              </button>
            );
          })}

          <svg className="route-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="route route-main" d="M14 48 C22 43 30 51 36 51 C45 50 50 31 55 28 C64 23 75 27 82 25" />
            <path className="route route-support" d="M36 51 C45 55 54 46 66 46 C76 47 84 58 88 63" />
            <path className="route route-close" d="M63 68 C55 76 48 80 45 80 C35 79 25 76 18 76" />
            <path className="route route-intervention" d="M36 51 C52 60 66 66 88 64" />
          </svg>

          {ambientCharacters.map((person) => (
            <CharacterFigure
              className={person.className}
              key={person.className}
              label={person.label}
              mood={person.mood}
              profile={person.profile}
              role={person.role}
            />
          ))}
          <CharacterFigure
            className="agent-assistant bot-a"
            label="Agente IA atendiendo la conversación"
            mood="talking"
            profile={{ skin: '#cdeaf0', hair: '#3d8394', shirt: '#9ee7f3', pants: '#3f6570', accent: '#f6d674', accessory: 'badge', motion: 'steady' }}
            role="agent"
          >
            <span className="agent-aura"><Bot size={13} /></span>
          </CharacterFigure>
          <CharacterFigure
            className="agent-assistant bot-b"
            label="Agente IA acompañando solicitud de ayuda"
            mood={pendingCount ? 'waiting' : 'talking'}
            profile={{ skin: '#d8f2f5', hair: '#487d8b', shirt: '#b4edf5', pants: '#3c6070', accent: '#ffb25e', accessory: 'badge', motion: 'steady' }}
            role="agent"
          >
            <span className="agent-aura"><Bot size={12} /></span>
          </CharacterFigure>

          {visibleAvatars.map((conversation, index) => {
            const latestEvent = latestEventByConversation.get(conversation.id);
            const semanticZone = semanticZoneForConversation(conversation, pendingIds, latestEvent);
            const operationalPose = getOperationalPose(conversation, pendingIds, latestEvent);
            const PoseIcon = operationalPose.icon;
            const center = zoneCenter(semanticZone.zone);
            const offset = stableAvatarOffset(conversation.id, index);
            const belongsToActiveZone = conversationBelongsToZone(conversation, activeZoneId, pendingIds);
            const isPriorityConversation = prioritySignal?.conversation?.id === conversation.id;
            return (
              <CharacterFigure
                className={`avatar-${conversation.status} ${belongsToActiveZone ? 'is-zone-related' : ''} ${isPriorityConversation ? 'is-priority' : ''} ${hasZoneFocus && !belongsToActiveZone && !isPriorityConversation ? 'is-zone-dimmed' : ''}`}
                data-conversation-id={conversation.id}
                data-operation-label={operationalPose.label}
                data-operation-reason={operationalPose.reason}
                data-operation-state={operationalPose.state}
                data-zone={semanticZone.zone}
                data-zone-source={semanticZone.source}
                key={conversation.id}
                interactive
                label={`Abrir conversación WhatsApp de ${conversation.customer} · ${statusLabel[conversation.status]} · ${operationalPose.reason}`}
                mood={getCharacterMood(conversation, pendingIds)}
                onClick={() => onSelect(conversation.id)}
                operationState={operationalPose.state}
                profile={getCharacterProfile(conversation, index)}
                role="client"
                selected={selectedId === conversation.id}
                style={{
                  left: `calc(${center.x}% + ${offset.x}px)`,
                  top: `calc(${center.y}% + ${offset.y}px)`,
                  transitionDelay: `${index * 45}ms`,
                }}
              >
                <em className="speech-bubble">{conversation.status === 'approval_required' ? '!' : conversation.status === 'blocked' ? '?' : '...'}</em>
                <span className={`operation-prop prop-${operationalPose.state}`} aria-hidden="true">
                  <PoseIcon size={12} strokeWidth={2.6} />
                </span>
                <span className="operation-state-label">{operationalPose.label}</span>
                <span className="character-badge">{conversation.avatar}</span>
                <i className="status-light" />
              </CharacterFigure>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function renderZoneInterior(zone, Icon) {
  if (zone.id === 'whatsapp') {
    return (
      <>
        <div className="door-frame"><MessageCircle size={18} /></div>
        <div className="whatsapp-badge">WA</div>
        <ZoneLabel zone={zone} Icon={Icon} />
      </>
    );
  }
  if (zone.id === 'agent') {
    return (
      <>
        <div className="service-counter" />
        <div className="counter-screen" />
        <ZoneLabel zone={zone} Icon={Icon} />
      </>
    );
  }
  if (zone.id === 'catalog' || zone.id === 'drive') {
    return (
      <>
        <div className="shelf-stack">
          {Array.from({ length: 18 }).map((_, index) => <b key={index} />)}
        </div>
        <ZoneLabel zone={zone} Icon={Icon} />
      </>
    );
  }
  if (zone.id === 'freezer') {
    return (
      <>
        <div className="freezer-door" />
        <div className="freezer-light" />
        <ZoneLabel zone={zone} Icon={Icon} />
      </>
    );
  }
  if (zone.id === 'approval') {
    return (
      <>
        <div className="approval-podium" />
        <div className="alert-ring" />
        <ZoneLabel zone={zone} Icon={Icon} />
      </>
    );
  }
  if (zone.id === 'payment') {
    return (
      <>
        <div className="cash-desk" />
        <div className="cash-screen" />
        <ZoneLabel zone={zone} Icon={Icon} />
      </>
    );
  }
  return <ZoneLabel zone={zone} Icon={Icon} />;
}

function ZoneLabel({ zone, Icon }) {
  return (
    <div className="zone-label">
      <Icon size={16} />
      <strong>{zone.short}</strong>
      <span>{zone.label}</span>
    </div>
  );
}

function SummaryView({ conversations: conversationItems, events, metrics, onNavigate, onSelectConversation, requests: requestItems, tools: toolItems, usage }) {
  const [activeSummaryFocus, setActiveSummaryFocus] = useState('attention');
  const activePipeline = [
    ['Entrada', conversationItems.filter((item) => item.path.includes('whatsapp')).length],
    ['Atención IA', conversationItems.filter((item) => item.path.includes('agent')).length],
    ['Catálogo', conversationItems.filter((item) => item.stage === 'catalog').length],
    ['Aprobación', requestItems.length],
    ['Cierre', conversationItems.filter((item) => item.stage === 'payment').length],
  ];
  const health = toolItems.reduce(
    (acc, tool) => {
      acc[tool.status] = (acc[tool.status] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const summaryFocusTabs = [
    ['attention', ListChecks, 'Atención', requestItems.length ? `${requestItems.length} pendientes` : 'Sin bloqueos'],
    ['usage', ShoppingBag, 'Uso del plan', formatUsageRatio(usage.metrics.deliveries_confirmed, usage.limits.includedDeliveries)],
    ['activity', Activity, 'Actividad', `${events.length} eventos`],
  ];

  return (
    <section className="summary-layout">
      <div className="section-title split-title summary-titlebar">
        <div>
          <span className="eyebrow">Resumen operativo</span>
          <h2>Qué requiere atención ahora</h2>
        </div>
        <div className="workspace-tabs compact-tabs summary-tabs" role="tablist" aria-label="Foco del resumen operativo">
          {summaryFocusTabs.map(([key, Icon, label, hint]) => (
            <button
              aria-selected={activeSummaryFocus === key}
              className={activeSummaryFocus === key ? 'is-active' : ''}
              key={key}
              onClick={() => setActiveSummaryFocus(key)}
              role="tab"
              type="button"
            >
              <Icon size={16} />
              <span>{label}</span>
              <small>{hint}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="summary-grid">
        {activeSummaryFocus === 'usage' && <UsagePlanCard usage={usage} onOpenAnalytics={() => onNavigate('analytics')} />}
        <article className="ops-card priority-card">
          <div className="mini-row">
            <span>Prioridad</span>
            <StatusPill status={requestItems.length ? 'approval_required' : 'resolved'} />
          </div>
          <h3>{requestItems.length ? `${requestItems.length} aprobaciones pendientes` : 'Operación sin bloqueos humanos'}</h3>
          <p>Las aprobaciones muestran contexto, consecuencia y acciones trazables antes de liberar el flujo.</p>
          <button className="approve-btn" type="button" onClick={() => onNavigate('approvals')}>
            <ListChecks size={16} />
            Revisar aprobaciones
          </button>
        </article>
        {activeSummaryFocus === 'attention' && (
          <article className="ops-card">
            <span className="eyebrow">Embudo vivo</span>
            <div className="funnel-bars">
              {activePipeline.map(([label, value], index) => (
                <button
                  className="funnel-row"
                  key={label}
                  onClick={() => onNavigate(index === 3 ? 'approvals' : 'conversations')}
                  type="button"
                >
                  <span>{label}</span>
                  <b style={{ width: `${Math.min(100, Math.max(value * 18, 12))}%` }} />
                  <strong>{value}</strong>
                </button>
              ))}
            </div>
          </article>
        )}
        {(activeSummaryFocus === 'attention' || activeSummaryFocus === 'usage') && (
          <article className="ops-card">
            <span className="eyebrow">Salud operativa</span>
            <div className="health-grid">
              <div>
                <strong>{health.sandbox_ready ?? 0}</strong>
                <span>Listas</span>
              </div>
              <div>
                <strong>{metrics.binding}</strong>
                <span>Conexiones</span>
              </div>
              <div>
                <strong>{metrics.failed}</strong>
                <span>Riesgos</span>
              </div>
            </div>
            <button className="ghost-btn compact" type="button" onClick={() => onNavigate('config')}>
              <Settings2 size={16} />
              Ver integraciones
            </button>
          </article>
        )}
        {activeSummaryFocus === 'activity' && (
          <article className="ops-card span-2">
            <span className="eyebrow">Conversaciones recientes</span>
            <div className="conversation-list compact-list">
              {conversationItems.slice(0, 4).map((conversation) => (
                <button className="conversation-row" key={conversation.id} onClick={() => onSelectConversation(conversation.id, 'conversations')} type="button">
                  <span className="avatar-token">{conversation.avatar}</span>
                  <div>
                    <strong>{conversation.customer}</strong>
                    <span>{conversation.need}</span>
                  </div>
                  <StatusPill status={conversation.status} />
                </button>
              ))}
            </div>
          </article>
        )}
        {activeSummaryFocus === 'activity' && (
          <article className="ops-card">
            <span className="eyebrow">Eventos</span>
            {events.slice(0, 5).map((event) => (
              <p className="event-line" key={event.id}>
                <span>{formatEventTime(event.at)}</span> {eventTypeLabel(event.type)}
              </p>
            ))}
          </article>
        )}
      </div>
    </section>
  );
}

function UsagePlanCard({ usage, onOpenAnalytics }) {
  const interactionsPct = usage.percentages?.interactions ?? 0;
  const deliveriesPct = usage.percentages?.deliveries ?? 0;
  const periodLabel = usage.period?.replace('-', ' / ') ?? 'mes actual';
  const planName = planLabel(usage.planCode?.replaceAll('_', ' ')) ?? 'plan activo';
  return (
    <article className={`ops-card usage-card usage-${usageTone(Math.max(interactionsPct, deliveriesPct))}`}>
      <div className="mini-row">
        <span>Uso del plan</span>
        <strong>{periodLabel}</strong>
      </div>
      <h3>{planName}</h3>
      <UsageMeter
        label="Domicilios"
        used={usage.metrics.deliveries_confirmed}
        limit={usage.limits.includedDeliveries}
        percent={deliveriesPct}
      />
      <UsageMeter
        label="Interacciones"
        used={usage.metrics.agent_interactions}
        limit={usage.limits.includedInteractions}
        percent={interactionsPct}
      />
      <div className="usage-mini-grid">
        <div>
          <span>Motor IA</span>
          <strong>{formatCompactNumber(usage.metrics.llm_total_tokens)} tokens</strong>
        </div>
        <div>
          <span>Herramientas</span>
          <strong>{formatCompactNumber(usage.metrics.tool_calls)}</strong>
        </div>
      </div>
      {onOpenAnalytics && (
        <button className="ghost-btn compact" type="button" onClick={onOpenAnalytics}>
          <BarChart3 size={16} />
          Ver detalle
        </button>
      )}
    </article>
  );
}

function UsageMeter({ label, used, limit, percent }) {
  return (
    <div className={`usage-meter usage-${usageTone(percent)}`}>
      <div className="mini-row">
        <span>{label}</span>
        <strong>{formatUsageRatio(used, limit)}</strong>
      </div>
      <div className="usage-track" aria-label={`${label}: ${Math.min(percent, 100)}% usado`}>
        <span style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <small>{limit ? `${Math.max(limit - used, 0).toLocaleString('es-CO')} disponibles` : 'Sin límite configurado'}</small>
    </div>
  );
}

function ConversationsView({
  backendStatus,
  conversations: conversationItems,
  detailCollapsed,
  events,
  onOpenApprovals,
  onSelectConversation,
  onToggleDetail,
  pendingRequest,
  query,
  searchInputRef,
  selectedConversation,
  selectedId,
  setQuery,
  setStatusFilter,
  statusFilter,
  workspaceTab,
  setWorkspaceTab,
  mobileDetailOpen,
  onOpenMobileDetail,
  onCloseMobileDetail,
  tab,
  setTab,
}) {
  const statuses = ['all', 'live', 'approval_required', 'blocked', 'degraded', 'needs_binding'];
  const activeWorkspaceTab = workspaceTab === 'detail' ? 'detail' : 'list';
  function selectConversation(id) {
    onSelectConversation(id);
    setWorkspaceTab?.('detail');
  }
  function returnToList() {
    setWorkspaceTab?.('list');
    onCloseMobileDetail?.();
  }
  return (
    <section className={`conversations-layout ${mobileDetailOpen ? 'is-detail-open' : ''} conversation-workspace-${activeWorkspaceTab}`}>
      <div className="section-title split-title conversation-titlebar">
        <div>
          <span className="eyebrow">{activeWorkspaceTab === 'list' ? 'Vista lista' : 'Vista detalle'}</span>
          <h2>{activeWorkspaceTab === 'list' ? 'Bandeja de conversaciones' : selectedConversation?.customer ?? 'Detalle de conversación'}</h2>
        </div>
        <div className="conversation-workspace-tabs" role="tablist" aria-label="Navegación de conversaciones">
          <button
            aria-selected={activeWorkspaceTab === 'list'}
            className={activeWorkspaceTab === 'list' ? 'is-active' : ''}
            onClick={returnToList}
            role="tab"
            type="button"
          >
            <MessageSquareText size={16} />
            Listado
          </button>
          <button
            aria-selected={activeWorkspaceTab === 'detail'}
            className={activeWorkspaceTab === 'detail' ? 'is-active' : ''}
            disabled={!selectedConversation}
            onClick={() => {
              setWorkspaceTab?.('detail');
              onOpenMobileDetail?.();
            }}
            role="tab"
            type="button"
          >
            <Eye size={16} />
            Detalle
          </button>
        </div>
      </div>
      {activeWorkspaceTab === 'list' && (
        <div className="conversation-toolbar">
          <div className="filter-strip">
            <label className="global-search inline-search">
              <Search size={16} />
              <input
                aria-label="Buscar en conversaciones"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cliente, ID, necesidad"
                ref={searchInputRef}
                value={query}
              />
            </label>
            <label className="select-filter">
              <ListFilter size={16} />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status === 'all' ? 'Todos los estados' : statusLabel[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
      {backendStatus === 'offline' && (
        <div className="inline-state error-state" role="status">
          <AlertTriangle size={17} />
          <span>No se pudo sincronizar con el backend. Estás viendo la última información local disponible.</span>
        </div>
      )}
      {backendStatus === 'connecting' && (
        <div className="inline-state loading-state" role="status">
          <Activity size={17} />
          <span>Cargando conversaciones y estados del agente...</span>
        </div>
      )}
      <div className={`conversation-grid conversation-tab-panel is-${activeWorkspaceTab}`}>
        {activeWorkspaceTab === 'list' && (
          <article className="conversation-list" aria-label="Lista de conversaciones">
            {conversationItems.length === 0 && (
              <div className="empty-state">
                <Search size={28} />
                <h3>Sin conversaciones para este filtro</h3>
                <p>Ajusta la búsqueda o vuelve a todos los estados.</p>
              </div>
            )}
            {conversationItems.map((conversation) => (
              <button
                className={selectedId === conversation.id ? 'conversation-row is-selected' : 'conversation-row'}
                aria-current={selectedId === conversation.id ? 'true' : undefined}
                key={conversation.id}
                onClick={() => selectConversation(conversation.id)}
                type="button"
              >
                <span className="avatar-token">{conversation.avatar}</span>
                <div>
                  <strong>{conversation.customer}</strong>
                  <span>{conversation.id} · {toolLabel(conversation.lastTool)}</span>
                  <small>{conversation.nextStep}</small>
                </div>
                <span className="conversation-progress" title="Progreso estimado del flujo operativo de esta conversación">
                  <small>Progreso</small>
                  <b>{conversation.progress}%</b>
                </span>
                <StatusPill status={conversation.status} />
              </button>
            ))}
          </article>
        )}
        {activeWorkspaceTab === 'detail' && selectedConversation ? (
          <ConversationPanel
            conversation={selectedConversation}
            detailCollapsed={detailCollapsed}
            events={events}
            onBack={returnToList}
            onOpenApprovals={() => onOpenApprovals?.(pendingRequest?.id ?? '')}
            onToggleDetail={onToggleDetail}
            pendingRequest={pendingRequest}
            tab={tab}
            setTab={setTab}
          />
        ) : activeWorkspaceTab === 'detail' ? (
          <div className="empty-state conversation-detail-empty">
            <MessageSquareText size={30} />
            <h3>Selecciona una conversación</h3>
            <p>Vuelve al listado para elegir el cliente que quieres revisar.</p>
            <button className="approve-btn compact" type="button" onClick={() => setWorkspaceTab?.('list')}>
              Ver listado
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ConversationPanel({
  conversation,
  detailCollapsed = false,
  events,
  onBack,
  onClose,
  onOpenApprovals,
  onOpenList,
  onToggleDetail,
  pendingRequest,
  tab = 'chat',
  setTab,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!panelRef.current) return;
    panelRef.current.focus({ preventScroll: true });
  }, [conversation?.id]);

  if (!conversation) return null;
  const relevantEvents = events.filter((event) => event.conversationId === conversation.id).slice(0, 3);
  const eventPreview = relevantEvents.length ? relevantEvents : events.slice(0, 3);
  const needsHuman = conversation.status === 'approval_required' || conversation.status === 'blocked' || Boolean(pendingRequest);
  const nextAction = needsHuman
    ? pendingRequest?.title ?? conversation.humanReason ?? 'Revisar intervención humana'
    : conversation.nextStep;
  const riskLabel = needsHuman ? 'Requiere acción humana' : conversation.status === 'degraded' ? 'Operación degradada' : 'Flujo normal';
  const waId = pendingRequest?.contextSnapshot?.customerWaId ?? pendingRequest?.context_snapshot?.customerWaId ?? conversation.waId ?? '';
  const waHref = whatsappHref(waId);
  const messages = conversationMessages(conversation);
  const sidePanelHidden = detailCollapsed ? 'is-detail-collapsed' : 'is-detail-expanded';
  return (
    <aside
      ref={panelRef}
      className={`detail-panel operator-panel whatsapp-thread-panel ${sidePanelHidden} active-tab-${tab}`}
      tabIndex={-1}
      role="complementary"
      aria-label={`Conversación WhatsApp de ${conversation.customer}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && onClose) onClose();
      }}
    >
      <span className="sheet-grip" aria-hidden="true" />
      <div className="panel-heading">
        <span className="eyebrow">Conversación WhatsApp</span>
        <div className="panel-title-row">
          {onBack && (
            <button className="ghost-btn compact conversation-back" type="button" onClick={onBack}>
              ← Atrás
            </button>
          )}
          <h2>{conversation.customer}</h2>
          <StatusPill status={conversation.status} />
          {onToggleDetail && (
            <button className="ghost-btn compact detail-toggle" type="button" onClick={onToggleDetail} aria-pressed={!detailCollapsed}>
              {detailCollapsed ? 'Mostrar resumen' : 'Ocultar resumen'}
            </button>
          )}
          {waHref && (
            <a className="ghost-btn compact whatsapp-header-btn" href={waHref} target="_blank" rel="noreferrer">
              <Send size={15} />
              Abrir WhatsApp
            </a>
          )}
          {onClose && (
            <button className="icon-btn compact" type="button" title="Cerrar caso" onClick={onClose}>
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {setTab && (
        <div className="conversation-tabs" role="tablist" aria-label="Vista de conversación">
          {['chat', 'summary', 'actions'].map((item) => (
            <button
              aria-selected={tab === item}
              className={tab === item ? 'is-active' : ''}
              key={item}
              onClick={() => setTab(item)}
              role="tab"
              type="button"
            >
              {item === 'chat' ? 'Chat' : item === 'summary' ? 'Resumen' : 'Acciones'}
            </button>
          ))}
        </div>
      )}

      <div className="whatsapp-contact-card conversation-side-card tab-summary tab-actions">
        <MessageCircle size={20} />
        <div>
          <span>{waId || 'Número no registrado'}</span>
          <strong>{riskLabel}</strong>
        </div>
        {waHref && (
          <a className="ghost-btn compact whatsapp-open-btn" href={waHref} target="_blank" rel="noreferrer">
            <Send size={15} />
            Abrir WhatsApp
          </a>
        )}
      </div>

      <div className="action-card whatsapp-action-card conversation-side-card tab-actions">
        <span>{needsHuman ? 'Necesita atención' : 'Siguiente paso'}</span>
        <strong>{nextAction}</strong>
        <div className="button-row">
          {needsHuman && onOpenApprovals && (
            <button className="approve-btn compact" type="button" onClick={onOpenApprovals}>
              <UserCheck size={16} />
              Resolver solicitud
            </button>
          )}
          {onOpenList && (
            <button className="ghost-btn compact" type="button" onClick={onOpenList}>
              <MessageSquareText size={16} />
              Lista de chats
            </button>
          )}
        </div>
      </div>

      <div className="whatsapp-message-list tab-chat" aria-label="Mensajes recientes" aria-live="polite">
        {messages.map((message) => (
          <div className={`whatsapp-message is-${message.role}`} key={message.id}>
            <span>{message.label}</span>
            <p>{message.text}</p>
            <small>{formatMessageTime(message.createdAt)}</small>
          </div>
        ))}
      </div>

      <div className="info-stack compact-info conversation-side-card tab-summary">
        <InfoLine icon={Search} label="Necesidad" value={conversation.need} />
        <InfoLine icon={ShoppingBag} label="Valor / etapa" value={`${conversation.value} · ${stageLabel(conversation.stage)}`} />
        <InfoLine icon={PlugZap} label="Herramienta" value={toolLabel(conversation.lastTool)} />
      </div>

      {pendingRequest && (
        <div className="approval-context conversation-side-card tab-actions">
          <strong>{pendingRequest.urgency} · {pendingRequest.type}</strong>
          <span>{pendingRequest.context}</span>
        </div>
      )}

      {needsHuman && onOpenApprovals && (
        <div className="whatsapp-reply-box conversation-side-card tab-actions">
          <button className="approve-btn" type="button" onClick={onOpenApprovals}>
            <Send size={16} />
            Responder desde solicitud
          </button>
        </div>
      )}

      <div className="event-card operator-events conversation-side-card tab-summary">
        <div className="mini-row">
          <strong>Última actividad</strong>
          <Eye size={16} />
        </div>
        {eventPreview.map((event) => (
          <p key={event.id}>
            <span>{formatEventTime(event.at)}</span> {eventTypeLabel(event.type)}
          </p>
        ))}
      </div>
    </aside>
  );
}

function conversationMessages(conversation) {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  if (!messages.length) {
    return [
      {
        id: `${conversation.id}-need`,
        role: 'user',
        label: 'Cliente',
        text: conversation.need || 'Conversación recibida por WhatsApp.',
        createdAt: conversation.updatedAt ?? conversation.createdAt,
      },
      {
        id: `${conversation.id}-next`,
        role: conversation.status === 'blocked' || conversation.status === 'approval_required' ? 'system' : 'agent',
        label: conversation.status === 'blocked' || conversation.status === 'approval_required' ? 'Sistema' : 'Agente IA',
        text: conversation.humanReason || conversation.nextStep || 'El agente está gestionando la conversación.',
        createdAt: conversation.updatedAt ?? conversation.createdAt,
      },
    ];
  }
  return messages.slice(-8).map((message) => ({
    id: message.id ?? `${conversation.id}-${message.createdAt ?? message.text}`,
    role: message.role === 'human' ? 'human' : message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'agent',
    label: message.role === 'human'
      ? 'Tienda'
      : message.role === 'user'
        ? 'Cliente'
        : message.role === 'system'
          ? 'Sistema'
          : 'Agente IA',
    text: message.text || `[${message.messageType ?? 'mensaje'}]`,
    createdAt: message.createdAt,
  }));
}

function whatsappHref(waId) {
  const digits = String(waId ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}`;
}

function formatMessageTime(value) {
  if (!value) return 'Ahora';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Ahora';
  return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
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

function humanRequestViewModel(request, conversation) {
  const snapshot = request.contextSnapshot ?? request.context_snapshot ?? {};
  const isDeliveryOrder = request.action === 'prepare_delivery_order'
    || snapshot.action === 'prepare_delivery_order'
    || (request.assignedTeam === 'operaciones' && normalizeLabel(request.title).includes('pedido'));
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const itemLines = items.map((item) => ({
    name: item.name ?? item.catalogQuery ?? 'Producto por validar',
    quantity: item.quantity ?? 1,
    total: item.lineTotal ?? null,
  }));
  const subtotal = snapshot.subtotal ?? itemLines.reduce((sum, item) => sum + Number(item.total ?? 0), 0);
  return {
    isDeliveryOrder,
    title: isDeliveryOrder ? 'Alistar domicilio' : request.title,
    task: isDeliveryOrder ? 'Preparar y entregar' : eventTypeLabel(request.type),
    customer: snapshot.customerName ?? conversation?.customer ?? request.conversationId,
    address: snapshot.deliveryAddress ?? conversation?.deliveryAddress ?? 'Sin dirección registrada',
    waId: snapshot.customerWaId ?? conversation?.waId ?? '',
    orderId: snapshot.orderId ?? conversation?.orderId ?? '',
    items: itemLines,
    subtotal,
    paymentMethod: snapshot.paymentMethod ?? null,
    context: request.context,
    consequence: isDeliveryOrder
      ? 'El tendero toma el pedido para alistarlo. Si falta algo, responde al cliente desde la conversación.'
      : request.consequence,
    primaryAction: isDeliveryOrder ? 'Marcar tomado' : 'Aprobar',
    denyAction: isDeliveryOrder ? 'No puedo alistar' : 'Rechazar',
  };
}

function normalizeLabel(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function HumanQueue({ requests, conversations, onSelectConversation, onResolve, draftReply, setDraftReply, replyMode, setReplyMode, selectedRequestId = '' }) {
  const [activeQueueTab, setActiveQueueTab] = useState('pending');
  const selectedRequestRef = useRef(null);
  const queueRows = requests.map((request) => {
    const conversation = conversations.find((item) => item.id === request.conversationId);
    return {
      request,
      conversation,
      view: humanRequestViewModel(request, conversation),
    };
  });
  const deliveryRows = queueRows.filter((row) => row.view.isDeliveryOrder);
  const responseRows = queueRows.filter((row) => !row.view.isDeliveryOrder);
  const queueTabs = [
    ['pending', ListChecks, 'Pendientes', queueRows.length],
    ['delivery', ShoppingBag, 'Preparar pedidos', deliveryRows.length],
    ['response', Send, 'Responder cliente', responseRows.length],
    ['history', BadgeCheck, 'Historial', 0],
  ];
  const visibleQueueRows = activeQueueTab === 'delivery'
    ? deliveryRows
    : activeQueueTab === 'response'
      ? responseRows
      : activeQueueTab === 'history'
        ? []
        : queueRows;

  useEffect(() => {
    if (!selectedRequestId || !selectedRequestRef.current) return;
    selectedRequestRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    selectedRequestRef.current.focus({ preventScroll: true });
  }, [selectedRequestId]);

  useEffect(() => {
    if (!selectedRequestId) return;
    const selectedRow = queueRows.find((row) => row.request.id === selectedRequestId);
    if (!selectedRow) return;
    setActiveQueueTab(selectedRow.view.isDeliveryOrder ? 'delivery' : 'response');
  }, [selectedRequestId, requests]);

  return (
    <section className="queue-layout">
      <div className="section-title split-title queue-titlebar">
        <div>
          <span className="eyebrow">Aprobaciones</span>
          <h2>Bandeja priorizada de intervención humana</h2>
        </div>
        <div className="workspace-tabs compact-tabs" role="tablist" aria-label="Tipos de aprobaciones">
          {queueTabs.map(([key, Icon, label, count]) => (
            <button
              aria-selected={activeQueueTab === key}
              className={activeQueueTab === key ? 'is-active' : ''}
              key={key}
              onClick={() => setActiveQueueTab(key)}
              role="tab"
              type="button"
            >
              <Icon size={16} />
              <span>{label}</span>
              <b>{count}</b>
            </button>
          ))}
        </div>
      </div>
      <div className="queue-grid">
        {visibleQueueRows.length === 0 && (
          <article className="empty-state">
            {activeQueueTab === 'history' ? <Clock3 size={28} /> : <BadgeCheck size={28} />}
            <h3>{activeQueueTab === 'history' ? 'Historial pendiente de consolidar' : 'Sin pendientes para este filtro'}</h3>
            <p>{activeQueueTab === 'history' ? 'Cuando se persistan resoluciones recientes, aparecerán aquí como solo lectura.' : 'Cambia de tab o espera nuevas solicitudes humanas del agente.'}</p>
          </article>
        )}
        {visibleQueueRows.map(({ request, conversation, view }) => {
          const isSelected = request.id === selectedRequestId;
          return (
            <article
              className={`request-card ${view.isDeliveryOrder ? 'is-delivery-order' : ''} ${isSelected ? 'is-selected' : ''}`}
              data-request-id={request.id}
              data-conversation-id={request.conversationId}
              key={request.id}
              ref={isSelected ? selectedRequestRef : null}
              tabIndex={isSelected ? -1 : undefined}
            >
              <div className="request-top">
                <span className={`urgency urgency-${request.urgency.toLowerCase()}`}>{request.urgency}</span>
                <span className="request-kind">{view.task}</span>
              </div>
              <h3>{view.title}</h3>
              {view.isDeliveryOrder ? (
                <div className="delivery-brief">
                  <div className="delivery-main">
                    <ShoppingBag size={20} />
                    <div>
                      <span>Pedido</span>
                      <strong>{view.orderId || 'Pedido confirmado'}</strong>
                    </div>
                    <b>{formatCurrency(view.subtotal)}</b>
                  </div>
                  <div className="delivery-items">
                    {view.items.slice(0, 5).map((item, index) => (
                      <div key={`${item.name}-${index}`}>
                        <strong>{item.quantity}x</strong>
                        <span>{item.name}</span>
                      </div>
                    ))}
                    {view.items.length > 5 && <em>+ {view.items.length - 5} producto(s) más</em>}
                  </div>
                  <div className="delivery-destination">
                    <InfoLine icon={UserCheck} label="Cliente" value={view.customer} />
                    <InfoLine icon={Store} label="Entrega" value={view.address} />
                    {view.paymentMethod && <InfoLine icon={CircleDollarSign} label="Pago" value={view.paymentMethod} />}
                  </div>
                </div>
              ) : (
                <p className="request-summary">{view.context}</p>
              )}
              <div className="impact-box request-next-step">
                <strong>{view.isDeliveryOrder ? 'Qué debe hacer' : 'Después de responder'}</strong>
                <span>{view.consequence}</span>
              </div>
              <div className="mini-row">
                <button className="text-btn" type="button" onClick={() => onSelectConversation(request.conversationId)}>
                  Abrir conversación WhatsApp
                </button>
                <span>{view.waId || request.conversationId}</span>
              </div>
              {!view.isDeliveryOrder && (
                <>
                  <textarea value={draftReply} onChange={(event) => setDraftReply(event.target.value)} rows={2} placeholder="Respuesta corta para el cliente o nota interna" />
                  <label className="select-filter human-reply-mode">
                    <Send size={16} />
                    <select value={replyMode} onChange={(event) => setReplyMode(event.target.value)}>
                      <option value="whatsapp">Enviar por WhatsApp</option>
                      <option value="platform">Guardar en plataforma</option>
                    </select>
                  </label>
                </>
              )}
              <div className="button-row">
                <button className="approve-btn" type="button" onClick={() => onResolve(request.id, 'approved', { responseMode: 'none' })}>
                  <Check size={16} />
                  {view.primaryAction}
                </button>
                <button className="deny-btn" type="button" onClick={() => onResolve(request.id, 'denied', { responseMode: 'none' })}>
                  <X size={16} />
                  {view.denyAction}
                </button>
                {!view.isDeliveryOrder && (
                  <button
                    className="ghost-btn compact"
                    type="button"
                    onClick={() => onResolve(request.id, 'approved', { responseMode: replyMode, note: draftReply })}
                  >
                    <Send size={16} />
                    {replyMode === 'whatsapp' ? 'Enviar por WhatsApp' : 'Guardar nota'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function onboardingTabForStep(step) {
  if (['subscription', 'billing-checkout', 'billing-continue', 'billing-cancel'].includes(step)) return 'billing';
  if (['google_oauth', 'google_provisioning', 'provision'].includes(step)) return 'google';
  if (step === 'whatsapp') return 'whatsapp';
  return 'route';
}

function OnboardingView({ billingStatus, bundle, busyAction, error, isPlatformAdmin, onAction, onNavigate, onWhatsAppAction, tenant }) {
  const status = bundle?.status ?? fallbackOnboardingStatus(tenant);
  const [activeOnboardingTab, setActiveOnboardingTab] = useState(() => onboardingTabForStep(status.nextStep));
  const checks = status.checks ?? [];
  const enrichedSteps = checks.map((check) => ({ ...check, meta: onboardingStepMeta(check.key) }));
  const next = nextOnboardingAction(status, isPlatformAdmin);
  const completeCount = checks.filter((item) => item.ok).length;
  const progress = Math.round((completeCount / Math.max(checks.length, 1)) * 100);
  const workspace = bundle?.googleWorkspace;
  const googleConnection = bundle?.googleConnection;
  const whatsappOnboarding = bundle?.whatsappOnboarding ?? fallbackWhatsAppOnboarding(tenant);
  const subscription = status.subscription ?? bundle?.subscription;
  const currentStep = enrichedSteps.find((item) => !item.ok) ?? enrichedSteps.at(-1);
  const currentMeta = currentStep?.meta ?? onboardingStepMeta(status.nextStep);
  const CurrentIcon = currentMeta.icon;
  const operationLabel = status.readyForOperation
    ? 'Operación habilitada'
    : status.readyForActivation
      ? 'Lista para activar'
      : 'Configuración en curso';
  const remainingCount = Math.max(checks.length - completeCount, 0);
  const onboardingSignals = [
    {
      icon: CircleDollarSign,
      label: 'Suscripción',
      value: humanState(subscription?.status) ?? 'Por validar',
      state: subscription?.status === 'active' || subscription?.status === 'authorized' ? 'ok' : 'warn',
    },
    {
      icon: UserCheck,
      label: 'Google del cliente',
      value: googleConnection?.accountEmail ?? 'Pendiente',
      state: googleConnection?.accountEmail ? 'ok' : 'warn',
    },
    {
      icon: MessageCircle,
      label: 'WhatsApp',
      value: tenant.config?.whatsapp?.phoneNumberId ? 'Número conectado' : 'Por conectar',
      state: tenant.config?.whatsapp?.phoneNumberId ? 'ok' : 'warn',
    },
    {
      icon: Bot,
      label: 'Motor IA',
      value: 'DeepSeek plataforma',
      state: 'ok',
    },
  ];
  const onboardingTabs = [
    ['route', ShieldCheck, 'Ruta', `${completeCount}/${checks.length}`],
    ['billing', CircleDollarSign, 'Pago', humanState(subscription?.status) ?? 'Pendiente'],
    ['google', Database, 'Google', googleConnection?.accountEmail ? 'Conectado' : 'Pendiente'],
    ['whatsapp', MessageCircle, 'WhatsApp', tenant.config?.whatsapp?.phoneNumberId ? 'Conectado' : 'Pendiente'],
    ['test', Play, 'Prueba', status.readyForOperation ? 'Lista' : 'Pendiente'],
  ];
  const googleConnected = Boolean(googleConnection?.accountEmail || googleConnection?.status === 'connected');
  const googleProvisioned = Boolean(
    workspace?.spreadsheet?.id || workspace?.status === 'provisioned' || workspace?.status === 'ready',
  );
  const googleSetupSteps = [
    {
      key: 'authorize',
      icon: UserCheck,
      title: 'Autorizar Drive y Sheets',
      detail: 'El dueño entra con la cuenta Google de la tienda y aprueba permisos para crear archivos operativos.',
      done: googleConnected,
      status: googleConnected ? 'sandbox_ready' : 'needs_binding',
      statusText: googleConnected ? 'Cuenta conectada' : 'Pendiente',
      action: 'google-oauth',
      actionLabel: googleConnected ? 'Reconectar Google' : 'Conectar Google',
      disabled: false,
    },
    {
      key: 'provision',
      icon: Database,
      title: 'Crear estructura en Drive',
      detail: 'La plataforma crea la carpeta de la tienda y el Google Sheet con catalogo, clientes y pedidos.',
      done: googleProvisioned,
      status: googleProvisioned ? 'sandbox_ready' : googleConnected ? 'approval_required' : 'needs_binding',
      statusText: googleProvisioned ? 'Estructura creada' : googleConnected ? 'Lista para crear' : 'Esperando cuenta',
      action: googleProvisioned ? null : 'provision',
      actionLabel: 'Crear Drive y Sheets',
      disabled: !googleConnected,
    },
    {
      key: 'complete',
      icon: ShoppingBag,
      title: 'Completar datos base',
      detail: 'El usuario abre la hoja, completa catalogo, stock, clientes frecuentes y valida que la tienda pueda operar.',
      done: googleProvisioned,
      status: googleProvisioned ? 'sandbox_ready' : 'needs_binding',
      statusText: googleProvisioned ? 'Lista para editar' : 'Despues de crear estructura',
      disabled: !googleProvisioned,
    },
  ];

  useEffect(() => {
    setActiveOnboardingTab(onboardingTabForStep(status.nextStep));
  }, [status.nextStep, tenant.id]);

  return (
    <section className="onboarding-layout">
      <div className="onboarding-hero">
        <div className="onboarding-hero-copy">
          <span className="eyebrow">Puesta en marcha guiada</span>
          <h2>{tenant.name}</h2>
          <p>
            Acompañamos la activación de la tienda paso a paso: pago de plataforma, Google del cliente,
            estructura operativa, DeepSeek y WhatsApp aislado por tienda.
          </p>
          <div className="hero-next">
            <CurrentIcon size={18} />
            <span>{operationLabel}</span>
            <strong>{currentMeta.short}</strong>
          </div>
        </div>
        <div className="onboarding-score" style={{ '--setup-progress': `${progress}%` }}>
          <span>Avance</span>
          <strong>{progress}%</strong>
          <b>{completeCount}/{checks.length}</b>
          <i />
        </div>
        <div className="onboarding-hero-actions">
          <button className="ghost-btn" type="button" onClick={() => onAction('validate')} disabled={busyAction === 'validate'}>
            <RotateCcw size={16} />
            Validar
          </button>
          <button className="approve-btn" type="button" onClick={() => onAction(next.action)} disabled={!next.action || Boolean(busyAction)}>
            <Check size={16} />
            {busyAction ? 'Procesando' : next.label}
          </button>
        </div>
      </div>

      <div className="activation-strip" aria-label="Resumen de activación">
        {onboardingSignals.map(({ icon: Icon, label, state, value }) => (
          <article className={`activation-card is-${state}`} key={label}>
            <Icon size={18} />
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="workspace-tabs onboarding-tabs" role="tablist" aria-label="Etapas de activación">
        {onboardingTabs.map(([key, Icon, label, detail]) => (
          <button
            aria-selected={activeOnboardingTab === key}
            className={activeOnboardingTab === key ? 'is-active' : ''}
            key={key}
            onClick={() => setActiveOnboardingTab(key)}
            role="tab"
            type="button"
          >
            <Icon size={16} />
            <span>{label}</span>
            <small>{detail}</small>
          </button>
        ))}
      </div>

      {activeOnboardingTab === 'billing' && (
        <BillingOwnerPanel
          billing={billingStatus}
          busyAction={busyAction}
          onAction={onAction}
          subscription={subscription}
        />
      )}

      {activeOnboardingTab === 'route' && (
      <>
      <div className="guided-grid">
        <article className="guide-panel next-step-panel">
          <span className="eyebrow">Siguiente paso recomendado</span>
          <div className="next-step-heading">
            <CurrentIcon size={22} />
            <div>
              <h3>{next.title}</h3>
              <p>{next.detail}</p>
            </div>
          </div>
          <div className="guide-explainer">
            <div>
              <span>Por qué importa</span>
              <strong>{currentMeta.why}</strong>
            </div>
            <div>
              <span>Qué necesitas</span>
              <strong>{currentMeta.needs}</strong>
            </div>
          </div>
          <div className="button-row">
            {next.secondary && (
              <button className="ghost-btn" type="button" onClick={() => onNavigate(next.secondary.view)}>
                <Settings2 size={16} />
                {next.secondary.label}
              </button>
            )}
            {status.readyForActivation && !status.readyForOperation && isPlatformAdmin && (
              <button className="approve-btn" type="button" onClick={() => onAction('activate')} disabled={Boolean(busyAction)}>
                <ShieldCheck size={16} />
                Activar tienda
              </button>
            )}
          </div>
          {error && (
            <div className="setup-error">
              <AlertTriangle size={17} />
              <span>{error}</span>
            </div>
          )}
        </article>

        <article className="guide-panel readiness-panel">
          <span className="eyebrow">Estado de la tienda</span>
          <div className="readiness-summary">
            <strong>{remainingCount ? `${remainingCount} pasos pendientes` : 'Lista para validar operación'}</strong>
            <span>{status.readyForOperation ? 'La tienda ya puede operar con controles activos.' : 'Cada paso queda validado antes de habilitar la operación.'}</span>
          </div>
          <div className="readiness-list">
            <ResourceRow icon={ShieldCheck} label="Operación" value={operationLabel} />
            <ResourceRow icon={CircleDollarSign} label="Pago plataforma" value={humanState(subscription?.status) ?? 'Sin validar'} />
            <ResourceRow icon={UserCheck} label="Cuenta Google" value={googleConnection?.accountEmail ?? 'No conectada'} />
            <ResourceRow icon={MessageCircle} label="WhatsApp" value={tenant.config?.whatsapp?.phoneNumberId ? 'Número conectado' : 'Pendiente'} />
          </div>
        </article>
      </div>

      <article className="journey-panel">
        <div className="journey-title">
          <div>
            <span className="eyebrow">Ruta de activación</span>
            <h3>De suscripción a operación real</h3>
          </div>
          <span>{completeCount} etapas completas</span>
        </div>
        <div className="setup-board">
          {enrichedSteps.map((check, index) => (
            <OnboardingStep
              busyAction={busyAction}
              check={check}
              index={index}
              isCurrent={!check.ok && check.key === status.nextStep}
              key={check.key}
              onAction={onAction}
            />
          ))}
        </div>
      </article>
      </>
      )}

      {activeOnboardingTab === 'test' && (
      <article className="guide-panel test-drive-panel">
        <div>
          <span className="eyebrow">Prueba guiada</span>
          <h3>Antes de publicar, valida una conversación completa</h3>
          <p>Usa casos de tienda reales: cliente nuevo, producto ambiguo, varias presentaciones, producto agotado y escalamiento humano.</p>
        </div>
        <div className="test-script-grid">
          <div>
            <MessageCircle size={17} />
            <span>Cliente escribe por WhatsApp</span>
            <strong>"Buenas, para un domicilio..."</strong>
          </div>
          <div>
            <Search size={17} />
            <span>Motor IA interpreta</span>
            <strong>Consulta catálogo y decide si pregunta o escala</strong>
          </div>
          <div>
            <ShoppingBag size={17} />
            <span>Pedido queda listo</span>
            <strong>Registra canasta en Google Sheets</strong>
          </div>
        </div>
        <div className="button-row">
          <button className="approve-btn" type="button" onClick={() => onNavigate('store')}>
            <Store size={16} />
            Abrir Tienda viva
          </button>
          <button className="ghost-btn" type="button" onClick={() => onNavigate('conversations')}>
            <MessageSquareText size={16} />
            Ver conversaciones
          </button>
        </div>
      </article>
      )}

      {activeOnboardingTab === 'whatsapp' && (
      <WhatsAppActivationWizard
        busyAction={busyAction}
        onboarding={whatsappOnboarding}
        onAction={onWhatsAppAction}
        onOpenConfig={() => onNavigate('config')}
        tenant={tenant}
      />
      )}

      {activeOnboardingTab === 'google' && (
      <div className="google-onboarding-grid">
        <article className="guide-panel google-guide-panel">
          <div>
            <span className="eyebrow">Conectar Google Drive</span>
            <h3>Guía para dejar Drive y Sheets listos</h3>
            <p>
              Este paso conecta la cuenta Google del cliente, crea la estructura operativa en su Drive
              y deja una hoja editable para catálogo, clientes y pedidos.
            </p>
          </div>

          <div className="google-step-stack">
            {googleSetupSteps.map((step, index) => {
              const StepIcon = step.icon;
              return (
                <article className={`google-step-card ${step.done ? 'is-done' : step.disabled ? 'is-locked' : 'is-current'}`} key={step.key}>
                  <div className="google-step-index">{step.done ? <Check size={15} /> : index + 1}</div>
                  <div className="google-step-body">
                    <div className="google-step-heading">
                      <StepIcon size={18} />
                      <div>
                        <strong>{step.title}</strong>
                        <span>{step.statusText}</span>
                      </div>
                      <StatusPill status={step.status} />
                    </div>
                    <p>{step.detail}</p>
                    {step.action && (
                      <button
                        className={step.done ? 'ghost-btn' : 'approve-btn'}
                        disabled={step.disabled || Boolean(busyAction)}
                        onClick={() => onAction(step.action)}
                        type="button"
                      >
                        {step.done ? <RotateCcw size={16} /> : <Check size={16} />}
                        {busyAction === step.action ? 'Procesando' : step.actionLabel}
                      </button>
                    )}
                    {step.key === 'complete' && (
                      <div className="google-action-row">
                        {workspace?.spreadsheet?.url && (
                          <a className="approve-btn" href={workspace.spreadsheet.url} target="_blank" rel="noreferrer">
                            <Database size={16} />
                            Abrir Google Sheets
                          </a>
                        )}
                        <button className="ghost-btn" onClick={() => onNavigate('config')} type="button">
                          <Settings2 size={16} />
                          Editar configuración Google
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </article>

        <article className="guide-panel google-result-panel">
          <div>
            <span className="eyebrow">Recursos del cliente</span>
            <h3>{googleProvisioned ? 'Drive operativo creado' : 'Estructura pendiente'}</h3>
            <p>
              Cada tienda mantiene sus archivos en su propio Google. La plataforma guarda referencias
              por tenant y valida permisos antes de habilitar la operación.
            </p>
          </div>
          <div className="resource-list compact-resource-list">
            <ResourceRow icon={UserCheck} label="Cuenta" value={googleConnection?.accountEmail ?? 'Pendiente'} />
            <ResourceRow icon={Database} label="Google Sheets" value={workspace?.spreadsheet?.id ?? 'Pendiente'} />
            <ResourceRow icon={ShoppingBag} label="Catálogo" value={workspace?.sheets?.catalog ?? 'Catalogo'} />
            <ResourceRow icon={MessageCircle} label="Clientes" value={tenant.config?.googleSheets?.customerProfilesRange ?? 'Clientes!A1:H1000'} />
            <ResourceRow icon={CircleDollarSign} label="Pedidos" value={tenant.config?.googleSheets?.ordersRange ?? 'Pedidos!A1:M1000'} />
          </div>
          <div className="google-note">
            <ShieldCheck size={18} />
            <div>
              <strong>Qué debe hacer el usuario</strong>
              <span>Autorizar Google, crear la hoja y completar catálogo/stock. WhatsApp se configura en su propia pestaña.</span>
            </div>
          </div>
        </article>
      </div>
      )}
    </section>
  );
}

function BillingOwnerPanel({ billing, busyAction, onAction, subscription }) {
  const plan = billing?.plan;
  const activeSubscription = billing?.subscription ?? subscription;
  const usage = billing?.usageCycle;
  const payments = billing?.payments ?? [];
  const deliveriesUsed = Number(usage?.deliveriesUsed ?? 0);
  const interactionsUsed = Number(usage?.interactionsUsed ?? 0);
  const includedDeliveries = Number(plan?.includedDeliveries ?? activeSubscription?.includedDeliveries ?? 1000);
  const includedInteractions = Number(plan?.includedInteractions ?? activeSubscription?.includedInteractions ?? 5000);
  const canContinue = billing?.actions?.canContinueCheckout;
  const canStart = billing?.actions?.canStartCheckout;
  const status = activeSubscription?.status ?? 'pending_payment';
  const nextDate = activeSubscription?.nextBillingDate ?? activeSubscription?.currentPeriodEnd;
  const notices = billing?.notices ?? [];
  const paymentHistory = billing?.paymentHistory ?? payments;
  return (
    <article className="billing-owner-panel">
      <div className="billing-owner-copy">
        <span className="eyebrow">Facturación de plataforma</span>
        <h3>{plan?.name ?? 'Plan Ventas IA'}</h3>
        <p>Precio final único. Mercado Pago cobra la suscripción mensual; los pagos de domicilios siguen siendo de la tienda.</p>
      </div>
      <div className="billing-owner-status">
        <span className={`billing-state is-${status}`}>{humanState(status)}</span>
        <strong>{formatCurrency(plan?.amount ?? activeSubscription?.amount ?? 89000, plan?.currency ?? 'COP')}</strong>
        <small>{nextDate ? `Próximo cobro ${formatDateShort(nextDate)}` : 'Cobro por aniversario de suscripción'}</small>
      </div>
      <div className="billing-owner-usage">
        <UsageMiniBar label="Domicilios" value={deliveriesUsed} limit={includedDeliveries} />
        <UsageMiniBar label="Interacciones" value={interactionsUsed} limit={includedInteractions} />
      </div>
      {notices.length > 0 && (
        <div className="billing-notice-list">
          {notices.slice(0, 3).map((notice) => (
            <div className={`billing-notice is-${notice.tone}`} key={notice.key}>
              <AlertTriangle size={15} />
              <div>
                <strong>{notice.title}</strong>
                <span>{notice.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="billing-owner-actions">
        {canContinue ? (
          <button className="approve-btn compact" type="button" onClick={() => onAction('billing-continue')} disabled={Boolean(busyAction)}>
            <CircleDollarSign size={16} />
            Continuar pago
          </button>
        ) : canStart ? (
          <button className="approve-btn compact" type="button" onClick={() => onAction('billing-checkout')} disabled={Boolean(busyAction)}>
            <CircleDollarSign size={16} />
            Activar suscripción
          </button>
        ) : (
          <button className="ghost-btn compact" type="button" onClick={() => onAction('billing-cancel')} disabled={Boolean(busyAction)}>
            <X size={16} />
            Cancelar al final del periodo
          </button>
        )}
        <div className="billing-payment-preview">
          <span>Último pago</span>
          <strong>{paymentHistory[0] ? `${humanState(paymentHistory[0].status)} · ${formatDateShort(paymentHistory[0].paidAt)}` : 'Sin pagos confirmados'}</strong>
          {paymentHistory[0]?.receiptLabel && <small>{paymentHistory[0].receiptLabel}</small>}
        </div>
      </div>
      {paymentHistory.length > 1 && (
        <div className="billing-history-list">
          {paymentHistory.slice(0, 3).map((payment) => (
            <span key={payment.id}>
              <b>{humanState(payment.status)}</b>
              {formatDateShort(payment.paidAt)}
              <em>{formatCurrency(payment.amount, payment.currency)}</em>
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function UsageMiniBar({ label, value, limit }) {
  const percentage = Math.min(100, Math.round((Number(value) / Math.max(Number(limit), 1)) * 100));
  return (
    <div className="usage-mini-bar">
      <div>
        <span>{label}</span>
        <strong>{value.toLocaleString('es-CO')} / {limit.toLocaleString('es-CO')}</strong>
      </div>
      <i><b style={{ width: `${percentage}%` }} /></i>
    </div>
  );
}

function OnboardingStep({ busyAction, check, index, isCurrent, onAction }) {
  const meta = check.meta ?? onboardingStepMeta(check.key);
  const Icon = meta.icon;
  const action = onboardingStepAction(check.key);
  return (
    <article className={`setup-step ${check.ok ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`}>
      <span className="setup-index">{check.ok ? <Check size={15} /> : index + 1}</span>
      <div className="setup-copy">
        <div>
          <Icon size={17} />
          <strong>{meta.title}</strong>
        </div>
        <p>{meta.description}</p>
        <span>{onboardingDetailLabel(check)}</span>
      </div>
      {check.ok ? (
        <span className="setup-chip is-ok">Listo</span>
      ) : (
        <button className="ghost-btn compact" type="button" onClick={() => onAction(action.key)} disabled={busyAction === action.key}>
          {action.icon}
          {busyAction === action.key ? 'Procesando' : action.label}
        </button>
      )}
    </article>
  );
}

function ResourceRow({ icon: Icon, label, value }) {
  return (
    <div className="resource-row">
      <Icon size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function onboardingDetailLabel(check) {
  if (!check) return 'Pendiente';
  if (check.ok) {
    const labels = {
      subscription: 'Pago validado',
      google_oauth: 'Cuenta autorizada',
      google_provisioning: 'Estructura creada',
      llm: 'Motor IA disponible',
      whatsapp: 'Canal conectado',
    };
    return labels[check.key] ?? 'Listo';
  }
  if (check.detail === 'missing') return 'Pendiente por completar';
  if (String(check.detail ?? '').includes('backend')) return 'Pendiente de validación local';
  return check.detail ?? 'Pendiente';
}

function whatsappPathLabel(value) {
  const labels = {
    cloud_api_existing: 'Ya tiene integración oficial',
    business_app_existing: 'Tiene WhatsApp Business App',
    new_business: 'Empieza desde cero',
  };
  return labels[value] ?? 'Sin seleccionar';
}

function whatsappStepLabel(step) {
  const byKey = {
    diagnosis: 'Diagnóstico',
    meta_auth: 'Autorización Meta',
    business: 'Cuenta WhatsApp',
    phone: 'Número y código',
    webhook: 'Eventos de conexión',
    test: 'Mensaje de prueba',
  };
  return byKey[step?.key] ?? String(step?.label ?? '').replace('Webhook', 'Eventos de conexión');
}

function whatsappStepDetail(step) {
  const details = {
    diagnosis: 'Preguntar si ya tiene WhatsApp Business, integración oficial o empieza desde cero.',
    meta_auth: 'Guiar al cliente en Meta Business hasta habilitar la cuenta.',
    business: 'Seleccionar o crear la cuenta WhatsApp del cliente, negocio, nombre visible y categoría.',
    phone: 'Validar el número del cliente, recibir el código y obtener el identificador del número.',
    webhook: 'Conectar los mensajes entrantes de WhatsApp con la URL pública de la plataforma.',
    test: 'Enviar un mensaje real cuando la URL pública esté publicada.',
  };
  return details[step?.key] ?? String(step?.detail ?? '')
    .replaceAll('phone_number_id', 'identificador del número')
    .replaceAll('WABA', 'cuenta WhatsApp')
    .replaceAll('webhook', 'evento de conexión')
    .replaceAll('Webhook', 'Evento de conexión');
}

function WhatsAppActivationWizard({ busyAction, onboarding, onAction, onOpenConfig, tenant }) {
  const paths = [
    {
      key: 'cloud_api_existing',
      title: 'Ya tiene integración oficial',
      detail: 'Conectamos la cuenta, el número y la referencia segura del negocio existente.',
      hasWhatsAppBusiness: true,
    },
    {
      key: 'business_app_existing',
      title: 'Tiene WhatsApp Business App',
      detail: 'Guiamos migración o activación del número para responder desde la plataforma.',
      hasWhatsAppBusiness: true,
    },
    {
      key: 'new_business',
      title: 'Empieza desde cero',
      detail: 'Acompañamos creación del negocio en Meta, cuenta WhatsApp y número.',
      hasWhatsAppBusiness: false,
    },
  ];
  const currentPath = onboarding.setupPath;
  const connected = onboarding.status === 'connected';
  return (
    <article className="guide-panel whatsapp-wizard">
      <div className="wizard-heading">
        <div>
          <span className="eyebrow">Activación WhatsApp Business</span>
          <h3>Conexión guiada del canal del cliente</h3>
          <p>Primero identificamos el punto de partida. Si el alta guiada de Meta está configurada, la microapp abre la conexión; si no, deja una guía operativa paso a paso.</p>
        </div>
        <span className={`automation-chip ${onboarding.canAutomate ? 'is-ready' : 'is-manual'}`}>
          {onboarding.canAutomate ? 'Alta guiada disponible' : 'Guía asistida'}
        </span>
      </div>

      <div className="whatsapp-path-grid">
        {paths.map((path) => (
          <button
            className={`whatsapp-path ${currentPath === path.key ? 'is-selected' : ''}`}
            disabled={busyAction === 'whatsapp-intent' || connected}
            key={path.key}
            onClick={() => onAction('intent', {
              setupPath: path.key,
              hasWhatsAppBusiness: path.hasWhatsAppBusiness,
              businessName: tenant.name,
              contactPhone: tenant.whatsappNumber,
            })}
            type="button"
          >
            <span>{path.title}</span>
            <strong>{path.detail}</strong>
          </button>
        ))}
      </div>

      <div className="wizard-content-grid">
        <div className="whatsapp-step-list">
          {onboarding.steps.map((step) => (
            <div className={`whatsapp-step is-${step.status}`} key={step.key}>
              <span>{step.status === 'done' ? <Check size={14} /> : step.status === 'locked' ? <Lock size={14} /> : <MessageCircle size={14} />}</span>
              <div>
                <strong>{whatsappStepLabel(step)}</strong>
                <p>{whatsappStepDetail(step)}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="whatsapp-sidecar">
          <div className="manual-guide">
            <strong>{connected ? 'Canal conectado' : onboarding.canAutomate ? 'Listo para alta guiada Meta' : 'Pendiente configuración Meta'}</strong>
            <p>
              {connected
                ? `El identificador ${onboarding.binding.phoneNumberId} ya está asociado a esta tienda.`
                : onboarding.canAutomate
                  ? 'El siguiente paso abre Meta para seleccionar negocio, cuenta WhatsApp y número.'
                  : 'Para automatizar desde la interfaz falta configurar el alta guiada de Meta; mientras tanto la pantalla guía el alta manual.'}
            </p>
          </div>
          <div className="resource-list compact-resource-list">
            <ResourceRow icon={Store} label="Ruta" value={whatsappPathLabel(currentPath)} />
            <ResourceRow icon={MessageCircle} label="Número" value={onboarding.binding.displayPhoneNumber ?? 'Pendiente'} />
            <ResourceRow icon={KeyRound} label="Referencia segura" value={onboarding.binding.accessTokenRef ?? tenant.config?.whatsapp?.accessTokenRef ?? 'Pendiente'} />
          </div>
          <div className="button-row">
            <button
              className="approve-btn"
              disabled={!currentPath || Boolean(busyAction) || connected}
              onClick={() => onAction('start', {})}
              type="button"
            >
              <Send size={16} />
              {onboarding.canAutomate ? 'Iniciar alta guiada' : 'Preparar guía'}
            </button>
            <button className="ghost-btn" type="button" onClick={onOpenConfig}>
              <Settings2 size={16} />
              Configuración avanzada
            </button>
          </div>
        </div>
      </div>

      {!connected && !onboarding.canAutomate && (
        <div className="manual-guide manual-guide-wide">
          <strong>La conexión manual no activa el canal por sí sola</strong>
          <p>
            El administrador debe configurar Meta o validar la conexión después del registro. Así evitamos guardar un número que no pertenezca a esta tienda ni usar credenciales compartidas.
          </p>
          <div className="button-row">
            <a className="ghost-btn" href={onboarding.externalLinks?.businessSuite} target="_blank" rel="noreferrer">
              <Building2 size={16} />
              Abrir Meta Business
            </a>
            <button className="ghost-btn" type="button" onClick={onOpenConfig}>
              <Settings2 size={16} />
              Ver requisitos
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function fallbackOnboardingStatus(tenant) {
  const checks = [
    { key: 'subscription', label: 'Suscripcion activa en Mercado Pago', ok: false, detail: 'Sin datos del backend SaaS' },
    { key: 'google_oauth', label: 'Google conectado', ok: false, detail: 'Sin datos del backend SaaS' },
    { key: 'google_provisioning', label: 'Drive y Sheets aprovisionados', ok: false, detail: 'Sin datos del backend SaaS' },
    {
      key: 'llm',
      label: 'DeepSeek global de plataforma',
      ok: true,
      detail: 'Motor listo',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp separado por tienda',
      ok: Boolean(tenant.config?.whatsapp?.phoneNumberId),
      detail: tenant.config?.whatsapp?.phoneNumberId ? 'Número conectado' : 'missing',
    },
  ];
  return {
    checks,
    nextStep: checks.find((item) => !item.ok)?.key ?? 'activation',
    readyForActivation: checks.every((item) => item.ok),
    readyForOperation: false,
    subscription: null,
  };
}

function fallbackWhatsAppOnboarding(tenant) {
  const phoneNumberId = tenant.config?.whatsapp?.phoneNumberId ?? null;
  return {
    tenantId: tenant.id,
    setupPath: phoneNumberId ? 'cloud_api_existing' : null,
    status: phoneNumberId ? 'connected' : 'needs_path',
    automationMode: 'guided_manual',
    canAutomate: false,
    nextAction: phoneNumberId ? 'validate' : 'choose_setup_path',
    binding: {
      phoneNumberId,
      wabaId: tenant.config?.whatsapp?.wabaId ?? null,
      displayPhoneNumber: tenant.config?.whatsapp?.displayPhoneNumber ?? tenant.whatsappNumber ?? null,
      accessTokenRef: tenant.config?.whatsapp?.accessTokenRef ?? null,
    },
    steps: [
      { key: 'diagnosis', label: 'Diagnóstico', status: phoneNumberId ? 'done' : 'current', detail: 'Definir si el cliente ya tiene WhatsApp Business, integración oficial o empieza desde cero.' },
      { key: 'meta_auth', label: 'Autorización Meta', status: phoneNumberId ? 'done' : 'locked', detail: 'Conectar o guiar al dueño en Meta Business.' },
      { key: 'business', label: 'Cuenta WhatsApp', status: phoneNumberId ? 'done' : 'locked', detail: 'Seleccionar o crear la cuenta WhatsApp del cliente.' },
      { key: 'phone', label: 'Número y código', status: phoneNumberId ? 'done' : 'locked', detail: 'Obtener el identificador del número activo.' },
      { key: 'webhook', label: 'Eventos de conexión', status: phoneNumberId ? 'done' : 'locked', detail: 'Preparar la recepción de mensajes contra la URL pública.' },
      { key: 'test', label: 'Mensaje de prueba', status: phoneNumberId ? 'current' : 'locked', detail: 'Probar recepción y respuesta real.' },
    ],
  };
}

function onboardingStepIcon(key) {
  return onboardingStepMeta(key).icon;
}

function onboardingStepMeta(key) {
  const metadata = {
    subscription: {
      icon: CircleDollarSign,
      title: 'Suscripción activa',
      short: 'Pago de plataforma',
      description: 'Confirma que la tienda tiene derecho de uso mensual antes de operar.',
      why: 'Evita entregar servicio a clientes vencidos o sin plan activo.',
      needs: 'Pago activo o activación de prueba local.',
    },
    google_oauth: {
      icon: UserCheck,
      title: 'Google conectado',
      short: 'Permisos del cliente',
      description: 'Autoriza Drive y Sheets de la tienda con OAuth seguro.',
      why: 'Los datos operativos viven en el Google del cliente, no mezclados en la plataforma.',
      needs: 'Cuenta Google del dueño y autorización segura.',
    },
    google_provisioning: {
      icon: Database,
      title: 'Drive y Sheets creados',
      short: 'Estructura operativa',
      description: 'Genera catálogo, clientes, pedidos y configuración inicial.',
      why: 'El agente necesita una fuente viva para consultar productos y registrar pedidos.',
      needs: 'Google conectado y permisos de Drive/Sheets vigentes.',
    },
    llm: {
      icon: Bot,
      title: 'DeepSeek configurado',
      short: 'Razonamiento comercial',
      description: 'Usa el motor global de plataforma para interpretar pedidos como tendero.',
      why: 'El parser, la inferencia de productos y la decisión de herramientas dependen del motor de IA.',
      needs: 'Configuración global de plataforma activa.',
    },
    whatsapp: {
      icon: MessageCircle,
      title: 'WhatsApp aislado',
      short: 'Canal de la tienda',
      description: 'Asocia el identificador real del número para recibir y responder solo por esta tienda.',
      why: 'Impide mezclar mensajes entre clientes y habilita eventos seguros.',
      needs: 'Identificador del número de WhatsApp Business y referencias seguras.',
    },
  };
  return metadata[key] ?? {
    icon: ShieldCheck,
    title: 'Validación final',
    short: 'Control de salida',
    description: 'Revisa que todos los prerequisitos estén completos.',
    why: 'Reduce errores antes de habilitar operación real.',
    needs: 'Checklist completo.',
  };
}

function onboardingStepAction(key) {
  const action = {
    subscription: { key: 'subscription', label: 'Activar prueba local', icon: <CircleDollarSign size={15} /> },
    google_oauth: { key: 'google-oauth', label: 'Conectar Google', icon: <UserCheck size={15} /> },
    google_provisioning: { key: 'provision', label: 'Provisionar', icon: <Database size={15} /> },
    llm: { key: 'config-llm', label: 'Configurar', icon: <Bot size={15} /> },
    whatsapp: { key: 'config-whatsapp', label: 'Configurar', icon: <MessageCircle size={15} /> },
  };
  return action[key] ?? { key: 'validate', label: 'Validar', icon: <RotateCcw size={15} /> };
}

function nextOnboardingAction(status, isPlatformAdmin = false) {
  if (status.readyForOperation) {
    return {
      action: 'validate',
      label: 'Revalidar',
      title: 'La tienda ya puede operar',
      detail: 'Suscripción, Google, DeepSeek y WhatsApp están completos para esta tienda.',
    };
  }
  if (status.readyForActivation) {
    if (!isPlatformAdmin) {
      return {
        action: null,
        label: 'Esperando revision',
        title: 'Configuracion completa, pendiente de activacion',
        detail: 'El administrador de plataforma revisa los controles y habilita la operacion.',
      };
    }
    return {
      action: 'activate',
      label: 'Activar tienda',
      title: 'Todo está listo para activar',
      detail: 'La validación de prerequisitos está completa; falta marcar la tienda como operativa.',
    };
  }
  const stepAction = onboardingStepAction(status.nextStep);
  const titles = {
    subscription: ['Validar suscripción', 'El acceso depende del pago mensual de la plataforma en Mercado Pago.'],
    google_oauth: ['Conectar Google', 'La microapp necesita autorización segura para crear y leer los archivos del cliente.'],
    google_provisioning: ['Crear estructura Google', 'Se deben aprovisionar Drive y Google Sheets con catálogo, clientes y pedidos.'],
    llm: ['Revisar Motor IA de la plataforma', 'El motor se administra desde Centro de control y se consume transversalmente.'],
    whatsapp: ['Separar WhatsApp por tienda', 'La conexión solo debe aceptar mensajes del identificador configurado para esta tienda.'],
  };
  const [title, detail] = titles[status.nextStep] ?? ['Completar configuración', 'Hay controles pendientes antes de activar operación.'];
  return {
    action: stepAction.key,
    label: stepAction.label,
    title,
    detail,
    secondary: ['llm', 'whatsapp'].includes(status.nextStep) ? { label: 'Abrir configuración', view: 'config' } : null,
  };
}

function AnalyticsView({ conversations: conversationItems, events, requests: requestItems, tools: toolItems, usage }) {
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState('usage');
  const stages = ['catalog', 'approval', 'handoff', 'binding', 'payment', 'off_hours'];
  const activeCount = conversationItems.filter((conversation) => conversation.status === 'live').length;
  const blockedCount = conversationItems.filter((conversation) => ['blocked', 'degraded', 'needs_binding'].includes(conversation.status)).length;
  const completedCount = conversationItems.filter((conversation) => conversation.stage === 'payment' || conversation.progress >= 85).length;
  const avgProgress = Math.round(
    conversationItems.reduce((sum, conversation) => sum + conversation.progress, 0) / Math.max(conversationItems.length, 1),
  );
  const stageCounts = stages.map((stage) => ({
    stage,
    label: stageLabel(stage),
    count: conversationItems.filter((conversation) => conversation.stage === stage).length,
  }));
  const maxStageCount = Math.max(1, ...stageCounts.map((stage) => stage.count));
  const connectedTools = toolItems.filter((tool) => ['sandbox_ready', 'production_ready', 'approval_required'].includes(tool.status)).length;
  const pendingTools = Math.max(toolItems.length - connectedTools, 0);
  const deliveriesPct = Math.min(usage.percentages?.deliveries ?? 0, 100);
  const interactionsPct = Math.min(usage.percentages?.interactions ?? 0, 100);
  const healthScore = Math.max(0, Math.min(100, Math.round((avgProgress * 0.45) + ((100 - Math.min(blockedCount * 18, 60)) * 0.25) + ((100 - Math.min(pendingTools * 10, 40)) * 0.3))));
  const healthTone = healthScore >= 78 ? 'ok' : healthScore >= 55 ? 'warn' : 'bad';
  const eventTypes = events.reduce((acc, event) => {
    acc[event.type] = (acc[event.type] ?? 0) + 1;
    return acc;
  }, {});
  const topEvents = Object.entries(eventTypes)
    .map(([type, count]) => ({ type, label: eventTypeLabel(type), count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 4);
  const analyticsTabs = [
    ['usage', ShoppingBag, 'Uso', formatUsageRatio(usage.metrics.deliveries_confirmed, usage.limits.includedDeliveries)],
    ['flow', Activity, 'Flujo', `${avgProgress}% avance`],
    ['risks', AlertTriangle, 'Riesgos', blockedCount ? `${blockedCount} alertas` : 'Sin bloqueos'],
    ['events', PlugZap, 'Eventos', `${events.length} recientes`],
  ];

  return (
    <section className="analytics-layout">
      <div className="analytics-hero">
        <div>
          <span className="eyebrow">Analítica operativa</span>
          <h2>Lectura ejecutiva de la tienda</h2>
          <p>Estado comercial, capacidad del plan y puntos donde el agente necesita ayuda humana o conexiones completas.</p>
        </div>
        <div className={`analytics-score is-${healthTone}`}>
          <span>Salud</span>
          <strong>{healthScore}</strong>
          <small>{healthTone === 'ok' ? 'Operación estable' : healthTone === 'warn' ? 'Revisar señales' : 'Atención prioritaria'}</small>
        </div>
      </div>
      <div className="analytics-signal-grid">
        <AnalyticsSignal icon={Activity} label="Conversaciones activas" value={activeCount} detail={`${conversationItems.length} visibles`} tone="mint" />
        <AnalyticsSignal icon={ListChecks} label="Apoyo humano" value={requestItems.length} detail={requestItems.length ? 'Pendiente de decisión' : 'Sin pendientes'} tone="gold" />
        <AnalyticsSignal icon={ShoppingBag} label="Pedidos avanzados" value={completedCount} detail={`${avgProgress}% avance promedio`} tone="blue" />
        <AnalyticsSignal icon={PlugZap} label="Conexiones pendientes" value={pendingTools} detail={`${connectedTools}/${toolItems.length} operativas`} tone="coral" />
      </div>
      <div className="workspace-tabs analytics-tabs" role="tablist" aria-label="Secciones de analítica">
        {analyticsTabs.map(([key, Icon, label, detail]) => (
          <button
            aria-selected={activeAnalyticsTab === key}
            className={activeAnalyticsTab === key ? 'is-active' : ''}
            key={key}
            onClick={() => setActiveAnalyticsTab(key)}
            role="tab"
            type="button"
          >
            <Icon size={16} />
            <span>{label}</span>
            <small>{detail}</small>
          </button>
        ))}
      </div>
      <div className="analytics-grid">
        {activeAnalyticsTab === 'usage' && (
        <article className="analytics-panel usage-focus-panel">
          <div className="panel-heading">
            <span className="eyebrow">Capacidad mensual</span>
            <strong>{planLabel(usage.planCode?.replaceAll('_', ' '))}</strong>
          </div>
          <div className="capacity-ring-grid">
            <CapacityRing label="Domicilios" value={usage.metrics.deliveries_confirmed} limit={usage.limits.includedDeliveries} percent={deliveriesPct} />
            <CapacityRing label="Interacciones" value={usage.metrics.agent_interactions} limit={usage.limits.includedInteractions} percent={interactionsPct} />
          </div>
          <div className="usage-mini-grid">
            <div>
              <span>Motor IA</span>
              <strong>{formatCompactNumber(usage.metrics.llm_total_tokens)} tokens</strong>
            </div>
            <div>
              <span>Herramientas</span>
              <strong>{formatCompactNumber(usage.metrics.tool_calls)}</strong>
            </div>
          </div>
        </article>
        )}
        {activeAnalyticsTab === 'flow' && (
        <article className="analytics-panel stage-flow-panel span-2">
          <div className="panel-heading">
            <span className="eyebrow">Flujo comercial</span>
            <strong>Etapas con mayor carga</strong>
          </div>
          <div className="stage-bars">
            {stageCounts.map((stage) => (
              <div className="stage-row rich-stage-row" key={stage.stage}>
                <span>{stage.label}</span>
                <b><i style={{ width: `${Math.max((stage.count / maxStageCount) * 100, stage.count ? 12 : 4)}%` }} /></b>
                <strong>{stage.count}</strong>
              </div>
            ))}
          </div>
        </article>
        )}
        {activeAnalyticsTab === 'usage' && (
        <article className="analytics-panel">
          <div className="panel-heading">
            <span className="eyebrow">Conexiones</span>
            <strong>Preparación operativa</strong>
          </div>
          <div className="analytics-tool-list">
            {toolItems.slice(0, 6).map((tool) => (
              <div className="analytics-tool-row" key={tool.key}>
                <span>{toolLabel(tool.name)}</span>
                <StatusPill status={tool.status} />
              </div>
            ))}
          </div>
        </article>
        )}
        {activeAnalyticsTab === 'events' && (
        <article className="analytics-panel events-panel">
          <div className="panel-heading">
            <span className="eyebrow">Ritmo reciente</span>
            <strong>Eventos principales</strong>
          </div>
          <div className="event-pill-list">
            {topEvents.map(({ type, label, count }) => (
              <div className="event-pill" key={type}>
                <span>{label}</span>
                <b>{count}</b>
              </div>
            ))}
            {!topEvents.length && <p className="muted-copy">Aún no hay eventos para analizar en esta tienda.</p>}
          </div>
        </article>
        )}
        {activeAnalyticsTab === 'risks' && (
        <article className="analytics-panel risk-panel">
          <div className="panel-heading">
            <span className="eyebrow">Riesgos</span>
            <strong>{blockedCount ? 'Atención requerida' : 'Sin bloqueos críticos'}</strong>
          </div>
          <div className="risk-list">
            {conversationItems.filter((conversation) => ['blocked', 'degraded', 'needs_binding'].includes(conversation.status)).slice(0, 4).map((conversation) => (
              <button className="risk-row" key={conversation.id} type="button">
                <span>{conversation.customer}</span>
                <strong>{stageLabel(conversation.stage)}</strong>
              </button>
            ))}
            {!blockedCount && (
              <div className="risk-empty">
                <BadgeCheck size={18} />
                <span>El agente opera sin bloqueos visibles.</span>
              </div>
            )}
          </div>
        </article>
        )}
      </div>
    </section>
  );
}

function AnalyticsSignal({ detail, icon: Icon, label, tone, value }) {
  return (
    <article className={`analytics-signal is-${tone}`}>
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function CapacityRing({ label, limit, percent, value }) {
  const safePercent = Math.max(0, Math.min(percent ?? 0, 100));
  return (
    <div className="capacity-ring-card">
      <div className={`capacity-ring is-${usageTone(safePercent)}`} style={{ '--capacity': `${safePercent}%` }}>
        <strong>{Math.round(safePercent)}%</strong>
        <span>usado</span>
      </div>
      <div>
        <span>{label}</span>
        <strong>{formatUsageRatio(value, limit)}</strong>
        <small>{limit ? `${Math.max(limit - value, 0).toLocaleString('es-CO')} disponibles` : 'Sin límite configurado'}</small>
      </div>
    </div>
  );
}

function RestrictedAdminPanel() {
  return (
    <article className="admin-hero">
      <div>
        <span className="eyebrow">Consola protegida</span>
        <h2>Centro de control de plataforma</h2>
        <p>Esta vista queda reservada para administradores de plataforma. Para la tienda activa, usa Resumen, Tienda viva, Conversaciones, Onboarding o Aprobaciones.</p>
      </div>
      <div className="admin-stat-card">
        <span>Acceso</span>
        <strong>Tienda</strong>
        <small>Sin llamadas admin en segundo plano</small>
      </div>
    </article>
  );
}

function PlatformAdminView({ auth, error, overview, onOpenObservability, onRefresh, onSaveSettings }) {
  const llm = overview?.platform?.llm ?? {};
  const [activeAdminTab, setActiveAdminTab] = useState('llm');
  const [llmDraft, setLlmDraft] = useState(() => ({
    model: llm.model ?? 'deepseek-chat',
    apiKeyRef: llm.apiKeyRef ?? 'DEEPSEEK_API_KEY',
    baseUrlRef: llm.baseUrlRef ?? 'DEEPSEEK_BASE_URL',
    simulator: llm.simulator ?? 'codex',
    maxTokens: llm.maxTokens ?? 1200,
    timeoutMs: llm.timeoutMs ?? 15000,
    temperature: llm.temperature ?? 0,
  }));
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [billingAdmin, setBillingAdmin] = useState({ plans: [], funnel: null, loading: true, error: '', lastJob: null });
  const [billingAction, setBillingAction] = useState('');
  const [tenantLifecycleAction, setTenantLifecycleAction] = useState('');
  const [tenantLifecycleMessage, setTenantLifecycleMessage] = useState('');

  useEffect(() => {
    setLlmDraft({
      model: llm.model ?? 'deepseek-chat',
      apiKeyRef: llm.apiKeyRef ?? 'DEEPSEEK_API_KEY',
      baseUrlRef: llm.baseUrlRef ?? 'DEEPSEEK_BASE_URL',
      simulator: llm.simulator ?? 'codex',
      maxTokens: llm.maxTokens ?? 1200,
      timeoutMs: llm.timeoutMs ?? 15000,
      temperature: llm.temperature ?? 0,
    });
  }, [llm.model, llm.apiKeyRef, llm.baseUrlRef, llm.simulator, llm.maxTokens, llm.timeoutMs, llm.temperature]);

  const tenants = overview?.tenants ?? [];
  const totals = overview?.totals ?? {};
  const webhookSummary = overview?.platform?.webhookSummary ?? {};

  async function loadBillingAdmin(silent = false) {
    if (!silent) setBillingAdmin((current) => ({ ...current, loading: true, error: '' }));
    try {
      const [plansResponse, funnelResponse] = await Promise.all([
        fetch('/api/admin/billing/plans', { credentials: 'include' }),
        fetch('/api/admin/billing/funnel', { credentials: 'include' }),
      ]);
      if (!plansResponse.ok || !funnelResponse.ok) throw new Error('No fue posible leer facturación');
      const [plansPayload, funnelPayload] = await Promise.all([plansResponse.json(), funnelResponse.json()]);
      setBillingAdmin((current) => ({
        ...current,
        plans: plansPayload.plans ?? [],
        funnel: funnelPayload,
        loading: false,
        error: '',
      }));
    } catch (loadError) {
      setBillingAdmin((current) => ({
        ...current,
        loading: false,
        error: loadError.message ?? 'No fue posible leer facturación',
      }));
    }
  }

  useEffect(() => {
    if (!tenants.length) {
      setSelectedTenantId('');
      return;
    }
    if (!selectedTenantId || !tenants.some((tenant) => tenant.id === selectedTenantId)) {
      setSelectedTenantId(tenants[0].id);
    }
  }, [tenants, selectedTenantId]);

  useEffect(() => {
    let alive = true;
    loadBillingAdmin(false);
    const timer = window.setInterval(() => {
      if (alive) loadBillingAdmin(true);
    }, 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  async function runBillingAdminAction(action, tenantId, resourceId) {
    if (action !== 'jobs' && !tenantId) return;
    const actionKey = action === 'jobs' ? 'jobs:platform' : `${action}:${tenantId}${resourceId ? `:${resourceId}` : ''}`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const routes = {
      jobs: '/api/admin/billing/jobs/run',
      sync: `/api/admin/billing/tenants/${tenantId}/sync`,
      exception: `/api/admin/billing/tenants/${tenantId}/exceptions`,
      discount: `/api/admin/billing/tenants/${tenantId}/discounts`,
      revokeException: `/api/admin/billing/tenants/${tenantId}/exceptions/${resourceId}/revoke`,
      revokeDiscount: `/api/admin/billing/tenants/${tenantId}/discounts/${resourceId}/revoke`,
    };
    const bodies = {
      jobs: {},
      sync: {},
      exception: { reason: 'Soporte comercial temporal', expiresAt },
      discount: { discountValue: 20, reason: 'Ajuste comercial piloto', expiresAt },
      revokeException: {},
      revokeDiscount: {},
    };
    try {
      setBillingAction(actionKey);
      const response = await fetch(routes[action], {
        method: action.startsWith('revoke') ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json', ...csrfHeaders(auth) },
        credentials: 'include',
        body: JSON.stringify(bodies[action] ?? {}),
      });
      if (!response.ok) throw new Error('No fue posible aplicar la acción');
      const actionPayload = await response.json().catch(() => null);
      const [plansResponse, funnelResponse] = await Promise.all([
        fetch('/api/admin/billing/plans', { credentials: 'include' }),
        fetch('/api/admin/billing/funnel', { credentials: 'include' }),
      ]);
      if (!plansResponse.ok || !funnelResponse.ok) throw new Error('La acción se aplicó, pero no fue posible refrescar facturación');
      const [plansPayload, funnelPayload] = await Promise.all([plansResponse.json(), funnelResponse.json()]);
      setBillingAdmin((current) => ({
        ...current,
        plans: plansPayload.plans ?? [],
        funnel: funnelPayload,
        loading: false,
        error: '',
        lastJob: action === 'jobs' ? actionPayload : current.lastJob,
      }));
      onRefresh?.();
    } catch (actionError) {
      setBillingAdmin((current) => ({
        ...current,
        loading: false,
        error: actionError.message ?? 'No fue posible aplicar la acción',
      }));
    } finally {
      setBillingAction('');
    }
  }

  async function saveBillingPlan(planId, payload) {
    const isNew = !planId;
    const actionKey = `plan:${planId ?? 'new'}`;
    const cleanPayload = {
      name: String(payload.name ?? '').trim(),
      description: String(payload.description ?? '').trim(),
      currency: 'COP',
      amount: Number(payload.amount ?? 0),
      billingFrequency: 'monthly',
      includedDeliveries: Number(payload.includedDeliveries ?? 0),
      includedInteractions: Number(payload.includedInteractions ?? 0),
      trialEnabled: Boolean(payload.trialEnabled),
      trialDays: Number(payload.trialDays ?? 0),
      graceDays: Number(payload.graceDays ?? 0),
      isActive: Boolean(payload.isActive),
      isDefault: Boolean(payload.isDefault),
    };
    try {
      setBillingAction(actionKey);
      const response = await fetch(isNew ? '/api/admin/billing/plans' : `/api/admin/billing/plans/${planId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json', ...csrfHeaders(auth) },
        credentials: 'include',
        body: JSON.stringify(cleanPayload),
      });
      if (!response.ok) throw new Error('No fue posible guardar el plan');
      await loadBillingAdmin(false);
    } catch (planError) {
      setBillingAdmin((current) => ({
        ...current,
        loading: false,
        error: planError.message ?? 'No fue posible guardar el plan',
      }));
    } finally {
      setBillingAction('');
    }
  }

  async function runTenantLifecycleAction(action) {
    if (!selectedTenant?.id) return;
    const actionKey = `${action}:${selectedTenant.id}`;
    try {
      setTenantLifecycleAction(actionKey);
      setTenantLifecycleMessage('');
      const response = await fetch(`/api/admin/tenants/${selectedTenant.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...csrfHeaders(auth) },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `No fue posible ${action === 'validate' ? 'validar' : 'activar'} la tienda`);
      setTenantLifecycleMessage(action === 'validate' ? 'Configuración validada. Puedes revisar los resultados antes de activar.' : 'Tienda activada por el administrador de plataforma.');
      onRefresh?.();
    } catch (actionError) {
      setTenantLifecycleMessage(actionError.message ?? 'No fue posible completar la acción');
    } finally {
      setTenantLifecycleAction('');
    }
  }

  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? tenants[0] ?? null;
  const selectedTenantScore = tenantHealthScore(selectedTenant);
  const maxInteractions = Math.max(1, ...tenants.map((tenant) => Number(tenant.usage?.metrics?.agent_interactions ?? 0)));
  const maxWebhooks = Math.max(1, ...tenants.map((tenant) => Number(tenant.webhooks?.total ?? 0)));
  const selectedInteractions = Number(selectedTenant?.usage?.metrics?.agent_interactions ?? 0);
  const selectedTokens = Number(selectedTenant?.usage?.metrics?.llm_total_tokens ?? 0);
  const adminTabs = [
    ['llm', Bot, 'Motor IA', llm.configured ? 'Producción' : 'Pendiente'],
    ['tenants', Users, 'Clientes', `${tenants.length} tenants`],
    ['billing', CircleDollarSign, 'Facturación', `${totals.paymentBlocked ?? 0} riesgo`],
    ['observability', Activity, 'Observabilidad', `${webhookSummary.total ?? 0} eventos`],
  ];
  return (
    <section className="admin-layout">
      <div className="admin-hero">
        <div>
          <span className="eyebrow">Consola del operador SaaS</span>
          <h2>Centro de control</h2>
          <p>Supervisa clientes, pagos, consumo, Motor IA y eventos de conexión desde una sola cabina.</p>
        </div>
        <div className="admin-hero-metrics">
          <AdminKpi label="Clientes" value={totals.tenants ?? tenants.length} />
          <AdminKpi label="Activos" value={totals.activeTenants ?? 0} />
          <AdminKpi label="Tokens IA" value={formatCompactNumber(totals.llmTokens ?? 0)} />
          <AdminKpi label="Eventos" value={webhookSummary.total ?? 0} />
        </div>
      </div>

      {error && (
        <div className="setup-error">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      )}

      <div className="workspace-tabs admin-tabs" role="tablist" aria-label="Secciones del centro de control">
        {adminTabs.map(([key, Icon, label, detail]) => (
          <button
            aria-selected={activeAdminTab === key}
            className={activeAdminTab === key ? 'is-active' : ''}
            key={key}
            onClick={() => setActiveAdminTab(key)}
            role="tab"
            type="button"
          >
            <Icon size={16} />
            <span>{label}</span>
            <small>{detail}</small>
          </button>
        ))}
      </div>

      <div className="admin-grid">
        {activeAdminTab === 'llm' && (
        <article className="admin-panel llm-control-panel">
          <div className="panel-heading-inline">
            <div>
              <span className="eyebrow">Motor IA global</span>
              <h3>DeepSeek de la plataforma</h3>
            </div>
            <StatusPill status={llm.configured ? 'production_ready' : 'needs_binding'} />
          </div>
          <p>Esta configuración aplica transversalmente a todos los clientes. El consumo se mide por tienda, pero la credencial y el modelo los opera la plataforma.</p>
          <div className="llm-form-grid">
            <label className="config-field">
              <span>
                <Bot size={16} />
                Modelo
              </span>
              <input value={llmDraft.model} onChange={(event) => setLlmDraft((current) => ({ ...current, model: event.target.value }))} />
            </label>
            <label className="config-field">
              <span>
                <KeyRound size={16} />
                Referencia segura
              </span>
              <input value={llmDraft.apiKeyRef} onChange={(event) => setLlmDraft((current) => ({ ...current, apiKeyRef: event.target.value }))} />
            </label>
            <label className="config-field">
              <span>
                <Database size={16} />
                Referencia del endpoint
              </span>
              <input value={llmDraft.baseUrlRef} onChange={(event) => setLlmDraft((current) => ({ ...current, baseUrlRef: event.target.value }))} />
            </label>
            <label className="config-field">
              <span>
                <Gauge size={16} />
                Simulador local
              </span>
              <select value={llmDraft.simulator ?? ''} onChange={(event) => setLlmDraft((current) => ({ ...current, simulator: event.target.value }))}>
                <option value="codex">Codex simula DeepSeek</option>
                <option value="codex_cli">Codex CLI local</option>
                <option value="">Proveedor real</option>
              </select>
            </label>
            <label className="config-field">
              <span>
                <Layers3 size={16} />
                Límite de respuesta
              </span>
              <input type="number" value={llmDraft.maxTokens} onChange={(event) => setLlmDraft((current) => ({ ...current, maxTokens: event.target.value }))} />
            </label>
            <label className="config-field">
              <span>
                <Clock3 size={16} />
                Tiempo de espera
              </span>
              <input type="number" value={llmDraft.timeoutMs} onChange={(event) => setLlmDraft((current) => ({ ...current, timeoutMs: event.target.value }))} />
            </label>
          </div>
          <button className="approve-btn" type="button" onClick={() => onSaveSettings({ llm: llmDraft })}>
            <Check size={16} />
            Guardar Motor IA
          </button>
        </article>
        )}

        {activeAdminTab === 'tenants' && (
        <article className="admin-panel tenant-watch-panel">
          <div className="panel-heading-inline">
            <div>
              <span className="eyebrow">Clientes</span>
              <h3>Radar comercial y operativo</h3>
            </div>
            <span className="admin-chip">{totals.paymentBlocked ?? 0} con riesgo de pago</span>
          </div>
          <div className="tenant-command-grid">
            <div className="tenant-watch-list">
              {tenants.map((tenant) => (
                <button className={`tenant-watch-row ${selectedTenant?.id === tenant.id ? 'is-selected' : ''}`} key={tenant.id} onClick={() => setSelectedTenantId(tenant.id)} type="button">
                  <div>
                    <strong>{tenant.name}</strong>
                    <span>{tenant.ownerEmail ?? tenant.id}</span>
                  </div>
                  <div className="tenant-watch-status">
                    <span className={`admin-dot is-${tenant.subscriptionStatus}`}></span>
                    <b>{humanState(tenant.subscriptionStatus)}</b>
                  </div>
                </button>
              ))}
            </div>

            {selectedTenant && (
              <aside className="tenant-radar-card">
                <div className="tenant-radar-top">
                  <TenantHealthDial score={selectedTenantScore} />
                  <div>
                    <span className="eyebrow">Cliente seleccionado</span>
                    <h4>{selectedTenant.name}</h4>
                    <p>{selectedTenant.ownerEmail ?? selectedTenant.id}</p>
                  </div>
                </div>
                <div className="tenant-signal-grid">
                  <TenantSignalCard icon={CircleDollarSign} label="Pago" value={humanState(selectedTenant.subscriptionStatus)} state={tenantSignalState(selectedTenant.subscriptionStatus, ['active', 'authorized'], ['pending', 'pending_payment', 'past_due', 'grace_period', 'payment_required'])} />
                  <TenantSignalCard icon={Database} label="Google" value={humanState(selectedTenant.googleWorkspaceStatus)} state={tenantSignalState(selectedTenant.googleWorkspaceStatus, ['ready', 'provisioned'], ['missing', 'pending'])} />
                  <TenantSignalCard icon={MessageCircle} label="WhatsApp" value={humanState(selectedTenant.whatsappStatus)} state={tenantSignalState(selectedTenant.whatsappStatus, ['connected'], ['missing'])} />
                  <TenantSignalCard icon={Activity} label="Acceso" value={humanState(selectedTenant.access)} state={tenantSignalState(selectedTenant.access, ['enabled', 'active'], ['limited', 'pending'])} />
                </div>
                <div className="tenant-usage-bars">
                  <MetricBar label="Interacciones" value={selectedInteractions} max={maxInteractions} tone="mint" />
                  <MetricBar label="Tokens IA" value={selectedTokens} max={Math.max(1, Number(totals.llmTokens ?? 0))} tone="gold" />
                  <MetricBar label="Eventos" value={selectedTenant.webhooks?.total ?? 0} max={maxWebhooks} tone="ink" />
                </div>
                <WebhookStatusBars summary={selectedTenant.webhooks ?? {}} />
                <div className="tenant-timeline">
                  <TenantTimelineStep label="Pago" state={tenantSignalState(selectedTenant.subscriptionStatus, ['active', 'authorized'], ['pending', 'pending_payment', 'past_due', 'grace_period'])} />
                  <TenantTimelineStep label="Google" state={tenantSignalState(selectedTenant.googleWorkspaceStatus, ['ready', 'provisioned'], ['pending'])} />
                  <TenantTimelineStep label="WhatsApp" state={tenantSignalState(selectedTenant.whatsappStatus, ['connected'], ['missing'])} />
                  <TenantTimelineStep label="Operación" state={selectedTenant.lastError ? 'bad' : 'ok'} />
                </div>
                <div className="tenant-admin-actions">
                  <div>
                    <span className="eyebrow">Administración de ciclo de vida</span>
                    <p>El cliente prepara sus conexiones. La plataforma valida y habilita la operación.</p>
                  </div>
                  <div className="tenant-admin-action-buttons">
                    <button className="ghost-btn compact" type="button" onClick={() => runTenantLifecycleAction('validate')} disabled={Boolean(tenantLifecycleAction)}>
                      <ShieldCheck size={15} />
                      {tenantLifecycleAction === `validate:${selectedTenant.id}` ? 'Validando...' : 'Validar configuración'}
                    </button>
                    <button className="approve-btn compact" type="button" onClick={() => runTenantLifecycleAction('activate')} disabled={Boolean(tenantLifecycleAction)}>
                      <Check size={15} />
                      {tenantLifecycleAction === `activate:${selectedTenant.id}` ? 'Activando...' : 'Activar tienda'}
                    </button>
                  </div>
                  {tenantLifecycleMessage && <small className="tenant-admin-message">{tenantLifecycleMessage}</small>}
                </div>
              </aside>
            )}
          </div>
        </article>
        )}
      </div>

      {activeAdminTab === 'billing' && (
      <BillingAdminPanel
        billing={billingAdmin}
        busyAction={billingAction}
        onAction={runBillingAdminAction}
        onSavePlan={saveBillingPlan}
        selectedTenant={selectedTenant}
        totals={totals}
      />
      )}

      {activeAdminTab === 'observability' && (
      <article className="admin-panel observability-entry-panel">
        <div className="panel-heading-inline">
          <div>
            <span className="eyebrow">Observabilidad</span>
            <h3>Eventos de conexión separados del control comercial</h3>
          </div>
          <button className="approve-btn compact" type="button" onClick={onOpenObservability}>
            <Activity size={16} />
            Abrir observabilidad
          </button>
        </div>
        <p>Los eventos de WhatsApp, Mercado Pago y futuras integraciones se investigan en una cabina propia, con filtros por tienda, proveedor, estado y rango de fechas.</p>
        <div className="webhook-kpis">
          <AdminKpi label="Eventos" value={webhookSummary.total ?? 0} />
          <AdminKpi label="Procesados" value={webhookSummary.processed ?? 0} />
          <AdminKpi label="Errores" value={webhookSummary.failed ?? 0} />
          <AdminKpi label="Promedio" value={`${webhookSummary.avgDurationMs ?? 0} ms`} />
        </div>
      </article>
      )}
    </section>
  );
}

function billingPlanDraft(plan) {
  return {
    name: plan?.name ?? 'Plan crecimiento',
    description: plan?.description ?? 'Plan mensual para comercios con mayor volumen operativo.',
    amount: plan?.amount ?? 129000,
    includedDeliveries: plan?.includedDeliveries ?? 1500,
    includedInteractions: plan?.includedInteractions ?? 7500,
    trialEnabled: Boolean(plan?.trialEnabled ?? false),
    trialDays: Number(plan?.trialDays ?? 0),
    graceDays: Number(plan?.graceDays ?? 5),
    isActive: Boolean(plan?.isActive ?? true),
    isDefault: Boolean(plan?.isDefault ?? false),
  };
}

function BillingAdminPanel({ billing, busyAction, onAction, onSavePlan, selectedTenant, totals }) {
  const plans = billing?.plans ?? [];
  const activePlans = plans.filter((plan) => plan.isActive);
  const defaultPlan = plans.find((plan) => plan.isDefault) ?? activePlans[0] ?? plans[0] ?? null;
  const stages = billing?.funnel?.stages ?? [];
  const recentEvents = billing?.funnel?.events?.slice(0, 4) ?? [];
  const maxStageTotal = Math.max(1, ...stages.map((stage) => Number(stage.total ?? 0)));
  const selectedTenantId = selectedTenant?.id;
  const selectedTenantBlocked = ['pending_payment', 'past_due', 'expired', 'cancelled', 'suspended', 'payment_required'].includes(selectedTenant?.subscriptionStatus);
  const selectedNotices = selectedTenant?.billingNotices ?? [];
  const selectedDiscounts = selectedTenant?.activeDiscountsDetail ?? [];
  const selectedExceptions = selectedTenant?.activeAccessExceptionsDetail ?? [];
  const [selectedPlanId, setSelectedPlanId] = useState(defaultPlan?.id ?? '');
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState(() => billingPlanDraft(defaultPlan));
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? defaultPlan;
  const savingPlan = busyAction.startsWith('plan:');
  const canSavePlan = planDraft.name.trim() && Number(planDraft.amount) > 0 && Number(planDraft.includedDeliveries) > 0 && Number(planDraft.includedInteractions) > 0;

  useEffect(() => {
    if (creatingPlan) return;
    const nextId = selectedPlanId && plans.some((plan) => plan.id === selectedPlanId) ? selectedPlanId : defaultPlan?.id ?? plans[0]?.id ?? '';
    if (nextId !== selectedPlanId) {
      setSelectedPlanId(nextId);
      return;
    }
    const nextPlan = plans.find((plan) => plan.id === nextId) ?? defaultPlan;
    setPlanDraft(billingPlanDraft(nextPlan));
  }, [plans, defaultPlan?.id, selectedPlanId, creatingPlan]);

  function selectPlan(plan) {
    setCreatingPlan(false);
    setSelectedPlanId(plan.id);
    setPlanDraft(billingPlanDraft(plan));
  }

  function startNewPlan() {
    setCreatingPlan(true);
    setSelectedPlanId('');
    setPlanDraft(billingPlanDraft(null));
  }

  async function submitPlan(event) {
    event.preventDefault();
    if (!canSavePlan || savingPlan) return;
    await onSavePlan(creatingPlan ? null : selectedPlanId, planDraft);
    setCreatingPlan(false);
  }

  function quickPlanPatch(plan, patch) {
    onSavePlan(plan.id, { ...billingPlanDraft(plan), ...patch });
  }

  return (
    <article className="admin-panel billing-admin-panel">
      <div className="panel-heading-inline">
        <div>
          <span className="eyebrow">Mercado Pago</span>
          <h3>Facturación y acceso</h3>
          <p>Administra planes, cobros recurrentes y excepciones comerciales sin tocar la operación diaria de la tienda.</p>
        </div>
        <div className="billing-admin-toolbar">
          <button className="ghost-btn compact" type="button" onClick={() => onAction('jobs')} disabled={busyAction === 'jobs:platform'}>
            <RotateCcw size={15} />
            Conciliar ahora
          </button>
          <span className={`admin-chip ${billing?.loading || busyAction === 'jobs:platform' ? 'is-busy' : ''}`}>
            {billing?.loading || busyAction === 'jobs:platform' ? 'Actualizando' : `${totals?.paymentBlocked ?? 0} con pago pendiente`}
          </span>
        </div>
      </div>

      {billing?.error && (
        <div className="setup-error">
          <AlertTriangle size={17} />
          <span>{billing.error}</span>
        </div>
      )}

      {billing?.lastJob && (
        <div className="billing-job-strip">
          <span>Última conciliación</span>
          <strong>{formatCompactNumber(billing.lastJob.actions?.length ?? 0)} cambios</strong>
          <b>{formatCompactNumber(billing.lastJob.checkoutExpired ?? 0)} checkout · {formatCompactNumber(billing.lastJob.enteredGrace ?? 0)} gracia · {formatCompactNumber(billing.lastJob.suspended ?? 0)} suspendidos</b>
        </div>
      )}

      <div className="billing-admin-grid">
        <section className="billing-plan-console">
          <div className="billing-section-title with-action">
            <div>
              <span>Planes comerciales</span>
              <strong>{defaultPlan?.name ?? 'Sin plan principal'}</strong>
            </div>
            <button className="ghost-btn compact" type="button" onClick={startNewPlan} disabled={savingPlan}>
              <CircleDollarSign size={15} />
              Nuevo plan
            </button>
          </div>

          <div className="billing-plan-workbench">
            <div className="billing-plan-list">
              {plans.map((plan) => (
                <button className={`billing-plan-row ${selectedPlan?.id === plan.id && !creatingPlan ? 'is-selected' : ''}`} key={plan.id} onClick={() => selectPlan(plan)} type="button">
                  <div>
                    <strong>{plan.name}</strong>
                    <span>{formatCurrency(plan.amount, plan.currency)} · {formatCompactNumber(plan.includedDeliveries)} domicilios</span>
                  </div>
                  <div className="billing-plan-row-tags">
                    {plan.isDefault && <span>Principal</span>}
                    <span className={plan.isActive ? 'is-active' : 'is-muted'}>{plan.isActive ? 'Activo' : 'Inactivo'}</span>
                  </div>
                </button>
              ))}
            </div>

            <form className="billing-plan-form" onSubmit={submitPlan}>
              <div className="billing-form-head">
                <div>
                  <span>{creatingPlan ? 'Nuevo plan' : 'Editar plan'}</span>
                  <strong>{creatingPlan ? 'Configurar oferta' : selectedPlan?.name ?? 'Plan seleccionado'}</strong>
                </div>
                <span className="admin-chip">{activePlans.length} activos</span>
              </div>
              <div className="billing-plan-fields">
                <label className="config-field span-2">
                  <span>Nombre comercial</span>
                  <input value={planDraft.name} onChange={(event) => setPlanDraft((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label className="config-field">
                  <span>Valor mensual COP</span>
                  <input type="number" min="0" step="1000" value={planDraft.amount} onChange={(event) => setPlanDraft((current) => ({ ...current, amount: event.target.value }))} />
                </label>
                <label className="config-field">
                  <span>Domicilios incluidos</span>
                  <input type="number" min="1" value={planDraft.includedDeliveries} onChange={(event) => setPlanDraft((current) => ({ ...current, includedDeliveries: event.target.value }))} />
                </label>
                <label className="config-field">
                  <span>Interacciones incluidas</span>
                  <input type="number" min="1" value={planDraft.includedInteractions} onChange={(event) => setPlanDraft((current) => ({ ...current, includedInteractions: event.target.value }))} />
                </label>
                <label className="config-field">
                  <span>Días de gracia</span>
                  <input type="number" min="0" value={planDraft.graceDays} onChange={(event) => setPlanDraft((current) => ({ ...current, graceDays: event.target.value }))} />
                </label>
                <label className="config-field">
                  <span>Días de prueba</span>
                  <input type="number" min="0" disabled={!planDraft.trialEnabled} value={planDraft.trialDays} onChange={(event) => setPlanDraft((current) => ({ ...current, trialDays: event.target.value }))} />
                </label>
              </div>
              <div className="billing-plan-switches">
                <label>
                  <input type="checkbox" checked={planDraft.isActive} onChange={(event) => setPlanDraft((current) => ({ ...current, isActive: event.target.checked }))} />
                  <span>Plan activo</span>
                </label>
                <label>
                  <input type="checkbox" checked={planDraft.isDefault} onChange={(event) => setPlanDraft((current) => ({ ...current, isDefault: event.target.checked, isActive: event.target.checked ? true : current.isActive }))} />
                  <span>Plan principal</span>
                </label>
                <label>
                  <input type="checkbox" checked={planDraft.trialEnabled} onChange={(event) => setPlanDraft((current) => ({ ...current, trialEnabled: event.target.checked, trialDays: event.target.checked ? current.trialDays || 5 : 0 }))} />
                  <span>Prueba gratis</span>
                </label>
              </div>
              <div className="billing-plan-actions">
                {!creatingPlan && selectedPlan && (
                  <>
                    <button className="ghost-btn compact" type="button" onClick={() => quickPlanPatch(selectedPlan, { isActive: !selectedPlan.isActive })} disabled={savingPlan || selectedPlan.isDefault}>
                      {selectedPlan.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                    <button className="ghost-btn compact" type="button" onClick={() => quickPlanPatch(selectedPlan, { isDefault: true, isActive: true })} disabled={savingPlan || selectedPlan.isDefault}>
                      Marcar principal
                    </button>
                  </>
                )}
                <button className="approve-btn compact" type="submit" disabled={!canSavePlan || savingPlan}>
                  <Check size={15} />
                  {creatingPlan ? 'Crear plan' : 'Guardar plan'}
                </button>
              </div>
            </form>
          </div>
        </section>

        <section className="billing-funnel-panel">
          <div className="billing-section-title">
            <span>Embudo de activación</span>
            <strong>{recentEvents.length ? 'Actividad reciente' : 'Esperando actividad'}</strong>
          </div>
          <div className="billing-funnel-list">
            {stages.slice(0, 8).map((stage) => (
              <div className="billing-funnel-step" key={stage.stage}>
                <span>{billingStageLabel(stage.stage)}</span>
                <b><i style={{ width: `${Math.max((Number(stage.total ?? 0) / maxStageTotal) * 100, stage.total ? 10 : 4)}%` }} /></b>
                <strong>{stage.total ?? 0}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="billing-tenant-control">
          <div className="billing-section-title">
            <span>Cliente seleccionado</span>
            <strong>{selectedTenant?.name ?? 'Selecciona un cliente'}</strong>
          </div>
          <div className="billing-tenant-state">
            <span className={`billing-state is-${selectedTenant?.subscriptionStatus ?? 'missing'}`}>{humanState(selectedTenant?.subscriptionStatus)}</span>
            <p>{selectedTenantBlocked ? 'Requiere atención para recuperar acceso o cobro.' : 'Acceso comercial estable.'}</p>
          </div>
          {selectedNotices.length > 0 && (
            <div className="billing-admin-notices">
              {selectedNotices.slice(0, 3).map((notice) => (
                <span className={`billing-admin-notice is-${notice.tone}`} key={notice.key}>
                  <AlertTriangle size={14} />
                  <b>{notice.title}</b>
                </span>
              ))}
            </div>
          )}
          <div className="billing-admin-actions">
            <button className="ghost-btn" type="button" onClick={() => onAction('sync', selectedTenantId)} disabled={!selectedTenantId || busyAction === `sync:${selectedTenantId}`}>
              <RotateCcw size={15} />
              Sincronizar
            </button>
            <button className="ghost-btn" type="button" onClick={() => onAction('exception', selectedTenantId)} disabled={!selectedTenantId || busyAction === `exception:${selectedTenantId}`}>
              <ShieldCheck size={15} />
              Excepción 48h
            </button>
            <button className="ghost-btn" type="button" onClick={() => onAction('discount', selectedTenantId)} disabled={!selectedTenantId || busyAction === `discount:${selectedTenantId}`}>
              <CircleDollarSign size={15} />
              Descuento piloto
            </button>
          </div>
          {(selectedDiscounts.length > 0 || selectedExceptions.length > 0) && (
            <div className="billing-commercial-list">
              {selectedDiscounts.map((discount) => (
                <div className="billing-commercial-row" key={discount.id}>
                  <span>Descuento {discount.discountValue}%</span>
                  <b>{formatDateShort(discount.endsAt)}</b>
                  <button className="ghost-btn compact" type="button" onClick={() => onAction('revokeDiscount', selectedTenantId, discount.id)} disabled={busyAction === `revokeDiscount:${selectedTenantId}:${discount.id}`}>
                    Revocar
                  </button>
                </div>
              ))}
              {selectedExceptions.map((exception) => (
                <div className="billing-commercial-row" key={exception.id}>
                  <span>Excepción temporal</span>
                  <b>{formatDateShort(exception.expiresAt)}</b>
                  <button className="ghost-btn compact" type="button" onClick={() => onAction('revokeException', selectedTenantId, exception.id)} disabled={busyAction === `revokeException:${selectedTenantId}:${exception.id}`}>
                    Revocar
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </article>
  );
}

function ObservabilityView({ overview }) {
  const tenants = overview?.tenants ?? [];
  const [activeObservabilityTab, setActiveObservabilityTab] = useState('monitor');
  const [webhookFilters, setWebhookFilters] = useState({ tenantId: '', provider: '', status: '', from: '', to: '', q: '' });
  const [webhookData, setWebhookData] = useState({ summary: overview?.platform?.webhookSummary ?? {}, events: overview?.recentWebhooks ?? [] });
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [selectedWebhookId, setSelectedWebhookId] = useState('');
  const [selectedWebhook, setSelectedWebhook] = useState(null);
  const [selectedWebhookBusy, setSelectedWebhookBusy] = useState(false);
  const [monitorGranularity, setMonitorGranularity] = useState('hour');

  useEffect(() => {
    let cancelled = false;
    async function loadWebhooks() {
      setWebhookBusy(true);
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(webhookFilters)) {
        if (value) params.set(key, value);
      }
      params.set('limit', '500');
      try {
        const response = await fetch(`/api/admin/webhooks?${params}`, { credentials: 'include' });
        const payload = await response.json().catch(() => ({}));
        if (!cancelled && response.ok) setWebhookData(payload);
      } finally {
        if (!cancelled) setWebhookBusy(false);
      }
    }
    loadWebhooks();
    const timer = window.setInterval(loadWebhooks, 7000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [webhookFilters]);

  useEffect(() => {
    const events = webhookData.events ?? [];
    if (!events.length) {
      setSelectedWebhook(null);
      setSelectedWebhookId('');
      return;
    }
    if (!selectedWebhookId || !events.some((event) => event.id === selectedWebhookId)) {
      openWebhookDetail(events[0].id);
    }
  }, [webhookData.events]);

  async function openWebhookDetail(id) {
    setSelectedWebhookId(id);
    setSelectedWebhookBusy(true);
    try {
      const response = await fetch(`/api/admin/webhooks/${encodeURIComponent(id)}`, { credentials: 'include' });
      const payload = await response.json().catch(() => null);
      if (response.ok) setSelectedWebhook(payload);
    } finally {
      setSelectedWebhookBusy(false);
    }
  }

  const webhookSummary = webhookData.summary ?? {};
  const observabilityTabs = [
    ['monitor', Activity, 'Monitor', `${webhookSummary.total ?? 0} eventos`],
    ['events', ListFilter, 'Eventos', `${(webhookData.events ?? []).length} visibles`],
    ['detail', Eye, 'Detalle', selectedWebhook ? eventStatusLabel(selectedWebhook.status) : 'Sin selección'],
  ];
  function inspectWebhook(id) {
    openWebhookDetail(id);
    setActiveObservabilityTab('detail');
  }
  return (
    <section className={`observability-layout active-observability-${activeObservabilityTab}`}>
      <article className="admin-panel webhook-console">
        <div className="panel-heading-inline">
          <div>
            <span className="eyebrow">Eventos de conexión</span>
            <h3>Monitor en vivo e histórico</h3>
          </div>
          <span className={`admin-chip ${webhookBusy ? 'is-busy' : ''}`}>{webhookBusy ? 'Actualizando' : 'En vivo local'}</span>
        </div>
        <p>Investiga integraciones sin mezclar la operación comercial: filtra por tienda, proveedor, estado, fecha o identificador externo.</p>
        <div className="workspace-tabs observability-tabs" role="tablist" aria-label="Secciones de observabilidad">
          {observabilityTabs.map(([key, Icon, label, detail]) => (
            <button
              aria-selected={activeObservabilityTab === key}
              className={activeObservabilityTab === key ? 'is-active' : ''}
              key={key}
              onClick={() => setActiveObservabilityTab(key)}
              role="tab"
              type="button"
            >
              <Icon size={16} />
              <span>{label}</span>
              <small>{detail}</small>
            </button>
          ))}
        </div>
        <div className="webhook-filters tab-events">
          <label className="config-field">
            <span>
              <Store size={16} />
              Cliente / tienda
            </span>
            <select value={webhookFilters.tenantId} onChange={(event) => setWebhookFilters((current) => ({ ...current, tenantId: event.target.value }))}>
              <option value="">Todas</option>
              {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </label>
          <label className="config-field">
            <span>
              <PlugZap size={16} />
              Proveedor
            </span>
            <select value={webhookFilters.provider} onChange={(event) => setWebhookFilters((current) => ({ ...current, provider: event.target.value }))}>
              <option value="">Todos</option>
              <option value="meta_whatsapp_cloud_api">WhatsApp</option>
              <option value="mercado_pago">Mercado Pago</option>
            </select>
          </label>
          <label className="config-field">
            <span>
              <ListFilter size={16} />
              Estado
            </span>
            <select value={webhookFilters.status} onChange={(event) => setWebhookFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">Todos</option>
              <option value="processed">Procesado</option>
              <option value="duplicate">Duplicado</option>
              <option value="ignored">Ignorado</option>
              <option value="rejected">Rechazado</option>
              <option value="failed">Error</option>
            </select>
          </label>
          <label className="config-field">
            <span>
              <Search size={16} />
              Buscar
            </span>
            <input value={webhookFilters.q} onChange={(event) => setWebhookFilters((current) => ({ ...current, q: event.target.value }))} placeholder="ID, tienda, error" />
          </label>
          <label className="config-field">
            <span>
              <Clock3 size={16} />
              Desde
            </span>
            <input type="datetime-local" value={webhookFilters.from} onChange={(event) => setWebhookFilters((current) => ({ ...current, from: event.target.value }))} />
          </label>
          <label className="config-field">
            <span>
              <Clock3 size={16} />
              Hasta
            </span>
            <input type="datetime-local" value={webhookFilters.to} onChange={(event) => setWebhookFilters((current) => ({ ...current, to: event.target.value }))} />
          </label>
        </div>
        <div className="tab-monitor">
          <AdminWebhookMonitor
            events={webhookData.events ?? []}
            granularity={monitorGranularity}
            onGranularityChange={setMonitorGranularity}
            summary={webhookSummary}
          />
          <div className="webhook-kpis">
            <AdminKpi label="Procesados" value={webhookSummary.processed ?? 0} />
            <AdminKpi label="Errores" value={webhookSummary.failed ?? 0} />
            <AdminKpi label="Rechazados" value={webhookSummary.rejected ?? 0} />
            <AdminKpi label="Promedio" value={`${webhookSummary.avgDurationMs ?? 0} ms`} />
          </div>
        </div>
        <div className="webhook-investigation-grid">
          <div className="webhook-table tab-events">
            {(webhookData.events ?? []).map((event) => (
              <button className={`webhook-row ${selectedWebhookId === event.id ? 'is-selected' : ''}`} key={event.id} onClick={() => inspectWebhook(event.id)} type="button">
                <time>{formatDateTime(event.receivedAt)}</time>
                <strong>{providerLabel(event.provider)}</strong>
                <span>{event.tenantId ?? 'Sin tienda'}</span>
                <span>{event.eventType}</span>
                <b className={`webhook-status is-${event.status}`}>{eventStatusLabel(event.status)}</b>
                <code>{event.externalId ?? event.errorCode ?? event.id}</code>
                <span>{event.durationMs ?? 0} ms</span>
              </button>
            ))}
            {!(webhookData.events ?? []).length && (
              <div className="empty-state">
                <PlugZap size={24} />
                <h3>Sin eventos para el filtro</h3>
                <p>Cuando entren eventos de WhatsApp o Mercado Pago aparecerán aquí con trazabilidad completa.</p>
              </div>
            )}
          </div>

          <aside className="webhook-detail-panel tab-detail">
            <div className="panel-heading-inline">
              <div>
                <span className="eyebrow">Detalle técnico</span>
                <h3>{selectedWebhook ? providerLabel(selectedWebhook.provider) : 'Selecciona un evento'}</h3>
              </div>
              {selectedWebhookBusy && <span className="admin-chip is-busy">Cargando</span>}
            </div>
            {selectedWebhook ? (
              <>
                <div className="webhook-detail-summary">
                  <ResourceRow icon={Store} label="Cliente / tienda" value={selectedWebhook.tenantId ?? 'No resuelto'} />
                  <ResourceRow icon={PlugZap} label="Estado" value={eventStatusLabel(selectedWebhook.status)} />
                  <ResourceRow icon={Clock3} label="Recibido" value={formatFullDateTime(selectedWebhook.receivedAt)} />
                  <ResourceRow icon={Gauge} label="Duración" value={`${selectedWebhook.durationMs ?? 0} ms`} />
                  <ResourceRow icon={MessageCircle} label="Externo" value={selectedWebhook.externalId ?? 'Sin ID'} />
                  <ResourceRow icon={MessageSquareText} label="Conversación" value={selectedWebhook.conversationId ?? 'No aplica'} />
                </div>
                {(selectedWebhook.errorCode || selectedWebhook.errorMessage) && (
                  <div className="webhook-error-box">
                    <AlertTriangle size={17} />
                    <div>
                      <strong>{selectedWebhook.errorCode ?? 'error'}</strong>
                      <span>{selectedWebhook.errorMessage}</span>
                    </div>
                  </div>
                )}
                <WebhookJsonBlock title="Payload enmascarado" value={selectedWebhook.payloadRedacted} />
                <WebhookJsonBlock title="Headers enmascarados" value={selectedWebhook.headersRedacted} />
                <WebhookJsonBlock title="Metadata" value={selectedWebhook.metadata} />
              </>
            ) : (
              <div className="empty-state webhook-detail-empty">
                <Eye size={24} />
                <h3>Sin evento seleccionado</h3>
                <p>El detalle muestra datos sensibles enmascarados, resultado, error y trazabilidad técnica.</p>
              </div>
            )}
          </aside>
        </div>
      </article>
    </section>
  );
}

function WebhookJsonBlock({ title, value }) {
  return (
    <details className="webhook-json-block" open={title === 'Payload enmascarado'}>
      <summary>{title}</summary>
      <pre>{JSON.stringify(value ?? {}, null, 2)}</pre>
    </details>
  );
}

function AdminWebhookMonitor({ events, granularity, onGranularityChange, summary }) {
  const timeline = buildWebhookTimeline(events, granularity);
  const peak = Math.max(1, ...timeline.map((bucket) => bucket.total));
  const processed = Number(summary.processed ?? 0);
  const failed = Number(summary.failed ?? 0);
  const total = Number(summary.total ?? events.length ?? 0);
  const successRate = total ? Math.round((processed / total) * 100) : 0;
  const peakBucket = timeline.reduce((best, bucket) => (bucket.total > best.total ? bucket : best), timeline[0] ?? { total: 0, label: 'Sin datos' });
  const whatsappCount = events.filter((event) => event.provider === 'meta_whatsapp_cloud_api').length;
  const mercadoPagoCount = events.filter((event) => event.provider === 'mercado_pago').length;
  return (
    <section className="webhook-monitor">
      <div className="webhook-monitor-top">
        <div>
          <span className="eyebrow">Monitor vivo</span>
          <h4>Ritmo histórico de eventos</h4>
        </div>
        <div className="segmented-control" aria-label="Agrupar eventos">
          <button className={granularity === 'hour' ? 'is-active' : ''} type="button" onClick={() => onGranularityChange('hour')}>Hora</button>
          <button className={granularity === 'day' ? 'is-active' : ''} type="button" onClick={() => onGranularityChange('day')}>Día</button>
        </div>
      </div>
      <div className="webhook-monitor-grid">
        <div className="webhook-chart-card">
          <WebhookTimelineChart peak={peak} timeline={timeline} />
          <div className="webhook-chart-axis">
            <span>{timeline[0]?.label ?? 'Sin inicio'}</span>
            <span>{timeline.at(-1)?.label ?? 'Sin fin'}</span>
          </div>
        </div>
        <div className="webhook-monitor-side">
          <AdminKpi label="Éxito" value={`${successRate}%`} />
          <AdminKpi label="Pico" value={`${peakBucket.total} evt`} />
          <AdminKpi label="Errores" value={failed} />
          <div className="provider-mix">
            <div>
              <span>WhatsApp</span>
              <strong>{whatsappCount}</strong>
            </div>
            <div>
              <span>Mercado Pago</span>
              <strong>{mercadoPagoCount}</strong>
            </div>
            <MetricBar label={peakBucket.label} value={peakBucket.total} max={peak} tone="mint" />
          </div>
        </div>
      </div>
    </section>
  );
}

function WebhookTimelineChart({ peak, timeline }) {
  const width = 720;
  const height = 220;
  const padX = 30;
  const padBottom = 28;
  const padTop = 18;
  const usableHeight = height - padTop - padBottom;
  const points = timeline.map((bucket, index) => {
    const x = timeline.length <= 1 ? width / 2 : padX + (index / (timeline.length - 1)) * (width - padX * 2);
    const y = padTop + usableHeight - (bucket.total / peak) * usableHeight;
    const failedY = padTop + usableHeight - (bucket.failed / peak) * usableHeight;
    return { ...bucket, x, y, failedY };
  });
  const baseline = height - padBottom;
  const linePath = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const areaPath = points.length
    ? `M ${points[0].x.toFixed(1)} ${baseline} ${points.map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')} L ${points.at(-1).x.toFixed(1)} ${baseline} Z`
    : '';
  return (
    <svg className="webhook-timeline-chart" role="img" viewBox={`0 0 ${width} ${height}`}>
      {[0.25, 0.5, 0.75, 1].map((line) => (
        <line className="chart-grid-line" key={line} x1={padX} x2={width - padX} y1={padTop + usableHeight * line} y2={padTop + usableHeight * line} />
      ))}
      {points.length ? (
        <>
          <path className="chart-area" d={areaPath} />
          <path className="chart-line" d={linePath} />
          {points.map((point) => (
            <g key={point.key}>
              <rect className="chart-failed-bar" x={point.x - 4} y={point.failedY} width="8" height={Math.max(0, baseline - point.failedY)} rx="4" />
              <circle className={`chart-point ${point.failed ? 'has-failures' : ''}`} cx={point.x} cy={point.y} r={point.total ? 5 : 3} />
            </g>
          ))}
        </>
      ) : (
        <text className="chart-empty-label" x={width / 2} y={height / 2}>Sin eventos en esta ventana</text>
      )}
    </svg>
  );
}

function AdminKpi({ label, value }) {
  return (
    <div className="admin-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TenantHealthDial({ score }) {
  const tone = score >= 82 ? 'ok' : score >= 62 ? 'warn' : 'bad';
  return (
    <div className={`tenant-health-dial is-${tone}`} style={{ '--score': `${Math.max(0, Math.min(score, 100))}%` }}>
      <strong>{score}</strong>
      <span>salud</span>
    </div>
  );
}

function TenantSignalCard({ icon: Icon, label, value, state }) {
  return (
    <div className={`tenant-signal-card is-${state}`}>
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value ?? 'Pendiente'}</strong>
    </div>
  );
}

function MetricBar({ label, value, max, tone }) {
  const percent = Math.min(100, Math.round((Number(value ?? 0) / Math.max(1, Number(max ?? 1))) * 100));
  return (
    <div className={`metric-bar is-${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{formatCompactNumber(value)}</strong>
      </div>
      <b>
        <i style={{ width: `${percent}%` }} />
      </b>
    </div>
  );
}

function WebhookStatusBars({ summary }) {
  const statuses = [
    ['Procesados', summary.processed ?? summary.byStatus?.processed ?? 0, 'ok'],
    ['Duplicados', summary.duplicates ?? summary.byStatus?.duplicate ?? 0, 'warn'],
    ['Ignorados', summary.ignored ?? summary.byStatus?.ignored ?? 0, 'warn'],
    ['Fallidos', summary.failed ?? 0, 'bad'],
  ];
  const max = Math.max(1, ...statuses.map(([, value]) => Number(value ?? 0)));
  return (
    <div className="webhook-status-bars">
      {statuses.map(([label, value, tone]) => (
        <div className={`webhook-status-bar is-${tone}`} key={label}>
          <span>{label}</span>
          <b><i style={{ height: `${Math.max(8, (Number(value) / max) * 100)}%` }} /></b>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function TenantTimelineStep({ label, state }) {
  return (
    <div className={`tenant-timeline-step is-${state}`}>
      <span />
      <strong>{label}</strong>
    </div>
  );
}

function tenantHealthScore(tenant) {
  if (!tenant) return 0;
  let score = 0;
  score += ['active', 'authorized'].includes(tenant.subscriptionStatus)
    ? 25
    : ['pending', 'pending_payment', 'past_due', 'grace_period', 'payment_required'].includes(tenant.subscriptionStatus)
      ? 10
      : 0;
  score += ['ready', 'provisioned'].includes(tenant.googleWorkspaceStatus) ? 25 : tenant.googleStatus === 'authorized' ? 18 : 0;
  score += tenant.whatsappStatus === 'connected' ? 20 : 0;
  score += ['enabled', 'active'].includes(tenant.access) ? 15 : 0;
  score += tenant.lastError ? 0 : 15;
  return Math.max(0, Math.min(100, score));
}

function tenantSignalState(value, okValues, warnValues = []) {
  if (okValues.includes(value)) return 'ok';
  if (warnValues.includes(value)) return 'warn';
  return 'bad';
}

function humanState(value) {
  const labels = {
    active: 'Activo',
    authorized: 'Autorizado',
    pending: 'Pendiente',
    pending_payment: 'Pago pendiente',
    past_due: 'Pago atrasado',
    grace_period: 'En gracia',
    payment_required: 'Pago pendiente',
    expired: 'Vencido',
    cancelled: 'Cancelado',
    suspended: 'Suspendido',
    paused: 'Pausado',
    approved: 'Aprobado',
    rejected: 'Rechazado',
    ready: 'Listo',
    provisioned: 'Aprovisionado',
    missing: 'Pendiente',
    connected: 'Conectado',
    enabled: 'Habilitado',
    limited: 'Limitado',
    inactive: 'Inactivo',
  };
  return labels[value] ?? value ?? 'Pendiente';
}

function billingStageLabel(value) {
  const labels = {
    account_created: 'Cuenta creada',
    diagnosis_started: 'Diagnóstico iniciado',
    diagnosis_completed: 'Diagnóstico listo',
    checkout_started: 'Checkout iniciado',
    payment_confirmed: 'Pago confirmado',
    google_connected: 'Google conectado',
    whatsapp_configured: 'WhatsApp listo',
    store_activated: 'Tienda activa',
    blocked: 'Bloqueo registrado',
  };
  return labels[value] ?? humanState(value);
}

function eventStatusLabel(value) {
  const labels = {
    processed: 'Procesado',
    duplicate: 'Duplicado',
    ignored: 'Ignorado',
    rejected: 'Rechazado',
    failed: 'Error',
  };
  return labels[value] ?? value ?? 'Sin estado';
}

function planLabel(value) {
  const labels = {
    'Production pilot': 'Piloto productivo',
    'Design binding': 'Conexión en curso',
    'Human review': 'Revisión asistida',
    'ventas ia 1000 domicilios': 'Plan 1.000 domicilios',
    ventas_ia_1000_domicilios: 'Plan 1.000 domicilios',
  };
  return labels[value] ?? value;
}

function sourceLabel(value = '') {
  const source = String(value ?? '').toLowerCase();
  if (source.includes('whatsapp')) return 'Canal WhatsApp';
  if (source.includes('google sheets')) return 'Google Sheets';
  if (source.includes('google-sheets')) return 'Google Sheets';
  if (source.includes('google drive')) return 'Google Drive';
  if (source.includes('google-drive')) return 'Google Drive';
  if (source.includes('approval') || source.includes('aprobación')) return 'Aprobación humana';
  if (source.includes('human-handoff') || source.includes('escalamiento')) return 'Escalamiento humano';
  if (source.includes('transactional') || source.includes('registro')) return 'Registro operativo';
  if (source.includes('cliente')) return 'Gestión de clientes';
  if (source.includes('pedido')) return 'Gestión de pedidos';
  if (source.includes('catálogo')) return 'Catálogo de tienda';
  return value ? 'Conexión operativa' : 'Sin origen';
}

function stageLabel(value) {
  const labels = {
    catalog: 'Búsqueda en catálogo',
    approval: 'Revisión humana',
    handoff: 'Acompañamiento humano',
    binding: 'Conexión pendiente',
    payment: 'Pago y cierre',
    off_hours: 'Fuera de horario',
  };
  return labels[value] ?? value ?? 'Sin etapa';
}

function toolLabel(value) {
  const labels = {
    approval_gate: 'Aprobación humana',
    human_handoff: 'Escalamiento humano',
    transactional_write: 'Registro del pedido',
    google_sheets_read_table: 'Consulta de catálogo',
    google_drive_file_picker: 'Documentos de tienda',
    google_sheets_customer_profile_lookup: 'Consulta de cliente',
    google_sheets_customer_profile_upsert: 'Actualización de cliente',
    google_sheets_order_write: 'Registro del pedido',
    whatsapp_business_messaging: 'Canal WhatsApp',
    scheduler: 'Programación de atención',
    planner: 'Razonamiento del agente',
  };
  return labels[value] ?? sourceLabel(value);
}

function riskLabel(value) {
  const labels = {
    low: 'Bajo',
    medium: 'Medio',
    high: 'Alto',
  };
  return labels[value] ?? value ?? 'Sin riesgo';
}

function eventTypeLabel(value) {
  const labels = {
    'agent.started': 'Conversacion iniciada',
    'agent.completed': 'Conversacion cerrada',
    'agent.failed': 'Error del agente',
    'tool.call.started': 'Herramienta en uso',
    'tool.call.completed': 'Herramienta completada',
    'decision.requested': 'Decision humana requerida',
    'approval.requested': 'Apoyo humano solicitado',
    'approval.granted': 'Aprobación registrada',
    'fallback.activated': 'Ruta alternativa activada',
    'auth.login': 'Inicio de sesión',
    human_handoff: 'Escalamiento humano',
    'tool.binding.changed': 'Conexión pendiente',
  };
  return labels[value] ?? value ?? 'Evento';
}

function formatEventTime(value) {
  if (!value) return '';
  if (String(value).includes('T')) return formatDateTime(value);
  return value;
}

function buildWebhookTimeline(events, granularity) {
  const validEvents = events
    .map((event) => ({ ...event, date: new Date(event.receivedAt) }))
    .filter((event) => !Number.isNaN(event.date.getTime()))
    .sort((left, right) => left.date - right.date);
  if (!validEvents.length) return [];
  const bucketMs = granularity === 'day' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const maxBuckets = granularity === 'day' ? 31 : 30;
  const end = floorWebhookBucket(validEvents.at(-1).date, granularity);
  let start = floorWebhookBucket(validEvents[0].date, granularity);
  if (validEvents.length === 1 || end - start > (maxBuckets - 1) * bucketMs) {
    start = new Date(end.getTime() - (maxBuckets - 1) * bucketMs);
  }
  const buckets = new Map();
  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + bucketMs)) {
    const key = cursor.toISOString();
    buckets.set(key, {
      key,
      label: formatWebhookBucketLabel(cursor, granularity),
      total: 0,
      processed: 0,
      failed: 0,
      whatsapp: 0,
      mercadoPago: 0,
    });
  }
  for (const event of validEvents) {
    const bucketDate = floorWebhookBucket(event.date, granularity);
    if (bucketDate < start || bucketDate > end) continue;
    const key = bucketDate.toISOString();
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.total += 1;
    if (event.status === 'processed') bucket.processed += 1;
    if (['failed', 'rejected'].includes(event.status)) bucket.failed += 1;
    if (event.provider === 'meta_whatsapp_cloud_api') bucket.whatsapp += 1;
    if (event.provider === 'mercado_pago') bucket.mercadoPago += 1;
  }
  return [...buckets.values()];
}

function floorWebhookBucket(value, granularity) {
  const date = new Date(value);
  if (granularity === 'day') {
    date.setHours(0, 0, 0, 0);
    return date;
  }
  date.setMinutes(0, 0, 0);
  return date;
}

function formatWebhookBucketLabel(value, granularity) {
  if (granularity === 'day') {
    return new Intl.DateTimeFormat('es-CO', { month: 'short', day: '2-digit' }).format(value);
  }
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(value);
}

function providerLabel(provider) {
  if (provider === 'meta_whatsapp_cloud_api') return 'WhatsApp';
  if (provider === 'mercado_pago') return 'Mercado Pago';
  return provider ?? 'Evento';
}

function formatDateTime(value) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatFullDateTime(value) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function Configuration({ onSaveConfig, tenant, tools: toolList }) {
  const [activeConfigTab, setActiveConfigTab] = useState('store');
  const [llmDraft, setLlmDraft] = useState(() => ({
    phoneNumberId: tenant.config?.whatsapp?.phoneNumberId ?? '',
    phoneNumberIdRef: tenant.config?.whatsapp?.phoneNumberIdRef ?? `${tenant.id.toUpperCase()}_WHATSAPP_PHONE_NUMBER_ID_REF`,
    accessTokenRef: tenant.config?.whatsapp?.accessTokenRef ?? 'WHATSAPP_ACCESS_TOKEN_REF',
    verifyTokenRef: tenant.config?.whatsapp?.verifyTokenRef ?? 'WHATSAPP_WEBHOOK_VERIFY_TOKEN_REF',
    appSecretRef: tenant.config?.whatsapp?.appSecretRef ?? 'WHATSAPP_APP_SECRET_REF',
    spreadsheetIdRef: tenant.config?.googleSheets?.spreadsheetIdRef ?? `${tenant.id.toUpperCase()}_GOOGLE_SHEETS_OPS_SPREADSHEET_ID_REF`,
    catalogRange: tenant.config?.googleSheets?.catalogRange ?? tenant.config?.googleSheets?.range ?? 'Catalogo!A1:J1000',
    tone: tenant.config?.agentPolicy?.tone ?? 'tendero_bogotano',
    humanEscalation: tenant.config?.agentPolicy?.humanEscalation ?? true,
    customerProfilesRange: tenant.config?.googleSheets?.customerProfilesRange ?? 'Clientes!A1:F500',
    ordersRange: tenant.config?.googleSheets?.ordersRange ?? 'Pedidos!A1:K500',
    rootFolderRef: tenant.config?.googleDrive?.rootFolderRef ?? `${tenant.id.toUpperCase()}_GOOGLE_DRIVE_ROOT_FOLDER_ID_REF`,
    customerProfileFolderRef: tenant.config?.googleDrive?.customerProfileFolderRef ?? `${tenant.id.toUpperCase()}_CUSTOMER_PROFILE_FOLDER_REF`,
    filePolicyRef: tenant.config?.googleDrive?.filePolicyRef ?? `${tenant.id.toUpperCase()}_DRIVE_FILE_POLICY_REF`,
    missingQuantity: tenant.config?.agentPolicy?.missingQuantity ?? tenant.config?.orderPolicy?.missingQuantity ?? 'ask',
  }));
  useEffect(() => {
    setLlmDraft({
      phoneNumberId: tenant.config?.whatsapp?.phoneNumberId ?? '',
      phoneNumberIdRef: tenant.config?.whatsapp?.phoneNumberIdRef ?? `${tenant.id.toUpperCase()}_WHATSAPP_PHONE_NUMBER_ID_REF`,
      accessTokenRef: tenant.config?.whatsapp?.accessTokenRef ?? 'WHATSAPP_ACCESS_TOKEN_REF',
      verifyTokenRef: tenant.config?.whatsapp?.verifyTokenRef ?? 'WHATSAPP_WEBHOOK_VERIFY_TOKEN_REF',
      appSecretRef: tenant.config?.whatsapp?.appSecretRef ?? 'WHATSAPP_APP_SECRET_REF',
      spreadsheetIdRef: tenant.config?.googleSheets?.spreadsheetIdRef ?? `${tenant.id.toUpperCase()}_GOOGLE_SHEETS_OPS_SPREADSHEET_ID_REF`,
      catalogRange: tenant.config?.googleSheets?.catalogRange ?? tenant.config?.googleSheets?.range ?? 'Catalogo!A1:J1000',
      tone: tenant.config?.agentPolicy?.tone ?? 'tendero_bogotano',
      humanEscalation: tenant.config?.agentPolicy?.humanEscalation ?? true,
      customerProfilesRange: tenant.config?.googleSheets?.customerProfilesRange ?? 'Clientes!A1:F500',
      ordersRange: tenant.config?.googleSheets?.ordersRange ?? 'Pedidos!A1:K500',
      rootFolderRef: tenant.config?.googleDrive?.rootFolderRef ?? `${tenant.id.toUpperCase()}_GOOGLE_DRIVE_ROOT_FOLDER_ID_REF`,
      customerProfileFolderRef: tenant.config?.googleDrive?.customerProfileFolderRef ?? `${tenant.id.toUpperCase()}_CUSTOMER_PROFILE_FOLDER_REF`,
      filePolicyRef: tenant.config?.googleDrive?.filePolicyRef ?? `${tenant.id.toUpperCase()}_DRIVE_FILE_POLICY_REF`,
      missingQuantity: tenant.config?.agentPolicy?.missingQuantity ?? tenant.config?.orderPolicy?.missingQuantity ?? 'ask',
    });
  }, [tenant]);
  const fields = [
    ['Identificador WhatsApp', 'WHATSAPP_PHONE_NUMBER_ID_REF', MessageCircle],
    ['Token de verificación', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN_REF', KeyRound],
    ['Plan SaaS', tenant.config?.saas?.planCode ?? tenant.plan ?? 'Pendiente', ShoppingBag],
    ['Origen de secretos', 'Requiere revisión', Lock],
  ];
  const googleTools = toolList.filter((tool) => tool.name.startsWith('google_'));
  const googleReady = googleTools.length > 0 && googleTools.every((tool) => ['sandbox_ready', 'production_ready'].includes(tool.status));
  const googleStatusHint = googleReady ? 'Listo' : 'Pendiente';
  const connectedTools = toolList.filter((tool) => ['sandbox_ready', 'production_ready', 'approval_required'].includes(tool.status)).length;
  const configTabs = [
    ['store', Store, 'Tienda', 'Datos base'],
    ['google', Database, 'Google', googleStatusHint],
    ['whatsapp', MessageCircle, 'WhatsApp', llmDraft.phoneNumberId ? 'Conectado' : 'Pendiente'],
    ['agent', Bot, 'Agente', 'Criterio comercial'],
    ['tools', PlugZap, 'Conexiones', `${connectedTools}/${toolList.length}`],
  ];
  return (
    <section className="config-layout">
      <div className="section-title split-title config-titlebar">
        <div>
          <span className="eyebrow">Configuración sin código</span>
          <h2>{tenant.name}</h2>
        </div>
        <div className="config-tabs" role="tablist" aria-label="Secciones de configuración">
          {configTabs.map(([key, Icon, label, detail]) => (
            <button
              aria-selected={activeConfigTab === key}
              className={activeConfigTab === key ? 'is-active' : ''}
              key={key}
              onClick={() => setActiveConfigTab(key)}
              role="tab"
              type="button"
            >
              <Icon size={16} />
              <span>{label}</span>
              <small>{detail}</small>
            </button>
          ))}
        </div>
      </div>
      <div className={`config-tab-panel active-config-${activeConfigTab}`}>
        {activeConfigTab === 'store' && (
        <article className="settings-panel config-focus-panel">
          <h3>Parámetros de la tienda</h3>
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
        )}
        {activeConfigTab === 'google' && (
        <article className="settings-panel config-focus-panel">
          <div className="config-panel-heading">
            <div>
              <span className="eyebrow">Google del cliente</span>
              <h3>Drive y Sheets operativos</h3>
            </div>
            <StatusPill status={googleReady ? 'sandbox_ready' : 'needs_binding'} />
          </div>
          <div className="google-config-status">
            <div>
              <Database size={18} />
              <span>Sheets</span>
              <strong>{llmDraft.spreadsheetIdRef || 'Pendiente'}</strong>
            </div>
            <div>
              <FileImage size={18} />
              <span>Drive</span>
              <strong>{llmDraft.rootFolderRef || 'Pendiente'}</strong>
            </div>
            <div>
              <ShieldCheck size={18} />
              <span>Estado</span>
              <strong>{googleStatusHint}</strong>
            </div>
          </div>
          <div className="config-field-grid">
            <label className="config-field">
              <span>
                <Database size={16} />
                Referencia segura de Google Sheets
              </span>
            <input value={llmDraft.spreadsheetIdRef} readOnly />
            </label>
            <label className="config-field">
              <span>
                <Store size={16} />
                Rango de catálogo
              </span>
            <input value={llmDraft.catalogRange} readOnly />
            </label>
            <label className="config-field">
              <span>
                <UserCheck size={16} />
                Rango de clientes
              </span>
            <input value={llmDraft.customerProfilesRange} readOnly />
            </label>
            <label className="config-field">
              <span>
                <ShoppingBag size={16} />
                Rango de pedidos
              </span>
            <input value={llmDraft.ordersRange} readOnly />
            </label>
          </div>
          <details className="advanced-config">
            <summary>Referencias avanzadas de Drive</summary>
            <div className="config-field-grid">
              <label className="config-field">
                <span>
                  <FileImage size={16} />
                  Carpeta raíz
                </span>
                <input value={llmDraft.rootFolderRef} readOnly />
              </label>
              <label className="config-field">
                <span>
                  <UserCheck size={16} />
                  Carpeta de clientes
                </span>
                <input value={llmDraft.customerProfileFolderRef} readOnly />
              </label>
              <label className="config-field">
                <span>
                  <Lock size={16} />
                  Política de archivos
                </span>
                <input value={llmDraft.filePolicyRef} readOnly />
              </label>
            </div>
          </details>
          <button className="approve-btn" type="button" onClick={() => onNavigate('onboarding')}>
            <ShieldCheck size={16} />
            Gestionar Google en Onboarding
          </button>
          <div className="isolation-note">
            <ShieldCheck size={18} />
            <span>OAuth, aprovisionamiento y reconexion se gestionan en Onboarding. Las referencias tecnicas quedan protegidas.</span>
          </div>
        </article>
        )}
        {activeConfigTab === 'whatsapp' && (
        <article className="settings-panel config-focus-panel">
          <h3>WhatsApp por tienda</h3>
          <label className="config-field">
            <span>
              <MessageCircle size={16} />
              Identificador del número
            </span>
            <input value={llmDraft.phoneNumberId || 'Pendiente de validacion'} readOnly />
          </label>
          <label className="config-field">
            <span>
              <KeyRound size={16} />
              Referencia del identificador
            </span>
            <input value={llmDraft.phoneNumberIdRef} readOnly />
          </label>
          <label className="config-field">
            <span>
              <Lock size={16} />
              Referencia segura de acceso
            </span>
            <input value={llmDraft.accessTokenRef} readOnly />
          </label>
          <label className="config-field">
            <span>
              <ShieldCheck size={16} />
              Referencia de verificación
            </span>
            <input value={llmDraft.verifyTokenRef} readOnly />
          </label>
          <label className="config-field">
            <span>
              <KeyRound size={16} />
              Referencia segura de aplicación
            </span>
            <input value={llmDraft.appSecretRef} readOnly />
          </label>
          <button className="approve-btn" type="button" onClick={() => onNavigate('onboarding')}>
            <MessageCircle size={16} />
            Gestionar WhatsApp en Onboarding
          </button>
          <div className="isolation-note">
            <ShieldCheck size={18} />
            <span>El cliente autoriza su cuenta en Meta desde Onboarding. Los tokens y la validacion del numero no se editan desde esta pantalla.</span>
          </div>
        </article>
        )}
        {activeConfigTab === 'agent' && (
        <article className="settings-panel config-focus-panel">
          <h3>Politica del agente</h3>
          <div className="isolation-note">
            <Bot size={18} />
            <span>Esta politica la administra la plataforma. El cliente no puede cambiar el criterio comercial, el escalamiento humano ni las reglas de pedido.</span>
          </div>
          <div className="resource-list compact-resource-list">
            <ResourceRow icon={Bot} label="Motor IA" value="DeepSeek global de plataforma" />
            <ResourceRow icon={MessageCircle} label="Idioma" value="Español de Colombia" />
            <ResourceRow icon={UserCheck} label="Escalamiento" value="Activo por defecto" />
            <ResourceRow icon={ShoppingBag} label="Cierre" value="Pedido confirmado -> preparacion humana" />
          </div>
          <div className="isolation-note">
            <Bot size={18} />
            <span>Para solicitar cambios operativos, contacta al administrador de la plataforma.</span>
          </div>
        </article>
        )}
        {activeConfigTab === 'tools' && (
        <article className="tools-panel config-focus-panel">
          <h3>Conexiones operativas</h3>
          <div className="tool-list">
            {toolList.map((tool) => (
              <div className="tool-row" key={tool.key}>
                <div>
                  <strong>{toolLabel(tool.name)}</strong>
                  <span>{tool.purpose}</span>
                  <code>{sourceLabel(tool.source)}</code>
                </div>
                <div className="tool-meta">
                  <StatusPill status={tool.status} />
                  <span className={`risk risk-${tool.risk}`}>{riskLabel(tool.risk)}</span>
                  {tool.sideEffects && <span className="side-effect">impacta datos</span>}
                </div>
              </div>
            ))}
          </div>
        </article>
        )}
      </div>
    </section>
  );
}

function Traceability({ events, conversations, compact = false }) {
  return (
    <section className={compact ? 'trace-layout compact-trace' : 'trace-layout'}>
      {!compact && (
        <div className="section-title">
          <span className="eyebrow">Trazabilidad operativa</span>
          <h2>Eventos, decisiones y herramientas</h2>
        </div>
      )}
      <div className="trace-grid">
        <article className="event-stream">
          {events.map((event) => (
            <div className="stream-row" key={event.id}>
              <time>{formatEventTime(event.at)}</time>
              <div>
                <strong>{eventTypeLabel(event.type)}</strong>
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
              <span>Los contratos del ZIP no incluyen conexiones operativas ni secretos reales. La capa visual queda preparada para consumir eventos reales cuando existan endpoints.</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

export default App;
