const state = {
  token: localStorage.getItem('leohub.admin.token') || '',
  offers: []
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
