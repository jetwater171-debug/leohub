const state = {
  token: localStorage.getItem('leohub.admin.token') || '',
  users: [],
  offers: [],
  activeOfferId: localStorage.getItem('leohub.active.offer') || '',
  activeView: 'overview',
  activeOfferTab: 'overview',
  baseUrl: window.location.origin
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const money = (value) => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

const offerModules = [
  ['overview', 'Visao geral'],
  ['tracking', 'Tracking'],
  ['utmify', 'UTMfy'],
  ['gateways', 'Gateways'],
  ['pages', 'Paginas'],
  ['audience', 'Publico'],
  ['sales', 'Vendas'],
  ['backredirects', 'Backredirects'],
  ['leads', 'Leads']
];

const dateText = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function boolAttr(value) {
  return value ? 'checked' : '';
}

function prettyJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch (_error) {
    return '{}';
  }
}

function ensureOfferTable() {
  const content = $('#offer-module-content');
  if (!content) return;
  content.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead id="offer-table-head"></thead>
        <tbody id="offer-table-body"></tbody>
      </table>
    </div>
  `;
}

function setOfferModuleHtml(title, count, html) {
  $('#offer-table-title').textContent = title;
  $('#offer-table-count').textContent = count;
  $('#offer-module-content').innerHTML = html;
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

function setView(view) {
  state.activeView = view;
  $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
  $$('.view').forEach((item) => item.classList.add('hidden'));
  $(`#view-${view}`)?.classList.remove('hidden');
  const titles = {
    overview: 'Visao geral',
    users: 'Usuarios',
    offers: 'Ofertas',
    offer: 'Admin da oferta',
    integrations: 'Integracoes',
    docs: 'Documentacao'
  };
  $('#view-title').textContent = titles[view] || 'LEOHUB';
  if (view === 'offer') renderOfferPanel();
  if (view === 'offers') renderOfferOwnerSelect();
  if (view === 'integrations') renderSettingsForm();
  if (view === 'docs') renderDocs();
}

function activeOffer() {
  return state.offers.find((offer) => offer.id === state.activeOfferId) || state.offers[0] || null;
}

async function bootstrap() {
  try {
    const data = await api('/api/admin/bootstrap');
    state.baseUrl = data.baseUrl || window.location.origin;
    state.users = data.users || [];
    state.offers = data.offers || [];
    if (!state.activeOfferId && state.offers[0]) state.activeOfferId = state.offers[0].id;
    if (!state.offers.some((offer) => offer.id === state.activeOfferId) && state.offers[0]) {
      state.activeOfferId = state.offers[0].id;
    }
    localStorage.setItem('leohub.active.offer', state.activeOfferId || '');
    $('#api-status').classList.add('ok');
    $('#api-status-text').textContent = 'Online';
    $('#default-password-alert').classList.toggle('hidden', !data.defaultPassword);
    renderApp(data);
    $('#login-screen').classList.add('hidden');
    $('#app-screen').classList.remove('hidden');
  } catch (error) {
    $('#api-status').classList.remove('ok');
    $('#api-status-text').textContent = 'Login necessario';
    $('#login-screen').classList.remove('hidden');
    $('#app-screen').classList.add('hidden');
  }
}

function renderApp(data = {}) {
  renderOfferSelect();
  renderOfferOwnerSelect();
  renderOverview(data);
  renderUsers();
  if (state.activeView === 'offer') renderOfferPanel();
  if (state.activeView === 'integrations') renderSettingsForm();
  if (state.activeView === 'docs') renderDocs();
}

function renderOfferSelect() {
  const select = $('#offer-select');
  select.innerHTML = state.offers.map((offer) => (
    `<option value="${escapeHtml(offer.id)}">${escapeHtml(offer.name)}</option>`
  )).join('');
  select.value = state.activeOfferId || state.offers[0]?.id || '';
}

function renderOverview(data = {}) {
  const stats = data.stats || {};
  $('#m-users').textContent = stats.users || 0;
  $('#m-offers').textContent = stats.offers || 0;
  $('#m-leads').textContent = stats.leads || 0;
  $('#m-events').textContent = stats.events || 0;
  $('#m-transactions').textContent = stats.transactions || 0;
  $('#m-paid').textContent = stats.paid || 0;
  $('#m-revenue').textContent = money(stats.revenue || 0);

  $('#offers-list').innerHTML = state.offers.map((offer) => {
    const st = offer.stats || {};
    return `
      <article class="offer-card">
        <strong>${escapeHtml(offer.name)}</strong>
        <span class="muted">${escapeHtml(offer.slug)} | ${st.leads || 0} leads | ${st.paid || 0} pagos | ${money(st.revenue || 0)}</span>
        <button class="secondary" type="button" data-open-offer="${escapeHtml(offer.id)}">Abrir painel</button>
      </article>
    `;
  }).join('') || '<p class="muted">Nenhuma oferta cadastrada.</p>';

  const recent = data.recentEvents || [];
  $('#recent-count').textContent = recent.length;
  $('#recent-feed').innerHTML = recent.map((event) => `
    <article class="feed-item">
      <strong>${escapeHtml(event.event || '-')}</strong>
      <span>${escapeHtml(event.sessionId || '-')} | ${dateText(event.createdAt)}</span>
    </article>
  `).join('') || '<p class="muted">Sem eventos ainda.</p>';

  $('#offers-table-count').textContent = state.offers.length;
  $('#offers-table').innerHTML = state.offers.map((offer) => {
    const st = offer.stats || {};
    return `
      <tr data-open-offer="${escapeHtml(offer.id)}">
        <td><strong>${escapeHtml(offer.name)}</strong><br><span class="muted">${escapeHtml(offer.slug)}</span></td>
        <td>${st.leads || 0}</td>
        <td>${st.transactions || 0}</td>
        <td>${st.paid || 0} | ${money(st.revenue || 0)}</td>
        <td>${escapeHtml(st.topGateway || offer.settings?.payments?.activeGateway || '-')}</td>
      </tr>
    `;
  }).join('');
}

function renderUsers() {
  const table = $('#users-table');
  if (!table) return;
  $('#users-table-count').textContent = state.users.length;
  table.innerHTML = state.users.map((user) => {
    const st = user.stats || {};
    return `
      <tr>
        <td><strong>${escapeHtml(user.name || '-')}</strong><br><span class="muted">${escapeHtml(user.email || '-')}</span></td>
        <td>${escapeHtml(user.plan || '-')}<br><span class="muted">${escapeHtml(user.status || '-')}</span></td>
        <td>${st.offers || 0}</td>
        <td>${st.leads || 0}</td>
        <td>${money(st.revenue || 0)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="5">Nenhum usuario cadastrado.</td></tr>';
}

function renderOfferOwnerSelect() {
  const select = $('#offer-owner-select');
  if (!select) return;
  select.innerHTML = [
    '<option value="">Sem usuario dono</option>',
    ...state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} - ${escapeHtml(user.email)}</option>`)
  ].join('');
}

async function renderOfferPanel() {
  const offer = activeOffer();
  if (!offer) return;
  const st = offer.stats || {};
  $('#offer-m-leads').textContent = st.leads || 0;
  $('#offer-m-events').textContent = st.events || 0;
  $('#offer-m-pix').textContent = st.transactions || 0;
  $('#offer-m-paid').textContent = st.paid || 0;
  $('#offer-m-conversion').textContent = `${st.conversion || 0}%`;
  $('#offer-m-revenue').textContent = money(st.revenue || 0);
  $('#offer-name').textContent = offer.name;
  $('#offer-description').textContent = offer.description || 'Oferta sem descricao.';
  $('#offer-owner').value = offer.owner ? `${offer.owner.name} - ${offer.owner.email}` : 'Sem usuario dono';
  $('#offer-public-key').value = offer.publicKey || '';
  $('#offer-id').value = offer.id || '';
  $('#offer-slug').value = offer.slug || '';
  const tabs = document.querySelector('.tabs');
  if (tabs) {
    tabs.innerHTML = offerModules.map(([key, label]) => (
      `<button class="tab${state.activeOfferTab === key ? ' is-active' : ''}" data-offer-tab="${key}" type="button">${label}</button>`
    )).join('');
  }
  await renderOfferCollection(state.activeOfferTab);
}

