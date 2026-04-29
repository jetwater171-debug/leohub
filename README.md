# LEOHUB

Painel e API central para operar varias ofertas com uma credencial por oferta.

## Rodar local

```powershell
npm start
```

Abra `http://localhost:3333`.

Senha padrão local: `admin`

## Vercel + Supabase

1. Crie um projeto no Supabase.
2. Rode o SQL de `supabase/schema.sql` no SQL Editor.
3. Crie um projeto na Vercel apontando para essa pasta.
4. Configure as variaveis de ambiente na Vercel:

```env
LEOHUB_ADMIN_PASSWORD=sua-senha-forte
LEOHUB_BASE_URL=https://seu-projeto.vercel.app
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
LEOHUB_SUPABASE_STATE_TABLE=leohub_state
```

Sem `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, a LEOHUB usa `data/store.json` apenas para desenvolvimento local.

## Fluxo de integração

1. Crie uma oferta no painel.
2. Copie a credencial pública da oferta.
3. No frontend, chame a API da LEOHUB com `x-leohub-offer-key`.
4. A LEOHUB resolve tracking, PIX, gateway, fallback e integrações.

Exemplo:

```js
const response = await fetch('https://sua-leohub.com/api/v1/pix/create', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-leohub-offer-key': 'lh_pub_xxx'
  },
  body: JSON.stringify({
    amount: 29.9,
    sessionId: 'lead-123',
    customer: {
      name: 'Cliente Teste',
      email: 'cliente@email.com',
      document: '12345678909',
      phone: '11999999999'
    },
    items: [
      { title: 'Produto principal', price: 29.9, quantity: 1 }
    ],
    utm: {
      utm_source: 'facebook',
      utm_campaign: 'campanha'
    }
  })
});

const pix = await response.json();
```
