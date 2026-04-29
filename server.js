const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3333);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const ADMIN_PASSWORD = String(process.env.LEOHUB_ADMIN_PASSWORD || 'admin');
const BASE_URL = String(process.env.LEOHUB_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '');
const SUPABASE_STATE_TABLE = String(process.env.LEOHUB_SUPABASE_STATE_TABLE || 'leohub_state');
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

const JSON_LIMIT_BYTES = Number(process.env.LEOHUB_JSON_LIMIT_BYTES || 1024 * 1024);
const TERMINAL_EVENTS = new Set(['pix_confirmed', 'pix_refunded', 'pix_refused', 'purchase']);
const GATEWAYS = ['atomopay', 'paradise', 'sunize'];
const STATE_ID = 'main';

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function randomToken(prefix = 'lh') {
  return `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
}

function id(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('base64url')}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asObject(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function toText(value, max = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : '';
}

function onlyDigits(value, max = 32) {
  return String(value ?? '').replace(/\D/g, '').slice(0, max);
}

function toAmount(value) {
  if (value === undefined || value === null || value === '') return 0;
  const raw = String(value).trim().replace(',', '.');
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function cents(value) {
  return Math.max(1, Math.round(toAmount(value) * 100));
}

function normalizeStatus(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');
}

function pickText(...values) {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return '';
}

function defaultGatewayConfig() {
  return {
    enabled: false,
    timeoutMs: 12000,
    baseUrl: '',
    postbackUrl: '',
    apiKey: '',
    apiSecret: '',
    apiToken: '',
    secretKey: '',
    companyId: '',
    basicAuthBase64: '',
    offerHash: '',
    productHash: '',
    orderbumpHash: '',
    source: '',
    description: '',
    iofOfferHash: '',
    iofProductHash: '',
    correiosOfferHash: '',
    correiosProductHash: '',
    expressoOfferHash: '',
    expressoProductHash: '',
    webhookToken: randomToken('lh_wh'),
    webhookTokenRequired: true
  };
}

function gatewayDefaultBaseUrl(gateway) {
  if (gateway === 'atomopay') return 'https://api.atomopay.com.br/api/public/v1';
  if (gateway === 'sunize') return 'https://api.sunize.com.br/v1';
  if (gateway === 'paradise') return 'https://multi.paradisepags.com';
  return '';
}

function defaultOfferSettings() {
  return {
    features: {
      tracking: true,
      pix: true,
      pageviews: true,
      dispatch: true
    },
    payments: {
      activeGateway: 'atomopay',
      gatewayOrder: ['atomopay', 'paradise', 'sunize'],
      gateways: {
        atomopay: defaultGatewayConfig(),
        paradise: defaultGatewayConfig(),
        sunize: defaultGatewayConfig()
      }
    },
    meta: {
      enabled: false,
      pixelId: '',
      backupPixelId: '',
      accessToken: '',
      backupAccessToken: '',
      testEventCode: '',
      backupTestEventCode: '',
      events: {
        page_view: true,
        view_content: true,
        lead: true,
        checkout: true,
        purchase: true
      }
    },
    tiktok: {
      enabled: false,
      pixelId: '',
      events: {
        page_view: true,
        lead: true,
        checkout: true,
        purchase: true
      }
    },
    utmify: {
      enabled: false,
      endpoint: 'https://api.utmify.com.br/api-credentials/orders',
      apiKey: '',
      platform: 'LEOHUB',
      sendPixCreated: true,
      sendPixConfirmed: true,
      sendRefunds: true
    },
    pushcut: {
      enabled: false,
      apiKey: '',
      pixCreatedNotification: '',
      pixConfirmedNotification: '',
      pixCreatedUrl: '',
      pixConfirmedUrl: '',
      templates: {
        pixCreatedTitle: 'PIX gerado - {amount}',
        pixCreatedMessage: '{offerName} | {name} | {gateway} | {txid}',
        pixConfirmedTitle: 'PIX pago - {amount}',
        pixConfirmedMessage: '{offerName} | {name} | {gateway} | {txid}'
      }
    },
    tracking: {
      firstTouch: true,
      captureFbclid: true,
      captureTtclid: true,
      captureGclid: true,
      sourceBasedRouting: true
    },
    pages: {
      enabled: true,
      home: '',
      checkout: '',
      pix: '',
      success: ''
    },
    audience: {
      paidOnly: true,
      minRevenueForInsight: 1
    },
    backredirects: {
      enabled: false,
      urls: []
    },
    publicConfig: {
      pixelEnabled: false,
      tiktokPixelEnabled: false,
      custom: {}
    }
  };
}

function createEmptyStore() {
  const masterToken = randomToken('lh_admin');
  return {
    meta: {
      createdAt: nowIso(),
      updatedAt: nowIso(),
      masterToken,
      sessions: []
    },
    users: [],
    offers: [],
    leads: [],
    events: [],
    pageviews: [],
    transactions: [],
    webhooks: [],
    dispatches: []
  };
}

function loadStore() {
  if (USE_SUPABASE) {
    return createEmptyStore();
  }
  ensureDir(DATA_DIR);
  if (!fs.existsSync(STORE_FILE)) {
    const initial = createEmptyStore();
    saveStore(initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return {
      ...createEmptyStore(),
      ...parsed,
      meta: {
        ...createEmptyStore().meta,
        ...(parsed.meta || {})
      }
    };
  } catch (error) {
    const broken = `${STORE_FILE}.${Date.now()}.broken`;
    fs.copyFileSync(STORE_FILE, broken);
    const initial = createEmptyStore();
    initial.meta.recoveredFrom = broken;
    saveStore(initial);
    return initial;
  }
}

let STORE = loadStore();
let STORE_READY = !USE_SUPABASE;
let STORE_LOAD_PROMISE = null;
const PENDING_SAVES = new Set();

function saveStore(next = STORE) {
  next.meta = next.meta || {};
  next.meta.updatedAt = nowIso();
  STORE = next;
  if (USE_SUPABASE) {
    const pending = saveSupabaseStore(next).catch((error) => {
      console.error('[leohub] supabase save failed', error?.message || error);
    });
    PENDING_SAVES.add(pending);
    pending.finally(() => PENDING_SAVES.delete(pending));
    return;
  }
  ensureDir(DATA_DIR);
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function writeStore(mutator) {
  const next = clone(STORE);
  const result = mutator(next);
  saveStore(next);
  return result;
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabaseFetch(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: supabaseHeaders(options.headers || {})
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_error) {
    data = text;
  }
  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data || {});
    throw new Error(`supabase_${response.status}_${detail}`);
  }
  return data;
}

function normalizeRemoteStore(rawState = {}) {
  const base = createEmptyStore();
  const source = rawState && typeof rawState === 'object' ? rawState : {};
  return {
    ...base,
    ...source,
    meta: {
      ...base.meta,
      ...(source.meta || {})
    },
    offers: Array.isArray(source.offers) ? source.offers : [],
    leads: Array.isArray(source.leads) ? source.leads : [],
    events: Array.isArray(source.events) ? source.events : [],
    users: Array.isArray(source.users) ? source.users : [],
    pageviews: Array.isArray(source.pageviews) ? source.pageviews : [],
    transactions: Array.isArray(source.transactions) ? source.transactions : [],
    webhooks: Array.isArray(source.webhooks) ? source.webhooks : [],
    dispatches: Array.isArray(source.dispatches) ? source.dispatches : []
  };
}

async function loadSupabaseStore() {
  const rows = await supabaseFetch(`/rest/v1/${encodeURIComponent(SUPABASE_STATE_TABLE)}?id=eq.${encodeURIComponent(STATE_ID)}&select=id,state,updated_at&limit=1`);
  if (Array.isArray(rows) && rows[0]?.state) {
    return normalizeRemoteStore(rows[0].state);
  }
  const initial = createEmptyStore();
  await supabaseFetch(`/rest/v1/${encodeURIComponent(SUPABASE_STATE_TABLE)}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{
      id: STATE_ID,
      state: initial,
      updated_at: nowIso()
    }])
  });
  return initial;
}

