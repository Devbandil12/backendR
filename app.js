// file app.js
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import net from 'net'; // Built-in Node module
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { SourceMapConsumer } from 'source-map'; // 👈 added
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // 🟢 1. Import this
import { errorHandler } from './middleware/errorHandler.js'; // 🟢 Import this
import { rateLimit } from './middleware/rateLimiter.js'; // 🟢 FIX: general request rate limiting

// 🟢 2. Define __dirname manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ⚡ PERFORMANCE & SECURITY PACKAGES
import compression from 'compression'; // Compress JSON response (Huge speedup)
import helmet from 'helmet'; // Security headers (Fixes CSP/HSTS issues)

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
import { initCronJobs } from './services/cron.service.js'; 
import cmsRoutes from './routes/cms.js';
import { startEmailWorker } from './services/emailQueue.js';
import referralRouter from "./routes/referral.js";
import rewardsRouter from "./routes/rewards.js";
import shiprocketRoutes from "./routes/shiprocket.js";
import checkoutOtpRoutes from "./routes/checkoutOtp.js"; // 🟢 NEW: COD WhatsApp OTP verification
import phoneVerificationRoutes from "./routes/phoneVerification.js"; // 🟢 NEW: Part A2/A3 — general phone verification

const app = express();
const server = http.createServer(app);

// ⚡ 1. ENABLE GZIP COMPRESSION (Must be top level)
app.use(compression());

// ⚡ 2. ENABLE SECURITY HEADERS
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow images to load
}));

app.use((req, res, next) => {
  if (req.path.endsWith('.map')) {
    return res.status(403).send('Source map access is forbidden.');
  }
  next();
});

app.use((err, req, res, next) => {
  console.error("🔥 Error Middleware:", err.message);
  
  if (err.message === 'Unauthenticated') {
    return res.status(401).json({ error: "Unauthorized: You must be logged in." });
  }
  
  res.status(500).json({ error: "Internal Server Error" });
});

// ───── CORS ─────
app.use(cors({
  origin: [
    "https://www.devidaura.com",
    "https://devidaura.com",
    "http://localhost:5173",
    "http://localhost:4173",
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

// 🟢 FIX: General-purpose rate limiting for all API traffic. This is
// deliberately generous (it's a backstop against scraping/abuse, not the
// main defense for sensitive endpoints) — see paymentRoute.js and
// coupons.js for tighter, route-specific limits on payments and coupon
// validation.
app.use('/api/', rateLimit({
  windowSeconds: 300,
  max: 600,
  keyPrefix: 'rl:global',
  message: 'Too many requests from this connection. Please try again in a few minutes.',
}));



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
app.use('/api/cms', cmsRoutes);
app.use("/api/referrals", referralRouter); // 🟢 THIS IS MISSING
app.use("/api/rewards", rewardsRouter); // 🟢 THIS IS MISSING
app.use("/api/shipping/shiprocket", shiprocketRoutes);
app.use("/api/checkout-otp", checkoutOtpRoutes); // 🟢 NEW: COD WhatsApp OTP verification
app.use("/api/phone-verification", phoneVerificationRoutes); // 🟢 NEW: Part A2/A3
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// ───── Global Error Handler (Must be after all routes) ─────
app.use(errorHandler);

// ───── Healthcheck & Root ─────
app.get('/', (req, res) => res.send('🛠️ Payment API running'));
app.get('/wake-up', (req, res) => {
  console.log('✅ Ping received! Keeping the service awake.'); 
  res.send('✅ Devid Aura backend awake');
});

// app.get('/api/debug-network', async (req, res) => {
//   try {
//     // 1. Get Public IP
//     const ipRes = await fetch('https://api.ipify.org?format=json');
//     const ipData = await ipRes.json();
    
//     // 2. Test Connection to Gmail
//     const host = 'smtp.gmail.com';
//     const port = 465;
    
//     let connectionLog = [];
//     const start = Date.now();

//     const result = await new Promise((resolve) => {
//       const socket = new net.Socket();
//       socket.setTimeout(5000); // 5 second timeout

//       connectionLog.push(`Attempting to connect to ${host}:${port}...`);

//       socket.connect(port, host, () => {
//         connectionLog.push('✅ Connection Established! (Network is OK)');
//         socket.end();
//         resolve('SUCCESS');
//       });

//       socket.on('timeout', () => {
//         connectionLog.push('❌ Connection TIMED OUT (Blocked by Firewall/Gmail)');
//         socket.destroy();
//         resolve('TIMEOUT');
//       });

//       socket.on('error', (err) => {
//         connectionLog.push(`❌ Connection Error: ${err.message}`);
//         resolve('ERROR');
//       });
//     });

//     res.json({
//       server_ip: ipData.ip,
//       connection_status: result,
//       logs: connectionLog,
//       duration: `${Date.now() - start}ms`
//     });

//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });


// ───── Initialize Cron Jobs ─────
initCronJobs();
startEmailWorker();

// ───── Start Server ─────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});