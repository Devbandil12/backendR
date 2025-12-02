// file app.js

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
import variantRoutes from "./routes/variants.js";
import bundleRoutes from "./routes/bundles.js";
import contactRoutes from "./routes/contact.js";
import notificationRoutes from './routes/notifications.js';
import promoRoutes from './routes/promoNotifications.js';
const app = express();
const server = http.createServer(app);

// ───── CORS ─────
app.use(cors({
  origin: [
    "https://www.devidaura.com",
    "https://devidaura.com",
    "http://localhost:5173",
    "http://localhost:3000",
  ],
  methods: ["GET", "POST", "PUT", "DELETE",'PATCH', "OPTIONS"],
  credentials: true,
}));
app.options('*', cors());

// ───── Webhook route (must be before JSON parser) ─────
app.post(
  '/api/payments/razorpay-webhook',
  express.raw({ type: 'application/json' }),
  razorpayWebhookHandler
);


// ───── JSON Body Parser (must be before routes using req.body) ─────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));



const errorStore = [];

// ───── Utility: map error to original source dynamically ─────
async function mapErrorToSource(details) {
  try {
    if (!details.file || !details.line || !details.column) return details;

    const fileName = path.basename(details.file); // e.g., index-DMyYtHyF.js
    const mapDir = path.resolve("./dist/assets");

    // Find a matching .map file in the directory
    const mapFiles = fs.readdirSync(mapDir).filter(f => f.endsWith(".map"));
    const mapFile = mapFiles.find(f => f.startsWith(fileName.split(".")[0]));

    if (!mapFile) {
      console.warn(`⚠️ No source map found for ${fileName}`);
      return details;
    }

    const mapFilePath = path.join(mapDir, mapFile);
    const rawSourceMap = JSON.parse(fs.readFileSync(mapFilePath, "utf8"));
    const consumer = await new SourceMapConsumer(rawSourceMap);

    const orig = consumer.originalPositionFor({
      line: details.line,
      column: details.column,
    });

    consumer.destroy();

    return {
      ...details,
      originalFile: orig.source,
      originalLine: orig.line,
      originalColumn: orig.column,
      originalName: orig.name,
    };
  } catch (err) {
    console.error("Source map decode failed:", err);
    return details;
  }
}

// ───── Error Logging API ─────
app.post("/api/log-error", async (req, res) => {
  let { type, details, ...meta } = req.body;

  if (details?.file && details?.line && details?.column) {
    details = await mapErrorToSource(details);
  }

  const entry = {
    id: Date.now(),
    type,
    details,
    ...meta,
  };

  errorStore.push(entry);
  console.error("🔥 Error captured:", entry);

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
app.use("/api/variants", variantRoutes);
app.use("/api/bundles", bundleRoutes);
app.use("/api/contact", contactRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/promos', promoRoutes);

// ───── Healthcheck & Root ─────
app.get('/', (req, res) => res.send('🛠️ Payment API running'));
app.get('/wake-up', (req, res) => {
  console.log('✅ Ping received! Keeping the service awake.'); 
  res.send('✅ DevidAura backend awake');
});

// ───── Start Server ─────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