async function saveSupabaseStore(next = STORE) {
  await supabaseFetch(`/rest/v1/${encodeURIComponent(SUPABASE_STATE_TABLE)}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{
      id: STATE_ID,
      state: next,
      updated_at: nowIso()
    }])
  });
}

async function ensureStoreReady() {
  if (!USE_SUPABASE || STORE_READY) return;
  if (!STORE_LOAD_PROMISE) {
    STORE_LOAD_PROMISE = loadSupabaseStore()
      .then((store) => {
        STORE = store;
        STORE_READY = true;
      })
      .finally(() => {
        STORE_LOAD_PROMISE = null;
      });
  }
  await STORE_LOAD_PROMISE;
}

async function flushPendingSaves() {
  if (!PENDING_SAVES.size) return;
  await Promise.allSettled([...PENDING_SAVES]);
}

function publicOffer(offer) {
  if (!offer) return null;
  return {
    id: offer.id,
    slug: offer.slug,
    name: offer.name,
    status: offer.status,
    description: offer.description,
    publicKey: offer.publicKey,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
    stats: buildOfferStats(offer.id)
  };
}

function publicOfferConfig(offer) {
  const settings = offer.settings || {};
  const metaEnabled = settings.meta?.enabled && settings.meta?.pixelId;
  const tiktokEnabled = settings.tiktok?.enabled && settings.tiktok?.pixelId;
  return {
    ...(settings.publicConfig || {}),
    pixel: metaEnabled
      ? {
          enabled: true,
          id: settings.meta.pixelId,
          backupId: settings.meta.backupPixelId || '',
          events: settings.meta.events || {}
        }
      : { enabled: false },
    metaPixel: metaEnabled
      ? {
          enabled: true,
          pixelId: settings.meta.pixelId,
          backupPixelId: settings.meta.backupPixelId || '',
          events: settings.meta.events || {}
        }
      : { enabled: false },
    tiktokPixel: tiktokEnabled
      ? {
          enabled: true,
          id: settings.tiktok.pixelId,
          pixelId: settings.tiktok.pixelId,
          events: settings.tiktok.events || {}
        }
      : { enabled: false },
    pages: settings.pages || {},
    backredirects: {
      enabled: settings.backredirects?.enabled === true,
      urls: Array.isArray(settings.backredirects?.urls) ? settings.backredirects.urls : []
    }
  };
}

function publicUser(user) {
  if (!user) return null;
  const offers = STORE.offers.filter((offer) => offer.ownerId === user.id);
  const offerIds = offers.map((offer) => offer.id);
  const leads = STORE.leads.filter((lead) => offerIds.includes(lead.offerId));
  const transactions = STORE.transactions.filter((tx) => offerIds.includes(tx.offerId));
  const paid = transactions.filter((tx) => tx.status === 'paid');
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    plan: user.plan,
    notes: user.notes,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    stats: {
      offers: offers.length,
      leads: leads.length,
      transactions: transactions.length,
      paid: paid.length,
      revenue: Number(paid.reduce((sum, tx) => sum + Number(tx.amount || 0), 0).toFixed(2))
    }
  };
}

function adminOffer(offer) {
  if (!offer) return null;
  const owner = STORE.users.find((user) => user.id === offer.ownerId) || null;
  return {
    ...clone(offer),
    owner: owner ? publicUser(owner) : null,
    stats: buildOfferStats(offer.id),
    insights: buildOfferInsights(offer.id)
  };
}

function buildOfferStats(offerId) {
  const leads = STORE.leads.filter((item) => item.offerId === offerId);
  const events = STORE.events.filter((item) => item.offerId === offerId);
  const transactions = STORE.transactions.filter((item) => item.offerId === offerId);
  const paid = transactions.filter((item) => item.status === 'paid');
  const revenue = paid.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const gatewayCounts = {};
  transactions.forEach((item) => {
    const gateway = item.gateway || 'unknown';
    gatewayCounts[gateway] = (gatewayCounts[gateway] || 0) + 1;
  });
  const topGateway = Object.entries(gatewayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return {
    leads: leads.length,
    events: events.length,
    pageviews: STORE.pageviews.filter((item) => item.offerId === offerId).length,
    transactions: transactions.length,
    paid: paid.length,
    revenue: Number(revenue.toFixed(2)),
    conversion: transactions.length ? Number(((paid.length / transactions.length) * 100).toFixed(1)) : 0,
    topGateway,
    lastActivityAt: [leads, events, transactions]
      .flat()
      .map((item) => item.updatedAt || item.createdAt)
      .filter(Boolean)
      .sort()
      .at(-1) || ''
  };
}

function buildOfferInsights(offerId) {
  const leads = STORE.leads.filter((item) => item.offerId === offerId);
  const events = STORE.events.filter((item) => item.offerId === offerId);
  const transactions = STORE.transactions.filter((item) => item.offerId === offerId);
  const paid = transactions.filter((item) => item.status === 'paid');
  const byGateway = {};
  const bySource = {};
  const byStage = {};
  const byPage = {};

  for (const tx of transactions) {
    const key = tx.gateway || 'unknown';
    byGateway[key] = byGateway[key] || { generated: 0, paid: 0, revenue: 0 };
    byGateway[key].generated += 1;
    if (tx.status === 'paid') {
      byGateway[key].paid += 1;
      byGateway[key].revenue = Number((byGateway[key].revenue + Number(tx.amount || 0)).toFixed(2));
    }
  }

  for (const lead of leads) {
    const source = pickText(lead.utm?.utm_source, lead.utm?.src, lead.referrer, 'direto');
    bySource[source] = (bySource[source] || 0) + 1;
    const stage = pickText(lead.stage, lead.lastEvent, 'sem_etapa');
    byStage[stage] = (byStage[stage] || 0) + 1;
  }

  for (const event of events) {
    const page = pickText(event.page, event.stage, event.event, 'evento');
    byPage[page] = (byPage[page] || 0) + 1;
  }

  return {
    gatewayStats: byGateway,
    sourceStats: bySource,
    stageStats: byStage,
    pageStats: byPage,
    paidLeads: paid.length,
    revenue: Number(paid.reduce((sum, tx) => sum + Number(tx.amount || 0), 0).toFixed(2))
  };
}

function findOfferByKey(key = '') {
  const token = toText(key, 200);
  if (!token) return null;
  return STORE.offers.find((offer) => offer.publicKey === token || offer.privateKey === token) || null;
}

function findOfferById(idOrSlug = '') {
  const value = toText(idOrSlug, 200);
  return STORE.offers.find((offer) => offer.id === value || offer.slug === value) || null;
}

function findUserById(idOrEmail = '') {
  const value = toText(idOrEmail, 200).toLowerCase();
  return STORE.users.find((user) => user.id === value || String(user.email || '').toLowerCase() === value) || null;
}

function getBearer(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function getAdminToken(req) {
  return getBearer(req) || toText(req.headers['x-leohub-admin-token'] || req.headers['x-admin-token'], 300);
}

function isAdmin(req) {
  const token = getAdminToken(req);
  if (!token) return false;
  if (token === STORE.meta.masterToken) return true;
  return (STORE.meta.sessions || []).some((session) => session.token === token && Date.parse(session.expiresAt) > Date.now());
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  sendJson(res, 401, { ok: false, error: 'unauthorized' });
  return false;
}

function getOfferFromRequest(req) {
  const key =
    toText(req.headers['x-leohub-offer-key'], 300) ||
    toText(req.headers['x-offer-key'], 300) ||
    toText(req.query.offer_key, 300) ||
    toText(req.query.offerKey, 300);
  return findOfferByKey(key);
}

function requireOffer(req, res) {
  const offer = getOfferFromRequest(req);
  if (offer) return offer;
  sendJson(res, 401, { ok: false, error: 'invalid_offer_key' });
  return null;
}

function findLeadForOffer(offerId, leadIdOrSession = '') {
  const key = toText(leadIdOrSession, 300);
  return STORE.leads.find((lead) =>
    lead.offerId === offerId &&
    (lead.id === key || lead.sessionId === key || lead.pixTxid === key || lead.payload?.pix?.idTransaction === key)
  ) || null;
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-leohub-offer-key, x-offer-key, x-leohub-admin-token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    ...headers
  });
  res.end(payload);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function parseUrl(req) {
  const parsed = new URL(req.url, BASE_URL);
  req.query = Object.fromEntries(parsed.searchParams.entries());
  return parsed;
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > JSON_LIMIT_BYTES) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_error) {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  if (file === '/docs') file = '/docs.html';
  if (file === '/app') file = '/index.html';
  const safePath = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, safePath);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    sendText(res, 404, 'Not found');
    return;
  }
  const ext = path.extname(full).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
  };
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=60'
  });
  fs.createReadStream(full).pipe(res);
}

function normalizeOfferInput(input = {}, existing = null) {
  const now = nowIso();
  const name = toText(input.name || existing?.name || 'Nova oferta', 120);
  const slugBase = toText(input.slug || existing?.slug || name, 120)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `oferta-${Date.now()}`;
  const settings = {
    ...defaultOfferSettings(),
    ...asObject(existing?.settings),
    ...asObject(input.settings)
  };
  settings.payments = {
    ...defaultOfferSettings().payments,
    ...asObject(existing?.settings?.payments),
    ...asObject(input.settings?.payments)
  };
  settings.payments.gateways = {
    ...defaultOfferSettings().payments.gateways,
    ...asObject(existing?.settings?.payments?.gateways),
    ...asObject(input.settings?.payments?.gateways)
  };
  Object.keys(settings.payments.gateways).forEach((gateway) => {
    if (!GATEWAYS.includes(gateway)) delete settings.payments.gateways[gateway];
  });
  for (const gateway of GATEWAYS) {
    settings.payments.gateways[gateway] = {
      ...defaultGatewayConfig(),
      ...asObject(existing?.settings?.payments?.gateways?.[gateway]),
      ...asObject(input.settings?.payments?.gateways?.[gateway])
    };
    delete settings.payments.gateways[gateway].mockMode;
    if (!settings.payments.gateways[gateway].baseUrl) {
      settings.payments.gateways[gateway].baseUrl = gatewayDefaultBaseUrl(gateway);
    }
  }
  settings.meta = {
    ...defaultOfferSettings().meta,
    ...asObject(existing?.settings?.meta),
    ...asObject(input.settings?.meta),
    events: {
      ...defaultOfferSettings().meta.events,
      ...asObject(existing?.settings?.meta?.events),
      ...asObject(input.settings?.meta?.events)
    }
  };
  settings.tiktok = {
    ...defaultOfferSettings().tiktok,
    ...asObject(existing?.settings?.tiktok),
    ...asObject(input.settings?.tiktok),
    events: {
      ...defaultOfferSettings().tiktok.events,
      ...asObject(existing?.settings?.tiktok?.events),
      ...asObject(input.settings?.tiktok?.events)
    }
  };
  settings.utmify = {
    ...defaultOfferSettings().utmify,
    ...asObject(existing?.settings?.utmify),
    ...asObject(input.settings?.utmify)
  };
  settings.pushcut = {
    ...defaultOfferSettings().pushcut,
    ...asObject(existing?.settings?.pushcut),
    ...asObject(input.settings?.pushcut),
    templates: {
      ...defaultOfferSettings().pushcut.templates,
      ...asObject(existing?.settings?.pushcut?.templates),
      ...asObject(input.settings?.pushcut?.templates)
    }
  };
  for (const section of ['tracking', 'pages', 'audience', 'backredirects', 'publicConfig', 'features']) {
    settings[section] = {
      ...asObject(defaultOfferSettings()[section]),
      ...asObject(existing?.settings?.[section]),
      ...asObject(input.settings?.[section])
    };
  }
  return {
    id: existing?.id || id('offer'),
    ownerId: toText(input.ownerId || input.owner_id || existing?.ownerId || '', 120),
    slug: slugBase,
    name,
    status: toText(input.status || existing?.status || 'active', 30),
    description: toText(input.description || existing?.description || '', 500),
    publicKey: existing?.publicKey || randomToken('lh_pub'),
    privateKey: existing?.privateKey || randomToken('lh_sec'),
    settings,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function normalizeUserInput(input = {}, existing = null) {
  const now = nowIso();
  const email = toText(input.email || existing?.email || '', 180).toLowerCase();
  return {
    id: existing?.id || id('user'),
    name: toText(input.name || existing?.name || 'Novo usuario', 160),
    email,
    status: toText(input.status || existing?.status || 'active', 40),
    plan: toText(input.plan || existing?.plan || 'interno', 80),
    notes: toText(input.notes || existing?.notes || '', 1000),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function upsertLead(offer, payload = {}, req = null) {
  const sessionId = pickText(payload.sessionId, payload.session_id, payload.leadSession, payload.orderId) || id('session');
  const personal = asObject(payload.personal || payload.customer);
  const address = asObject(payload.address);
  const shipping = asObject(payload.shipping);
  const pix = asObject(payload.pix);
  const utm = asObject(payload.utm);
  const incoming = {
    offerId: offer.id,
    sessionId,
    stage: toText(payload.stage, 80),
    lastEvent: toText(payload.event || payload.lastEvent, 100),
    name: toText(personal.name, 160),
    email: toText(personal.email, 180),
    document: onlyDigits(personal.cpf || personal.document, 18),
    phone: onlyDigits(personal.phoneDigits || personal.phone || personal.phone_number, 24),
    sourceUrl: toText(payload.sourceUrl, 600),
    landingPage: toText(utm.landing_page || payload.landingPage, 400),
    referrer: toText(utm.referrer || payload.referrer, 400),
    utm,
    address,
    shipping,
    pix,
    pixTxid: pickText(payload.pixTxid, pix.idTransaction, pix.txid),
    pixAmount: toAmount(payload.pixAmount || pix.amount || payload.amount),
    payload,
    updatedAt: nowIso()
  };
  return writeStore((store) => {
    let lead = store.leads.find((item) => item.offerId === offer.id && item.sessionId === sessionId);
    if (!lead) {
      lead = {
        id: id('lead'),
        offerId: offer.id,
        sessionId,
        createdAt: nowIso()
      };
      store.leads.push(lead);
    }
    const mergedPayload = {
      ...asObject(lead.payload),
      ...payload,
      utm: { ...asObject(lead.payload?.utm), ...utm },
      personal: { ...asObject(lead.payload?.personal), ...personal },
      customer: { ...asObject(lead.payload?.customer), ...personal },
      address: { ...asObject(lead.payload?.address), ...address },
      shipping: { ...asObject(lead.payload?.shipping), ...shipping },
      pix: { ...asObject(lead.payload?.pix), ...pix }
    };
    Object.assign(lead, {
      ...lead,
      ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => {
        if (value === '' || value === null || value === undefined) return false;
        if (typeof value === 'number' && value === 0) return false;
        if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
        return true;
      })),
      payload: mergedPayload,
      userAgent: toText(req?.headers?.['user-agent'], 300) || lead.userAgent || '',
      clientIp: clientIp(req) || lead.clientIp || '',
      updatedAt: nowIso()
    });
    return clone(lead);
  });
}

function clientIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '');
  return forwarded ? forwarded.split(',')[0].trim() : String(req?.socket?.remoteAddress || '');
}

function recordEvent(offer, body = {}, req = null) {
  const lead = upsertLead(offer, body, req);
  const event = {
    id: id('evt'),
    offerId: offer.id,
    leadId: lead.id,
    sessionId: lead.sessionId,
    event: toText(body.event || 'track', 120),
    stage: toText(body.stage || lead.stage, 80),
    page: toText(body.page, 120),
    sourceUrl: toText(body.sourceUrl, 600),
    payload: body,
    createdAt: nowIso()
  };
  writeStore((store) => {
    store.events.push(event);
  });
  scheduleDispatches(offer, event.event, {
    ...body,
    sessionId: lead.sessionId,
    lead
  }, req);
  return { lead, event };
}

function recordPageview(offer, body = {}, req = null) {
  const page = toText(body.page || body.path || 'page', 120);
  const lead = upsertLead(offer, { ...body, event: 'pageview', page }, req);
  const exists = STORE.pageviews.some((item) => item.offerId === offer.id && item.sessionId === lead.sessionId && item.page === page);
  let pageview;
  if (!exists) {
    pageview = {
      id: id('pv'),
      offerId: offer.id,
      leadId: lead.id,
      sessionId: lead.sessionId,
      page,
      sourceUrl: toText(body.sourceUrl, 600),
      payload: body,
      createdAt: nowIso()
    };
    writeStore((store) => {
      store.pageviews.push(pageview);
    });
  }
  scheduleDispatches(offer, 'page_view', { ...body, sessionId: lead.sessionId, lead, page }, req);
  return { lead, pageview, deduped: exists };
}

function resolveGatewayOrder(offer, requested = '') {
  const payments = asObject(offer.settings?.payments);
  const order = Array.isArray(payments.gatewayOrder) && payments.gatewayOrder.length ? payments.gatewayOrder : GATEWAYS;
  const active = toText(payments.activeGateway || order[0], 40);
  const withRequested = requested ? [requested, ...order] : [active, ...order];
  return [...new Set(withRequested.map((item) => normalizeStatus(item)).filter((item) => GATEWAYS.includes(item)))];
}

function resolveStrictGatewayOrder(requested = '') {
  const gateway = normalizeStatus(requested);
  return GATEWAYS.includes(gateway) ? [gateway] : [];
}

function gatewayHasCredentials(gateway, config = {}) {
  if (gateway === 'sunize') return Boolean(config.apiKey && config.apiSecret);
  if (gateway === 'paradise') return Boolean(config.apiKey);
  if (gateway === 'atomopay') return Boolean(config.apiToken && config.offerHash && config.productHash);
  return false;
}

function gatewayCredentialState(gateway, config = {}, offer = null) {
  const requiredByGateway = {
    atomopay: ['apiToken', 'offerHash', 'productHash'],
    paradise: ['apiKey'],
    sunize: ['apiKey', 'apiSecret']
  };
  const recommendedByGateway = {
    atomopay: ['baseUrl'],
    paradise: ['productHash'],
    sunize: ['baseUrl']
  };
  const required = requiredByGateway[gateway] || [];
  const recommended = recommendedByGateway[gateway] || [];
  const missing = required.filter((field) => !toText(config[field], 1000));
  return {
    gateway,
    enabled: config.enabled !== false,
    ready: config.enabled !== false && missing.length === 0,
    required,
    recommended,
    missing,
    mode: 'real',
    webhookUrl: offer ? buildWebhookUrl(offer, gateway, config) : ''
  };
}

async function createPixForOffer(offer, body = {}, req = null) {
  if (offer.settings?.features?.pix === false) {
    return { ok: false, status: 403, error: 'pix_disabled' };
  }
  const order = body.strictGateway
    ? resolveStrictGatewayOrder(body.gateway || body.paymentGateway)
    : resolveGatewayOrder(offer, body.gateway || body.paymentGateway);
  const attempts = [];
  const amount = toAmount(body.amount || body.value || body.total);
  if (amount <= 0) return { ok: false, status: 400, error: 'invalid_amount' };
  if (!order.length) return { ok: false, status: 400, error: 'invalid_gateway' };
  const sessionId = pickText(body.sessionId, body.session_id, body.orderId) || id('session');
  const customer = normalizeCustomer(body.customer || body.personal || {});
  const idempotencyKey = pickText(body.idempotencyKey, body.orderId, `${offer.id}:${sessionId}:${amount}`);

  const existing = STORE.transactions.find((tx) =>
    tx.offerId === offer.id &&
    tx.idempotencyKey === idempotencyKey &&
    ['waiting_payment', 'pending'].includes(tx.status) &&
    Date.now() - Date.parse(tx.createdAt) < 48 * 60 * 60 * 1000
  );
  if (existing) {
    return { ok: true, transaction: existing, reused: true };
  }

  for (const gateway of order) {
    const config = asObject(offer.settings?.payments?.gateways?.[gateway]);
    if (config.enabled === false) {
      attempts.push({ gateway, ok: false, reason: 'disabled' });
      continue;
    }
    if (!gatewayHasCredentials(gateway, config)) {
      attempts.push({ gateway, ok: false, reason: 'missing_credentials' });
      continue;
    }
    try {
      const result = await callGatewayCreate(gateway, config, {
        ...body,
        amount,
        sessionId,
        customer,
        offer,
        req,
        webhookUrl: buildWebhookUrl(offer, gateway, config)
      });
      if (!result.ok) {
        attempts.push({ gateway, ok: false, reason: result.error || 'gateway_error', detail: result.detail || '' });
        continue;
      }
      const transaction = writeStore((store) => {
        const tx = {
          id: id('pix'),
          offerId: offer.id,
          sessionId,
          leadId: '',
          idempotencyKey,
          gateway,
          txid: result.txid,
          externalId: result.externalId || '',
          status: result.status || 'waiting_payment',
          statusRaw: result.statusRaw || result.status || 'waiting_payment',
          amount,
          paymentCode: result.paymentCode || '',
          paymentCodeBase64: result.paymentCodeBase64 || '',
          paymentQrUrl: result.paymentQrUrl || '',
          attempts,
          gatewayPayload: result.raw || {},
          requestPayload: sanitizeSecrets(body),
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        store.transactions.push(tx);
        return clone(tx);
      });
      const lead = upsertLead(offer, {
        ...body,
        sessionId,
        event: 'pix_created',
        stage: body.stage || 'pix',
        pixTxid: transaction.txid,
        pixAmount: amount,
        gateway,
        pix: {
          idTransaction: transaction.txid,
          amount,
          status: transaction.status,
          gateway,
          paymentCode: transaction.paymentCode,
          paymentCodeBase64: transaction.paymentCodeBase64,
          paymentQrUrl: transaction.paymentQrUrl
        }
      }, req);
      writeStore((store) => {
        const tx = store.transactions.find((item) => item.id === transaction.id);
        if (tx) tx.leadId = lead.id;
      });
      scheduleDispatches(offer, 'pix_created', { ...body, sessionId, lead, transaction, amount, gateway }, req);
      return { ok: true, transaction: { ...transaction, leadId: lead.id } };
    } catch (error) {
      attempts.push({ gateway, ok: false, reason: error.message || 'gateway_exception' });
    }
  }
  return { ok: false, status: 502, error: 'all_gateways_failed', attempts };
}

function normalizeCustomer(input = {}) {
  return {
    name: toText(input.name, 180) || 'Cliente',
    email: toText(input.email, 180) || `lead.${Date.now()}@leohub.local`,
    document: onlyDigits(input.document || input.cpf, 18) || '00000000000',
    phone: onlyDigits(input.phone || input.phoneDigits || input.phone_number, 24) || '11999999999'
  };
}

function buildWebhookUrl(offer, gateway, config = {}) {
  const token = toText(config.webhookToken, 200) || offer.privateKey;
  return `${BASE_URL}/api/v1/webhooks/${gateway}?offer_id=${encodeURIComponent(offer.id)}&token=${encodeURIComponent(token)}`;
}

function baseUrl(value, fallback) {
  return String(value || fallback).replace(/\/+$/, '');
}

function normalizePhoneE164(value = '') {
  const digits = onlyDigits(value, 20);
  if (!digits) return '+5511999999999';
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  return `+55${digits}`;
}

function extractIp(req = null) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').trim();
  if (forwarded) return forwarded.split(',')[0].trim();
  return String(req?.socket?.remoteAddress || '').trim();
}

function buildUtmFields(source = {}) {
  const raw = asObject(source.utm || source);
  const fields = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'src', 'sck', 'fbclid', 'gclid', 'ttclid']) {
    const value = pickText(raw[key], source[key]);
    if (value) fields[key] = value;
  }
  return fields;
}

function buildGatewayItems(config = {}, payload = {}) {
  const rawItems = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : [{ title: payload.title || payload.offer?.name || 'Oferta LEOHUB', price: payload.amount, quantity: 1 }];
  return rawItems.map((item) => ({
    id: toText(item.id || item.productId || item.productHash || config.productHash, 120),
    title: toText(item.title || item.name || payload.offer?.name || 'Oferta LEOHUB', 180),
    price: toAmount(item.price || item.amount || payload.amount),
    quantity: Math.max(1, Number(item.quantity || 1))
  }));
}

async function callGatewayCreate(gateway, config = {}, payload = {}) {
  if (gateway === 'atomopay') return createAtomopay(config, payload);
  if (gateway === 'sunize') return createSunize(config, payload);
  if (gateway === 'paradise') return createParadise(config, payload);
  return { ok: false, error: 'unsupported_gateway' };
}

async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1200, Number(timeoutMs || 0) || 12000));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_error) {
      data = { raw: text };
    }
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithRetry(url, options = {}, timeoutMs = 12000, attempts = 3) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await fetchJson(url, options, timeoutMs);
    if (last.response?.ok) return last;
    const status = Number(last.response?.status || 0);
    const retryable = status === 408 || status === 429 || status >= 500 || !status;
    if (!retryable || attempt === attempts - 1) return last;
    await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
  }
  return last || { response: { ok: false, status: 500 }, data: { error: 'request_failed' } };
}

async function hydratePixVisual(gateway, config = {}, txid = '') {
  const cleanTxid = toText(txid, 180);
  if (!cleanTxid) return null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const quickConfig = {
      ...config,
      timeoutMs: Math.max(1200, Math.min(Number(config.timeoutMs || 12000), attempt === 0 ? 3500 : 5000))
    };
    const status = await callGatewayStatus(gateway, quickConfig, { txid: cleanTxid }).catch(() => null);
    if (status?.ok && (status.paymentCode || status.paymentCodeBase64 || status.paymentQrUrl)) return status;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  return null;
}

async function createAtomopay(config, payload) {
  const url = new URL(`${baseUrl(config.baseUrl, 'https://api.atomopay.com.br/api/public/v1')}/transactions`);
  url.searchParams.set('api_token', config.apiToken);
  const amountCents = cents(payload.amount);
  const items = buildGatewayItems(config, payload);
  const body = {
    amount: amountCents,
    offer_hash: config.offerHash,
    payment_method: 'pix',
    customer: {
      name: payload.customer.name,
      email: payload.customer.email,
      phone_number: payload.customer.phone,
      document: payload.customer.document
    },
    cart: items.map((item) => ({
      product_hash: item.id || config.productHash,
      title: item.title,
      price: cents(item.price),
      quantity: item.quantity,
      operation_type: 1,
      tangible: false
    })),
    expire_in_days: Number(config.expireInDays || 2),
    transaction_origin: 'api',
    postback_url: payload.webhookUrl
  };
  if (payload.utm && Object.keys(payload.utm).length) body.tracking = payload.utm;
  const { response, data } = await fetchJsonWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, config.timeoutMs);
  if (!response.ok || data?.success === false) return { ok: false, error: 'atomopay_create_failed', detail: data };
  const normalized = normalizePixResponse('atomopay', data);
  if ((!normalized.ok && normalized.error === 'atomopay_missing_pix_visual') || (normalized.ok && !normalized.paymentCode && !normalized.paymentCodeBase64 && !normalized.paymentQrUrl)) {
    const hydrated = await hydratePixVisual('atomopay', config, normalized.txid);
    if (hydrated?.ok) return { ...normalized, ...hydrated, ok: true, raw: data };
  }
  return normalized;
}

async function createSunize(config, payload) {
  const amount = toAmount(payload.amount);
  const externalId = `${payload.sessionId || id('order')}-${Date.now()}`;
  const utmFields = buildUtmFields(payload);
  const items = buildGatewayItems(config, payload).map((item, index) => ({
    id: `${toText(item.id, 80) || 'item'}-${index + 1}`,
    title: item.title,
    description: item.title,
    price: Number(toAmount(item.price || amount).toFixed(2)),
    quantity: item.quantity,
    is_physical: false
  }));
  const baseBody = {
    external_id: externalId,
    total_amount: Number(amount.toFixed(2)),
    payment_method: 'PIX',
    items,
    ip: extractIp(payload.req),
    customer: {
      name: payload.customer.name,
      email: payload.customer.email,
      phone: normalizePhoneE164(payload.customer.phone),
      document_type: payload.customer.document.length > 11 ? 'CNPJ' : 'CPF',
      document: payload.customer.document
    }
  };
  const body = {
    ...baseBody,
    ...utmFields,
    metadata: {
      orderId: payload.sessionId,
      offerId: payload.offer.id,
      sessionId: payload.sessionId,
      ...utmFields
    },
    webhook_url: payload.webhookUrl
  };
  const endpoint = `${baseUrl(config.baseUrl, 'https://api.sunize.com.br/v1')}/transactions`;
  let { response, data } = await fetchJsonWithRetry(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-api-secret': config.apiSecret
    },
    body: JSON.stringify(body)
  }, config.timeoutMs);
  if (Number(response?.status || 0) === 400 && Object.keys(utmFields).length) {
    ({ response, data } = await fetchJsonWithRetry(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-api-secret': config.apiSecret
      },
      body: JSON.stringify({ ...baseBody, metadata: body.metadata, webhook_url: payload.webhookUrl })
    }, config.timeoutMs));
  }
  if (Number(response?.status || 0) === 400) {
    ({ response, data } = await fetchJsonWithRetry(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-api-secret': config.apiSecret
      },
      body: JSON.stringify(baseBody)
    }, config.timeoutMs));
  }
  if (!response.ok || data?.hasError === true) return { ok: false, error: 'sunize_create_failed', detail: data };
  const normalized = normalizePixResponse('sunize', data);
  if (normalized.ok && !normalized.externalId) normalized.externalId = externalId;
  if ((!normalized.ok && normalized.error === 'sunize_missing_pix_visual') || (normalized.ok && !normalized.paymentCode && !normalized.paymentCodeBase64 && !normalized.paymentQrUrl)) {
    const hydrated = await hydratePixVisual('sunize', config, normalized.txid);
    if (hydrated?.ok) return { ...normalized, ...hydrated, ok: true, externalId: normalized.externalId || externalId, raw: data };
  }
  return normalized;
}

async function createParadise(config, payload) {
  const source = toText(config.source, 80) || (config.productHash ? '' : 'api_externa');
  const externalId = `${payload.sessionId || id('order')}-${Date.now()}`;
  const body = {
    amount: cents(payload.amount),
    description: toText(config.description, 180) || payload.offer?.name || 'Oferta LEOHUB',
    reference: externalId,
    productHash: config.productHash || undefined,
    source: source || undefined,
    customer: {
      name: payload.customer.name,
      email: payload.customer.email,
      document: payload.customer.document,
      phone: payload.customer.phone
    },
    postback_url: payload.webhookUrl,
    tracking: {
      gateway: 'paradise',
      orderId: payload.sessionId,
      sessionId: payload.sessionId,
      ...buildUtmFields(payload)
    }
  };
  if (config.orderbumpHash && payload.orderbump) body.orderbump = config.orderbumpHash;
  const { response, data } = await fetchJsonWithRetry(`${baseUrl(config.baseUrl, 'https://multi.paradisepags.com')}/api/v1/transaction.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey
    },
    body: JSON.stringify(body)
  }, config.timeoutMs);
  if (!response.ok || data?.success === false || String(data?.status || '').toLowerCase() === 'error') {
    return { ok: false, error: 'paradise_create_failed', detail: data };
  }
  const normalized = normalizePixResponse('paradise', data);
  if (normalized.ok && !normalized.externalId) normalized.externalId = externalId;
  if ((!normalized.ok && normalized.error === 'paradise_missing_pix_visual') || (normalized.ok && !normalized.paymentCode && !normalized.paymentCodeBase64 && !normalized.paymentQrUrl)) {
    const hydrated = await hydratePixVisual('paradise', config, normalized.txid);
    if (hydrated?.ok) return { ...normalized, ...hydrated, ok: true, externalId: normalized.externalId || externalId, raw: data };
  }
  return normalized;
}

