// src/app.js
// Express application — middleware registration + route mounting only.
// No server.listen(), no cron, no workers. Those live in src/server.js.

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { SourceMapConsumer } from 'source-map';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Config ───────────────────────────────────────────────────────────────────
import { corsOptions } from './config/cors.js';
import { helmetOptions } from './config/security.js';

// ── Middleware ────────────────────────────────────────────────────────────────
import { errorHandler } from './middleware/error-handler.js';
import { rateLimit } from './middleware/rate-limit.js';
import { blockSourceMaps } from './middleware/security.js';
import { requestId } from './middleware/request-id.js';

// ── Routes (legacy — still pointing to the root-level routes/ folder until
//    each module's *.routes.js is fully implemented) ──────────────────────────
import paymentRoutes from './modules/payments/payments.routes.js';
import couponsRouter from './modules/coupons/coupons.routes.js';
import addressRoutes from './modules/addresses/addresses.routes.js';
import razorpayWebhookHandler from './modules/payments/webhooks.controller.js';
import testimonialRoutes from './modules/testimonials/testimonials.routes.js';
import reviewRoutes from './modules/reviews/reviews.routes.js';
import analyticsRoutes from "./modules/analytics/analytics.routes.js";
import intelligenceRoutes from "./modules/intelligence/intelligence.routes.js";
import userRoutes from './modules/users/users.routes.js';
import orderRoutes from './modules/orders/orders.routes.js';
import cartRoutes from './modules/cart/cart.routes.js';
import productRoutes from './modules/catalog/catalog.routes.js';
import variantRoutes from './modules/variants/variants.routes.js';
import bundleRoutes from './modules/bundles/bundles.routes.js';
import contactRoutes from './modules/contact/contact.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import promoRoutes from './modules/promo-notifications/promo-notifications.routes.js';
import cmsRoutes from './modules/cms/cms.routes.js';
import referralRouter from './modules/referrals/referrals.routes.js';
import rewardsRouter from './modules/rewards/rewards.routes.js';
import shiprocketRoutes from './modules/shipping/shipping.routes.js';
import otpRoutes from './modules/verification/otp/otp.routes.js';

import rbacRoutes from './modules/rbac/rbac.routes.js';
import supportRoutes from './modules/support/support.routes.js';
import siteRoutes from './modules/site/site.routes.js';
import aiRoutes from './modules/ai/ai.routes.js';
import auditRoutes from './infrastructure/audit/audit.routes.js';
import { siteStatusMiddleware } from './middleware/site-status.js';
import { withAuth } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust the reverse proxy (Render) so rate limiting works per user IP
app.set('trust proxy', 1);

// ── 1. Compression ───────────────────────────────────────────────────────────
app.use(compression());

// ── 2. Security headers ──────────────────────────────────────────────────────
app.use(helmet(helmetOptions));
app.use(blockSourceMaps);

// ── 3. Request ID ────────────────────────────────────────────────────────────
app.use(requestId);

// ── 4. CORS ──────────────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ── 5. Webhook route (must be before JSON parser) ────────────────────────────
// Shiprocket webhook needs raw buffer for signature verification
app.use(
  '/api/shipping/shiprocket/webhook',
  express.raw({ type: 'application/json' })
);

app.post(
  '/api/payments/razorpay-webhook',
  express.raw({ type: 'application/json' }),
  razorpayWebhookHandler
);

// ── 6. Body parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── 7. Global rate limiter ───────────────────────────────────────────────────
app.use(
  '/api/',
  rateLimit({
    windowSeconds: 300,
    max: 600,
    keyPrefix: 'rl:global',
    message: 'Too many requests from this connection. Please try again in a few minutes.',
  })
);

// ── 8. Error logger (client-side source-map decoder) ─────────────────────────
const errorStore = [];

async function mapErrorToSource(details) {
  try {
    if (!details.file || !details.line || !details.column) return details;
    const fileName = path.basename(details.file);
    const mapDir = path.resolve('./dist/assets');
    if (!fs.existsSync(mapDir)) { console.warn(`⚠️ Source map dir not found: ${mapDir}`); return details; }
    const mapFiles = fs.readdirSync(mapDir).filter((f) => f.endsWith('.map'));
    const mapFile = mapFiles.find((f) => f.startsWith(fileName.split('.')[0]));
    if (!mapFile) { console.warn(`⚠️ No source map found for ${fileName}`); return details; }
    const rawSourceMap = JSON.parse(fs.readFileSync(path.join(mapDir, mapFile), 'utf8'));
    const consumer = await new SourceMapConsumer(rawSourceMap);
    const orig = consumer.originalPositionFor({ line: details.line, column: details.column });
    consumer.destroy();
    return { ...details, originalFile: orig.source, originalLine: orig.line, originalColumn: orig.column, originalName: orig.name };
  } catch (err) {
    console.error('Source map decode failed:', err);
    return details;
  }
}

app.post('/api/log-error', async (req, res) => {
  let { type, details, ...meta } = req.body;
  if (details?.file && details?.line && details?.column) details = await mapErrorToSource(details);
  const entry = { id: Date.now(), type, details, ...meta };
  errorStore.push(entry);
  console.error('🔥 Error captured:', entry);
  res.sendStatus(200);
});

// ── 9. Routes ────────────────────────────────────────────────────────────────
app.use('/api/site', siteRoutes); // Mount first so it's not blocked

app.use(withAuth); // Populate req.auth globally for site status check
app.use(siteStatusMiddleware); // Global site status lock

app.use('/api/payments', paymentRoutes);
app.use('/api/coupons', couponsRouter);
app.use('/api/address', addressRoutes);
app.use('/api/testimonials', testimonialRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/intelligence", intelligenceRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/products', productRoutes);
app.use('/api/bundles', bundleRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/variants', variantRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/promos', promoRoutes);
app.use('/api/cms', cmsRoutes);
app.use('/api/referrals', referralRouter);
app.use('/api/rewards', rewardsRouter);
app.use('/api/shipping/shiprocket', shiprocketRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/rbac', rbacRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/support/ai', aiRoutes);
app.use('/api/admin/audit-logs', auditRoutes);

// ── 10. Static uploads ────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── 11. Health & ping ─────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/', (_req, res) => res.send('🛠️ Payment API running'));
app.get('/wake-up', (_req, res) => {
  console.log('✅ Ping received! Keeping the service awake.');
  res.send('✅ Devid Aura backend awake');
});

// ── 12. Global error handler (must be last) ───────────────────────────────────
app.use(errorHandler);

export default app;
