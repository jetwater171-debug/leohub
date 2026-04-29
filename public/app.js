const state = {
  token: localStorage.getItem('leohub.admin.token') || '',
  offers: [],
  activeHubTab: localStorage.getItem('leohub.hub.tab') || 'offers',
  apiOfferId: localStorage.getItem('leohub.api.offer') || ''
};

const $ = (selector) => document.querySelector(selector);

const money = (value) => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

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

function openOffer(offerId) {
  localStorage.setItem('leohub.active.offer', offerId);
  window.location.href = `/offer-admin.html?id=${encodeURIComponent(offerId)}`;
}

function activeApiOffer() {
  return state.offers.find((offer) => offer.id === state.apiOfferId) || state.offers[0] || null;
}

function setHubTab(tab) {
  state.activeHubTab = tab;
  localStorage.setItem('leohub.hub.tab', tab);
  document.querySelectorAll('[data-hub-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.hubTab === tab);
  });
  $('#hub-offers-view').classList.toggle('hidden', tab !== 'offers');
  $('#hub-api-view').classList.toggle('hidden', tab !== 'api');
  if (tab === 'api') renderApiDocs();
}

function renderOffers() {
  $('#offers-count').textContent = String(state.offers.length);
  $('#offers-card-grid').innerHTML = state.offers.map((offer) => {
    const st = offer.stats || {};
    const gateway = st.topGateway || offer.settings?.payments?.activeGateway || '-';
    return `
      <article class="saas-offer-card" data-open-offer="${escapeHtml(offer.id)}">
        <div class="saas-offer-top">
          <div>
            <span class="eyebrow">Oferta</span>
            <strong>${escapeHtml(offer.name)}</strong>
            <small>${escapeHtml(offer.slug)} | ${escapeHtml(offer.status || 'active')}</small>
          </div>
          <span class="pill">${escapeHtml(gateway)}</span>
        </div>
        <div class="saas-offer-metrics">
          <span><b>${st.leads || 0}</b>Leads</span>
          <span><b>${st.transactions || 0}</b>PIX</span>
          <span><b>${st.paid || 0}</b>Pagos</span>
          <span><b>${money(st.revenue || 0)}</b>Receita</span>
        </div>
        <div class="saas-offer-footer">
          <span>Credencial gerada automaticamente</span>
          <button class="secondary" type="button">Abrir admin</button>
        </div>
      </article>
    `;
  }).join('') || '<p class="muted">Nenhuma oferta cadastrada. Crie a primeira oferta para abrir o admin.</p>';
}

function renderApiOfferSelect() {
  const select = $('#api-offer-select');
  if (!select) return;
  if (!state.apiOfferId && state.offers[0]) state.apiOfferId = state.offers[0].id;
  if (!state.offers.some((offer) => offer.id === state.apiOfferId) && state.offers[0]) state.apiOfferId = state.offers[0].id;
  select.innerHTML = state.offers.map((offer) => `<option value="${escapeHtml(offer.id)}">${escapeHtml(offer.name)}</option>`).join('');
  select.value = state.apiOfferId || '';
}

function renderApiDocs() {
  renderApiOfferSelect();
  const offer = activeApiOffer();
  const key = offer?.publicKey || 'SUA_CREDENCIAL_DA_OFERTA';
  const base = window.location.origin;
  $('#api-selected-offer').textContent = offer ? offer.name : 'Sem oferta';
  $('#api-public-key').textContent = key;
  $('#code-full').textContent = fullSnippet(base, key);
  $('#code-pix').textContent = pixSnippet(base, key);
  $('#code-status').textContent = statusSnippet(base, key);
  $('#code-track').textContent = trackSnippet(base, key);
  $('#api-endpoints-body').innerHTML = [
    ['Config publica', '/api/site/config', 'GET', 'Carregar paginas, pixels publicos, backredirects e flags da oferta.'],
    ['Pageview', '/api/lead/pageview', 'POST', 'Salvar visita unica por pagina e capturar UTMs de entrada.'],
    ['Track evento', '/api/lead/track', 'POST', 'Salvar etapa/evento do funil: quiz, dados, checkout, upsell, clique etc.'],
    ['Criar PIX', '/api/pix/create', 'POST', 'Gerar PIX com gateway principal e fallback automatico.'],
    ['Status PIX', '/api/pix/status', 'POST', 'Consultar e sincronizar status do PIX.'],
    ['Webhook gateway', '/api/pix/webhook?gateway=atomopay&offer_id=ID', 'POST', 'URL para colocar no gateway quando ele pedir webhook/postback.']
  ].map(([name, endpoint, method, use]) => `
    <tr>
      <td><strong>${escapeHtml(name)}</strong></td>
      <td><code>${escapeHtml(base + endpoint)}</code></td>
      <td>${escapeHtml(method)}</td>
      <td>${escapeHtml(use)}</td>
    </tr>
  `).join('');
}