function normalizePixResponse(gateway, data = {}) {
  const root = asObject(data);
  const nested = asObject(root.data);
  const transaction = asObject(root.transaction || nested.transaction);
  const payment = asObject(root.payment || nested.payment);
  const pix = asObject(root.pix || nested.pix || transaction.pix || payment.pix);
  const source = Object.keys(nested).length ? nested : root;
  const txid = pickText(
    source.hash,
    source.transaction_hash,
    source.transactionHash,
    source.transaction_id,
    source.transactionId,
    source.id_transaction,
    source.idTransaction,
    source.payment_id,
    source.transaction_id,
    source.transactionId,
    source.id,
    transaction.hash,
    transaction.id,
    payment.id,
    pix.id,
    pix.txid
  );
  const paymentCode = pickText(
    source.pix_code,
    source.pixCode,
    source.pix_payload,
    source.pixPayload,
    source.copy_paste,
    source.copyPaste,
    source.qr_code,
    source.qrCode,
    source.paymentCode,
    pix.payload,
    pix.copyPaste,
    pix.copy_paste,
    pix.qrcodeText,
    pix.qrCodeText,
    pix.emv
  );
  const qrRaw = pickText(
    source.qr_code_base64,
    source.qrcode_base64,
    source.qrCodeBase64,
    source.pix_qr_code,
    source.pixQrCode,
    source.paymentCodeBase64,
    pix.qrcode,
    pix.qrCode,
    pix.qrcodeBase64,
    pix.qrCodeBase64,
    pix.image
  );
  const paymentQrUrl = /^https?:\/\//i.test(qrRaw) || qrRaw.startsWith('data:image') ? qrRaw : pickText(pix.qrcodeUrl, pix.qrCodeUrl, source.paymentQrUrl);
  const paymentCodeBase64 = paymentQrUrl ? '' : qrRaw;
  const statusRaw = pickGatewayPaymentStatus(root, nested, transaction, payment, pix) || 'waiting_payment';
  const externalId = pickText(source.external_id, source.externalId, source.reference, source.ref, transaction.external_id, transaction.externalId);
  if (!txid) return { ok: false, error: `${gateway}_missing_txid`, detail: data };
  if (!paymentCode && !paymentCodeBase64 && !paymentQrUrl) {
    return {
      ok: false,
      error: `${gateway}_missing_pix_visual`,
      txid,
      externalId,
      status: mapPaymentStatus(statusRaw),
      statusRaw,
      raw: data,
      detail: data
    };
  }
  return {
    ok: true,
    txid,
    externalId,
    status: mapPaymentStatus(statusRaw),
    statusRaw,
    paymentCode,
    paymentCodeBase64,
    paymentQrUrl,
    raw: data
  };
}

