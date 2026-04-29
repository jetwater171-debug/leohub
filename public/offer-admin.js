const state = {
  token: localStorage.getItem('leohub.admin.token') || '',
  offerId: new URLSearchParams(location.search).get('id') || localStorage.getItem('leohub.active.offer') || '',
  offer: null,
  users: [],
  leads: [],
  events: [],
  pageviews: [],
  transactions: [],
  dispatches: [],
  webhooks: [],
  activeTab: 'overview'
};

const gateways = ['atomopay', 'paradise', 'sunize'];
const gatewayNames = { atomopay: 'AtomoPay', paradise: 'Paradise', sunize: 'Sunize' };
const tabs = {
  overview: ['Painel Administrativo', 'Visao geral de performance, funil e status da operacao em tempo real.'],
  tracking: ['Tracking', 'Controle de first-touch, UTMs, cliques e roteamento por origem.'],
  utmify: ['UTMfy', 'Envio de pedidos e eventos de venda para UTMfy.'],
  gateways: ['Gateways PIX', 'Central de roteamento, credenciais, fallback e testes de PIX.'],
  pages: ['Paginas', 'URLs oficiais usadas pela oferta e documentacao de integracao.'],
  public: ['Publico', 'Leitura de origem, etapa, cidade, dispositivo e melhores segmentos.'],
  sales: ['Vendas', 'Receita, pagamentos, conversao por gateway e fila externa.'],
  backredirects: ['Backredirects', 'URLs e comportamento quando o lead tenta voltar.'],
  leads: ['Leads', 'Busca, jornada e detalhes completos dos leads capturados.']
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dateText(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('pt-BR');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function checked(value) {
  return value ? 'checked' : '';
}

function payloadOf(lead) {
  return lead?.payload || {};
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.data = data;
    throw error;
  }
  return data;
}

function showLogin() {
  $('#admin-login').classList.remove('hidden');
  $('#admin-panel').classList.add('hidden');
}

function showPanel() {
  $('#admin-login').classList.add('hidden');
  $('#admin-panel').classList.remove('hidden');
}

function offerStats() {
  const paid = state.transactions.filter((tx) => tx.status === 'paid');
  const pix = state.transactions.length;
  const revenue = paid.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  return {
    leads: state.leads.length,
    events: state.events.length,
    pix,
    paid: paid.length,
    revenue,
    conversion: pix ? Math.round((paid.length / pix) * 1000) / 10 : 0
  };
}

function countBy(rows, getter) {
  const map = new Map();
  rows.forEach((row) => {
    const key = String(getter(row) || '-').trim() || '-';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function setTab(tab) {
  state.activeTab = tab;
  document.body.dataset.admin = tab;
  $$('.admin-nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.adminTab === tab));
  $$('.admin-tab-panel').forEach((item) => item.classList.add('hidden'));
  $(`#tab-${tab}`)?.classList.remove('hidden');
  const [title, subtitle] = tabs[tab] || tabs.overview;
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = subtitle;
  render();
}

async function bootstrap() {
  if (!state.token) return showLogin();
  try {
    const boot = await api('/api/admin/bootstrap');
    state.users = boot.users || [];
    if (!state.offerId && boot.offers?.[0]) state.offerId = boot.offers[0].id;
    const offerResponse = await api(`/api/admin/offers/${encodeURIComponent(state.offerId)}`);
    state.offer = offerResponse.offer;
    localStorage.setItem('leohub.active.offer', state.offer.id);
    await loadCollections();
    $('#sidebar-offer-name').textContent = state.offer.name || state.offer.slug || 'Oferta';
    showPanel();
    setTab(state.activeTab);
  } catch (error) {
    if (String(error.message).includes('401')) showLogin();
    else {
      showPanel();
      $('#tab-overview').innerHTML = `<div class="admin-section leohub-empty">Falha ao carregar oferta: ${escapeHtml(error.message)}</div>`;
    }
  }
}

async function loadCollections() {
  const names = ['leads', 'events', 'pageviews', 'transactions', 'dispatches', 'webhooks'];
  const results = await Promise.all(names.map((name) =>
    api(`/api/admin/offers/${encodeURIComponent(state.offer.id)}/${name}`).catch(() => ({ data: [] }))
  ));
  names.forEach((name, index) => {
    state[name] = results[index].data || [];
  });
}

function settings() {
  state.offer.settings = state.offer.settings || {};
  return state.offer.settings;
}

function render() {
  if (!state.offer) return;
  const renderer = {
    overview: renderOverview,
    tracking: renderTracking,
    utmify: renderUtmify,
    gateways: renderGateways,
    pages: renderPages,
    public: renderPublic,
    sales: renderSales,
    backredirects: renderBackredirects,
    leads: renderLeads
  }[state.activeTab];
  renderer?.();
}

function renderOverview() {
  const stats = offerStats();
  const payments = settings().payments || {};
  const source = countBy(state.leads, (lead) => lead.utm?.utm_source || payloadOf(lead).utm?.utm_source || lead.referrer)[0];
  const stage = countBy(state.leads, (lead) => lead.stage || lead.lastEvent)[0];
  $('#tab-overview').innerHTML = `
    <section class="admin-section admin-section--overview">
      <div class="admin-section-header">
        <h2>Visao geral</h2>
        <span class="admin-chip">Base: ${stats.leads}</span>
      </div>
      <div class="admin-hero">
        <div class="admin-hero-info">
          <h3>${escapeHtml(state.offer.name)}</h3>
          <p>${escapeHtml(state.offer.description || 'Oferta conectada ao LEOHUB.')}</p>
          <div class="admin-hero-tags">
            <span class="admin-tag">Gateway ativo: <strong>${escapeHtml(gatewayNames[payments.activeGateway] || payments.activeGateway || '-')}</strong></span>
            <span class="admin-tag">Ultima atividade: <strong>${dateText(state.offer.stats?.lastActivityAt || state.offer.updatedAt)}</strong></span>
            <span class="admin-tag">Credencial: <strong>${escapeHtml(state.offer.publicKey || '-')}</strong></span>
          </div>
        </div>
        <div class="admin-hero-highlight">
          <span>Receita</span>
          <strong>${money(stats.revenue)}</strong>
          <em>${stats.paid} pagamentos pagos</em>
        </div>
      </div>
      <div class="admin-kpi-grid">
        ${kpi('Leads ativos', stats.leads, 'Total carregado')}
        ${kpi('Eventos', stats.events, 'Trackeamento recebido')}
        ${kpi('PIX gerado', stats.pix, 'Transacoes criadas')}
        ${kpi('PIX pago', stats.paid, 'Pagamentos confirmados')}
        ${kpi('Conversao PIX', `${stats.conversion}%`, 'Pago / gerado', true)}
        ${kpi('Fonte principal', source ? source[0] : '-', source ? `${source[1]} leads` : 'Sem dados', true)}
      </div>
      <div class="admin-funnel">
        ${funnelRow('Leads', stats.leads, stats.leads)}
        ${funnelRow('Eventos', stats.events, stats.leads)}
        ${funnelRow('PIX gerado', stats.pix, stats.leads)}
        ${funnelRow('PIX pago', stats.paid, stats.leads)}
      </div>
      <section class="admin-section admin-section--card">
        <div class="admin-section-header"><h2>Diagnostico rapido</h2><span class="admin-chip">Oferta</span></div>
        <div class="admin-kpi-grid">
          ${kpi('Origem dominante', source ? source[0] : '-', source ? `${source[1]} leads` : '-')}
          ${kpi('Etapa dominante', stage ? stage[0] : '-', stage ? `${stage[1]} leads` : '-')}
          ${kpi('Fila externa', state.dispatches.filter((job) => job.status === 'pending').length, 'UTMfy / Pushcut / Meta')}
        </div>
      </section>
    </section>
  `;
}

function kpi(label, value, detail, accent = false) {
  return `<div class="admin-kpi${accent ? ' admin-kpi--accent' : ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><em>${escapeHtml(detail || '')}</em></div>`;
}

function funnelRow(label, value, base) {
  const pct = base ? Math.min(100, Math.round((Number(value || 0) / base) * 100)) : 0;
  return `<div class="admin-funnel-row"><span>${escapeHtml(label)}</span><div class="admin-funnel-bar"><i style="width:${pct}%"></i></div><strong>${pct}%</strong></div>`;
}

function renderGateways() {
  const payments = settings().payments || {};
  const order = (payments.gatewayOrder || gateways).filter((gateway) => gateways.includes(gateway));
  const transactionsByGateway = countGatewayTransactions();
  const readyCount = gateways.filter((gateway) => gatewayCredentialInfo(gateway).ready).length;
  const activeGateway = order.find((gateway) => gatewayCredentialInfo(gateway).ready) || order[0] || 'atomopay';
  $('#tab-gateways').innerHTML = `
    <section class="admin-section admin-section--overview">
      <div class="admin-section-header"><h2>Saude de conversao</h2><span class="admin-chip">${readyCount}/${gateways.length} prontos</span></div>
      <div class="admin-hero">
        <div class="admin-hero-info">
          <h3>Roteamento PIX da oferta</h3>
          <p>O LEOHUB tenta o primeiro gateway pronto da lista. Se ele falhar, cai automaticamente para o proximo da prioridade.</p>
          <div class="admin-hero-tags">
            <span class="admin-tag">Primeira tentativa: <strong>${escapeHtml(gatewayNames[activeGateway] || activeGateway)}</strong></span>
            <span class="admin-tag">Modo: <strong>Real</strong></span>
            <span class="admin-tag">Fallback: <strong>${escapeHtml(order.map((gateway) => gatewayNames[gateway]).join(' -> '))}</strong></span>
          </div>
        </div>
        <div class="admin-hero-highlight">
          <span>Receita PIX</span>
          <strong>${money(state.transactions.filter((tx) => tx.status === 'paid').reduce((sum, tx) => sum + Number(tx.amount || 0), 0))}</strong>
          <em>${state.transactions.filter((tx) => tx.status === 'paid').length} pagamentos pagos</em>
        </div>
      </div>
      <div class="admin-kpi-grid">
        ${gateways.map((gateway) => {
          const item = transactionsByGateway[gateway] || { pix: 0, paid: 0, revenue: 0 };
          const conv = item.pix ? Math.round((item.paid / item.pix) * 1000) / 10 : 0;
          const info = gatewayCredentialInfo(gateway);
          return kpi(gatewayNames[gateway], `${conv}%`, `${item.paid} pagos / ${item.pix} PIX | ${info.label}`);
        }).join('')}
      </div>
    </section>
    <section class="admin-section admin-section--card gateway-config-section">
      <div class="admin-section-header"><h2>Configuracao dos gateways</h2><span class="admin-chip">Fallback real</span></div>
      <p class="admin-hint">Configure igual ao painel antigo: liga/desliga gateway, coloca credenciais, ordena prioridade e testa cada provedor sem deploy.</p>
      <div class="gateway-top-row">
        <input type="hidden" id="payments-active-gateway" value="${escapeHtml(payments.activeGateway || order[0] || 'atomopay')}">
        <div class="gateway-priority-panel">
          <div class="gateway-priority-panel__head"><strong>Prioridade de tentativa</strong><span>${escapeHtml(order.join(' -> '))}</span></div>
          <div id="payments-gateway-order" class="gateway-order-list">
            ${order.map((gateway, index) => gatewayOrderItem(gateway, index)).join('')}
          </div>
        </div>
        <p class="gateway-top-row-note">A ordem salva aqui e a ordem real usada pela API publica. Teste de gateway e isolado: se voce testar Paradise, ele nao cai para AtomoPay escondido.</p>
      </div>
      <div class="gateway-test-panel">
        <div>
          <strong>Teste operacional de PIX</strong>
          <span>Gera PIX real no provedor selecionado. Se faltar credencial, o teste falha e mostra o motivo.</span>
        </div>
        <div class="gateway-test-controls">
          <div class="input-group gateway-test-amount">
            <input id="gateway-test-amount" type="number" min="1" step="0.01" class="floating-input" placeholder=" " value="1.99">
            <label for="gateway-test-amount" class="floating-label">Valor teste</label>
          </div>
          <div class="gateway-test-checks">
            ${gateways.map((gateway) => `<label><input type="checkbox" data-gateway-test="${gateway}" checked> ${gatewayNames[gateway]}</label>`).join('')}
          </div>
          <button id="test-gateway-pix" class="btn-secondary" type="button">Gerar PIX de teste</button>
        </div>
        <span id="gateway-test-status" class="admin-muted"></span>
      </div>
      <div id="gateway-test-cards" class="gateway-test-results hidden"></div>
      <pre id="gateway-test-result" class="leohub-code gateway-test-result hidden"></pre>
      <div class="gateway-card-list gateway-card-list--compact">
        ${gateways.map((gateway) => gatewayConfigCard(gateway)).join('')}
      </div>
    </section>
  `;
}

function countGatewayTransactions() {
  const result = {};
  gateways.forEach((gateway) => result[gateway] = { pix: 0, paid: 0, revenue: 0 });
  state.transactions.forEach((tx) => {
    const key = tx.gateway;
    if (!result[key]) return;
    result[key].pix += 1;
    if (tx.status === 'paid') {
      result[key].paid += 1;
      result[key].revenue += Number(tx.amount || 0);
    }
  });
  return result;
}

function gatewayOrderItem(gateway, index) {
  const cfg = settings().payments?.gateways?.[gateway] || {};
  const stats = countGatewayTransactions()[gateway] || { pix: 0, paid: 0, revenue: 0 };
  const conv = stats.pix ? Math.round((stats.paid / stats.pix) * 1000) / 10 : 0;
  const info = gatewayCredentialInfo(gateway);
  return `
    <article class="gateway-order-item${cfg.enabled === false ? ' is-disabled' : ''}" data-gateway-order-item="${gateway}" draggable="true">
      <span class="gateway-order-index">${index + 1}</span>
      <span class="gateway-order-handle"></span>
      <span class="gateway-order-name">${gatewayNames[gateway]}</span>
      <span class="gateway-order-stats">
        <span class="gateway-order-stat"><strong>${stats.pix}</strong><em>Gerados</em></span>
        <span class="gateway-order-stat"><strong>${stats.paid}</strong><em>Aprovados</em></span>
        <span class="gateway-order-stat gateway-order-stat--conversion"><strong>${conv}%</strong><em>Conversao</em><i><b style="width:${Math.min(100, conv)}%"></b></i></span>
      </span>
      <span class="gateway-order-state${info.ready ? ' is-on' : ''}">${escapeHtml(info.label)}</span>
      <button class="gateway-order-move" type="button" data-gateway-order-move="up" aria-label="Subir"></button>
      <button class="gateway-order-move" type="button" data-gateway-order-move="down" aria-label="Descer"></button>
    </article>
  `;
}

function gatewayConfigCard(gateway) {
  const cfg = settings().payments?.gateways?.[gateway] || {};
  const info = gatewayCredentialInfo(gateway);
  const webhookUrl = `${location.origin}/api/v1/webhooks/${gateway}?offer_id=${encodeURIComponent(state.offer.id)}&token=${encodeURIComponent(cfg.webhookToken || 'TOKEN_DO_WEBHOOK')}`;
  return `
    <article class="gateway-card is-open${info.ready ? ' is-current' : ''}" data-gateway-card="${gateway}">
      <header class="gateway-card-header">
        <div class="gateway-card-heading">
          <h3>${gatewayNames[gateway]}</h3>
          <p>${gatewayDescription(gateway)}</p>
          <div class="gateway-required-line ${info.ready ? 'is-ok' : 'is-warn'}">
            <strong>${escapeHtml(info.label)}</strong>
            <span>${escapeHtml(info.help)}</span>
          </div>
        </div>
        <div class="gateway-card-actions">
          <label class="gateway-switch">
            <input type="checkbox" data-field="payments.gateways.${gateway}.enabled" ${checked(cfg.enabled)}>
            <span class="gateway-switch-track"></span>
            <span class="gateway-switch-text">${cfg.enabled ? 'Ativo' : 'Desligado'}</span>
          </label>
        </div>
      </header>
      <div class="gateway-card-body">
        <div class="admin-grid gateway-fields-grid">
          ${input(`payments.gateways.${gateway}.baseUrl`, 'Base URL do gateway', cfg.baseUrl || gatewayDefaultBaseUrl(gateway))}
          ${input(`payments.gateways.${gateway}.webhookToken`, 'Webhook Token', cfg.webhookToken, 'password')}
          ${gatewayFields(gateway, cfg)}
          <div class="gateway-webhook-box input-group--wide">
            <span>Webhook para configurar no gateway</span>
            <code>${escapeHtml(webhookUrl)}</code>
            <button class="btn-secondary" type="button" data-copy="${escapeHtml(webhookUrl)}">Copiar webhook</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function gatewayDescription(gateway) {
  if (gateway === 'atomopay') return 'Usa api_token na query, offer_hash, product_hash, postback e consulta por hash.';
  if (gateway === 'paradise') return 'Usa X-API-Key, reference da sessao, productHash/source e query de status.';
  return 'Usa x-api-key e x-api-secret, com telefone em formato +55.';
}

function gatewayDefaultBaseUrl(gateway) {
  if (gateway === 'atomopay') return 'https://api.atomopay.com.br/api/public/v1';
  if (gateway === 'paradise') return 'https://multi.paradisepags.com';
  if (gateway === 'sunize') return 'https://api.sunize.com.br/v1';
  return '';
}

function gatewayFields(gateway, cfg) {
  if (gateway === 'atomopay') {
    return [
      input(`payments.gateways.${gateway}.apiToken`, 'API Token', cfg.apiToken, 'password'),
      input(`payments.gateways.${gateway}.offerHash`, 'Offer Hash', cfg.offerHash),
      input(`payments.gateways.${gateway}.productHash`, 'Product Hash', cfg.productHash),
      input(`payments.gateways.${gateway}.expireInDays`, 'Expira em dias', cfg.expireInDays || 2)
    ].join('');
  }
  if (gateway === 'paradise') {
    return [
      input(`payments.gateways.${gateway}.apiKey`, 'API Key', cfg.apiKey, 'password'),
      input(`payments.gateways.${gateway}.productHash`, 'Product Hash', cfg.productHash),
      input(`payments.gateways.${gateway}.orderbumpHash`, 'Orderbump Hash', cfg.orderbumpHash),
      input(`payments.gateways.${gateway}.source`, 'Source', cfg.source),
      input(`payments.gateways.${gateway}.description`, 'Descricao', cfg.description)
    ].join('');
  }
  return [
    input(`payments.gateways.${gateway}.apiKey`, 'API Key', cfg.apiKey, 'password'),
    input(`payments.gateways.${gateway}.apiSecret`, 'API Secret', cfg.apiSecret, 'password')
  ].join('');
}

function gatewayCredentialInfo(gateway) {
  const cfg = settings().payments?.gateways?.[gateway] || {};
  if (cfg.enabled === false) {
    return { ready: false, label: 'Desligado', help: 'Este gateway nao participa do fallback.' };
  }
  const required = {
    atomopay: ['apiToken', 'offerHash', 'productHash'],
    paradise: ['apiKey'],
    sunize: ['apiKey', 'apiSecret']
  }[gateway] || [];
  const labels = {
    apiToken: 'API Token',
    offerHash: 'Offer Hash',
    productHash: 'Product Hash',
    apiKey: 'API Key',
    apiSecret: 'API Secret'
  };
  const missing = required.filter((field) => !String(cfg[field] || '').trim());
  if (missing.length) {
    return {
      ready: false,
      label: `Falta ${missing.length}`,
      help: `Obrigatorio para modo real: ${missing.map((field) => labels[field] || field).join(', ')}.`
    };
  }
  return {
    ready: true,
    label: 'Real pronto',
    help: 'Credenciais minimas preenchidas. O teste chama o provedor real.'
  };
}

function renderTracking() {
  const cfg = settings().tracking || {};
  const meta = settings().meta || {};
  const tiktok = settings().tiktok || {};
  $('#tab-tracking').innerHTML = `
    <section class="admin-section admin-section--card">
      <div class="admin-section-header"><h2>Tracking nativo</h2><span class="admin-chip">LEOHUB API</span></div>
      <div class="admin-grid">
        ${toggle('tracking.firstTouch', 'Salvar first-touch', cfg.firstTouch)}
        ${toggle('tracking.sourceBasedRouting', 'Roteamento por origem', cfg.sourceBasedRouting)}
        ${toggle('tracking.captureFbclid', 'Capturar fbclid', cfg.captureFbclid !== false)}
        ${toggle('tracking.captureTtclid', 'Capturar ttclid', cfg.captureTtclid !== false)}
        ${toggle('tracking.captureGclid', 'Capturar gclid', cfg.captureGclid !== false)}
        ${toggle('meta.enabled', 'Meta CAPI ativo', meta.enabled)}
        ${input('meta.pixelId', 'Meta Pixel ID', meta.pixelId)}
        ${input('meta.accessToken', 'Meta Access Token', meta.accessToken, 'password')}
        ${input('meta.testEventCode', 'Meta Test Event Code', meta.testEventCode)}
        ${toggle('tiktok.enabled', 'TikTok Pixel ativo', tiktok.enabled)}
        ${input('tiktok.pixelId', 'TikTok Pixel ID', tiktok.pixelId)}
      </div>
    </section>
  `;
}

function renderUtmify() {
  const cfg = settings().utmify || {};
  const meta = settings().meta || {};
  const push = settings().pushcut || {};
  $('#tab-utmify').innerHTML = `
    <section class="admin-section admin-section--card">
      <div class="admin-section-header"><h2>Eventos externos</h2><span class="admin-chip">UTMfy / Meta / Pushcut</span></div>
      <div class="admin-grid">
        ${toggle('utmify.enabled', 'UTMfy ativo', cfg.enabled)}
        ${input('utmify.endpoint', 'Endpoint UTMfy', cfg.endpoint)}
        ${input('utmify.apiKey', 'API Key UTMfy', cfg.apiKey, 'password')}
        ${input('utmify.platform', 'Plataforma', cfg.platform)}
        ${toggle('meta.enabled', 'Meta CAPI ativo', meta.enabled)}
        ${input('meta.pixelId', 'Pixel ID', meta.pixelId)}
        ${input('meta.accessToken', 'Access Token', meta.accessToken, 'password')}
        ${input('meta.testEventCode', 'Test Event Code', meta.testEventCode)}
        ${toggle('pushcut.enabled', 'Pushcut ativo', push.enabled)}
        ${input('pushcut.apiKey', 'Pushcut API Key', push.apiKey, 'password')}
        ${input('pushcut.pixCreatedUrl', 'Webhook PIX gerado', push.templates?.pixCreatedUrl || push.pixCreatedUrl)}
        ${input('pushcut.pixConfirmedUrl', 'Webhook PIX pago', push.templates?.pixConfirmedUrl || push.pixConfirmedUrl)}
      </div>
      <div class="admin-form-actions">
        <button id="process-dispatches" class="btn-secondary" type="button">Processar fila agora</button>
        <button id="send-test-dispatch" class="btn-secondary" type="button">Enviar teste de evento</button>
        <span id="dispatch-action-status" class="admin-muted"></span>
      </div>
    </section>
  `;
}

function renderPages() {
  const cfg = settings().pages || {};
  $('#tab-pages').innerHTML = `
    <section class="admin-section admin-section--card">
      <div class="admin-section-header"><h2>Paginas da oferta</h2><span class="admin-chip">URLs</span></div>
      <div class="admin-grid">
        ${input('pages.home', 'Home', cfg.home)}
        ${input('pages.checkout', 'Checkout', cfg.checkout)}
        ${input('pages.pix', 'Pagina PIX', cfg.pix)}
        ${input('pages.success', 'Sucesso', cfg.success)}
        ${input('pages.upsell', 'Upsell', cfg.upsell)}
      </div>
      <div class="offer-key-box">
        <code>${escapeHtml(state.offer.publicKey)}</code>
        <button class="btn-secondary" type="button" data-copy="${escapeHtml(state.offer.publicKey)}">Copiar credencial</button>
      </div>
    </section>
  `;
}

function renderBackredirects() {
  const cfg = settings().backredirects || {};
  $('#tab-backredirects').innerHTML = `
    <section class="admin-section admin-section--card">
      <div class="admin-section-header"><h2>Backredirects</h2><span class="admin-chip">Controle</span></div>
      <div class="admin-grid">
        ${toggle('backredirects.enabled', 'Backredirect ativo', cfg.enabled)}
        <div class="input-group input-group--wide">
          <textarea data-field="backredirects.urlsText" class="floating-input" rows="8" placeholder=" ">${escapeHtml((cfg.urls || []).join('\n'))}</textarea>
          <label class="floating-label">URLs, uma por linha</label>
        </div>
      </div>
    </section>
  `;
}

function renderPublic() {
  const sources = countBy(state.leads, (lead) => lead.utm?.utm_source || payloadOf(lead).utm?.utm_source || lead.referrer).slice(0, 8);
  const cities = countBy(state.leads, (lead) => payloadOf(lead).address?.city || payloadOf(lead).shipping?.city || lead.city).slice(0, 8);
  const stages = countBy(state.leads, (lead) => lead.stage || lead.lastEvent).slice(0, 8);
  $('#tab-public').innerHTML = `
    <section class="admin-section admin-section--card">
      <div class="admin-section-header"><h2>Publico ideal</h2><span class="admin-chip">${state.leads.length} leads</span></div>
      <div class="sales-ranking-grid">
        ${ranking('Origens', sources, 'leads')}
        ${ranking('Cidades', cities, 'leads')}
        ${ranking('Etapas', stages, 'leads')}
      </div>
    </section>
  `;
}

function ranking(title, rows, suffix) {
  return `
    <article class="sales-ranking-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="sales-ranking-list">
        ${rows.map(([label, count], index) => `
          <div class="sales-ranking-item">
            <div class="sales-ranking-item__top"><span class="sales-ranking-item__badge">#${index + 1}</span><strong>${escapeHtml(label)}</strong><span class="sales-ranking-item__count">${count} ${suffix}</span></div>
            <div class="sales-ranking-bar"><i style="width:${Math.min(100, count * 10)}%"></i></div>
          </div>
        `).join('') || '<div class="sales-ranking-empty">Sem dados suficientes.</div>'}
      </div>
    </article>
  `;
}

function renderSales() {
  const byGateway = countGatewayTransactions();
  const rows = state.transactions.filter((tx) => tx.status === 'paid');
  $('#tab-sales').innerHTML = `
    <section class="admin-section admin-section--overview">
      <div class="admin-section-header"><h2>Vendas</h2><span class="admin-chip">${rows.length} pagas</span></div>
      <div class="admin-kpi-grid">
        ${kpi('Receita total', money(rows.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)), 'Pagamentos pagos', true)}
        ${kpi('PIX gerados', state.transactions.length, 'Todos os status')}
        ${gateways.map((gateway) => kpi(gatewayNames[gateway], money(byGateway[gateway]?.revenue || 0), `${byGateway[gateway]?.paid || 0} vendas`)).join('')}
      </div>
      <div class="admin-form-actions">
        <button id="reconcile-pix" class="btn-secondary" type="button">Consultar transacoes pendentes</button>
        <span id="reconcile-status" class="admin-muted"></span>
      </div>
    </section>
    ${transactionsTable(state.transactions)}
  `;
}

function renderLeads() {
  $('#tab-leads').innerHTML = `
    <section class="admin-section">
      <div class="admin-section-header"><h2>Leads</h2><span id="leads-count" class="admin-chip">${state.leads.length}</span></div>
      <div class="admin-toolbar">
        <input id="leads-search" type="text" placeholder="Buscar por nome, email, telefone, CPF, cidade, sessao ou TXID">
        <button id="refresh-leads" class="btn-secondary" type="button">Atualizar</button>
        <button id="reconcile-leads-pix" class="btn-secondary" type="button">Consultar transacoes</button>
        <button id="export-leads-csv" class="btn-secondary" type="button">Exportar CSV</button>
        <button id="export-leads-json" class="btn-secondary" type="button">Exportar JSON</button>
        <span id="leads-action-status" class="admin-muted"></span>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table admin-table--leads">
          <thead><tr><th>Lead</th><th>Contato</th><th>Origem</th><th>Oferta</th><th>Jornada</th><th>Pagamentos</th><th>Valor</th><th>Atualizado</th></tr></thead>
          <tbody id="leads-body">${leadRows(state.leads)}</tbody>
        </table>
      </div>
    </section>
  `;
}

function leadRows(rows) {
  return rows.map((lead) => {
    const payload = payloadOf(lead);
    const customer = payload.customer || payload.personal || {};
    const pix = payload.pix || {};
    return `
      <tr data-lead-id="${escapeHtml(lead.id)}">
        <td><strong>${escapeHtml(customer.name || lead.name || lead.sessionId || '-')}</strong><small>${escapeHtml(lead.sessionId || '')}</small></td>
        <td>${escapeHtml(customer.email || lead.email || '-')}<br><small>${escapeHtml(customer.phone || lead.phone || '')}</small></td>
        <td>${escapeHtml(lead.utm?.utm_source || payload.utm?.utm_source || lead.referrer || '-')}</td>
        <td>${escapeHtml(state.offer.name)}</td>
        <td>${escapeHtml(lead.stage || lead.lastEvent || '-')}</td>
        <td>${escapeHtml(pix.status || lead.pixStatus || '-')}<br><small>${escapeHtml(pix.gateway || lead.gateway || '')}</small></td>
        <td>${money(lead.pixAmount || pix.amount || 0)}</td>
        <td>${dateText(lead.updatedAt || lead.createdAt)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="8">Sem leads ainda.</td></tr>';
}

function transactionsTable(rows) {
  return `
    <section class="admin-section admin-section--card">
      <div class="admin-section-header"><h2>Transacoes PIX</h2><span class="admin-chip">${rows.length}</span></div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Gateway</th><th>TXID</th><th>Status</th><th>Valor</th><th>Sessao</th><th>Atualizado</th></tr></thead>
          <tbody>
            ${rows.map((tx) => `<tr><td>${escapeHtml(gatewayNames[tx.gateway] || tx.gateway)}</td><td>${escapeHtml(tx.txid || tx.id)}</td><td>${escapeHtml(tx.status)}</td><td>${money(tx.amount)}</td><td>${escapeHtml(tx.sessionId)}</td><td>${dateText(tx.updatedAt)}</td></tr>`).join('') || '<tr><td colspan="6">Sem transacoes.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function input(field, label, value = '', type = 'text') {
  return `
    <div class="input-group">
      <input data-field="${escapeHtml(field)}" type="${type}" class="floating-input" placeholder=" " value="${escapeHtml(value || '')}" autocomplete="new-password">
      <label class="floating-label">${escapeHtml(label)}</label>
    </div>
  `;
}

function toggle(field, label, value) {
  return `
    <label class="admin-switch">
      <input data-field="${escapeHtml(field)}" type="checkbox" ${checked(value)}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function collectSettings() {
  const next = JSON.parse(JSON.stringify(settings()));
  gateways.forEach((gateway) => {
    if (next.payments?.gateways?.[gateway]) delete next.payments.gateways[gateway].mockMode;
  });
  $$('[data-field]').forEach((field) => {
    const path = field.dataset.field;
    let value = field.type === 'checkbox' ? field.checked : field.value;
    if (path === 'backredirects.urlsText') {
      setDeep(next, 'backredirects.urls', String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean));
      return;
    }
    if (path.endsWith('.timeoutMs')) value = Number(value || 12000);
    setDeep(next, path, value);
  });
  if (state.activeTab === 'gateways') {
    const order = $$('#payments-gateway-order [data-gateway-order-item]').map((item) => item.dataset.gatewayOrderItem);
    setDeep(next, 'payments.gatewayOrder', order);
    setDeep(next, 'payments.activeGateway', order[0] || 'atomopay');
  }
  return next;
}

function refreshGatewayOrderIndexes() {
  $$('#payments-gateway-order [data-gateway-order-item]').forEach((node, index) => {
    const number = node.querySelector('.gateway-order-index');
    if (number) number.textContent = String(index + 1);
  });
  const order = $$('#payments-gateway-order [data-gateway-order-item]').map((item) => item.dataset.gatewayOrderItem);
  const current = $('.gateway-priority-panel__head span');
  if (current) current.textContent = order.join(' -> ');
  const active = $('#payments-active-gateway');
  if (active) active.value = order[0] || 'atomopay';
}

function getDragAfterElement(container, y) {
  const elements = [...container.querySelectorAll('[data-gateway-order-item]:not(.is-dragging)')];
  return elements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function setDeep(target, path, value) {
  const parts = path.split('.');
  let obj = target;
  while (parts.length > 1) {
    const key = parts.shift();
    obj[key] = obj[key] || {};
    obj = obj[key];
  }
  obj[parts[0]] = value;
}

async function saveSettings() {
  $('#save-status').textContent = 'Salvando...';
  const result = await api(`/api/admin/offers/${encodeURIComponent(state.offer.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ settings: collectSettings() })
  });
  state.offer = result.offer;
  $('#save-status').textContent = 'Salvo';
  render();
}

async function testGatewayPix() {
  const status = $('#gateway-test-status');
  const output = $('#gateway-test-result');
  const cards = $('#gateway-test-cards');
  const amount = Number($('#gateway-test-amount')?.value || 1.99);
  const selected = $$('[data-gateway-test]:checked').map((item) => item.dataset.gatewayTest).filter((gateway) => gateways.includes(gateway));
  if (!selected.length) {
    status.textContent = 'Selecione pelo menos um gateway';
    return;
  }
  status.textContent = 'Gerando PIX de teste...';
  output.classList.add('hidden');
  cards?.classList.add('hidden');
  const body = {
    amount,
    gateways: selected,
    customer: { name: 'Teste LEOHUB', email: 'teste@leohub.local', document: '12345678909', phone: '11999999999' },
    utm: { utm_source: 'admin_test' }
  };
  const data = await api(`/api/admin/offers/${encodeURIComponent(state.offer.id)}/gateway-test-pix`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  status.textContent = data.ok ? 'Teste executado' : 'Todos os gateways falharam';
  if (cards) {
    cards.innerHTML = gatewayTestCards(data.results || []);
    cards.classList.remove('hidden');
  }
  output.textContent = JSON.stringify(data, null, 2);
  output.classList.remove('hidden');
  await loadCollections();
}

function gatewayTestCards(results) {
  return results.map((item) => {
    const tx = item.transaction || {};
    const ok = Boolean(item.ok);
    const reason = item.error || item.reason || item.attempts?.map((attempt) => `${attempt.gateway}: ${attempt.reason}`).join(' | ') || '';
    return `
      <article class="gateway-test-card ${ok ? '' : 'gateway-test-card--error'}">
        <div class="gateway-test-card__top">
          <div class="gateway-test-card__title-group">
            <span class="gateway-test-card__eyebrow">${ok ? 'PIX gerado' : 'Falhou'}</span>
            <h4>${escapeHtml(gatewayNames[item.gateway] || item.gateway)}</h4>
            <p class="gateway-test-card__subtitle">${ok ? `Status: ${escapeHtml(tx.status || '-')}` : escapeHtml(reason || 'Gateway nao retornou PIX')}</p>
          </div>
          <span class="gateway-order-state${ok ? ' is-on' : ''}">${ok ? 'OK' : 'Erro'}</span>
        </div>
        ${ok ? `
          <div class="gateway-test-card__details">
            <span><small>TXID</small><code>${escapeHtml(tx.txid || tx.id || '-')}</code></span>
            <span><small>Valor</small><strong>${money(tx.amount || 0)}</strong></span>
            <span><small>Gateway</small><strong>${escapeHtml(gatewayNames[tx.gateway] || tx.gateway || item.gateway)}</strong></span>
          </div>
          <div class="gateway-test-card__copy">
            <input readonly value="${escapeHtml(tx.paymentCode || tx.paymentQrUrl || tx.paymentCodeBase64 || '')}">
            <button class="btn-secondary" type="button" data-copy="${escapeHtml(tx.paymentCode || tx.paymentQrUrl || tx.paymentCodeBase64 || '')}">Copiar PIX</button>
          </div>
        ` : `<div class="gateway-test-card__error">${escapeHtml(reason || 'Falha desconhecida')}</div>`}
      </article>
    `;
  }).join('') || '<div class="gateway-test-empty">Nenhum gateway testado.</div>';
}

async function showLeadDetail(leadId) {
  const detail = await api(`/api/admin/offers/${encodeURIComponent(state.offer.id)}/leads/${encodeURIComponent(leadId)}`).catch(() => ({}));
  const lead = detail.lead || state.leads.find((item) => item.id === leadId);
  if (!lead) return;
  const payload = payloadOf(lead);
  const customer = payload.customer || payload.personal || {};
  const pix = payload.pix || {};
  $('#lead-detail-title').textContent = customer.name || lead.sessionId || 'Lead';
  $('#lead-detail-subtitle').textContent = `${customer.email || '-'} | ${lead.stage || lead.lastEvent || '-'}`;
  $('#lead-detail-meta').innerHTML = `<span class="admin-quiz-chip">${escapeHtml(lead.sessionId || '-')}</span><span class="admin-quiz-chip">${escapeHtml(lead.utm?.utm_source || payload.utm?.utm_source || '-')}</span>`;
  $('#lead-detail-summary').innerHTML = `${kpi('Valor', money(lead.pixAmount || pix.amount || 0), pix.status || '-')}${kpi('Gateway', pix.gateway || lead.gateway || '-', 'Pagamento')}`;
  $('#lead-detail-identity').innerHTML = detailFields([
    ['Nome', customer.name || lead.name],
    ['Email', customer.email || lead.email],
    ['Telefone', customer.phone || lead.phone],
    ['Documento', customer.document || customer.cpf]
  ]);
  $('#lead-detail-tracking').innerHTML = detailFields(Object.entries({ ...(payload.utm || {}), ...(lead.utm || {}) }));
  $('#lead-detail-payment').innerHTML = detailFields([
    ['TXID', pix.idTransaction || lead.pixTxid],
    ['Status', pix.status || lead.pixStatus],
    ['Gateway', pix.gateway || lead.gateway],
    ['Valor', money(lead.pixAmount || pix.amount || 0)]
  ]);
  $('#lead-detail-payload').textContent = JSON.stringify({
    lead,
    transactions: detail.transactions || [],
    events: detail.events || [],
    pageviews: detail.pageviews || []
  }, null, 2);
  $('#lead-detail-modal').classList.remove('hidden');
}

function detailFields(rows) {
  return rows.map(([label, value]) => `<div class="lead-detail-field"><strong>${escapeHtml(label)}</strong><span class="lead-detail-field__value">${escapeHtml(value || '-')}</span></div>`).join('');
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-admin-tab]');
  if (tab) setTab(tab.dataset.adminTab);

  const move = event.target.closest('[data-gateway-order-move]');
  if (move) {
    const item = move.closest('[data-gateway-order-item]');
    const list = item?.parentElement;
    const sibling = move.dataset.gatewayOrderMove === 'up' ? item?.previousElementSibling : item?.nextElementSibling;
    if (list && item && sibling) {
      if (move.dataset.gatewayOrderMove === 'up') list.insertBefore(item, sibling);
      else list.insertBefore(sibling, item);
      refreshGatewayOrderIndexes();
    }
  }

  const copy = event.target.closest('[data-copy]');
  if (copy) navigator.clipboard?.writeText(copy.dataset.copy);

  const lead = event.target.closest('[data-lead-id]');
  if (lead) showLeadDetail(lead.dataset.leadId);
});

document.addEventListener('dragstart', (event) => {
  const item = event.target.closest?.('[data-gateway-order-item]');
  if (!item) return;
  item.classList.add('is-dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', item.dataset.gatewayOrderItem || '');
});

document.addEventListener('dragend', (event) => {
  const item = event.target.closest?.('[data-gateway-order-item]');
  if (!item) return;
  item.classList.remove('is-dragging');
  refreshGatewayOrderIndexes();
});

document.addEventListener('dragover', (event) => {
  const list = event.target.closest?.('#payments-gateway-order');
  if (!list) return;
  event.preventDefault();
  const dragging = list.querySelector('.is-dragging');
  if (!dragging) return;
  const afterElement = getDragAfterElement(list, event.clientY);
  if (afterElement) list.insertBefore(dragging, afterElement);
  else list.appendChild(dragging);
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'leads-search') {
    const query = event.target.value.toLowerCase();
    const rows = state.leads.filter((lead) => JSON.stringify(lead).toLowerCase().includes(query));
    $('#leads-body').innerHTML = leadRows(rows);
    $('#leads-count').textContent = String(rows.length);
  }
});

$('#admin-login-btn').addEventListener('click', async () => {
  try {
    const password = $('#admin-password').value;
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
    state.token = result.token;
    localStorage.setItem('leohub.admin.token', state.token);
    await bootstrap();
  } catch (error) {
    $('#admin-login-error').textContent = error.message || 'Falha no login';
    $('#admin-login-error').classList.remove('hidden');
  }
});

$('#save-settings').addEventListener('click', () => saveSettings().catch((error) => {
  $('#save-status').textContent = error.message || 'Falha ao salvar';
}));

$('#copy-offer-key').addEventListener('click', () => navigator.clipboard?.writeText(state.offer?.publicKey || ''));
$('#back-to-hub').addEventListener('click', () => location.href = '/');
$('#lead-detail-close').addEventListener('click', () => $('#lead-detail-modal').classList.add('hidden'));

document.addEventListener('click', async (event) => {
  if (event.target.id === 'test-gateway-pix') await testGatewayPix().catch((error) => {
    $('#gateway-test-status').textContent = error.message || 'Falha no teste';
  });
  if (event.target.id === 'refresh-leads') {
    await loadCollections();
    renderLeads();
  }
  if (event.target.id === 'export-leads-json') {
    const blob = new Blob([JSON.stringify(state.leads, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${state.offer.slug || state.offer.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  if (event.target.id === 'export-leads-csv') {
    const response = await fetch(`/api/admin/offers/${encodeURIComponent(state.offer.id)}/leads/export`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const text = await response.text();
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${state.offer.slug || state.offer.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  if (event.target.id === 'reconcile-leads-pix') {
    const status = $('#leads-action-status');
    status.textContent = 'Consultando gateways...';
    const data = await api(`/api/admin/offers/${encodeURIComponent(state.offer.id)}/pix-reconcile`, {
      method: 'POST',
      body: JSON.stringify({ limit: 100 })
    });
    status.textContent = `Consultados ${data.checked || 0}, atualizados ${data.updated || 0}, pagos ${data.confirmed || 0}.`;
    await loadCollections();
    renderLeads();
  }
  if (event.target.id === 'reconcile-pix') {
    const status = $('#reconcile-status');
    status.textContent = 'Consultando gateways...';
    const data = await api(`/api/admin/offers/${encodeURIComponent(state.offer.id)}/pix-reconcile`, {
      method: 'POST',
      body: JSON.stringify({ limit: 100 })
    });
    status.textContent = `Consultados ${data.checked || 0}, atualizados ${data.updated || 0}, pagos ${data.confirmed || 0}, pendentes ${data.pending || 0}.`;
    await loadCollections();
    renderSales();
  }
  if (event.target.id === 'process-dispatches' || event.target.id === 'send-test-dispatch') {
    const status = $('#dispatch-action-status');
    status.textContent = 'Processando...';
    const body = event.target.id === 'send-test-dispatch'
      ? { eventName: 'pix_confirmed', amount: 1.99, sessionId: `dispatch_test_${Date.now()}` }
      : {};
    const data = await api(`/api/admin/offers/${encodeURIComponent(state.offer.id)}/dispatch-process`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    status.textContent = `Fila processada. Pendentes: ${data.pending || 0}`;
    await loadCollections();
  }
});

bootstrap();
