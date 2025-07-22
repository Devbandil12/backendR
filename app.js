// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';

import paymentRoutes from './routes/paymentRoute.js';
import couponsRouter from './routes/coupons.js';
import addressRoutes from './routes/addressRoutes.js';
import razorpayWebhookHandler from './controllers/webhookController.js';

const app = express();
const server = http.createServer(app);

// ───── CORS ─────
app.use(cors({
  origin: [
    "https://www.devidaura.com",
    "https://devidaura.com",
    "http://localhost:3000",
    "http://localhost:5173",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
}));
app.options('*', cors());

// ───── Webhook route with raw body (MUST come before express.json) ─────
app.post(
  '/api/payments/razorpay-webhook',
  express.raw({ type: 'application/json' }),
  razorpayWebhookHandler
);

// ───── JSON body parser for other routes ─────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ───── Other Routes ─────
app.use('/api/payments', paymentRoutes);
app.use('/api/coupons', couponsRouter);
app.use('/api/address', addressRoutes);

// ───── Healthcheck ─────
app.get('/', (req, res) => res.send('🛠️ Payment API running'));

// ───── Start Server ─────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
