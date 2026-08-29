const DHAN_ORDERS_URL = 'https://api.dhan.co/v2/orders';

async function placeDhanOrder({
  accessToken,
  clientId,
  securityId,
  transactionType,
  quantity,
  orderType = 'LIMIT',
  price,
  productType = 'CNC',
  exchangeSegment = 'NSE_EQ',
}, fetchImpl = fetch) {
  const body = {
    dhanClientId: clientId,
    transactionType,
    exchangeSegment,
    productType,
    orderType,
    validity: 'DAY',
    securityId: String(securityId),
    quantity: Number(quantity),
    price: Number(price),
    afterMarketOrder: false,
  };

  const resp = await fetchImpl(DHAN_ORDERS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'access-token': accessToken,
      'client-id': clientId,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.message || data.errorMessage || `Dhan order failed HTTP ${resp.status}`);
  }
  return data;
}

function calcPositionSize(capital, riskPct, riskPerShare) {
  if (!riskPerShare || riskPerShare <= 0) return 0;
  const riskAmount = capital * (riskPct / 100);
  return Math.floor(riskAmount / riskPerShare);
}

module.exports = { placeDhanOrder, calcPositionSize };
