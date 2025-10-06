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

async function getPaymentKey(authToken, orderId, amount, currency, billingData) {
    const res = await axios.post(
        "https://accept.paymob.com/api/acceptance/payment_keys",
        {
            amount_cents: amount * 100,
            currency,
            order_id: orderId,
            integration_id: INTEGRATION_ID,
            billing_data: billingData,
        },
        { headers: { Authorization: `Bearer ${authToken}` } }
    );
    return res.data.token;
}

async function refundPaymentThroughPaymob(transactionId, amount = null) {
    try {
        const authToken = await getAuthToken();

        const payload = {
            auth_token: authToken,
            transaction_id: transactionId
        };

        if (amount) {
            payload.amount_cents = amount * 100; // optional partial refund
        }

        const res = await axios.post(
            "https://accept.paymob.com/api/acceptance/void_refund/refund",
            payload,
            { headers: { Authorization: `Bearer ${authToken}` } }
        );

        if (res.data && res.data.success) {
            return res.data;
        } else {
            throw new Error("Refund failed: " + JSON.stringify(res.data));
        }
    } catch (err) {
        console.error("Paymob refund error:", err.response?.data || err.message);
        throw err;
    }
}
module.exports = { getAuthToken, createOrder, getPaymentKey, refundPaymentThroughPaymob };