function pickGatewayPaymentStatus(root = {}, nested = {}, transaction = {}, payment = {}, pix = {}) {
  const candidates = [
    transaction.status,
    transaction.raw_status,
    transaction.rawStatus,
    payment.status,
    payment.raw_status,
    payment.rawStatus,
    pix.status,
    nested.payment_status,
    nested.paymentStatus,
    nested.transaction_status,
    nested.transactionStatus,
    nested.raw_status,
    nested.rawStatus,
    nested.status,
    root.payment_status,
    root.paymentStatus,
    root.transaction_status,
    root.transactionStatus,
    root.raw_status,
    root.rawStatus,
    root.status
  ];
  for (const candidate of candidates) {
    const text = toText(candidate, 80);
    if (!text) continue;
    const normalized = normalizeStatus(text);
    if ((normalized === 'success' || normalized === 'ok') && (root.success === true || nested.success === true)) continue;
    return text;
  }
  return '';
}

function mapPaymentStatus(statusRaw = '') {
  const status = normalizeStatus(statusRaw);
  if (/paid|approved|authorized|confirm|complete|success|payment_approved/.test(status)) return 'paid';
  if (/refund|refunded/.test(status)) return 'refunded';
  if (/chargeback|chargedback/.test(status)) return 'chargedback';
  if (/refus|fail|cancel|expired|denied|canceled|cancelled/.test(status)) return 'refused';
  return 'waiting_payment';
}

function isTerminalPaymentStatus(status = '') {
  return ['paid', 'refunded', 'refused', 'chargedback'].includes(String(status || ''));
}

