const express = require('express');
const axios = require('axios');
const moment = require('moment');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Read config from environment variables for safety and flexibility
const shortcode = process.env.MPESA_SHORTCODE;
const consumerKey = '3kPrqyYQykRoyoInl3P3tKU9DbL2RZHn3rvfJEud1iG9OqDi';
const consumerSecret = 'KJKOXneT9hiMKK4rr46P44PVhbmRZLRVnUL5cv95aEOl2NTviArqmbPbrW4NkFx3';
const passkey = 'bfb279f9aa9bdbcf15e97dd71a467cd2c2c7a1b1b204d17843c4fdd36f79c6e0';
const baseUrl = 'https://mpesa-stk-app.onrender.com/api/callback'; // e.g. https://your-app.onrender.com

if (!shortcode || !consumerKey || !consumerSecret || !passkey || !baseUrl) {
  console.error('ERROR: Missing one or more required environment variables!');
  process.exit(1);
}

const callbackURL = `${baseUrl}/api/callback`;

let cachedToken = null;
let tokenExpiry = null;
let paymentReceived = false;

// Get OAuth token from Safaricom
async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  try {
    const response = await axios.get(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );
    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000; // refresh 1 min early
    return cachedToken;
  } catch (error) {
    console.error('Error fetching access token:', error.response?.data || error.message);
    throw new Error('Failed to get access token');
  }
}

// Format Kenyan phone number to 2547XXXXXXXX
function formatPhone(phone) {
  phone = phone.trim();
  if (/^07\d{8}$/.test(phone)) return '254' + phone.slice(1);
  if (/^2547\d{8}$/.test(phone)) return phone;
  return null;
}

// STK Push endpoint
app.post('/api/stkpush', async (req, res) => {
  try {
    const { amount, phone } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    const formattedPhone = formatPhone(phone);
    if (!formattedPhone) {
      return res.status(400).json({ message: 'Invalid Kenyan phone number format' });
    }

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
      TransactionDesc: 'Payment from cashier app',
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    paymentReceived = false; // reset for polling

    return res.json({ message: 'STK Push initiated', data: response.data });
  } catch (error) {
    console.error('STK Push Error:', error.response?.data || error.message);
    return res.status(500).json({
      message: 'STK Push failed',
      error: error.response?.data || error.message,
    });
  }
});

// Callback endpoint for M-Pesa to notify payment results
app.post('/api/callback', (req, res) => {
  console.log('M-Pesa Callback received:', JSON.stringify(req.body, null, 2));

  const resultCode = req.body?.Body?.stkCallback?.ResultCode;
  if (resultCode === 0) {
    paymentReceived = true;
    console.log('✅ Payment successful');
  } else {
    console.log('❌ Payment failed or cancelled');
  }

  res.sendStatus(200);
});

// Endpoint for frontend to poll payment status
app.get('/payment-status', (req, res) => {
  res.json({ received: paymentReceived });
});

const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