async function renderOfferCollection(collection) {
  const offer = activeOffer();
  if (!offer) return;
  state.activeOfferTab = collection;
  $$('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.offerTab === collection));
  const virtualRenderers = {
    overview: renderOfferOverviewTable,
    sales: renderSalesTable,
    gateways: renderGatewaysControl,
    tracking: renderTrackingControl,
    utmify: renderUtmifyControl,
    pages: renderPagesControl,
    audience: renderAudiencePanel,
    backredirects: renderBackredirectControl
  };
  if (virtualRenderers[collection]) {
    await virtualRenderers[collection](offer);
    return;
  }
  const labels = {
    leads: 'Leads',
    events: 'Eventos',
    transactions: 'PIX',
    dispatches: 'Fila',
    webhooks: 'Webhooks'
  };
  $('#offer-table-title').textContent = labels[collection] || collection;
  const data = await api(`/api/admin/offers/${encodeURIComponent(offer.id)}/${collection}`);
  const rows = data.data || [];
  $('#offer-table-count').textContent = rows.length;
  ensureOfferTable();
  const renderers = {
    leads: renderLeadsTable,
    events: renderEventsTable,
    transactions: renderTransactionsTable,
    dispatches: renderDispatchesTable,
    webhooks: renderWebhooksTable
  };
  renderers[collection](rows);
}

function objEntries(obj = {}) {
  return Object.entries(obj || {}).sort((a, b) => {
    const av = typeof a[1] === 'object' ? (a[1].revenue || a[1].paid || a[1].generated || 0) : a[1];
    const bv = typeof b[1] === 'object' ? (b[1].revenue || b[1].paid || b[1].generated || 0) : b[1];
    return Number(bv || 0) - Number(av || 0);
  });
}

function renderOfferOverviewTable(offer) {
  const insights = offer.insights || {};
  $('#offer-table-title').textContent = 'Resumo da oferta';
  $('#offer-table-count').textContent = 'ao vivo';
  $('#offer-table-head').innerHTML = '<tr><th>Modulo</th><th>Principal</th><th>Detalhe</th><th>Status</th></tr>';
  const gateway = objEntries(insights.gatewayStats || {})[0];
  const source = objEntries(insights.sourceStats || {})[0];
  const stage = objEntries(insights.stageStats || {})[0];
  const page = objEntries(insights.pageStats || {})[0];
  const rows = [
    ['Gateway vencedor', gateway?.[0] || '-', gateway ? `${gateway[1].paid || 0} pagos de ${gateway[1].generated || 0} PIX` : '-', offer.settings?.payments?.activeGateway || '-'],
    ['Fonte com mais leads', source?.[0] || '-', source ? `${source[1]} leads` : '-', offer.settings?.tracking?.firstTouch ? 'first-touch ativo' : 'normal'],
    ['Etapa dominante', stage?.[0] || '-', stage ? `${stage[1]} leads` : '-', 'funil'],
    ['Pagina/evento dominante', page?.[0] || '-', page ? `${page[1]} eventos` : '-', 'tracking'],
    ['Integrações', 'UTMify / Pushcut / Pixel', [
      offer.settings?.utmify?.enabled ? 'UTMify ON' : 'UTMify OFF',
      offer.settings?.pushcut?.enabled ? 'Pushcut ON' : 'Pushcut OFF',
      offer.settings?.meta?.enabled ? 'Meta ON' : 'Meta OFF'
    ].join(' | '), 'por oferta']
  ];
  $('#offer-table-body').innerHTML = rows.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row[0])}</strong></td>
      <td>${escapeHtml(row[1])}</td>
      <td>${escapeHtml(row[2])}</td>
      <td><span class="pill">${escapeHtml(row[3])}</span></td>
    </tr>
  `).join('');
}

function renderLeadsTable(rows) {
  $('#offer-table-head').innerHTML = '<tr><th>Lead</th><th>Evento</th><th>PIX</th><th>UTM</th><th>Atualizado</th></tr>';
  $('#offer-table-body').innerHTML = rows.map((lead) => `
    <tr>
      <td><strong>${escapeHtml(lead.name || '-')}</strong><br><span class="muted">${escapeHtml(lead.email || lead.sessionId || '-')}</span></td>
      <td>${escapeHtml(lead.lastEvent || '-')}<br><span class="muted">${escapeHtml(lead.stage || '-')}</span></td>
      <td>${escapeHtml(lead.pixTxid || '-')}<br><span class="muted">${lead.pixAmount ? money(lead.pixAmount) : '-'}</span></td>
      <td>${escapeHtml(lead.utm?.utm_source || '-')}<br><span class="muted">${escapeHtml(lead.utm?.utm_campaign || '-')}</span></td>
      <td>${dateText(lead.updatedAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">Sem leads ainda.</td></tr>';
}

function renderEventsTable(rows) {
  $('#offer-table-head').innerHTML = '<tr><th>Evento</th><th>Sessao</th><th>Pagina</th><th>Data</th></tr>';
  $('#offer-table-body').innerHTML = rows.map((event) => `
    <tr>
      <td><strong>${escapeHtml(event.event || '-')}</strong><br><span class="muted">${escapeHtml(event.stage || '-')}</span></td>
      <td>${escapeHtml(event.sessionId || '-')}</td>
      <td>${escapeHtml(event.page || event.sourceUrl || '-')}</td>
      <td>${dateText(event.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">Sem eventos ainda.</td></tr>';
}

function renderTransactionsTable(rows) {
  $('#offer-table-head').innerHTML = '<tr><th>Transacao</th><th>Status</th><th>Valor</th><th>Gateway</th><th>Data</th></tr>';
  $('#offer-table-body').innerHTML = rows.map((tx) => `
    <tr>
      <td><strong>${escapeHtml(tx.txid || '-')}</strong><br><span class="muted">${escapeHtml(tx.id || '-')}</span></td>
      <td>${escapeHtml(tx.status || '-')}<br><span class="muted">${escapeHtml(tx.statusRaw || '-')}</span></td>
      <td>${money(tx.amount || 0)}</td>
      <td>${escapeHtml(tx.gateway || '-')}</td>
      <td>${dateText(tx.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">Sem PIX ainda.</td></tr>';
}

async function renderSalesTable(offer) {
  $('#offer-table-title').textContent = 'Vendas';
  const data = await api(`/api/admin/offers/${encodeURIComponent(offer.id)}/transactions`);
  const rows = (data.data || []).filter((tx) => tx.status === 'paid');
  $('#offer-table-count').textContent = rows.length;
  $('#offer-table-head').innerHTML = '<tr><th>Venda</th><th>Lead</th><th>Valor</th><th>Gateway</th><th>Pago em</th></tr>';
  $('#offer-table-body').innerHTML = rows.map((tx) => `
    <tr>
      <td><strong>${escapeHtml(tx.txid || '-')}</strong><br><span class="muted">${escapeHtml(tx.statusRaw || '-')}</span></td>
      <td>${escapeHtml(tx.sessionId || tx.leadId || '-')}</td>
      <td>${money(tx.amount || 0)}</td>
      <td>${escapeHtml(tx.gateway || '-')}</td>
      <td>${dateText(tx.updatedAt || tx.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">Nenhuma venda paga ainda.</td></tr>';
}

function renderGatewayPanel(offer) {
  const payments = offer.settings?.payments || {};
  const gateways = payments.gateways || {};
  const insights = offer.insights?.gatewayStats || {};
  $('#offer-table-title').textContent = 'Gateways multigateway';
  $('#offer-table-count').textContent = Object.keys(gateways).length;
  $('#offer-table-head').innerHTML = '<tr><th>Gateway</th><th>Operacao</th><th>Credenciais</th><th>Webhook</th><th>Performance</th></tr>';
  $('#offer-table-body').innerHTML = Object.keys(gatewayNames).map((gateway) => {
    const cfg = gateways[gateway] || {};
    const stats = insights[gateway] || {};
    const hasCredentials = cfg.mockMode || cfg.apiKey || cfg.apiSecret || cfg.apiToken || cfg.secretKey || cfg.basicAuthBase64;
    const webhookUrl = `${state.baseUrl}/api/v1/webhooks/${gateway}?offer_id=${offer.id}&token=${cfg.webhookToken || 'TOKEN'}`;
    return `
      <tr>
        <td><strong>${gatewayNames[gateway]}</strong><br><span class="muted">${payments.activeGateway === gateway ? 'gateway ativo' : 'fallback'}</span></td>
        <td>${cfg.enabled ? 'Ativo' : 'Desativado'}<br><span class="muted">${cfg.mockMode ? 'modo teste/mock' : 'modo real'}</span></td>
        <td>${hasCredentials ? 'Configurado' : 'Pendente'}<br><span class="muted">${escapeHtml(cfg.baseUrl || 'URL padrao')}</span></td>
        <td><code>${escapeHtml(webhookUrl)}</code></td>
        <td>${stats.paid || 0} pagos / ${stats.generated || 0} gerados<br><span class="muted">${money(stats.revenue || 0)}</span></td>
      </tr>
    `;
  }).join('');
}

function renderTrackingPanel(offer) {
  const meta = offer.settings?.meta || {};
  const tiktok = offer.settings?.tiktok || {};
  const tracking = offer.settings?.tracking || {};
  $('#offer-table-title').textContent = 'Tracking e pixels';
  $('#offer-table-count').textContent = meta.enabled || tiktok.enabled ? 'ativo' : 'off';
  $('#offer-table-head').innerHTML = '<tr><th>Area</th><th>Configuracao</th><th>Eventos</th><th>Observacao</th></tr>';
  const rows = [
    ['Meta Pixel/CAPI', meta.enabled ? `Pixel ${meta.pixelId || '-'}` : 'Desativado', Object.entries(meta.events || {}).filter(([, v]) => v !== false).map(([k]) => k).join(', '), meta.accessToken ? 'CAPI configurado' : 'sem token CAPI'],
    ['TikTok Pixel', tiktok.enabled ? `Pixel ${tiktok.pixelId || '-'}` : 'Desativado', Object.entries(tiktok.events || {}).filter(([, v]) => v !== false).map(([k]) => k).join(', '), 'roteamento por origem preparado'],
    ['Atribuicao', tracking.firstTouch ? 'First-touch ativo' : 'Ultimo toque', ['fbclid', 'ttclid', 'gclid'].filter((k) => tracking[`capture${k[0].toUpperCase()}${k.slice(1)}`] !== false).join(', '), tracking.sourceBasedRouting ? 'envia por origem' : 'sem roteamento por origem']
  ];
  $('#offer-table-body').innerHTML = rows.map((row) => `
    <tr><td><strong>${escapeHtml(row[0])}</strong></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td></tr>
  `).join('');
}

function renderUtmifyPanel(offer) {
  const utmify = offer.settings?.utmify || {};
  const pushcut = offer.settings?.pushcut || {};
  $('#offer-table-title').textContent = 'UTMify e Pushcut';
  $('#offer-table-count').textContent = [utmify.enabled && 'UTMify', pushcut.enabled && 'Pushcut'].filter(Boolean).join(' + ') || 'off';
  $('#offer-table-head').innerHTML = '<tr><th>Canal</th><th>Status</th><th>Destino</th><th>Eventos</th></tr>';
  const rows = [
    ['UTMify', utmify.enabled ? 'Ativo' : 'Desativado', utmify.endpoint || '-', [utmify.sendPixCreated !== false && 'PIX gerado', utmify.sendPixConfirmed !== false && 'PIX pago', utmify.sendRefunds !== false && 'reembolso/recusa'].filter(Boolean).join(', ')],
    ['Pushcut', pushcut.enabled ? 'Ativo' : 'Desativado', pushcut.apiKey ? 'API v1 por notificationName' : 'Webhook URL', [pushcut.pixCreatedNotification || pushcut.pixCreatedUrl || 'PIX gerado pendente', pushcut.pixConfirmedNotification || pushcut.pixConfirmedUrl || 'PIX pago pendente'].join(' | ')]
  ];
  $('#offer-table-body').innerHTML = rows.map((row) => `
    <tr><td><strong>${escapeHtml(row[0])}</strong></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td></tr>
  `).join('');
}

function renderPagesPanel(offer) {
  const pages = offer.settings?.pages || {};
  $('#offer-table-title').textContent = 'Paginas da oferta';
  $('#offer-table-count').textContent = pages.enabled ? 'ativo' : 'off';
  $('#offer-table-head').innerHTML = '<tr><th>Pagina</th><th>URL</th><th>Uso</th></tr>';
  const rows = [
    ['Home', pages.home || '-', 'entrada/pageview'],
    ['Checkout', pages.checkout || '-', 'checkout e AddPaymentInfo'],
    ['PIX', pages.pix || '-', 'polling e InitiateCheckout'],
    ['Sucesso', pages.success || '-', 'pos-pagamento']
  ];
  $('#offer-table-body').innerHTML = rows.map((row) => `
    <tr><td><strong>${escapeHtml(row[0])}</strong></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td></tr>
  `).join('');
}

function renderAudiencePanel(offer) {
  const insights = offer.insights || {};
  const sources = objEntries(insights.sourceStats || {}).slice(0, 8);
  $('#offer-table-title').textContent = 'Publico e trafego';
  $('#offer-table-count').textContent = `${insights.paidLeads || 0} pagos`;
  $('#offer-table-head').innerHTML = '<tr><th>Origem</th><th>Leads</th><th>Leitura</th></tr>';
  $('#offer-table-body').innerHTML = sources.map(([source, count]) => `
    <tr><td><strong>${escapeHtml(source)}</strong></td><td>${count}</td><td>${count > 0 ? 'fonte com volume para avaliar criativo/campanha' : '-'}</td></tr>
  `).join('') || '<tr><td colspan="3">Sem dados suficientes ainda.</td></tr>';
}

function renderBackredirectPanel(offer) {
  const cfg = offer.settings?.backredirects || {};
  const urls = Array.isArray(cfg.urls) ? cfg.urls : [];
  $('#offer-table-title').textContent = 'Backredirects';
  $('#offer-table-count').textContent = urls.length;
  $('#offer-table-head').innerHTML = '<tr><th>Status</th><th>URL</th><th>Observacao</th></tr>';
  $('#offer-table-body').innerHTML = (urls.length ? urls : ['']).map((url) => `
    <tr><td>${cfg.enabled ? 'Ativo' : 'Desativado'}</td><td>${escapeHtml(url || '-')}</td><td>configuracao por oferta</td></tr>
  `).join('');
}

function renderDispatchesTable(rows) {
  $('#offer-table-head').innerHTML = '<tr><th>Canal</th><th>Evento</th><th>Status</th><th>Processado</th></tr>';
  $('#offer-table-body').innerHTML = rows.map((job) => `
    <tr>
      <td><strong>${escapeHtml(job.channel || '-')}</strong></td>
      <td>${escapeHtml(job.eventName || '-')}</td>
      <td>${escapeHtml(job.status || '-')}</td>
      <td>${dateText(job.processedAt || job.updatedAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">Sem fila ainda.</td></tr>';
}

function renderWebhooksTable(rows) {
  $('#offer-table-head').innerHTML = '<tr><th>Gateway</th><th>TXID</th><th>Status</th><th>Recebido</th></tr>';
  $('#offer-table-body').innerHTML = rows.map((wh) => `
    <tr>
      <td><strong>${escapeHtml(wh.gateway || '-')}</strong></td>
      <td>${escapeHtml(wh.txid || '-')}</td>
      <td>${escapeHtml(wh.status || '-')}<br><span class="muted">${escapeHtml(wh.statusRaw || '-')}</span></td>
      <td>${dateText(wh.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">Nenhum webhook recebido.</td></tr>';
}

const gatewayNames = {
  atomopay: 'AtomoPay',
  paradise: 'Paradise',
  sunize: 'Sunize',
  ghostspay: 'GhostsPay'
};

function renderSettingsForm() {
  const offer = activeOffer();
  if (!offer) return;
  const settings = offer.settings || {};
  const form = $('#settings-form');
  setField(form, 'payments.activeGateway', settings.payments?.activeGateway || 'atomopay');
  setField(form, 'payments.gatewayOrderText', (settings.payments?.gatewayOrder || []).join(','));
  setField(form, 'utmify.enabled', Boolean(settings.utmify?.enabled));
  setField(form, 'utmify.endpoint', settings.utmify?.endpoint || '');
  setField(form, 'utmify.apiKey', settings.utmify?.apiKey || '');
  setField(form, 'utmify.platform', settings.utmify?.platform || 'LEOHUB');
  setField(form, 'pushcut.enabled', Boolean(settings.pushcut?.enabled));
  setField(form, 'pushcut.pixCreatedUrl', settings.pushcut?.pixCreatedUrl || '');
  setField(form, 'pushcut.pixConfirmedUrl', settings.pushcut?.pixConfirmedUrl || '');
  setField(form, 'pushcut.apiKey', settings.pushcut?.apiKey || '');
  setField(form, 'pushcut.pixCreatedNotification', settings.pushcut?.pixCreatedNotification || '');
  setField(form, 'pushcut.pixConfirmedNotification', settings.pushcut?.pixConfirmedNotification || '');
  setField(form, 'meta.enabled', Boolean(settings.meta?.enabled));
  setField(form, 'meta.pixelId', settings.meta?.pixelId || '');
  setField(form, 'meta.accessToken', settings.meta?.accessToken || '');
  setField(form, 'meta.testEventCode', settings.meta?.testEventCode || '');
  setField(form, 'meta.backupPixelId', settings.meta?.backupPixelId || '');
  setField(form, 'meta.backupAccessToken', settings.meta?.backupAccessToken || '');
  setField(form, 'tiktok.enabled', Boolean(settings.tiktok?.enabled));
  setField(form, 'tiktok.pixelId', settings.tiktok?.pixelId || '');
  setField(form, 'pages.home', settings.pages?.home || '');
  setField(form, 'pages.checkout', settings.pages?.checkout || '');
  setField(form, 'pages.pix', settings.pages?.pix || '');
  setField(form, 'pages.success', settings.pages?.success || '');
  setField(form, 'backredirects.enabled', Boolean(settings.backredirects?.enabled));
  setField(form, 'backredirects.urlsText', (settings.backredirects?.urls || []).join('\n'));

  $('#gateway-configs').innerHTML = ['atomopay', 'paradise', 'sunize', 'ghostspay'].map((gateway) => {
    const cfg = settings.payments?.gateways?.[gateway] || {};
    return `
      <article class="gateway-card" data-gateway="${gateway}">
        <h3>${gatewayNames[gateway]}</h3>
        <div class="form-grid">
          <label class="toggle">
            <input name="gateways.${gateway}.enabled" type="checkbox" ${cfg.enabled ? 'checked' : ''}>
            <span>Ativo</span>
          </label>
          <label class="toggle">
            <input name="gateways.${gateway}.mockMode" type="checkbox" ${cfg.mockMode ? 'checked' : ''}>
            <span>Mock/Teste</span>
          </label>
          <label>
            Timeout
            <input name="gateways.${gateway}.timeoutMs" value="${escapeHtml(cfg.timeoutMs || 12000)}">
          </label>
          <label>
            Base URL
            <input name="gateways.${gateway}.baseUrl" value="${escapeHtml(cfg.baseUrl || '')}">
          </label>
          <label>
            API Key
            <input name="gateways.${gateway}.apiKey" value="${escapeHtml(cfg.apiKey || '')}" type="password">
          </label>
          <label>
            API Secret
            <input name="gateways.${gateway}.apiSecret" value="${escapeHtml(cfg.apiSecret || '')}" type="password">
          </label>
          <label>
            API Token
            <input name="gateways.${gateway}.apiToken" value="${escapeHtml(cfg.apiToken || '')}" type="password">
          </label>
          <label>
            Secret Key
            <input name="gateways.${gateway}.secretKey" value="${escapeHtml(cfg.secretKey || '')}" type="password">
          </label>
          <label>
            Company ID
            <input name="gateways.${gateway}.companyId" value="${escapeHtml(cfg.companyId || '')}">
          </label>
          <label>
            Basic Auth Base64
            <input name="gateways.${gateway}.basicAuthBase64" value="${escapeHtml(cfg.basicAuthBase64 || '')}" type="password">
          </label>
          <label>
            Offer Hash
            <input name="gateways.${gateway}.offerHash" value="${escapeHtml(cfg.offerHash || '')}">
          </label>
          <label>
            Product Hash
            <input name="gateways.${gateway}.productHash" value="${escapeHtml(cfg.productHash || '')}">
          </label>
          <label>
            Webhook Token
            <input name="gateways.${gateway}.webhookToken" value="${escapeHtml(cfg.webhookToken || '')}" type="password">
          </label>
          <label>
            Orderbump Hash
            <input name="gateways.${gateway}.orderbumpHash" value="${escapeHtml(cfg.orderbumpHash || '')}">
          </label>
          <label>
            Source
            <input name="gateways.${gateway}.source" value="${escapeHtml(cfg.source || '')}">
          </label>
          <label>
            Descricao
            <input name="gateways.${gateway}.description" value="${escapeHtml(cfg.description || '')}">
          </label>
        </div>
      </article>
    `;
  }).join('');
}

function setField(form, name, value) {
  const input = form.elements[name];
  if (!input) return;
  if (input.type === 'checkbox') input.checked = Boolean(value);
  else input.value = value ?? '';
}

function getField(form, name) {
  const input = form.elements[name];
  if (!input) return '';
  return input.type === 'checkbox' ? input.checked : input.value;
}

function settingsFromForm() {
  const form = $('#settings-form');
  const offer = activeOffer();
  const current = JSON.parse(JSON.stringify(offer.settings || {}));
  current.payments = current.payments || {};
  current.payments.activeGateway = getField(form, 'payments.activeGateway');
  current.payments.gatewayOrder = String(getField(form, 'payments.gatewayOrderText') || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  current.payments.gateways = current.payments.gateways || {};
  for (const gateway of Object.keys(gatewayNames)) {
    current.payments.gateways[gateway] = {
      ...(current.payments.gateways[gateway] || {}),
      enabled: getField(form, `gateways.${gateway}.enabled`),
      mockMode: getField(form, `gateways.${gateway}.mockMode`),
      timeoutMs: Number(getField(form, `gateways.${gateway}.timeoutMs`) || 12000),
      baseUrl: getField(form, `gateways.${gateway}.baseUrl`),
      apiKey: getField(form, `gateways.${gateway}.apiKey`),
      apiSecret: getField(form, `gateways.${gateway}.apiSecret`),
      apiToken: getField(form, `gateways.${gateway}.apiToken`),
      secretKey: getField(form, `gateways.${gateway}.secretKey`),
      companyId: getField(form, `gateways.${gateway}.companyId`),
      basicAuthBase64: getField(form, `gateways.${gateway}.basicAuthBase64`),
      offerHash: getField(form, `gateways.${gateway}.offerHash`),
      productHash: getField(form, `gateways.${gateway}.productHash`),
      webhookToken: getField(form, `gateways.${gateway}.webhookToken`),
      orderbumpHash: getField(form, `gateways.${gateway}.orderbumpHash`),
      source: getField(form, `gateways.${gateway}.source`),
      description: getField(form, `gateways.${gateway}.description`)
    };
  }
  current.utmify = {
    ...(current.utmify || {}),
    enabled: getField(form, 'utmify.enabled'),
    endpoint: getField(form, 'utmify.endpoint'),
    apiKey: getField(form, 'utmify.apiKey'),
    platform: getField(form, 'utmify.platform')
  };
  current.pushcut = {
    ...(current.pushcut || {}),
    enabled: getField(form, 'pushcut.enabled'),
    pixCreatedUrl: getField(form, 'pushcut.pixCreatedUrl'),
    pixConfirmedUrl: getField(form, 'pushcut.pixConfirmedUrl'),
    apiKey: getField(form, 'pushcut.apiKey'),
    pixCreatedNotification: getField(form, 'pushcut.pixCreatedNotification'),
    pixConfirmedNotification: getField(form, 'pushcut.pixConfirmedNotification')
  };
  current.meta = {
    ...(current.meta || {}),
    enabled: getField(form, 'meta.enabled'),
    pixelId: getField(form, 'meta.pixelId'),
    accessToken: getField(form, 'meta.accessToken'),
    testEventCode: getField(form, 'meta.testEventCode'),
    backupPixelId: getField(form, 'meta.backupPixelId'),
    backupAccessToken: getField(form, 'meta.backupAccessToken')
  };
  current.tiktok = {
    ...(current.tiktok || {}),
    enabled: getField(form, 'tiktok.enabled'),
    pixelId: getField(form, 'tiktok.pixelId')
  };
  current.pages = {
    ...(current.pages || {}),
    home: getField(form, 'pages.home'),
    checkout: getField(form, 'pages.checkout'),
    pix: getField(form, 'pages.pix'),
    success: getField(form, 'pages.success')
  };
  current.backredirects = {
    ...(current.backredirects || {}),
    enabled: getField(form, 'backredirects.enabled'),
    urls: String(getField(form, 'backredirects.urlsText') || '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
  };
  return current;
}

function renderDocs() {
  const offer = activeOffer();
  if (!offer) return;
  const code = `const LEOHUB_URL = '${state.baseUrl}';
const OFFER_KEY = '${offer.publicKey}';

async function track(event, extra = {}) {
  return fetch(LEOHUB_URL + '/api/v1/track', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-leohub-offer-key': OFFER_KEY
    },
    body: JSON.stringify({
      sessionId: localStorage.getItem('lead_session') || crypto.randomUUID(),
      event,
      sourceUrl: location.href,
      utm: Object.fromEntries(new URLSearchParams(location.search)),
      ...extra
    })
  });
}

async function gerarPix() {
  const res = await fetch(LEOHUB_URL + '/api/v1/pix/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-leohub-offer-key': OFFER_KEY
    },
    body: JSON.stringify({
      amount: 29.90,
      sessionId: localStorage.getItem('lead_session'),
      customer: {
        name: 'Cliente Teste',
        email: 'cliente@email.com',
        document: '12345678909',
        phone: '11999999999'
      },
      items: [{ title: '${offer.name}', price: 29.90, quantity: 1 }]
    })
  });

  return res.json();
}`;
  $('#docs-code').textContent = code;
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

async function saveActiveOfferSettings(settingsPatch) {
  const offer = activeOffer();
  if (!offer) return;
  await api(`/api/admin/offers/${encodeURIComponent(offer.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ settings: settingsPatch })
  });
  await bootstrap();
  setView('offer');
}

function renderOfferOverviewTable(offer) {
  const insights = offer.insights || {};
  const gateway = objEntries(insights.gatewayStats || {})[0];
  const source = objEntries(insights.sourceStats || {})[0];
  const stage = objEntries(insights.stageStats || {})[0];
  const page = objEntries(insights.pageStats || {})[0];
  const st = offer.stats || {};
  setOfferModuleHtml('Visao geral da oferta', 'ao vivo', `
    <div class="module-grid">
      <article class="module-card accent"><span>Receita</span><strong>${money(st.revenue || 0)}</strong><small>${st.paid || 0} vendas pagas</small></article>
      <article class="module-card"><span>PIX</span><strong>${st.transactions || 0}</strong><small>${st.conversion || 0}% conversao pagamento</small></article>
      <article class="module-card"><span>Leads</span><strong>${st.leads || 0}</strong><small>${st.events || 0} eventos trackeados</small></article>
      <article class="module-card"><span>Gateway atual</span><strong>${escapeHtml(offer.settings?.payments?.activeGateway || '-')}</strong><small>${gateway ? `${gateway[1].paid || 0}/${gateway[1].generated || 0} pagos no top gateway` : 'sem dados'}</small></article>
    </div>
    <div class="control-grid">
      <section class="control-card">
        <h3>Operacao</h3>
        <div class="status-list">
          <span><b>Top origem</b>${escapeHtml(source ? `${source[0]} (${source[1]} leads)` : '-')}</span>
          <span><b>Top etapa</b>${escapeHtml(stage ? `${stage[0]} (${stage[1]})` : '-')}</span>
          <span><b>Top pagina/evento</b>${escapeHtml(page ? `${page[0]} (${page[1]})` : '-')}</span>
        </div>
      </section>
      <section class="control-card">
        <h3>Integracoes da oferta</h3>
        <div class="status-list">
          <span><b>UTMfy</b>${offer.settings?.utmify?.enabled ? 'Ativo' : 'Desativado'}</span>
          <span><b>Pushcut</b>${offer.settings?.pushcut?.enabled ? 'Ativo' : 'Desativado'}</span>
          <span><b>Meta Pixel/CAPI</b>${offer.settings?.meta?.enabled ? 'Ativo' : 'Desativado'}</span>
          <span><b>TikTok Pixel</b>${offer.settings?.tiktok?.enabled ? 'Ativo' : 'Desativado'}</span>
        </div>
      </section>
    </div>
  `);
}

function renderLeadsTable(rows) {
  $('#offer-table-head').innerHTML = '<tr><th>Lead</th><th>Contato / docs</th><th>Endereco / IP</th><th>PIX / gateway</th><th>Tracking</th><th>Payload</th></tr>';
  $('#offer-table-body').innerHTML = rows.map((lead) => `
    <tr>
      <td><strong>${escapeHtml(lead.name || 'Lead sem nome')}</strong><br><span class="muted">${escapeHtml(lead.sessionId || '-')}</span><br><span class="pill">${escapeHtml(lead.lastEvent || '-')}</span></td>
      <td>${escapeHtml(lead.email || '-')}<br><span class="muted">${escapeHtml(lead.phone || '-')} | ${escapeHtml(lead.document || '-')}</span></td>
      <td>${escapeHtml(lead.address?.city || '-')} ${escapeHtml(lead.address?.state || '')}<br><span class="muted">${escapeHtml(lead.address?.cep || '')} | ${escapeHtml(lead.clientIp || '-')}</span></td>
      <td>${escapeHtml(lead.pixTxid || '-')}<br><span class="muted">${lead.pixAmount ? money(lead.pixAmount) : '-'} | ${escapeHtml(lead.pix?.gateway || lead.payload?.gateway || '-')}</span></td>
      <td>${escapeHtml(lead.utm?.utm_source || lead.utm?.src || '-')}<br><span class="muted">${escapeHtml(lead.utm?.utm_campaign || '-')}</span><br><span class="muted">${dateText(lead.updatedAt)}</span></td>
      <td><details><summary>ver dados</summary><pre class="mini-json">${escapeHtml(prettyJson(lead.payload))}</pre></details></td>
    </tr>
  `).join('') || '<tr><td colspan="6">Sem leads ainda.</td></tr>';
}

function renderGatewaysControl(offer) {
  const settings = offer.settings || {};
  const payments = settings.payments || {};
  const gateways = payments.gateways || {};
  const insights = offer.insights?.gatewayStats || {};
  setOfferModuleHtml('Gateways da oferta', `${Object.keys(gatewayNames).length} gateways`, `
    <form class="module-form" data-offer-module-form="gateways">
      <div class="control-card">
        <div class="form-grid">
          <label>Gateway ativo
            <select name="payments.activeGateway">
              ${Object.keys(gatewayNames).map((gateway) => `<option value="${gateway}" ${payments.activeGateway === gateway ? 'selected' : ''}>${gatewayNames[gateway]}</option>`).join('')}
            </select>
          </label>
          <label>Ordem de fallback
            <input name="payments.gatewayOrderText" value="${escapeHtml((payments.gatewayOrder || []).join(','))}">
          </label>
        </div>
      </div>
      <div class="gateway-control-list">
        ${Object.keys(gatewayNames).map((gateway) => {
          const cfg = gateways[gateway] || {};
          const stats = insights[gateway] || {};
          return `
            <article class="gateway-control-card">
              <div class="gateway-control-head">
                <div><strong>${gatewayNames[gateway]}</strong><span>${stats.paid || 0} pagos / ${stats.generated || 0} gerados | ${money(stats.revenue || 0)}</span></div>
                <label class="toggle"><input name="gateways.${gateway}.enabled" type="checkbox" ${boolAttr(cfg.enabled)}><span>Ativo</span></label>
                <label class="toggle"><input name="gateways.${gateway}.mockMode" type="checkbox" ${boolAttr(cfg.mockMode)}><span>Mock</span></label>
              </div>
              <div class="form-grid dense">
                <label>Base URL<input name="gateways.${gateway}.baseUrl" value="${escapeHtml(cfg.baseUrl || '')}"></label>
                <label>Timeout<input name="gateways.${gateway}.timeoutMs" value="${escapeHtml(cfg.timeoutMs || 12000)}"></label>
                <label>Webhook Token<input name="gateways.${gateway}.webhookToken" type="password" value="${escapeHtml(cfg.webhookToken || '')}"></label>
                <label>API Key<input name="gateways.${gateway}.apiKey" type="password" value="${escapeHtml(cfg.apiKey || '')}"></label>
                <label>API Secret<input name="gateways.${gateway}.apiSecret" type="password" value="${escapeHtml(cfg.apiSecret || '')}"></label>
                <label>API Token<input name="gateways.${gateway}.apiToken" type="password" value="${escapeHtml(cfg.apiToken || '')}"></label>
                <label>Secret Key<input name="gateways.${gateway}.secretKey" type="password" value="${escapeHtml(cfg.secretKey || '')}"></label>
                <label>Company ID<input name="gateways.${gateway}.companyId" value="${escapeHtml(cfg.companyId || '')}"></label>
                <label>Basic Auth Base64<input name="gateways.${gateway}.basicAuthBase64" type="password" value="${escapeHtml(cfg.basicAuthBase64 || '')}"></label>
                <label>Offer Hash<input name="gateways.${gateway}.offerHash" value="${escapeHtml(cfg.offerHash || '')}"></label>
                <label>Product Hash<input name="gateways.${gateway}.productHash" value="${escapeHtml(cfg.productHash || '')}"></label>
                <label>Orderbump Hash<input name="gateways.${gateway}.orderbumpHash" value="${escapeHtml(cfg.orderbumpHash || '')}"></label>
                <label>Source<input name="gateways.${gateway}.source" value="${escapeHtml(cfg.source || '')}"></label>
                <label>Descricao<input name="gateways.${gateway}.description" value="${escapeHtml(cfg.description || '')}"></label>
              </div>
              <code>${escapeHtml(`${state.baseUrl}/api/v1/webhooks/${gateway}?offer_id=${offer.id}&token=${cfg.webhookToken || 'TOKEN'}`)}</code>
            </article>
          `;
        }).join('')}
      </div>
      <button class="primary" type="submit">Salvar gateways desta oferta</button>
      <span class="module-form-status muted"></span>
    </form>
  `);
}

function renderTrackingControl(offer) {
  const meta = offer.settings?.meta || {};
  const tiktok = offer.settings?.tiktok || {};
  const tracking = offer.settings?.tracking || {};
  setOfferModuleHtml('Tracking da oferta', meta.enabled || tiktok.enabled ? 'ativo' : 'off', `
    <form class="module-form" data-offer-module-form="tracking">
      <div class="control-grid">
        <section class="control-card">
          <h3>Meta Pixel + CAPI</h3>
          <div class="form-grid">
            <label class="toggle"><input name="meta.enabled" type="checkbox" ${boolAttr(meta.enabled)}><span>Meta ativo</span></label>
            <label>Pixel ID<input name="meta.pixelId" value="${escapeHtml(meta.pixelId || '')}"></label>
            <label>Access Token<input name="meta.accessToken" type="password" value="${escapeHtml(meta.accessToken || '')}"></label>
            <label>Test Event Code<input name="meta.testEventCode" value="${escapeHtml(meta.testEventCode || '')}"></label>
            <label>Pixel backup<input name="meta.backupPixelId" value="${escapeHtml(meta.backupPixelId || '')}"></label>
            <label>Token backup<input name="meta.backupAccessToken" type="password" value="${escapeHtml(meta.backupAccessToken || '')}"></label>
          </div>
        </section>
        <section class="control-card">
          <h3>TikTok e captura</h3>
          <div class="form-grid">
            <label class="toggle"><input name="tiktok.enabled" type="checkbox" ${boolAttr(tiktok.enabled)}><span>TikTok ativo</span></label>
            <label>TikTok Pixel ID<input name="tiktok.pixelId" value="${escapeHtml(tiktok.pixelId || '')}"></label>
            <label class="toggle"><input name="tracking.firstTouch" type="checkbox" ${boolAttr(tracking.firstTouch)}><span>First-touch</span></label>
            <label class="toggle"><input name="tracking.sourceBasedRouting" type="checkbox" ${boolAttr(tracking.sourceBasedRouting)}><span>Enviar por origem</span></label>
            <label class="toggle"><input name="tracking.captureFbclid" type="checkbox" ${boolAttr(tracking.captureFbclid !== false)}><span>fbclid</span></label>
            <label class="toggle"><input name="tracking.captureTtclid" type="checkbox" ${boolAttr(tracking.captureTtclid !== false)}><span>ttclid</span></label>
            <label class="toggle"><input name="tracking.captureGclid" type="checkbox" ${boolAttr(tracking.captureGclid !== false)}><span>gclid</span></label>
          </div>
        </section>
      </div>
      <button class="primary" type="submit">Salvar tracking desta oferta</button>
      <span class="module-form-status muted"></span>
    </form>
  `);
}

function renderUtmifyControl(offer) {
  const utmify = offer.settings?.utmify || {};
  const pushcut = offer.settings?.pushcut || {};
  setOfferModuleHtml('UTMfy e Pushcut da oferta', [utmify.enabled && 'UTMfy', pushcut.enabled && 'Pushcut'].filter(Boolean).join(' + ') || 'off', `
    <form class="module-form" data-offer-module-form="utmify">
      <div class="control-grid">
        <section class="control-card">
          <h3>UTMfy</h3>
          <div class="form-grid">
            <label class="toggle"><input name="utmify.enabled" type="checkbox" ${boolAttr(utmify.enabled)}><span>Ativo</span></label>
            <label>Endpoint<input name="utmify.endpoint" value="${escapeHtml(utmify.endpoint || '')}"></label>
            <label>API Key<input name="utmify.apiKey" type="password" value="${escapeHtml(utmify.apiKey || '')}"></label>
            <label>Plataforma<input name="utmify.platform" value="${escapeHtml(utmify.platform || 'LEOHUB')}"></label>
            <label class="toggle"><input name="utmify.sendPixCreated" type="checkbox" ${boolAttr(utmify.sendPixCreated !== false)}><span>Enviar PIX gerado</span></label>
            <label class="toggle"><input name="utmify.sendPixConfirmed" type="checkbox" ${boolAttr(utmify.sendPixConfirmed !== false)}><span>Enviar PIX pago</span></label>
            <label class="toggle"><input name="utmify.sendRefunds" type="checkbox" ${boolAttr(utmify.sendRefunds !== false)}><span>Enviar recusas/reembolso</span></label>
          </div>
        </section>
        <section class="control-card">
          <h3>Pushcut</h3>
          <div class="form-grid">
            <label class="toggle"><input name="pushcut.enabled" type="checkbox" ${boolAttr(pushcut.enabled)}><span>Ativo</span></label>
            <label>API Key<input name="pushcut.apiKey" type="password" value="${escapeHtml(pushcut.apiKey || '')}"></label>
            <label>Notification PIX gerado<input name="pushcut.pixCreatedNotification" value="${escapeHtml(pushcut.pixCreatedNotification || '')}"></label>
            <label>Notification PIX pago<input name="pushcut.pixConfirmedNotification" value="${escapeHtml(pushcut.pixConfirmedNotification || '')}"></label>
            <label>Webhook PIX gerado<input name="pushcut.pixCreatedUrl" value="${escapeHtml(pushcut.pixCreatedUrl || '')}"></label>
            <label>Webhook PIX pago<input name="pushcut.pixConfirmedUrl" value="${escapeHtml(pushcut.pixConfirmedUrl || '')}"></label>
          </div>
        </section>
      </div>
      <button class="primary" type="submit">Salvar UTMfy/Pushcut desta oferta</button>
      <span class="module-form-status muted"></span>
    </form>
  `);
}

function renderPagesControl(offer) {
  const pages = offer.settings?.pages || {};
  setOfferModuleHtml('Paginas da oferta', pages.enabled ? 'ativo' : 'off', `
    <form class="module-form" data-offer-module-form="pages">
      <div class="control-card">
        <div class="form-grid">
          <label class="toggle"><input name="pages.enabled" type="checkbox" ${boolAttr(pages.enabled !== false)}><span>Paginas ativas</span></label>
          <label>Home<input name="pages.home" value="${escapeHtml(pages.home || '')}" placeholder="https://..."></label>
          <label>Checkout<input name="pages.checkout" value="${escapeHtml(pages.checkout || '')}" placeholder="https://..."></label>
          <label>PIX<input name="pages.pix" value="${escapeHtml(pages.pix || '')}" placeholder="https://..."></label>
          <label>Sucesso<input name="pages.success" value="${escapeHtml(pages.success || '')}" placeholder="https://..."></label>
        </div>
      </div>
      <button class="primary" type="submit">Salvar paginas desta oferta</button>
      <span class="module-form-status muted"></span>
    </form>
  `);
}

function renderBackredirectControl(offer) {
  const cfg = offer.settings?.backredirects || {};
  setOfferModuleHtml('Backredirects da oferta', Array.isArray(cfg.urls) ? cfg.urls.length : 0, `
    <form class="module-form" data-offer-module-form="backredirects">
      <div class="control-card">
        <div class="form-grid">
          <label class="toggle"><input name="backredirects.enabled" type="checkbox" ${boolAttr(cfg.enabled)}><span>Backredirect ativo</span></label>
          <label class="wide">URLs, uma por linha<textarea name="backredirects.urlsText" rows="6">${escapeHtml((cfg.urls || []).join('\n'))}</textarea></label>
        </div>
      </div>
      <button class="primary" type="submit">Salvar backredirect desta oferta</button>
      <span class="module-form-status muted"></span>
    </form>
  `);
}

async function renderSalesTable(offer) {
  const data = await api(`/api/admin/offers/${encodeURIComponent(offer.id)}/transactions`);
  const rows = (data.data || []).filter((tx) => tx.status === 'paid');
  const byGateway = offer.insights?.gatewayStats || {};
  setOfferModuleHtml('Vendas da oferta', rows.length, `
    <div class="gateway-sales-mini">
      ${Object.entries(byGateway).map(([gateway, stats]) => `
        <article class="module-card">
          <span>${escapeHtml(gatewayNames[gateway] || gateway)}</span>
          <strong>${money(stats.revenue || 0)}</strong>
          <small>${stats.paid || 0} pagos / ${stats.generated || 0} PIX</small>
        </article>
      `).join('') || '<p class="muted">Sem vendas por gateway ainda.</p>'}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Venda</th><th>Lead</th><th>Valor</th><th>Gateway</th><th>Pago em</th><th>Payload</th></tr></thead>
        <tbody>
          ${rows.map((tx) => `
            <tr>
              <td><strong>${escapeHtml(tx.txid || '-')}</strong><br><span class="muted">${escapeHtml(tx.statusRaw || '-')}</span></td>
              <td>${escapeHtml(tx.sessionId || tx.leadId || '-')}</td>
              <td>${money(tx.amount || 0)}</td>
              <td>${escapeHtml(tx.gateway || '-')}</td>
              <td>${dateText(tx.updatedAt || tx.createdAt)}</td>
              <td><details><summary>ver</summary><pre class="mini-json">${escapeHtml(prettyJson(tx.gatewayPayload || tx.webhookPayload || tx))}</pre></details></td>
            </tr>
          `).join('') || '<tr><td colspan="6">Nenhuma venda paga ainda.</td></tr>'}
        </tbody>
      </table>
    </div>
  `);
}

function renderAudiencePanel(offer) {
  const insights = offer.insights || {};
  const sources = objEntries(insights.sourceStats || {}).slice(0, 12);
  const stages = objEntries(insights.stageStats || {}).slice(0, 12);
  setOfferModuleHtml('Publico da oferta', `${insights.paidLeads || 0} pagos`, `
    <div class="control-grid">
      <section class="control-card">
        <h3>Origens e campanhas</h3>
        <div class="rank-list">
          ${sources.map(([source, count]) => `<span><b>${escapeHtml(source)}</b><em>${count} leads</em></span>`).join('') || '<p class="muted">Sem origem ainda.</p>'}
        </div>
      </section>
      <section class="control-card">
        <h3>Etapas com volume</h3>
        <div class="rank-list">
          ${stages.map(([stage, count]) => `<span><b>${escapeHtml(stage)}</b><em>${count} leads</em></span>`).join('') || '<p class="muted">Sem etapas ainda.</p>'}
        </div>
      </section>
    </div>
  `);
}

function moduleSettingsFromForm(form, module) {
  const get = (name) => getField(form, name);
  if (module === 'gateways') {
    const gateways = {};
    for (const gateway of Object.keys(gatewayNames)) {
      gateways[gateway] = {
        enabled: get(`gateways.${gateway}.enabled`),
        mockMode: get(`gateways.${gateway}.mockMode`),
        timeoutMs: Number(get(`gateways.${gateway}.timeoutMs`) || 12000),
        baseUrl: get(`gateways.${gateway}.baseUrl`),
        webhookToken: get(`gateways.${gateway}.webhookToken`),
        apiKey: get(`gateways.${gateway}.apiKey`),
        apiSecret: get(`gateways.${gateway}.apiSecret`),
        apiToken: get(`gateways.${gateway}.apiToken`),
        secretKey: get(`gateways.${gateway}.secretKey`),
        companyId: get(`gateways.${gateway}.companyId`),
        basicAuthBase64: get(`gateways.${gateway}.basicAuthBase64`),
        offerHash: get(`gateways.${gateway}.offerHash`),
        productHash: get(`gateways.${gateway}.productHash`),
        orderbumpHash: get(`gateways.${gateway}.orderbumpHash`),
        source: get(`gateways.${gateway}.source`),
        description: get(`gateways.${gateway}.description`)
      };
    }
    return {
      payments: {
        activeGateway: get('payments.activeGateway'),
        gatewayOrder: String(get('payments.gatewayOrderText') || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
        gateways
      }
    };
  }
  if (module === 'tracking') {
    return {
      meta: {
        enabled: get('meta.enabled'),
        pixelId: get('meta.pixelId'),
        accessToken: get('meta.accessToken'),
        testEventCode: get('meta.testEventCode'),
        backupPixelId: get('meta.backupPixelId'),
        backupAccessToken: get('meta.backupAccessToken')
      },
      tiktok: {
        enabled: get('tiktok.enabled'),
        pixelId: get('tiktok.pixelId')
      },
      tracking: {
        firstTouch: get('tracking.firstTouch'),
        sourceBasedRouting: get('tracking.sourceBasedRouting'),
        captureFbclid: get('tracking.captureFbclid'),
        captureTtclid: get('tracking.captureTtclid'),
        captureGclid: get('tracking.captureGclid')
      }
    };
  }
  if (module === 'utmify') {
    return {
      utmify: {
        enabled: get('utmify.enabled'),
        endpoint: get('utmify.endpoint'),
        apiKey: get('utmify.apiKey'),
        platform: get('utmify.platform'),
        sendPixCreated: get('utmify.sendPixCreated'),
        sendPixConfirmed: get('utmify.sendPixConfirmed'),
        sendRefunds: get('utmify.sendRefunds')
      },
      pushcut: {
        enabled: get('pushcut.enabled'),
        apiKey: get('pushcut.apiKey'),
        pixCreatedNotification: get('pushcut.pixCreatedNotification'),
        pixConfirmedNotification: get('pushcut.pixConfirmedNotification'),
        pixCreatedUrl: get('pushcut.pixCreatedUrl'),
        pixConfirmedUrl: get('pushcut.pixConfirmedUrl')
      }
    };
  }
  if (module === 'pages') {
    return {
      pages: {
        enabled: get('pages.enabled'),
        home: get('pages.home'),
        checkout: get('pages.checkout'),
        pix: get('pages.pix'),
        success: get('pages.success')
      }
    };
  }
  if (module === 'backredirects') {
    return {
      backredirects: {
        enabled: get('backredirects.enabled'),
        urls: String(get('backredirects.urlsText') || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
      }
    };
  }
  return {};
}

function bindEvents() {
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-offer-module-form]');
    if (!form) return;
    event.preventDefault();
    const status = form.querySelector('.module-form-status');
    if (status) status.textContent = 'Salvando...';
    try {
      const module = form.getAttribute('data-offer-module-form');
      await saveActiveOfferSettings(moduleSettingsFromForm(form, module));
      if (status) status.textContent = 'Salvo';
    } catch (error) {
      if (status) status.textContent = error.message || 'Erro ao salvar';
    }
  });

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#login-error').textContent = '';
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: $('#admin-password').value })
      });
      state.token = data.token;
      localStorage.setItem('leohub.admin.token', state.token);
      await bootstrap();
    } catch (error) {
      $('#login-error').textContent = 'Senha invalida.';
    }
  });

  $$('.nav-item').forEach((item) => item.addEventListener('click', () => setView(item.dataset.view)));
  document.addEventListener('click', async (event) => {
    const offerTab = event.target.closest('[data-offer-tab]');
    if (offerTab) {
      await renderOfferCollection(offerTab.dataset.offerTab);
      return;
    }
    const jump = event.target.closest('[data-view-jump]');
    if (jump) setView(jump.dataset.viewJump);
    const open = event.target.closest('[data-open-offer]');
    if (open) {
      state.activeOfferId = open.dataset.openOffer;
      localStorage.setItem('leohub.active.offer', state.activeOfferId);
      renderOfferSelect();
      setView('offer');
    }
  });

  $('#offer-select').addEventListener('change', async (event) => {
    state.activeOfferId = event.target.value;
    localStorage.setItem('leohub.active.offer', state.activeOfferId);
    if (state.activeView === 'offer') await renderOfferPanel();
    if (state.activeView === 'integrations') renderSettingsForm();
    if (state.activeView === 'docs') renderDocs();
  });

  $('#refresh-btn').addEventListener('click', bootstrap);
  $('#logout-btn').addEventListener('click', () => {
    localStorage.removeItem('leohub.admin.token');
    state.token = '';
    location.reload();
  });

  $('#create-offer-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form.entries());
    const result = await api('/api/admin/offers', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    state.activeOfferId = result.offer.id;
    localStorage.setItem('leohub.active.offer', state.activeOfferId);
    event.currentTarget.reset();
    await bootstrap();
    setView('offer');
  });

  $('#create-user-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form.entries());
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    event.currentTarget.reset();
    await bootstrap();
    setView('users');
  });

  $('#copy-public-key').addEventListener('click', async () => {
    await copyText($('#offer-public-key').value);
    $('#copy-public-key').textContent = 'Copiado';
    setTimeout(() => { $('#copy-public-key').textContent = 'Copiar credencial'; }, 1200);
  });

  $('#rotate-key').addEventListener('click', async () => {
    const offer = activeOffer();
    if (!offer) return;
    if (!confirm('Rotacionar a chave publica dessa oferta? Sites usando a chave antiga vao parar.')) return;
    await api(`/api/admin/offers/${encodeURIComponent(offer.id)}/rotate-key`, { method: 'POST' });
    await bootstrap();
    setView('offer');
  });

  $('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const offer = activeOffer();
    if (!offer) return;
    $('#settings-status').textContent = 'Salvando...';
    const settings = settingsFromForm();
    await api(`/api/admin/offers/${encodeURIComponent(offer.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ settings })
    });
    $('#settings-status').textContent = 'Salvo';
    await bootstrap();
    setView('integrations');
  });

  $('#copy-docs').addEventListener('click', async () => {
    await copyText($('#docs-code').textContent);
    $('#copy-docs').textContent = 'Copiado';
    setTimeout(() => { $('#copy-docs').textContent = 'Copiar exemplo'; }, 1200);
  });

  $('#api-tester').addEventListener('submit', async (event) => {
    event.preventDefault();
    const offer = activeOffer();
    if (!offer) return;
    const form = new FormData(event.currentTarget);
    const body = {
      amount: Number(form.get('amount') || 0),
      sessionId: `tester_${Date.now()}`,
      customer: {
        name: form.get('name'),
        email: form.get('email'),
        document: form.get('document'),
        phone: '11999999999'
      },
      items: [{ title: offer.name, price: Number(form.get('amount') || 0), quantity: 1 }],
      utm: { utm_source: 'leohub_tester' }
    };
    $('#tester-status').textContent = 'Gerando...';
    try {
      const result = await fetch('/api/v1/pix/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-leohub-offer-key': offer.publicKey
        },
        body: JSON.stringify(body)
      }).then((res) => res.json());
      $('#tester-result').textContent = JSON.stringify(result, null, 2);
      $('#tester-status').textContent = result.ok ? 'PIX gerado' : 'Falhou';
      await bootstrap();
      setView('docs');
    } catch (error) {
      $('#tester-status').textContent = 'Erro';
      $('#tester-result').textContent = error.message;
    }
  });
}

bindEvents();
bootstrap();