async function callGatewayStatus(gateway, config = {}, tx = {}) {
  const txid = pickText(tx.txid, tx.externalId);
  if (!txid) return { ok: false, error: 'missing_txid' };
  if (gateway === 'atomopay') {
    const url = new URL(`${baseUrl(config.baseUrl, 'https://api.atomopay.com.br/api/public/v1')}/transactions/${encodeURIComponent(txid)}`);
    url.searchParams.set('api_token', config.apiToken);
    const { response, data } = await fetchJsonWithRetry(url.toString(), { method: 'GET' }, config.timeoutMs);
    if (!response.ok || data?.success === false) return { ok: false, error: 'atomopay_status_failed', detail: data };
    return normalizeStatusResponse(gateway, data);
  }
  if (gateway === 'sunize') {
    const { response, data } = await fetchJsonWithRetry(`${baseUrl(config.baseUrl, 'https://api.sunize.com.br/v1')}/transactions/${encodeURIComponent(txid)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-api-secret': config.apiSecret
      }
    }, config.timeoutMs);
    if (!response.ok) return { ok: false, error: 'sunize_status_failed', detail: data };
    return normalizeStatusResponse(gateway, data);
  }
  if (gateway === 'paradise') {
    const url = new URL(`${baseUrl(config.baseUrl, 'https://multi.paradisepags.com')}/api/v1/query.php`);
    url.searchParams.set('action', 'get_transaction');
    url.searchParams.set('id', txid);
    let { response, data } = await fetchJsonWithRetry(url.toString(), {
      method: 'GET',
      headers: { 'X-API-Key': config.apiKey }
    }, config.timeoutMs);
    if ((!response.ok || data?.success === false || String(data?.status || '').toLowerCase() === 'error') && tx.externalId) {
      const byReferenceUrl = new URL(`${baseUrl(config.baseUrl, 'https://multi.paradisepags.com')}/api/v1/query.php`);
      byReferenceUrl.searchParams.set('action', 'list_transactions');
      byReferenceUrl.searchParams.set('external_id', tx.externalId);
      const byReference = await fetchJsonWithRetry(byReferenceUrl.toString(), {
        method: 'GET',
        headers: { 'X-API-Key': config.apiKey }
      }, config.timeoutMs).catch(() => null);
      if (byReference?.response?.ok && byReference.data?.success !== false) {
        response = byReference.response;
        data = byReference.data;
      }
    }
    if (!response.ok || data?.success === false || String(data?.status || '').toLowerCase() === 'error') {
      return { ok: false, error: 'paradise_status_failed', detail: data };
    }
    return normalizeStatusResponse(gateway, data);
  }
  return { ok: false, error: 'unsupported_gateway' };
}

function normalizeStatusResponse(gateway, data = {}) {
  const root = asObject(data);
  const nested = asObject(root.data);
  const transaction = asObject(root.transaction || nested.transaction);
  const payment = asObject(root.payment || nested.payment);
  const pix = asObject(root.pix || nested.pix || transaction.pix || payment.pix);
  const source = Object.keys(nested).length ? nested : root;
  const statusRaw = pickGatewayPaymentStatus(root, nested, transaction, payment, pix) || 'waiting_payment';
  const pixNormalized = normalizePixResponse(gateway, data);
  return {
    ok: true,
    txid: pickText(pixNormalized.txid, source.hash, source.transaction_id, source.id, transaction.id),
    externalId: pickText(pixNormalized.externalId, source.external_id, source.externalId, source.reference),
    status: mapPaymentStatus(statusRaw),
    statusRaw,
    paymentCode: pixNormalized.ok ? pixNormalized.paymentCode : '',
    paymentCodeBase64: pixNormalized.ok ? pixNormalized.paymentCodeBase64 : '',
    paymentQrUrl: pixNormalized.ok ? pixNormalized.paymentQrUrl : '',
    raw: data
  };
}

function toUtmifyDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return toUtmifyDate();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function buildTrackingParameters(...sources) {
  const out = {};
  const keys = ['src', 'sck', 'utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid'];
  for (const source of sources) {
    const obj = asObject(source);
    for (const key of keys) {
      if (!out[key] && obj[key]) out[key] = toText(obj[key], 500);
    }
  }
  for (const key of keys) {
    if (!out[key]) out[key] = null;
  }
  return out;
}

function sanitizeSecrets(value) {
  const copy = clone(value || {});
  const redact = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (/token|secret|password|authorization|apikey|api_key/i.test(key)) obj[key] = '__SECRET__';
      else redact(obj[key]);
    }
  };
  redact(copy);
  return copy;
}

async function getPixStatus(offer, body = {}, req = null) {
  const txid = pickText(body.txid, body.idTransaction, body.transactionId);
  const transaction = STORE.transactions.find((item) => item.offerId === offer.id && (item.txid === txid || item.id === txid));
  if (!transaction) return { ok: false, status: 404, error: 'transaction_not_found' };
  if (isTerminalPaymentStatus(transaction.status)) return { ok: true, transaction };
  const config = asObject(offer.settings?.payments?.gateways?.[transaction.gateway]);
  if (gatewayHasCredentials(transaction.gateway, config)) {
    const remote = await callGatewayStatus(transaction.gateway, config, transaction).catch((error) => ({
      ok: false,
      error: error?.message || 'gateway_status_error'
    }));
    if (remote?.ok) {
      const previousStatus = transaction.status;
      let updated = null;
      writeStore((store) => {
        const tx = store.transactions.find((item) => item.id === transaction.id);
        if (!tx) return;
        tx.status = remote.status || tx.status;
        tx.statusRaw = remote.statusRaw || tx.statusRaw;
        if (remote.paymentCode) tx.paymentCode = remote.paymentCode;
        if (remote.paymentCodeBase64) tx.paymentCodeBase64 = remote.paymentCodeBase64;
        if (remote.paymentQrUrl) tx.paymentQrUrl = remote.paymentQrUrl;
        tx.statusPayload = remote.raw || {};
        tx.updatedAt = nowIso();
        updated = clone(tx);
      });
      if (updated && updated.status !== previousStatus) {
        applyPaymentSideEffects(offer, updated, updated.gateway, remote.raw || {}, req);
      }
      return { ok: true, transaction: updated || transaction, remoteChecked: true };
    }
    return { ok: true, transaction, remoteChecked: false, remoteError: remote.error || 'gateway_status_failed' };
  }
  return { ok: true, transaction };
}

async function reconcileOfferPix(offer, limit = 100, req = null) {
  const rows = STORE.transactions
    .filter((tx) => tx.offerId === offer.id && !isTerminalPaymentStatus(tx.status))
    .slice(-Math.max(1, Math.min(Number(limit) || 100, 300)))
    .reverse();
  const summary = { checked: 0, updated: 0, confirmed: 0, pending: 0, refunded: 0, refused: 0, failed: 0, results: [] };
  for (const tx of rows) {
    summary.checked += 1;
    const previous = tx.status;
    const result = await getPixStatus(offer, { idTransaction: tx.txid || tx.id }, req).catch((error) => ({
      ok: false,
      error: error?.message || 'status_error'
    }));
    const current = result.transaction || STORE.transactions.find((item) => item.id === tx.id) || tx;
    if (!result.ok || result.remoteError) summary.failed += 1;
    if (current.status !== previous) summary.updated += 1;
    if (current.status === 'paid') summary.confirmed += 1;
    else if (current.status === 'refunded') summary.refunded += 1;
    else if (current.status === 'refused' || current.status === 'chargedback') summary.refused += 1;
    else summary.pending += 1;
    summary.results.push({
      id: current.id,
      txid: current.txid,
      gateway: current.gateway,
      previousStatus: previous,
      status: current.status,
      remoteChecked: Boolean(result.remoteChecked),
      remoteError: result.remoteError || result.error || ''
    });
  }
  return summary;
}

function paymentEventForStatus(status = '') {
  if (status === 'paid') return 'pix_confirmed';
  if (status === 'refunded') return 'pix_refunded';
  if (status === 'refused') return 'pix_refused';
  if (status === 'chargedback') return 'pix_chargeback';
  return 'pix_pending';
}

function applyPaymentSideEffects(offer, transaction, gateway, rawPayload = {}, req = null) {
  const status = transaction.status || 'waiting_payment';
  const lead = STORE.leads.find((item) => item.id === transaction.leadId || (item.offerId === offer.id && item.sessionId === transaction.sessionId));
  if (lead) {
    upsertLead(offer, {
      sessionId: lead.sessionId,
      event: paymentEventForStatus(status),
      stage: 'pix',
      pixTxid: transaction.txid,
      pixAmount: transaction.amount,
      gateway,
      pix: {
        idTransaction: transaction.txid,
        amount: transaction.amount,
        status,
        statusRaw: transaction.statusRaw,
        gateway
      }
    }, req);
  }
  if (status === 'paid') {
    scheduleDispatches(offer, 'pix_confirmed', { transaction, lead, gateway, amount: transaction.amount, statusChangedAt: transaction.updatedAt }, req);
  } else if (status === 'refunded') {
    scheduleDispatches(offer, 'pix_refunded', { transaction, lead, gateway, amount: transaction.amount, statusChangedAt: transaction.updatedAt }, req);
  } else if (status === 'refused' || status === 'chargedback') {
    scheduleDispatches(offer, 'pix_refused', { transaction, lead, gateway, amount: transaction.amount, statusChangedAt: transaction.updatedAt, rawPayload }, req);
  }
}

function updateTransactionStatus(offer, gateway, rawBody = {}, query = {}, req = null) {
  const txid = extractWebhookTxid(gateway, rawBody);
  const statusRaw = extractWebhookStatus(gateway, rawBody);
  const status = mapPaymentStatus(statusRaw);
  const signature = `${gateway}:${txid}:${normalizeStatus(statusRaw)}`;
  const duplicate = STORE.webhooks.some((item) => item.offerId === offer.id && item.signature === signature);
  const webhook = {
    id: id('wh'),
    offerId: offer.id,
    gateway,
    txid,
    status,
    statusRaw,
    signature,
    duplicate,
    query,
    payload: rawBody,
    createdAt: nowIso()
  };
  let transaction = null;
  writeStore((store) => {
    store.webhooks.push(webhook);
    if (duplicate) return;
    transaction = store.transactions.find((item) => item.offerId === offer.id && (item.txid === txid || item.externalId === txid));
    if (transaction) {
      transaction.status = status;
      transaction.statusRaw = statusRaw;
      transaction.webhookPayload = rawBody;
      transaction.updatedAt = nowIso();
    }
  });
  if (transaction) {
    applyPaymentSideEffects(offer, transaction, gateway, rawBody, req);
  }
  return { webhook, transaction };
}

function extractWebhookTxid(gateway, body = {}) {
  if (gateway === 'atomopay') {
    return pickText(body.hash, body.transaction_hash, body.transactionHash, body.data?.hash, body.data?.transaction_hash, body.transaction?.hash, body.payment?.hash);
  }
  if (gateway === 'sunize') {
    return pickText(body.id, body.transaction_id, body.transactionId, body.data?.id, body.transaction?.id, body.external_id, body.externalId);
  }
  if (gateway === 'paradise') {
    return pickText(body.transaction_id, body.transactionId, body.id, body.data?.transaction_id, body.data?.id, body.external_id, body.externalId, body.reference);
  }
  return pickText(body.id, body.transactionId, body.transaction_id, body.data?.id, body.objectId);
}

function extractWebhookStatus(gateway, body = {}) {
  return pickText(body.status, body.raw_status, body.rawStatus, body.data?.status, body.transaction?.status, body.payment?.status, body.event) || 'waiting_payment';
}

function scheduleDispatches(offer, eventName, payload = {}, req = null) {
  if (offer.settings?.features?.dispatch === false) return;
  const jobs = [];
  if (shouldSendUtmify(offer, eventName)) {
    const txid = pickText(payload.transaction?.txid, payload.txid, payload.lead?.pixTxid, payload.sessionId);
    jobs.push({
      id: id('job'),
      offerId: offer.id,
      channel: 'utmify',
      eventName,
      dedupeKey: `utmify:${offer.id}:${eventName}:${txid || id('event')}`,
      status: 'pending',
      payload: buildUtmifyPayload(offer, eventName, payload),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  if (shouldSendPushcut(offer, eventName)) {
    const txid = pickText(payload.transaction?.txid, payload.txid, payload.lead?.pixTxid, payload.sessionId);
    jobs.push({
      id: id('job'),
      offerId: offer.id,
      channel: 'pushcut',
      eventName,
      dedupeKey: `pushcut:${offer.id}:${eventName}:${txid || id('event')}`,
      status: 'pending',
      payload: buildPushcutPayload(offer, eventName, payload),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  if (shouldSendMeta(offer, eventName)) {
    const txid = pickText(payload.transaction?.txid, payload.txid, payload.lead?.pixTxid, payload.sessionId);
    jobs.push({
      id: id('job'),
      offerId: offer.id,
      channel: 'meta',
      eventName,
      dedupeKey: `meta:${offer.id}:${eventName}:${txid || payload.eventId || payload.lead?.sessionId || id('event')}`,
      status: 'pending',
      payload: buildMetaPayload(offer, eventName, payload, req),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  if (!jobs.length) return;
  const filtered = jobs.filter((job) => !job.dedupeKey || !STORE.dispatches.some((item) => item.dedupeKey === job.dedupeKey));
  if (!filtered.length) return;
  writeStore((store) => {
    store.dispatches.push(...filtered);
  });
  processDispatchQueue().catch(() => null);
}

function shouldSendUtmify(offer, eventName) {
  const cfg = offer.settings?.utmify || {};
  if (!cfg.enabled) return false;
  if (eventName === 'pix_created') return cfg.sendPixCreated !== false;
  if (eventName === 'pix_confirmed' || eventName === 'purchase') return cfg.sendPixConfirmed !== false;
  if (eventName === 'pix_refunded' || eventName === 'pix_refused') return cfg.sendRefunds !== false;
  return false;
}

function shouldSendPushcut(offer, eventName) {
  const push = offer.settings?.pushcut || {};
  if (!push.enabled) return false;
  if (eventName === 'pix_created') return Boolean(push.pixCreatedUrl || (push.apiKey && push.pixCreatedNotification));
  if (eventName === 'pix_confirmed') return Boolean(push.pixConfirmedUrl || (push.apiKey && push.pixConfirmedNotification));
  return false;
}

function shouldSendMeta(offer, eventName) {
  const meta = offer.settings?.meta || {};
  if (!meta.enabled || !meta.pixelId || !meta.accessToken) return false;
  if (eventName === 'page_view') return meta.events?.page_view !== false;
  if (eventName === 'lead') return meta.events?.lead !== false;
  if (eventName === 'pix_created') return meta.events?.checkout !== false;
  if (eventName === 'pix_confirmed' || eventName === 'purchase') return meta.events?.purchase !== false;
  return false;
}

function buildUtmifyPayload(offer, eventName, payload = {}) {
  const tx = payload.transaction || {};
  const lead = payload.lead || {};
  const personal = asObject(lead.payload?.personal || lead.payload?.customer || payload.customer || {});
  const shipping = asObject(lead.payload?.shipping || payload.shipping);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const amount = toAmount(payload.amount || tx.amount || lead.pixAmount || 0);
  const status = eventName === 'pix_confirmed' || eventName === 'purchase'
    ? 'paid'
    : eventName === 'pix_refunded'
      ? 'refunded'
      : eventName === 'pix_refused'
        ? 'refused'
        : 'waiting_payment';
  return {
    orderId: tx.txid || payload.txid || lead.pixTxid || payload.sessionId,
    platform: offer.settings?.utmify?.platform || 'LEOHUB',
    paymentMethod: 'pix',
    status,
    createdAt: toUtmifyDate(tx.createdAt || lead.createdAt),
    approvedDate: status === 'paid' ? toUtmifyDate(tx.updatedAt || payload.statusChangedAt) : null,
    refundedAt: status === 'refunded' ? toUtmifyDate(tx.updatedAt || payload.statusChangedAt) : null,
    customer: {
      name: personal.name || lead.name || 'Cliente',
      email: personal.email || lead.email || `lead.${onlyDigits(lead.sessionId || tx.txid || Date.now(), 16)}@leohub.local`,
      phone: personal.phone || personal.phoneDigits || lead.phone || null,
      document: personal.document || personal.cpf || lead.document || null,
      country: 'BR',
      ip: lead.clientIp || payload.clientIp || null
    },
    trackingParameters: buildTrackingParameters(lead.utm, payload.utm, lead.payload?.utm, payload.trackingParameters),
    products: items.length ? items.map((item, index) => ({
      id: item.id || item.productHash || `${offer.slug}_${index + 1}`,
      name: item.title || item.name || offer.name,
      planId: offer.id,
      planName: offer.name,
      quantity: Number(item.quantity || 1),
      priceInCents: cents(item.price || item.amount || amount)
    })) : [
      {
        id: offer.slug,
        name: shipping.name || offer.name,
        planId: offer.id,
        planName: offer.name,
        quantity: 1,
        priceInCents: cents(amount)
      }
    ],
    commission: {
      totalPriceInCents: cents(amount),
      gatewayFeeInCents: 0,
      userCommissionInCents: cents(amount)
    }
  };
}

function buildPushcutPayload(offer, eventName, payload = {}) {
  const tx = payload.transaction || {};
  const lead = payload.lead || {};
  const amount = toAmount(payload.amount || tx.amount || 0);
  return {
    title: eventName === 'pix_confirmed' ? `PIX pago - ${offer.name}` : `PIX gerado - ${offer.name}`,
    text: `${lead.name || 'Lead'} | ${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} | ${tx.gateway || payload.gateway || ''}`,
    input: {
      offerId: offer.id,
      offerName: offer.name,
      txid: tx.txid || payload.txid || '',
      amount,
      name: lead.name || lead.email || 'Lead',
      gateway: tx.gateway || payload.gateway || '',
      eventName
    }
  };
}

function templateText(template = '', data = {}) {
  return String(template || '').replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, (_all, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function buildMetaPayload(offer, eventName, payload = {}, req = null) {
  const tx = payload.transaction || {};
  const lead = payload.lead || {};
  const metaEvent = eventName === 'page_view'
    ? 'PageView'
    : eventName === 'pix_confirmed' || eventName === 'purchase'
      ? 'Purchase'
      : eventName === 'pix_created'
        ? 'InitiateCheckout'
        : 'Lead';
  return {
    event_name: metaEvent,
    event_time: Math.floor(Date.now() / 1000),
    event_id: tx.txid || payload.eventId || `${eventName}_${lead.sessionId || id('evt')}`,
    action_source: 'website',
    event_source_url: payload.sourceUrl || lead.sourceUrl || '',
    user_data: {
      client_ip_address: clientIp(req),
      client_user_agent: toText(req?.headers?.['user-agent'], 500),
      em: lead.email ? [sha256(lead.email.toLowerCase())] : undefined,
      ph: lead.phone ? [sha256(lead.phone)] : undefined,
      external_id: lead.sessionId ? [sha256(lead.sessionId)] : undefined
    },
    custom_data: {
      currency: 'BRL',
      value: toAmount(payload.amount || tx.amount || lead.pixAmount || 0),
      order_id: tx.txid || lead.pixTxid || lead.sessionId,
      content_name: offer.name
    }
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function processDispatchQueue() {
  const pending = STORE.dispatches.filter((job) => job.status === 'pending').slice(0, 20);
  for (const job of pending) {
    try {
      const offer = findOfferById(job.offerId);
      let result = { ok: true, skipped: true };
      if (job.channel === 'utmify') result = await sendUtmify(offer, job.payload);
      if (job.channel === 'pushcut') result = await sendPushcut(offer, job.eventName, job.payload);
      if (job.channel === 'meta') result = await sendMeta(offer, job.payload);
      writeStore((store) => {
        const current = store.dispatches.find((item) => item.id === job.id);
        if (!current) return;
        current.status = result.ok ? 'done' : 'failed';
        current.result = sanitizeSecrets(result);
        current.updatedAt = nowIso();
        current.processedAt = nowIso();
      });
    } catch (error) {
      writeStore((store) => {
        const current = store.dispatches.find((item) => item.id === job.id);
        if (!current) return;
        current.status = 'failed';
        current.result = { ok: false, error: error.message || 'dispatch_error' };
        current.updatedAt = nowIso();
      });
    }
  }
}

function queueOfferDispatches(offer, body = {}, req = null) {
  const eventName = toText(body.eventName || body.event || 'pix_confirmed', 80);
  const transaction = STORE.transactions.find((tx) =>
    tx.offerId === offer.id &&
    (tx.id === body.transactionId || tx.txid === body.txid || tx.sessionId === body.sessionId)
  ) || {};
  const lead = transaction.leadId
    ? findLeadForOffer(offer.id, transaction.leadId)
    : findLeadForOffer(offer.id, body.leadId || body.sessionId || transaction.sessionId);
  scheduleDispatches(offer, eventName, {
    ...body,
    transaction,
    lead,
    amount: toAmount(body.amount || transaction.amount || lead?.pixAmount || 0),
    gateway: transaction.gateway || body.gateway || ''
  }, req);
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\r\n;]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function leadsToCsv(rows = []) {
  const headers = [
    'id', 'sessionId', 'name', 'email', 'phone', 'document', 'stage', 'lastEvent',
    'pixTxid', 'pixAmount', 'utm_source', 'utm_campaign', 'utm_medium', 'utm_content',
    'city', 'state', 'createdAt', 'updatedAt'
  ];
  const lines = [headers.join(';')];
  for (const lead of rows) {
    const payload = asObject(lead.payload);
    const customer = asObject(payload.customer || payload.personal);
    const address = asObject(payload.address || payload.shipping);
    const utm = asObject(lead.utm || payload.utm);
    const values = [
      lead.id,
      lead.sessionId,
      lead.name || customer.name,
      lead.email || customer.email,
      lead.phone || customer.phone,
      lead.document || customer.document || customer.cpf,
      lead.stage,
      lead.lastEvent,
      lead.pixTxid || payload.pix?.idTransaction,
      lead.pixAmount || payload.pix?.amount,
      utm.utm_source || utm.src,
      utm.utm_campaign,
      utm.utm_medium,
      utm.utm_content,
      address.city,
      address.state,
      lead.createdAt,
      lead.updatedAt
    ];
    lines.push(values.map(csvEscape).join(';'));
  }
  return lines.join('\r\n');
}

async function sendUtmify(offer, payload) {
  const cfg = offer?.settings?.utmify || {};
  if (!cfg.enabled || !cfg.endpoint || !cfg.apiKey) return { ok: true, skipped: true, reason: 'utmify_disabled' };
  const { response, data } = await fetchJson(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-token': cfg.apiKey
    },
    body: JSON.stringify(payload)
  }, 12000);
  return response.ok ? { ok: true, data } : { ok: false, status: response.status, data };
}

async function sendPushcut(offer, eventName, payload) {
  const cfg = offer?.settings?.pushcut || {};
  if (!cfg.enabled) return { ok: true, skipped: true, reason: 'pushcut_disabled' };
  const isPaid = eventName === 'pix_confirmed';
  const url = isPaid ? cfg.pixConfirmedUrl : cfg.pixCreatedUrl;
  const notification = isPaid ? cfg.pixConfirmedNotification : cfg.pixCreatedNotification;
  const apiKey = toText(cfg.apiKey, 500);
  const dataMap = {
    offerName: offer?.name || '',
    amount: Number(payload?.input?.amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    name: payload?.input?.name || '',
    gateway: payload?.input?.gateway || '',
    txid: payload?.input?.txid || ''
  };
  const templates = cfg.templates || {};
  const body = {
    ...payload,
    title: templateText(isPaid ? templates.pixConfirmedTitle : templates.pixCreatedTitle, dataMap) || payload.title,
    text: templateText(isPaid ? templates.pixConfirmedMessage : templates.pixCreatedMessage, dataMap) || payload.text
  };
  if (apiKey && notification) {
    const endpoint = `https://api.pushcut.io/v1/notifications/${encodeURIComponent(notification)}`;
    const { response, data } = await fetchJson(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-Key': apiKey
      },
      body: JSON.stringify({
        title: body.title,
        text: body.text,
        input: body.input || payload
      })
    }, 10000);
    return response.ok ? { ok: true, data } : { ok: false, status: response.status, data };
  }
  if (!url) return { ok: true, skipped: true, reason: 'pushcut_missing_target' };
  const { response, data } = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, 10000);
  return response.ok ? { ok: true, data } : { ok: false, status: response.status, data };
}

