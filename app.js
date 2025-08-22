import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { SourceMapConsumer } from 'source-map'; // 👈 added
import fs from 'fs';
import path from 'path';

import paymentRoutes from './routes/paymentRoute.js';
import couponsRouter from './routes/coupons.js';
import addressRoutes from './routes/addressRoutes.js';
import razorpayWebhookHandler from './controllers/webhookController.js';
import testimonialRoutes from './routes/testimonials.js';
import reviewRoutes from './routes/reviewRoutes.js';
import userRoutes from "./routes/User.js";
import orderRoutes from "./routes/orders.js";
import cartRoutes from "./routes/cart.js";
import productRoutes from "./routes/products.js";
import contactRoutes from "./routes/contact.js";

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

// ───── Webhook route (must be before JSON parser) ─────
app.post(
  '/api/payments/razorpay-webhook',
  express.raw({ type: 'application/json' }),
  razorpayWebhookHandler
);

// ───── JSON Body Parser (for all other routes) ─────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '5mb' }));

// ───── Error Logging Route (with source map decoding) ─────
app.post("/api/log-error", async (req, res) => {
  const { details } = req.body;
  console.log("Client error reported:", req.body);

  try {
    // Example: load your built source map file
    const mapFilePath = path.resolve("./dist/assets/index-BvJ0xBDI.js.map");
    if (fs.existsSync(mapFilePath)) {
      const rawSourceMap = JSON.parse(fs.readFileSync(mapFilePath, "utf8"));
      const consumer = await new SourceMapConsumer(rawSourceMap);

      if (details.line && details.column) {
        const originalPos = consumer.originalPositionFor({
          line: details.line,
          column: details.column
        });

        console.log("🔎 Mapped Error Location:", originalPos);
      }

      consumer.destroy();
    } else {
      console.warn("⚠️ No source map file found.");
    }
  } catch (err) {
    console.error("Failed to process source map:", err);
  }

  res.sendStatus(200);
});

// ───── Routes ─────
app.use('/api/payments', paymentRoutes);
app.use('/api/coupons', couponsRouter);
app.use('/api/address', addressRoutes);
app.use('/api/testimonials', testimonialRoutes);
app.use('/api/reviews', reviewRoutes);
app.use("/api/users", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/products", productRoutes);
app.use("/api/contact", contactRoutes);

// ───── Healthcheck & Root ─────
app.get('/', (req, res) => res.send('🛠️ Payment API running'));
app.get('/wake-up', (req, res) => res.send('✅ DevidAura backend awake'));

// ───── Start Server ─────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
