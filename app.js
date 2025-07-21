// server.js

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';

import paymentRoutes from './routes/paymentRoute.js';
import couponsRouter from './routes/coupons.js';
import addressRoutes from "./routes/addressRoutes.js";

import { razorpayWebhookHandler } from './routes/paymentRoute.js';


const app = express();
const server = http.createServer(app);

// 1) CORS
app.use(cors({
  origin: [
    "https://www.devidaura.com",
    "https://devidaura.com",
    "http://localhost:3000",
    "http://localhost:5173",
  ],
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  credentials: true,
}));
app.options('*', cors());

// ─── BODY PARSERS ────────────────────────────────────────────────
// Only the webhook needs a raw body. Mount that first:

app.post(
  '/api/payments/razorpay-webhook',
  express.raw({ type: 'application/json' }),
  razorpayWebhookHandler  // ✅ DIRECTLY call the handler function
);


// Now mount the normal JSON/body‐parser for everything else:
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ─── ROUTES ─────────────────────────────────────────────────────
// Payments (excluding /webhook, which was mounted above raw)
app.use('/api/payments', paymentRoutes);

// Coupons
app.use('/api/coupons', couponsRouter);

// address 
app.use("/api/address", addressRoutes);

// ─── HEALTHCHECK ────────────────────────────────────────────────
app.get('/', (req, res) => res.send('🛠️  Payment API up and running'));

// ─── START ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