async function sendMeta(offer, payload) {
  const cfg = offer?.settings?.meta || {};
  if (!cfg.enabled || !cfg.pixelId || !cfg.accessToken) return { ok: true, skipped: true, reason: 'meta_disabled' };
  const url = new URL(`https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.pixelId)}/events`);
  url.searchParams.set('access_token', cfg.accessToken);
  const body = {
    data: [payload]
  };
  if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;
  const { response, data } = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, 12000);
  return response.ok ? { ok: true, data } : { ok: false, status: response.status, data };
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  if (pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      name: 'LEOHUB',
      time: nowIso(),
      offers: STORE.offers.length
    });
    return;
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readJson(req);
    if (String(body.password || '') !== ADMIN_PASSWORD) {
      sendJson(res, 401, { ok: false, error: 'invalid_password' });
      return;
    }
    const session = {
      token: randomToken('lh_session'),
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    };
    writeStore((store) => {
      store.meta.sessions = [...(store.meta.sessions || []).filter((item) => Date.parse(item.expiresAt) > Date.now()).slice(-10), session];
    });
    sendJson(res, 200, { ok: true, token: session.token, expiresAt: session.expiresAt });
    return;
  }
  if (pathname === '/api/admin/bootstrap' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, {
      ok: true,
      baseUrl: BASE_URL,
      defaultPassword: ADMIN_PASSWORD === 'admin',
      users: STORE.users.map(publicUser),
      offers: STORE.offers.map(adminOffer),
      stats: buildGlobalStats(),
      recentEvents: STORE.events.slice(-20).reverse(),
      recentTransactions: STORE.transactions.slice(-20).reverse()
    });
    return;
  }
  if (pathname === '/api/admin/offers' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { ok: true, offers: STORE.offers.map(adminOffer) });
    return;
  }
  if (pathname === '/api/admin/users' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { ok: true, users: STORE.users.map(publicUser) });
    return;
  }
  if (pathname === '/api/admin/users' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    const incoming = normalizeUserInput(body);
    if (!incoming.email) return sendJson(res, 400, { ok: false, error: 'missing_email' });
    if (STORE.users.some((user) => String(user.email || '').toLowerCase() === incoming.email)) {
      return sendJson(res, 409, { ok: false, error: 'email_already_exists' });
    }
    writeStore((store) => {
      store.users.push(incoming);
    });
    sendJson(res, 201, { ok: true, user: publicUser(incoming) });
    return;
  }
  const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && req.method === 'PATCH') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    let updated = null;
    writeStore((store) => {
      const index = store.users.findIndex((user) => user.id === decodeURIComponent(userMatch[1]));
      if (index < 0) return;
      updated = normalizeUserInput(body, store.users[index]);
      store.users[index] = updated;
    });
    if (!updated) return sendJson(res, 404, { ok: false, error: 'user_not_found' });
    sendJson(res, 200, { ok: true, user: publicUser(updated) });
    return;
  }
  if (pathname === '/api/admin/offers' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    const offer = normalizeOfferInput(body);
    writeStore((store) => {
      store.offers.push(offer);
    });
    sendJson(res, 201, { ok: true, offer: adminOffer(offer) });
    return;
  }
  const offerMatch = pathname.match(/^\/api\/admin\/offers\/([^/]+)$/);
  if (offerMatch && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const offer = findOfferById(decodeURIComponent(offerMatch[1]));
    if (!offer) return sendJson(res, 404, { ok: false, error: 'offer_not_found' });
    sendJson(res, 200, { ok: true, offer: adminOffer(offer) });
    return;
  }
  if (offerMatch && req.method === 'PATCH') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    let updated = null;
    writeStore((store) => {
      const index = store.offers.findIndex((item) => item.id === decodeURIComponent(offerMatch[1]) || item.slug === decodeURIComponent(offerMatch[1]));
      if (index < 0) return;
      updated = normalizeOfferInput(body, store.offers[index]);
      store.offers[index] = updated;
    });
    if (!updated) return sendJson(res, 404, { ok: false, error: 'offer_not_found' });
    sendJson(res, 200, { ok: true, offer: adminOffer(updated) });
    return;
  }
  const rotateMatch = pathname.match(/^\/api\/admin\/offers\/([^/]+)\/rotate-key$/);
  if (rotateMatch && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    let updated = null;
    writeStore((store) => {
      const offer = store.offers.find((item) => item.id === decodeURIComponent(rotateMatch[1]) || item.slug === decodeURIComponent(rotateMatch[1]));
      if (!offer) return;
      offer.publicKey = randomToken('lh_pub');
      offer.privateKey = randomToken('lh_sec');
      offer.updatedAt = nowIso();
      updated = offer;
    });
    if (!updated) return sendJson(res, 404, { ok: false, error: 'offer_not_found' });
    sendJson(res, 200, { ok: true, offer: adminOffer(updated) });
    return;
  }
  const collectionMatch = pathname.match(/^\/api\/admin\/offers\/([^/]+)\/(leads|events|pageviews|transactions|dispatches|webhooks)$/);
  if (collectionMatch && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const offer = findOfferById(decodeURIComponent(collectionMatch[1]));
    if (!offer) return sendJson(res, 404, { ok: false, error: 'offer_not_found' });
    const collection = collectionMatch[2];
    let rows = STORE[collection].filter((item) => item.offerId === offer.id);
    const q = normalizeStatus(req.query.q || '');
    if (collection === 'leads' && q) {
      rows = rows.filter((item) => normalizeStatus(JSON.stringify(item)).includes(q));
    }
    rows = rows.slice(-Number(req.query.limit || 300)).reverse();
    sendJson(res, 200, { ok: true, data: rows });
    return;
  }
  const leadExportMatch = pathname.match(/^\/api\/admin\/offers\/([^/]+)\/leads\/export$/);
  if (leadExportMatch && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const offer = findOfferById(decodeURIComponent(leadExportMatch[1]));
    if (!offer) return sendJson(res, 404, { ok: false, error: 'offer_not_found' });
    let rows = STORE.leads.filter((item) => item.offerId === offer.id);
    const q = normalizeStatus(req.query.q || '');
    if (q) rows = rows.filter((item) => normalizeStatus(JSON.stringify(item)).includes(q));
    const csv = leadsToCsv(rows);
    sendText(res, 200, csv, 'text/csv; charset=utf-8');
    return;
  }
  const leadDetailMatch = pathname.match(/^\/api\/admin\/offers\/([^/]+)\/leads\/([^/]+)$/);
  if (leadDetailMatch && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const offer = findOfferById(decodeURIComponent(leadDetailMatch[1]));
    if (!offer) return sendJson(res, 404, { ok: false, error: 'offer_not_found' });
    const lead = findLeadForOffer(offer.id, decodeURIComponent(leadDetailMatch[2]));
    if (!lead) return sendJson(res, 404, { ok: false, error: 'lead_not_found' });
    const transactions = STORE.transactions.filter((tx) => tx.offerId === offer.id && (tx.leadId === lead.id || tx.sessionId === lead.sessionId));
    const events = STORE.events.filter((event) => event.offerId === offer.id && event.sessionId === lead.sessionId).slice(-100).reverse();
    const pageviews = STORE.pageviews.filter((pageview) => pageview.offerId === offer.id && pageview.sessionId === lead.sessionId).slice(-100).reverse();
    sendJson(res, 200, { ok: true, lead, transactions, events, pageviews });
    return;
  }
  const gatewayTestMatch = pathname.match(/^\/api\/admin\/offers\/([^/]+)\/gateway-test-pix$/);
  if (gatewayTestMatch && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const offer = findOfferById(decodeURIComponent(gatewayTestMatch[1]));
    if (!offer) return sendJson(res, 404, { ok: false, error: 'offer_not_found' });
    const body = await readJson(req).catch(() => ({}));
    const selected = Array.isArray(body.gateways) && body.gateways.length
      ? body.gateways.map((item) => normalizeStatus(item)).filter((item) => GATEWAYS.includes(item))
      : resolveGatewayOrder(offer, body.gateway);
    const results = [];
    for (const gateway of selected) {
      const result = await createPixForOffer(offer, {
        ...body,
        gateway,
        strictGateway: true,
        amount: toAmount(body.amount || 1.99),
        sessionId: `admin_test_${gateway}_${Date.now()}`,
        customer: {
          name: body.customer?.name || 'Teste LEOHUB',
          email: body.customer?.email || 'teste@leohub.local',
          document: body.customer?.document || '12345678909',
          phone: body.customer?.phone || '11999999999'
        },
        utm: { utm_source: 'admin_gateway_test', ...(body.utm || {}) }
      }, req).catch((error) => ({ ok: false, error: error?.message || 'gateway_test_error' }));
      results.push({ gateway, ...sanitizeSecrets(result) });
    }
    sendJson(res, 200, {
      ok: results.some((item) => item.ok),
      amount: toAmount(body.amount || 1.99),
      checked: selected,
      results
    });
    return;
  }
  const gatewayHealthMatch = pathname.match(/^\/api\/admin\/offers\/([^/]+)\/gateway-health$/);
  if (gatewayHealthMatch && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const offer = findOfferById(decodeURIComponent(gatewayHealthMatch[1]));
    if (!offer) return sendJson(res, 404, { ok: false, error: 'offer_not_found' });
    const payments = asObject(offer.settings?.payments);
    const order = resolveGatewayOrder(offer);
    const stats = {};
    for (const gateway of GATEWAYS) {
      const rows = STORE.transactions.filter((tx) => tx.offerId === offer.id && tx.gateway === gateway);
      const paidRows = rows.filter((tx) => tx.status === 'paid');
      stats[gateway] = {
        pix: rows.length,
        paid: paidRows.length,
        revenue: paidRows.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
      };
    }
    sendJson(res, 200, {
      ok: true,
      order,
      gateways: GATEWAYS.map((gateway) => ({
        ...gatewayCredentialState(gateway, asObject(payments.gateways?.[gateway]), offer),
        stats: stats[gateway] || { pix: 0, paid: 0, revenue: 0 }
      }))
    });
    return;
  }
  const reconcileMatch = pathname.match(/^\/api\/admin\/offers\/([^/]+)\/pix-reconcile$/);
  if (reconcileMatch && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const offer = findOfferById(decodeURIComponent(reconcileMatch[1]));
    if (!offer) return sendJson(res, 404, { ok: false, error: 'offer_not_found' });
    const body = await readJson(req).catch(() => ({}));
    const summary = await reconcileOfferPix(offer, body.limit || req.query.limit || 100, req);
    sendJson(res, 200, { ok: true, ...summary });
    return;
  }
  const dispatchOfferMatch = pathname.match(/^\/api\/admin\/offers\/([^/]+)\/dispatch-process$/);
  if (dispatchOfferMatch && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const offer = findOfferById(decodeURIComponent(dispatchOfferMatch[1]));
    if (!offer) return sendJson(res, 404, { ok: false, error: 'offer_not_found' });
    const body = await readJson(req).catch(() => ({}));
    if (body.eventName || body.event || body.txid || body.transactionId || body.sessionId) queueOfferDispatches(offer, body, req);
    await processDispatchQueue();
    const pending = STORE.dispatches.filter((job) => job.offerId === offer.id && job.status === 'pending').length;
    sendJson(res, 200, { ok: true, pending });
    return;
  }
  if (pathname === '/api/admin/dispatch/process' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    await processDispatchQueue();
    sendJson(res, 200, { ok: true, pending: STORE.dispatches.filter((job) => job.status === 'pending').length });
    return;
  }
  if ((pathname === '/api/site/config' || pathname === '/api/offer/config') && req.method === 'GET') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    sendJson(res, 200, {
      ok: true,
      offer: publicOffer(offer),
      config: publicOfferConfig(offer),
      features: offer.settings?.features || {}
    });
    return;
  }
  if (pathname === '/api/site/session' && (req.method === 'GET' || req.method === 'POST')) {
    const offer = requireOffer(req, res);
    if (!offer) return;
    const body = req.method === 'POST' ? await readJson(req).catch(() => ({})) : {};
    const sessionId = pickText(body.sessionId, req.query.sessionId, req.query.session_id) || id('session');
    const lead = upsertLead(offer, {
      ...body,
      sessionId,
      event: body.event || 'session',
      stage: body.stage || 'session'
    }, req);
    sendJson(res, 200, { ok: true, sessionId: lead.sessionId, leadId: lead.id });
    return;
  }
  if ((pathname === '/api/lead/track' || pathname === '/api/track') && req.method === 'POST') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    const body = await readJson(req);
    const result = recordEvent(offer, body, req);
    sendJson(res, 200, { ok: true, leadId: result.lead.id, eventId: result.event.id });
    return;
  }
  if ((pathname === '/api/lead/pageview' || pathname === '/api/pageview') && req.method === 'POST') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    const body = await readJson(req);
    const result = recordPageview(offer, body, req);
    sendJson(res, 200, { ok: true, leadId: result.lead.id, pageviewId: result.pageview?.id || '', deduped: result.deduped });
    return;
  }
  if (pathname === '/api/jobs/dispatch' && req.method === 'POST') {
    await processDispatchQueue();
    sendJson(res, 200, { ok: true, pending: STORE.dispatches.filter((job) => job.status === 'pending').length });
    return;
  }
  if (pathname === '/api/pix/create' && req.method === 'POST') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    const body = await readJson(req);
    const result = await createPixForOffer(offer, body, req);
    if (!result.ok) return sendJson(res, result.status || 502, result);
    sendJson(res, 200, {
      ok: true,
      idTransaction: result.transaction.txid,
      transactionId: result.transaction.id,
      gateway: result.transaction.gateway,
      amount: result.transaction.amount,
      reused: Boolean(result.reused),
      status: result.transaction.status,
      paymentCode: result.transaction.paymentCode,
      pixCode: result.transaction.paymentCode,
      qrCode: result.transaction.paymentQrUrl || result.transaction.paymentCodeBase64,
      qrCodeBase64: result.transaction.paymentCodeBase64,
      paymentCodeBase64: result.transaction.paymentCodeBase64,
      paymentQrUrl: result.transaction.paymentQrUrl
    });
    return;
  }
  if (pathname === '/api/pix/status' && req.method === 'POST') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    const body = await readJson(req);
    const result = await getPixStatus(offer, body, req);
    if (!result.ok) return sendJson(res, result.status || 404, result);
    sendJson(res, 200, {
      ok: true,
      idTransaction: result.transaction.txid,
      transactionId: result.transaction.id,
      status: result.transaction.status,
      statusRaw: result.transaction.statusRaw,
      amount: result.transaction.amount,
      gateway: result.transaction.gateway,
      remoteChecked: Boolean(result.remoteChecked),
      remoteError: result.remoteError || '',
      paymentCode: result.transaction.paymentCode,
      pixCode: result.transaction.paymentCode,
      qrCode: result.transaction.paymentQrUrl || result.transaction.paymentCodeBase64,
      qrCodeBase64: result.transaction.paymentCodeBase64,
      paymentCodeBase64: result.transaction.paymentCodeBase64,
      paymentQrUrl: result.transaction.paymentQrUrl
    });
    return;
  }
  if (pathname === '/api/pix/webhook' && req.method === 'POST') {
    const gateway = normalizeStatus(req.query.gateway || req.query.provider || '');
    if (!GATEWAYS.includes(gateway)) return sendJson(res, 400, { ok: false, error: 'invalid_gateway' });
    const offer = findOfferById(req.query.offer_id || req.query.offerId || '') || getOfferFromRequest(req);
    if (!offer) return sendJson(res, 401, { ok: false, error: 'invalid_offer' });
    const config = asObject(offer.settings?.payments?.gateways?.[gateway]);
    const expectedToken = toText(config.webhookToken || offer.privateKey, 300);
    const receivedToken = toText(req.query.token || req.headers['x-leohub-webhook-token'], 300);
    if (expectedToken && receivedToken !== expectedToken) return sendJson(res, 401, { ok: false, error: 'invalid_webhook_token' });
    const body = await readJson(req).catch(() => ({}));
    const result = updateTransactionStatus(offer, gateway, body, req.query, req);
    sendJson(res, 200, { ok: true, status: result.transaction ? 'updated' : 'stored', webhookId: result.webhook.id, duplicate: Boolean(result.webhook.duplicate) });
    return;
  }
  if (pathname === '/api/v1/offer/config' && req.method === 'GET') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    sendJson(res, 200, {
      ok: true,
      offer: publicOffer(offer),
      config: publicOfferConfig(offer),
      features: offer.settings?.features || {}
    });
    return;
  }
  if (pathname === '/api/v1/track' && req.method === 'POST') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    const body = await readJson(req);
    const result = recordEvent(offer, body, req);
    sendJson(res, 200, { ok: true, leadId: result.lead.id, eventId: result.event.id });
    return;
  }
  if (pathname === '/api/v1/pageview' && req.method === 'POST') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    const body = await readJson(req);
    const result = recordPageview(offer, body, req);
    sendJson(res, 200, { ok: true, leadId: result.lead.id, pageviewId: result.pageview?.id || '', deduped: result.deduped });
    return;
  }
  if (pathname === '/api/v1/pix/create' && req.method === 'POST') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    const body = await readJson(req);
    const result = await createPixForOffer(offer, body, req);
    if (!result.ok) return sendJson(res, result.status || 502, result);
    sendJson(res, 200, {
      ok: true,
      reused: result.reused || false,
      idTransaction: result.transaction.txid,
      transactionId: result.transaction.id,
      status: result.transaction.status,
      statusRaw: result.transaction.statusRaw,
      amount: result.transaction.amount,
      gateway: result.transaction.gateway,
      remoteChecked: Boolean(result.remoteChecked),
      remoteError: result.remoteError || '',
      paymentCode: result.transaction.paymentCode,
      pixCode: result.transaction.paymentCode,
      qrCode: result.transaction.paymentQrUrl || result.transaction.paymentCodeBase64,
      qrCodeBase64: result.transaction.paymentCodeBase64,
      paymentCodeBase64: result.transaction.paymentCodeBase64,
      paymentQrUrl: result.transaction.paymentQrUrl
    });
    return;
  }
  if (pathname === '/api/v1/pix/status' && req.method === 'POST') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    const body = await readJson(req);
    const result = await getPixStatus(offer, body, req);
    if (!result.ok) return sendJson(res, result.status || 404, result);
    sendJson(res, 200, {
      ok: true,
      idTransaction: result.transaction.txid,
      transactionId: result.transaction.id,
      status: result.transaction.status,
      statusRaw: result.transaction.statusRaw,
      amount: result.transaction.amount,
      gateway: result.transaction.gateway,
      paymentCode: result.transaction.paymentCode,
      pixCode: result.transaction.paymentCode,
      qrCode: result.transaction.paymentQrUrl || result.transaction.paymentCodeBase64,
      qrCodeBase64: result.transaction.paymentCodeBase64,
      paymentCodeBase64: result.transaction.paymentCodeBase64,
      paymentQrUrl: result.transaction.paymentQrUrl
    });
    return;
  }
  const webhookMatch = pathname.match(/^\/api\/v1\/webhooks\/([^/]+)$/);
  if (webhookMatch && req.method === 'POST') {
    const gateway = normalizeStatus(decodeURIComponent(webhookMatch[1]));
    const offer = findOfferById(req.query.offer_id || req.query.offerId || '') || getOfferFromRequest(req);
    if (!offer) return sendJson(res, 401, { ok: false, error: 'invalid_offer' });
    const config = asObject(offer.settings?.payments?.gateways?.[gateway]);
    const expectedToken = toText(config.webhookToken || offer.privateKey, 300);
    const receivedToken = toText(req.query.token || req.headers['x-leohub-webhook-token'], 300);
    if (expectedToken && receivedToken !== expectedToken) return sendJson(res, 401, { ok: false, error: 'invalid_webhook_token' });
    const body = await readJson(req).catch(() => ({}));
    const result = updateTransactionStatus(offer, gateway, body, req.query, req);
    sendJson(res, 200, { ok: true, status: result.transaction ? 'updated' : 'stored', webhookId: result.webhook.id });
    return;
  }
  sendJson(res, 404, { ok: false, error: 'not_found' });
}

