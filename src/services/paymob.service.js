const axios = require("axios");

const API_KEY = process.env.PAYMOB_API_KEY;
const INTEGRATION_ID = process.env.PAYMOB_INTEGRATION_ID;

async function getAuthToken() {
    const res = await axios.post("https://accept.paymob.com/api/auth/tokens", {
        api_key: API_KEY,
    });
    return res.data.token;
}

async function createOrder(authToken, amount, currency, merchantOrderId) {
    const res = await axios.post(
        "https://accept.paymob.com/api/ecommerce/orders",
        {
            merchant_order_id: merchantOrderId,
            amount_cents: amount * 100,
            currency,
            items: [],
        },
        { headers: { Authorization: `Bearer ${authToken}` } }
    );
    return res.data.id;
}

async function getPaymentKey(authToken, orderId, amount, currency) {
    const res = await axios.post(
        "https://accept.paymob.com/api/acceptance/payment_keys",
        {
            amount_cents: amount * 100,
            currency,
            order_id: orderId,
            integration_id: INTEGRATION_ID
        },
        { headers: { Authorization: `Bearer ${authToken}` } }
    );
    return res.data.token;
}

module.exports = { getAuthToken, createOrder, getPaymentKey };
