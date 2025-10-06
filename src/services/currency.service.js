const axios = require("axios");

const baseUrl = process.env.Exchange_URL;
const apiKey = process.env.Exchange_API;

let cachedRates = null; // stores USD→EGP, AED→EGP, SAR→EGP
let lastFetched = null;
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

async function convertToEGP(amount, from) {
    try {
        const now = Date.now();
        await axios.get(`${baseUrl}/${apiKey}/latest/EGP`);

        // Refresh cache if empty or expired
        if (!cachedRates || now - lastFetched > CACHE_TTL) {
            console.log("Fetching fresh currency rates...");

            // Fetch all relative to EGP
            const response = await axios.get(`${baseUrl}/${apiKey}/latest/EGP`);

            if (response.data.result !== "success") {
                throw new Error("Failed to fetch exchange rates");
            }

            const rates = response.data.conversion_rates;

            // Store only USD, AED, SAR relative to EGP
            cachedRates = {
                USD: 1 / rates.USD, // since base is EGP
                AED: 1 / rates.AED,
                SAR: 1 / rates.SAR,
            };

            lastFetched = now;
        }

        if (!cachedRates[from]) {
            throw new Error(`Unsupported currency: ${from}`);
        }

        // Convert → EGP
        const converted = (amount * cachedRates[from]).toFixed(2);
        return Number(converted);

    } catch (err) {
        console.error("Currency conversion error:", err.message);
        throw err;
    }
}

module.exports = { convertToEGP };
