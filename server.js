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
const GATEWAYS = ['ghostspay', 'sunize', 'paradise', 'atomopay'];
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
    mockMode: true,
    baseUrl: '',
    apiKey: '',
    apiSecret: '',
    apiToken: '',
    secretKey: '',
    companyId: '',
    basicAuthBase64: '',
    offerHash: '',
    productHash: '',
    webhookToken: randomToken('lh_wh')
  };
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
      gatewayOrder: ['atomopay', 'paradise', 'sunize', 'ghostspay'],
      gateways: {
        atomopay: defaultGatewayConfig(),
        paradise: defaultGatewayConfig(),
        sunize: defaultGatewayConfig(),
        ghostspay: defaultGatewayConfig()
      }
    },
    meta: {
      enabled: false,
      pixelId: '',
      accessToken: '',
      testEventCode: '',
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
      platform: 'LEOHUB'
    },
    pushcut: {
      enabled: false,
      pixCreatedUrl: '',
      pixConfirmedUrl: ''
    },
    publicConfig: {
      pixelEnabled: false,
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

function adminOffer(offer) {
  if (!offer) return null;
  return {
    ...clone(offer),
    stats: buildOfferStats(offer.id)
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

function findOfferByKey(key = '') {
  const token = toText(key, 200);
  if (!token) return null;
  return STORE.offers.find((offer) => offer.publicKey === token || offer.privateKey === token) || null;
}

function findOfferById(idOrSlug = '') {
  const value = toText(idOrSlug, 200);
  return STORE.offers.find((offer) => offer.id === value || offer.slug === value) || null;
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
  for (const gateway of GATEWAYS) {
    settings.payments.gateways[gateway] = {
      ...defaultGatewayConfig(),
      ...asObject(existing?.settings?.payments?.gateways?.[gateway]),
      ...asObject(input.settings?.payments?.gateways?.[gateway])
    };
  }
  return {
    id: existing?.id || id('offer'),
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

function gatewayHasCredentials(gateway, config = {}) {
  if (config.mockMode) return true;
  if (gateway === 'ghostspay') return Boolean(config.basicAuthBase64 || (config.secretKey && config.companyId));
  if (gateway === 'sunize') return Boolean(config.apiKey && config.apiSecret);
  if (gateway === 'paradise') return Boolean(config.apiKey);
  if (gateway === 'atomopay') return Boolean(config.apiToken && config.offerHash && config.productHash);
  return false;
}

async function createPixForOffer(offer, body = {}, req = null) {
  if (offer.settings?.features?.pix === false) {
    return { ok: false, status: 403, error: 'pix_disabled' };
  }
  const order = resolveGatewayOrder(offer, body.gateway || body.paymentGateway);
  const attempts = [];
  const amount = toAmount(body.amount || body.value || body.total);
  if (amount <= 0) return { ok: false, status: 400, error: 'invalid_amount' };
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

function mockPixPayload(gateway, payload = {}) {
  const txid = `${gateway}_${crypto.randomBytes(10).toString('hex')}`;
  return {
    ok: true,
    txid,
    externalId: payload.sessionId || txid,
    status: 'waiting_payment',
    statusRaw: 'mock_waiting_payment',
    paymentCode: `00020126580014br.gov.bcb.pix0136${crypto.randomUUID()}520400005303986540${toAmount(payload.amount).toFixed(2)}5802BR5925LEOHUB MOCK6009SAO PAULO62070503***6304ABCD`,
    paymentCodeBase64: '',
    paymentQrUrl: '',
    raw: {
      mock: true,
      gateway
    }
  };
}

async function callGatewayCreate(gateway, config = {}, payload = {}) {
  if (config.mockMode) return mockPixPayload(gateway, payload);
  if (gateway === 'atomopay') return createAtomopay(config, payload);
  if (gateway === 'sunize') return createSunize(config, payload);
  if (gateway === 'paradise') return createParadise(config, payload);
  if (gateway === 'ghostspay') return createGhostspay(config, payload);
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

async function createAtomopay(config, payload) {
  const url = new URL(`${config.baseUrl || 'https://api.atomopay.com.br/api/public/v1'}/transactions`);
  url.searchParams.set('api_token', config.apiToken);
  const amountCents = cents(payload.amount);
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
    cart: (payload.items || [{ title: payload.title || 'Oferta LEOHUB', price: payload.amount, quantity: 1 }]).map((item) => ({
      product_hash: item.productHash || config.productHash,
      title: item.title || 'Oferta LEOHUB',
      price: cents(item.price || payload.amount),
      quantity: Number(item.quantity || 1),
      operation_type: 1,
      tangible: false
    })),
    expire_in_days: Number(config.expireInDays || 2),
    transaction_origin: 'api',
    postback_url: payload.webhookUrl
  };
  if (payload.utm && Object.keys(payload.utm).length) body.tracking = payload.utm;
  const { response, data } = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, config.timeoutMs);
  if (!response.ok || data?.success === false) return { ok: false, error: 'atomopay_create_failed', detail: data };
  return normalizePixResponse('atomopay', data);
}

async function createSunize(config, payload) {
  const body = {
    amount: cents(payload.amount),
    payment_method: 'PIX',
    external_id: payload.sessionId,
    customer: {
      name: payload.customer.name,
      email: payload.customer.email,
      phone: payload.customer.phone.startsWith('55') ? `+${payload.customer.phone}` : `+55${payload.customer.phone}`,
      document: payload.customer.document,
      document_type: payload.customer.document.length > 11 ? 'CNPJ' : 'CPF'
    },
    metadata: {
      offerId: payload.offer.id,
      sessionId: payload.sessionId,
      ...(payload.utm || {})
    },
    webhook_url: payload.webhookUrl
  };
  const { response, data } = await fetchJson(`${config.baseUrl || 'https://api.sunize.com.br/v1'}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-api-secret': config.apiSecret
    },
    body: JSON.stringify(body)
  }, config.timeoutMs);
  if (!response.ok) return { ok: false, error: 'sunize_create_failed', detail: data };
  return normalizePixResponse('sunize', data);
}

async function createParadise(config, payload) {
  const body = {
    amount: cents(payload.amount),
    reference: payload.sessionId,
    productHash: config.productHash || undefined,
    source: config.productHash ? undefined : 'api_externa',
    customer: {
      name: payload.customer.name,
      email: payload.customer.email,
      document: payload.customer.document,
      phone: payload.customer.phone
    },
    postback_url: payload.webhookUrl,
    tracking: payload.utm || {}
  };
  const { response, data } = await fetchJson(`${config.baseUrl || 'https://multi.paradisepags.com'}/api/v1/transaction.php`, {
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
  return normalizePixResponse('paradise', data);
}

async function createGhostspay(config, payload) {
  const auth = config.basicAuthBase64 || Buffer.from(`${config.secretKey}:${config.companyId}`).toString('base64');
  const body = {
    amount: cents(payload.amount),
    paymentMethod: 'pix',
    customer: {
      name: payload.customer.name,
      email: payload.customer.email,
      document: payload.customer.document,
      phone: payload.customer.phone
    },
    metadata: {
      offerId: payload.offer.id,
      sessionId: payload.sessionId,
      ...(payload.utm || {})
    },
    postbackUrl: payload.webhookUrl,
    items: payload.items || [{ title: payload.title || 'Oferta LEOHUB', quantity: 1, unitPrice: cents(payload.amount) }]
  };
  const { response, data } = await fetchJson(`${config.baseUrl || 'https://api.ghostspaysv1.com/api/v1'}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`
    },
    body: JSON.stringify(body)
  }, config.timeoutMs);
  if (!response.ok) return { ok: false, error: 'ghostspay_create_failed', detail: data };
  return normalizePixResponse('ghostspay', data);
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
    source.paymentCodeBase64,
    pix.qrcode,
    pix.qrCode,
    pix.qrcodeBase64,
    pix.qrCodeBase64,
    pix.image
  );
  const paymentQrUrl = /^https?:\/\//i.test(qrRaw) || qrRaw.startsWith('data:image') ? qrRaw : pickText(pix.qrcodeUrl, pix.qrCodeUrl, source.paymentQrUrl);
  const paymentCodeBase64 = paymentQrUrl ? '' : qrRaw;
  const statusRaw = pickText(source.status, source.raw_status, transaction.status, payment.status) || 'waiting_payment';
  if (!txid) return { ok: false, error: `${gateway}_missing_txid`, detail: data };
  if (!paymentCode && !paymentCodeBase64 && !paymentQrUrl) return { ok: false, error: `${gateway}_missing_pix_visual`, detail: data };
  return {
    ok: true,
    txid,
    externalId: pickText(source.external_id, source.externalId, source.reference),
    status: mapPaymentStatus(statusRaw),
    statusRaw,
    paymentCode,
    paymentCodeBase64,
    paymentQrUrl,
    raw: data
  };
}

function mapPaymentStatus(statusRaw = '') {
  const status = normalizeStatus(statusRaw);
  if (/paid|approved|authorized|confirm|complete|success/.test(status)) return 'paid';
  if (/refund|refunded/.test(status)) return 'refunded';
  if (/refus|fail|cancel|expired|chargeback|chargedback|denied/.test(status)) return 'refused';
  return 'waiting_payment';
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
  return { ok: true, transaction };
}

function updateTransactionStatus(offer, gateway, rawBody = {}, query = {}, req = null) {
  const txid = extractWebhookTxid(gateway, rawBody);
  const statusRaw = extractWebhookStatus(gateway, rawBody);
  const status = mapPaymentStatus(statusRaw);
  const webhook = {
    id: id('wh'),
    offerId: offer.id,
    gateway,
    txid,
    status,
    statusRaw,
    query,
    payload: rawBody,
    createdAt: nowIso()
  };
  let transaction = null;
  writeStore((store) => {
    store.webhooks.push(webhook);
    transaction = store.transactions.find((item) => item.offerId === offer.id && (item.txid === txid || item.externalId === txid));
    if (transaction) {
      transaction.status = status;
      transaction.statusRaw = statusRaw;
      transaction.webhookPayload = rawBody;
      transaction.updatedAt = nowIso();
    }
  });
  if (transaction) {
    const lead = STORE.leads.find((item) => item.id === transaction.leadId || (item.offerId === offer.id && item.sessionId === transaction.sessionId));
    if (lead) {
      upsertLead(offer, {
        sessionId: lead.sessionId,
        event: status === 'paid' ? 'pix_confirmed' : status === 'refunded' ? 'pix_refunded' : status === 'refused' ? 'pix_refused' : 'pix_pending',
        stage: 'pix',
        pixTxid: transaction.txid,
        pixAmount: transaction.amount,
        gateway,
        pix: {
          idTransaction: transaction.txid,
          amount: transaction.amount,
          status,
          statusRaw,
          gateway
        }
      }, req);
    }
    if (status === 'paid') {
      scheduleDispatches(offer, 'pix_confirmed', { transaction, lead, gateway, amount: transaction.amount }, req);
    }
  }
  return { webhook, transaction };
}

function extractWebhookTxid(gateway, body = {}) {
  if (gateway === 'atomopay') {
    return pickText(body.hash, body.transaction_hash, body.transactionHash, body.data?.hash, body.data?.transaction_hash);
  }
  if (gateway === 'sunize') {
    return pickText(body.id, body.transaction_id, body.transactionId, body.data?.id);
  }
  if (gateway === 'paradise') {
    return pickText(body.transaction_id, body.transactionId, body.id, body.external_id, body.externalId);
  }
  return pickText(body.id, body.transactionId, body.transaction_id, body.data?.id, body.objectId);
}

function extractWebhookStatus(gateway, body = {}) {
  return pickText(body.status, body.raw_status, body.data?.status, body.transaction?.status, body.payment?.status) || 'waiting_payment';
}

function scheduleDispatches(offer, eventName, payload = {}, req = null) {
  if (offer.settings?.features?.dispatch === false) return;
  const jobs = [];
  if (shouldSendUtmify(offer, eventName)) {
    jobs.push({
      id: id('job'),
      offerId: offer.id,
      channel: 'utmify',
      eventName,
      status: 'pending',
      payload: buildUtmifyPayload(offer, eventName, payload),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  if (shouldSendPushcut(offer, eventName)) {
    jobs.push({
      id: id('job'),
      offerId: offer.id,
      channel: 'pushcut',
      eventName,
      status: 'pending',
      payload: buildPushcutPayload(offer, eventName, payload),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  if (shouldSendMeta(offer, eventName)) {
    jobs.push({
      id: id('job'),
      offerId: offer.id,
      channel: 'meta',
      eventName,
      status: 'pending',
      payload: buildMetaPayload(offer, eventName, payload, req),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  if (!jobs.length) return;
  writeStore((store) => {
    store.dispatches.push(...jobs);
  });
  processDispatchQueue().catch(() => null);
}

function shouldSendUtmify(offer, eventName) {
  return Boolean(offer.settings?.utmify?.enabled && ['pix_created', 'pix_confirmed', 'pix_refunded', 'pix_refused', 'purchase'].includes(eventName));
}

function shouldSendPushcut(offer, eventName) {
  const push = offer.settings?.pushcut || {};
  if (!push.enabled) return false;
  if (eventName === 'pix_created') return Boolean(push.pixCreatedUrl);
  if (eventName === 'pix_confirmed') return Boolean(push.pixConfirmedUrl);
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
    createdAt: tx.createdAt || nowIso(),
    approvedDate: status === 'paid' ? nowIso() : null,
    refundedAt: status === 'refunded' ? nowIso() : null,
    customer: {
      name: personal.name || lead.name || 'Cliente',
      email: personal.email || lead.email || '',
      phone: personal.phone || personal.phoneDigits || lead.phone || '',
      document: personal.document || personal.cpf || lead.document || ''
    },
    trackingParameters: lead.utm || payload.utm || {},
    products: [
      {
        id: offer.slug,
        name: offer.name,
        planId: offer.id,
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
  return {
    title: eventName === 'pix_confirmed' ? `PIX pago - ${offer.name}` : `PIX gerado - ${offer.name}`,
    text: `${lead.name || 'Lead'} | R$ ${toAmount(payload.amount || tx.amount || 0).toFixed(2)} | ${tx.gateway || payload.gateway || ''}`,
    input: {
      offerId: offer.id,
      offerName: offer.name,
      txid: tx.txid || payload.txid || '',
      amount: toAmount(payload.amount || tx.amount || 0),
      eventName
    }
  };
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
  const url = eventName === 'pix_confirmed' ? cfg.pixConfirmedUrl : cfg.pixCreatedUrl;
  if (!cfg.enabled || !url) return { ok: true, skipped: true, reason: 'pushcut_disabled' };
  const { response, data } = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
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
    const rows = STORE[collection].filter((item) => item.offerId === offer.id).slice(-300).reverse();
    sendJson(res, 200, { ok: true, data: rows });
    return;
  }
  if (pathname === '/api/admin/dispatch/process' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    await processDispatchQueue();
    sendJson(res, 200, { ok: true, pending: STORE.dispatches.filter((job) => job.status === 'pending').length });
    return;
  }
  if (pathname === '/api/v1/offer/config' && req.method === 'GET') {
    const offer = requireOffer(req, res);
    if (!offer) return;
    sendJson(res, 200, {
      ok: true,
      offer: publicOffer(offer),
      config: offer.settings?.publicConfig || {},
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
      paymentCode: result.transaction.paymentCode,
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
  if (STORE.offers.length) return;
  const offer = normalizeOfferInput({
    name: 'Oferta Demo',
    slug: 'oferta-demo',
    description: 'Oferta inicial para testar tracking, PIX e integrações.',
    settings: {
      payments: {
        activeGateway: 'atomopay',
        gatewayOrder: ['atomopay', 'paradise', 'sunize', 'ghostspay'],
        gateways: {
          atomopay: { ...defaultGatewayConfig(), enabled: true, mockMode: true },
          paradise: { ...defaultGatewayConfig(), enabled: true, mockMode: true },
          sunize: { ...defaultGatewayConfig(), enabled: true, mockMode: true },
          ghostspay: { ...defaultGatewayConfig(), enabled: true, mockMode: true }
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
