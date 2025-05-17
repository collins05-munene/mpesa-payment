const express = require('express');
const axios = require('axios');
const moment = require('moment');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Load environment variables
const consumerKey = process.env.MPESA_CONSUMER_KEY;
const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
const shortcode = process.env.MPESA_SHORTCODE; // e.g., 174379
const passkey = process.env.MPESA_PASSKEY; // Sandbox passkey
const callbackURL = process.env.MPESA_CALLBACK_URL;

let cachedToken = null;
let tokenExpiry = null;
let paymentReceived = false;

// Get OAuth token
async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}` } }
  );

  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return cachedToken;
}

// Format Kenyan phone number
function formatPhone(phone) {
  phone = phone.trim();
  if (/^07\d{8}$/.test(phone)) return '254' + phone.slice(1);
  if (/^2547\d{8}$/.test(phone)) return phone;
  return null;
}

// STK Push Endpoint
app.post('/api/stkpush', async (req, res) => {
  try {
    const { amount, phone } = req.body;
    if (!amount || !phone) return res.status(400).json({ message: 'Amount and phone are required' });

    const formattedPhone = formatPhone(phone);
    if (!formattedPhone) return res.status(400).json({ message: 'Invalid Kenyan phone number' });

    const token = await getAccessToken();
    const timestamp = moment().format('YYYYMMDDHHmmss');
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: callbackURL,
      AccountReference: 'SME-Payment',
      TransactionDesc: 'Payment from SME cashier'
    };

    await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    paymentReceived = false; // reset before polling
    res.json({ message: 'STK Push initiated' });

  } catch (error) {
    console.error('STK Push Error:', error.response?.data || error.message);
    res.status(500).json({ message: 'STK Push failed', error: error.message });
  }
});

// Callback endpoint
app.post('/api/callback', (req, res) => {
  console.log('M-Pesa Callback:', JSON.stringify(req.body, null, 2));

  const resultCode = req.body?.Body?.stkCallback?.ResultCode;
  if (resultCode === 0) {
    paymentReceived = true;
    console.log('✅ Payment received!');
  } else {
    console.log('❌ Payment failed or cancelled.');
  }

  res.sendStatus(200);
});

// Endpoint for polling payment status
app.get('/payment-status', (req, res) => {
  res.json({ received: paymentReceived });
});

const PORT = process.env.PORT || 5500;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
