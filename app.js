// server.js (or index.js)

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';

const app = express();
const server = http.createServer(app);

// ─── ENABLE CORS FOR ALL ROUTES ─────────────────────────────────
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
app.options('*', cors()); // handle preflight

// ─── BODY PARSERS ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ─── ROUTES ─────────────────────────────────────────────────────
import paymentRoutes from './routes/paymentRoute.js';
import couponsRouter from './routes/coupons.js';

app.use('/api/payments', paymentRoutes);
app.use('/api/coupons',  couponsRouter);

// ─── HEALTHCHECK ────────────────────────────────────────────────
app.get('/', (req, res) => res.send('🛠️  Payment API up and running'));

// ─── START SERVER ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
