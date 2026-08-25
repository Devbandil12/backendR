import express from "express";
import * as OrdersController from "./orders.controller.js";
import { cache } from "../../infrastructure/cache/cache.service.js";
import { makeAllOrdersKey, makeAdminOrdersReportKey } from "../../infrastructure/cache/cache.keys.js";
import { requireAuth, verifyAdmin, requirePermission } from "../../middleware/auth.js";
import { idempotency } from "../../middleware/idempotency.js";

const requiredReturnEnvs = [
  'RETURN_CUSTOMER_NAME', 'RETURN_PHONE', 'RETURN_ADDRESS',
  'RETURN_CITY', 'RETURN_STATE', 'RETURN_PINCODE', 'RETURN_COUNTRY'
];
const missingEnvs = requiredReturnEnvs.filter(env => !process.env[env]);
if (missingEnvs.length > 0) {
  throw new Error(`🚨 FATAL STARTUP ERROR: Missing required environment variables for reverse pickups: ${missingEnvs.join(', ')}. Please add them to your .env file to prevent misdelivered returns.`);
}

const router = express.Router();

/* ------------------------------------------------------
   👑 ADMIN ROUTES
------------------------------------------------------ */
router.get("/admin/dashboard-stats", requireAuth, requirePermission('orders.view'), OrdersController.getDashboardStats);
router.get("/admin/attention-counts", requireAuth, requirePermission('orders.view'), OrdersController.getAttentionCounts);
router.get("/admin/summary", requireAuth, requirePermission('orders.view'), OrdersController.getOrderSummary);
router.get("/", requireAuth, requirePermission('orders.view'), cache((req) => {
  const qs = new URLSearchParams(req.query).toString();
  return makeAllOrdersKey(qs);
}, 600), OrdersController.getAllOrders);
router.get("/details/for-reports", requireAuth, requirePermission('orders.export'), cache(makeAdminOrdersReportKey(), 3600), OrdersController.getReportDetails);
router.put("/bulk-status", requireAuth, requirePermission('orders.bulk_update'), idempotency, OrdersController.bulkStatusUpdate);
router.post("/admin/ship-preview", requireAuth, requirePermission('orders.ship'), OrdersController.shipPreview);
router.post("/admin/ship-now", requireAuth, requirePermission('orders.ship'), idempotency, OrdersController.shipNow);
router.put("/:id/status", requireAuth, requirePermission('orders.update_status'), idempotency, OrdersController.updateStatus);
router.put("/:id/cancel", requireAuth, requirePermission('orders.cancel'), idempotency, OrdersController.cancelOrder);
router.post("/:id/notes", requireAuth, requirePermission('orders.update_status'), idempotency, OrdersController.addOrderNote);
router.post("/:id/admin-returns", requireAuth, requirePermission('orders.return'), idempotency, OrdersController.initiateAdminReturn);
router.post("/:id/admin-refunds", requireAuth, requirePermission('orders.refund'), idempotency, OrdersController.initiateAdminRefund);

/* ------------------------------------------------------
   🟢 PUBLIC/USER ROUTES (Require Auth)
------------------------------------------------------ */
router.get("/stream", (req, res, next) => {
  if (req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, requireAuth, OrdersController.streamOrderEvents);
router.post("/get-my-orders", requireAuth, OrdersController.getMyOrders);
router.get("/:id", requireAuth, OrdersController.getOrderById);
router.get("/:id/invoice", requireAuth, OrdersController.getInvoice);
router.post("/:id/return", requireAuth, idempotency, OrdersController.initiateReturn);

export default router;
