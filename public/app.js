const state = {
  token: localStorage.getItem('leohub.admin.token') || '',
  offers: [],
  activeOfferId: localStorage.getItem('leohub.active.offer') || '',
  activeView: 'overview',
  activeOfferTab: 'leads',
  baseUrl: window.location.origin
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const money = (value) => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

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
    offers: 'Ofertas',
    offer: 'Painel da oferta',
    integrations: 'Integracoes',
    docs: 'Documentacao'
  };
  $('#view-title').textContent = titles[view] || 'LEOHUB';
  if (view === 'offer') renderOfferPanel();
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
  renderOverview(data);
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

async function renderOfferPanel() {
  const offer = activeOffer();
  if (!offer) return;
  $('#offer-name').textContent = offer.name;
  $('#offer-description').textContent = offer.description || 'Oferta sem descricao.';
  $('#offer-public-key').value = offer.publicKey || '';
  $('#offer-id').value = offer.id || '';
  $('#offer-slug').value = offer.slug || '';
  await renderOfferCollection(state.activeOfferTab);
}

async function renderOfferCollection(collection) {
  const offer = activeOffer();
  if (!offer) return;
  state.activeOfferTab = collection;
  $$('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.offerTab === collection));
  const labels = {
    leads: 'Leads',
    events: 'Eventos',
    transactions: 'PIX',
    dispatches: 'Fila'
  };
  $('#offer-table-title').textContent = labels[collection] || collection;
  const data = await api(`/api/admin/offers/${encodeURIComponent(offer.id)}/${collection}`);
  const rows = data.data || [];
  $('#offer-table-count').textContent = rows.length;
  const renderers = {
    leads: renderLeadsTable,
    events: renderEventsTable,
    transactions: renderTransactionsTable,
    dispatches: renderDispatchesTable
  };
  renderers[collection](rows);
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
  setField(form, 'meta.enabled', Boolean(settings.meta?.enabled));
  setField(form, 'meta.pixelId', settings.meta?.pixelId || '');
  setField(form, 'meta.accessToken', settings.meta?.accessToken || '');
  setField(form, 'meta.testEventCode', settings.meta?.testEventCode || '');

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
      productHash: getField(form, `gateways.${gateway}.productHash`)
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
    pixConfirmedUrl: getField(form, 'pushcut.pixConfirmedUrl')
  };
  current.meta = {
    ...(current.meta || {}),
    enabled: getField(form, 'meta.enabled'),
    pixelId: getField(form, 'meta.pixelId'),
    accessToken: getField(form, 'meta.accessToken'),
    testEventCode: getField(form, 'meta.testEventCode')
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

function bindEvents() {
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

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => renderOfferCollection(tab.dataset.offerTab)));

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