function buildGlobalStats() {
  const paid = STORE.transactions.filter((item) => item.status === 'paid');
  return {
    users: STORE.users.length,
    offers: STORE.offers.length,
    leads: STORE.leads.length,
    events: STORE.events.length,
    pageviews: STORE.pageviews.length,
    transactions: STORE.transactions.length,
    paid: paid.length,
    revenue: Number(paid.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
    pendingDispatches: STORE.dispatches.filter((job) => job.status === 'pending').length,
    failedDispatches: STORE.dispatches.filter((job) => job.status === 'failed').length
  };
}

async function handleRequest(req, res) {
  try {
    await ensureStoreReady();
    ensureSeedOffer();
    const parsed = parseUrl(req);
    const pathname = decodeURIComponent(parsed.pathname);
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }
    serveStatic(req, res, pathname);
  } catch (error) {
    const status = error.message === 'invalid_json' ? 400 : error.message === 'body_too_large' ? 413 : 500;
    sendJson(res, status, { ok: false, error: error.message || 'internal_error' });
  } finally {
    await flushPendingSaves();
  }
}

function ensureSeedOffer() {
  if (!STORE.users.length) {
    const user = normalizeUserInput({
      name: 'Operacao LEOHUB',
      email: 'admin@leohub.local',
      plan: 'interno',
      notes: 'Usuario master local criado automaticamente.'
    });
    writeStore((store) => {
      store.users.push(user);
    });
  }
  const defaultOwner = STORE.users[0] || null;
  if (defaultOwner && STORE.offers.some((offer) => !offer.ownerId)) {
    writeStore((store) => {
      store.offers.forEach((offer) => {
        if (!offer.ownerId) {
          offer.ownerId = defaultOwner.id;
          offer.updatedAt = nowIso();
        }
      });
    });
  }
  if (STORE.offers.length) return;
  const offer = normalizeOfferInput({
    ownerId: defaultOwner?.id || '',
    name: 'Oferta Demo',
    slug: 'oferta-demo',
    description: 'Oferta inicial para testar tracking, PIX e integrações.',
    settings: {
      payments: {
        activeGateway: 'atomopay',
        gatewayOrder: ['atomopay', 'paradise', 'sunize'],
        gateways: {
          atomopay: { ...defaultGatewayConfig(), enabled: true, baseUrl: gatewayDefaultBaseUrl('atomopay') },
          paradise: { ...defaultGatewayConfig(), enabled: true, baseUrl: gatewayDefaultBaseUrl('paradise') },
          sunize: { ...defaultGatewayConfig(), enabled: true, baseUrl: gatewayDefaultBaseUrl('sunize') }
        }
      }
    }
  });
  writeStore((store) => {
    store.offers.push(offer);
  });
}

async function startServer() {
  await ensureStoreReady();
  ensureSeedOffer();
  http.createServer(handleRequest).listen(PORT, () => {
    console.log(`LEOHUB rodando em ${BASE_URL}`);
    console.log(`Storage: ${USE_SUPABASE ? `Supabase/${SUPABASE_STATE_TABLE}` : 'JSON local'}`);
    console.log(`Senha admin: ${ADMIN_PASSWORD === 'admin' ? 'admin (altere LEOHUB_ADMIN_PASSWORD em producao)' : 'definida por ambiente'}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('[leohub] failed to start', error);
    process.exit(1);
  });
}

module.exports = handleRequest;
module.exports.handleRequest = handleRequest;
module.exports.startServer = startServer;
