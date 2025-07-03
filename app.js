import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import paymentRoutes from './routes/paymentRoute.js';
import couponsRouter from "./routes/coupons.js";


const app = express();
const server = http.createServer(app);

// ─── MIDDLEWARE ────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ─── ROUTES ────────────────────────────────────────────────
app.use('/api/payments', paymentRoutes);

// ─── HEALTHCHECK ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('🛠️  Payment API up and running');
});

app.use("/api/coupons", couponsRouter);


// ─── SERVER START ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