function fullSnippet(base, key) {
  return `<script>
const LEOHUB_URL = '${base}';
const LEOHUB_OFFER_KEY = '${key}';

const leohubSessionId =
  localStorage.getItem('leohub_session_id') ||
  (crypto.randomUUID ? crypto.randomUUID() : 'lh_' + Date.now() + '_' + Math.random().toString(16).slice(2));

localStorage.setItem('leohub_session_id', leohubSessionId);

function leohubUtm() {
  const params = new URLSearchParams(location.search);
  const keys = ['src', 'sck', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ttclid', 'gclid'];
  return Object.fromEntries(keys.map((key) => [key, params.get(key)]).filter(([, value]) => value));
}

async function leohub(path, body = {}, method = 'POST') {
  const res = await fetch(LEOHUB_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-leohub-offer-key': LEOHUB_OFFER_KEY
    },
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
  return res.json();
}

// Cole em todas as paginas para salvar entrada, UTM, origem e pageview.
leohub('/api/lead/pageview', {
  sessionId: leohubSessionId,
  page: location.pathname,
  sourceUrl: location.href,
  referrer: document.referrer,
  utm: leohubUtm()
});

// Use em qualquer etapa do funil.
async function trackLeoHub(event, stage, extra = {}) {
  return leohub('/api/lead/track', {
    sessionId: leohubSessionId,
    event,
    stage,
    sourceUrl: location.href,
    utm: leohubUtm(),
    ...extra
  });
}

// Use no checkout para gerar o PIX.
async function gerarPixLeoHub(customer, amount, items = []) {
  return leohub('/api/pix/create', {
    sessionId: leohubSessionId,
    amount,
    customer,
    items,
    utm: leohubUtm(),
    sourceUrl: location.href
  });
}

// Use na pagina PIX para consultar pagamento.
async function consultarPixLeoHub(idTransaction) {
  return leohub('/api/pix/status', { idTransaction });
}
</script>`;
}

function pixSnippet(base, key) {
  return `const pix = await fetch('${base}/api/pix/create', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-leohub-offer-key': '${key}'
  },
  body: JSON.stringify({
    sessionId: leohubSessionId,
    amount: 19.90,
    customer: {
      name: 'Nome do cliente',
      email: 'cliente@email.com',
      phone: '11999999999',
      document: '12345678909'
    },
    items: [
      { title: 'Produto principal', price: 19.90, quantity: 1 }
    ],
    utm: leohubUtm()
  })
}).then((res) => res.json());

// pix.paymentCode = copia e cola
// pix.paymentQrUrl ou pix.paymentCodeBase64 = QR Code
// pix.idTransaction = use para consultar status`;
}

function statusSnippet(base, key) {
  return `async function esperarPagamento(idTransaction) {
  const status = await fetch('${base}/api/pix/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-leohub-offer-key': '${key}'
    },
    body: JSON.stringify({ idTransaction })
  }).then((res) => res.json());

  if (status.status === 'paid') {
    // Redirecione para obrigado/sucesso.
    location.href = '/sucesso.html';
    return;
  }

  setTimeout(() => esperarPagamento(idTransaction), 4000);
}`;
}

function trackSnippet(base, key) {
  return `await fetch('${base}/api/lead/track', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-leohub-offer-key': '${key}'
  },
  body: JSON.stringify({
    sessionId: leohubSessionId,
    event: 'checkout_view',
    stage: 'checkout',
    page: location.pathname,
    sourceUrl: location.href,
    referrer: document.referrer,
    utm: leohubUtm(),
    customer: {
      name: 'Nome se ja tiver',
      email: 'email@cliente.com',
      phone: '11999999999',
      document: '12345678909'
    }
  })
});`;
}

async function bootstrap() {
  if (!state.token) {
    $('#login-screen').classList.remove('hidden');
    $('#app-screen').classList.add('hidden');
    return;
  }
  try {
    const data = await api('/api/admin/bootstrap');
    state.offers = data.offers || [];
    $('#api-status-text').textContent = 'Online';
    $('#default-password-alert').classList.toggle('hidden', !data.defaultPassword);
    renderOffers();
    renderApiDocs();
    setHubTab(state.activeHubTab);
    $('#login-screen').classList.add('hidden');
    $('#app-screen').classList.remove('hidden');
  } catch (_error) {
    localStorage.removeItem('leohub.admin.token');
    state.token = '';
    $('#login-screen').classList.remove('hidden');
    $('#app-screen').classList.add('hidden');
  }
}

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
  } catch (_error) {
    $('#login-error').textContent = 'Senha invalida.';
  }
});

$('#show-create-offer').addEventListener('click', () => {
  $('#create-offer-panel').classList.toggle('hidden');
});

document.querySelectorAll('[data-hub-tab]').forEach((button) => {
  button.addEventListener('click', () => setHubTab(button.dataset.hubTab));
});

$('#api-offer-select').addEventListener('change', (event) => {
  state.apiOfferId = event.target.value;
  localStorage.setItem('leohub.api.offer', state.apiOfferId);
  renderApiDocs();
});

$('#copy-api-key').addEventListener('click', () => {
  navigator.clipboard?.writeText($('#api-public-key').textContent || '');
});

document.addEventListener('click', (event) => {
  const copyTarget = event.target.closest('[data-copy-target]');
  if (!copyTarget) return;
  const target = document.getElementById(copyTarget.dataset.copyTarget);
  navigator.clipboard?.writeText(target?.textContent || '');
  const previous = copyTarget.textContent;
  copyTarget.textContent = 'Copiado';
  setTimeout(() => { copyTarget.textContent = previous; }, 1100);
});

$('#create-offer-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = Object.fromEntries(form.entries());
  const result = await api('/api/admin/offers', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  openOffer(result.offer.id);
});

document.addEventListener('click', (event) => {
  const card = event.target.closest('[data-open-offer]');
  if (card) openOffer(card.dataset.openOffer);
});

$('#refresh-btn').addEventListener('click', bootstrap);

$('#logout-btn').addEventListener('click', () => {
  localStorage.removeItem('leohub.admin.token');
  state.token = '';
  location.reload();
});

bootstrap();
