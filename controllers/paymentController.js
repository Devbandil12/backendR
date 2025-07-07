// server/controllers/paymentController.js
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable, couponsTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

export const createOrder = async (req, res) => {
  try {
    const {
      user,
      phone,
      amount,            // original total in rupees
      couponCode,       // optional
      paymentMode = 'online'
    } = req.body;

    if (!user) {
      return res.status(401).json({ success: false, msg: "Please log in first" });
    }

    let discountAmount = 0;
    let finalAmount = Number(amount);

    // ── 1️⃣ Lookup & validate coupon (if provided) ─────────────
    if (couponCode) {
      const [coupon] = await db
        .select({
          code:           couponsTable.code,
          discountPct:    couponsTable.discountValue,
          minOrderValue:  couponsTable.minOrderValue,
          validFrom:      couponsTable.validFrom,
          validUntil:     couponsTable.validUntil
        })
        .from(couponsTable)
        .where(eq(couponsTable.code, couponCode));

      if (!coupon) {
        return res.status(400).json({ success: false, msg: 'Invalid coupon code' });
      }

      const now = new Date();
      if (coupon.validFrom && now < coupon.validFrom) {
        return res.status(400).json({ success: false, msg: 'Coupon not yet active' });
      }
      if (coupon.validUntil && now > coupon.validUntil) {
        return res.status(400).json({ success: false, msg: 'Coupon has expired' });
      }
      if (finalAmount < coupon.minOrderValue) {
        return res.status(400).json({
          success: false,
          msg: `Minimum order value for this coupon is ₹${coupon.minOrderValue}`
        });
      }

      // calculate discount in rupees
      discountAmount = Math.floor(finalAmount * (coupon.discountPct / 100));
      finalAmount = finalAmount - discountAmount;
    }

    // ── 2️⃣ Create Razorpay order for the discounted total ────────
    const amountPaise = finalAmount * 100;
    const options = {
      amount:   amountPaise,
      currency: 'INR',
      receipt:  user.id,
    };

    razorpay.orders.create(options, async (err, order) => {
      if (err) {
        console.error('Razorpay order creation failed:', err);
        return res.status(400).json({ success: false, msg: 'Order creation failed' });
      }

      const nowISOString = new Date().toISOString();

      // ── 3️⃣ Persist our order with coupon info ───────────────────
      await db.insert(ordersTable).values({
        id:             `DA${Date.now()}`,
        userId:         user.id,
        razorpay_order_id: order.id,            // ← persist the Razorpay order id
        totalAmount:    finalAmount,
        couponCode:     couponCode || null,
        discountAmount,
        paymentMode,
        transactionId:  null,
        paymentStatus:  'created',
        phone,
        createdAt:      nowISOString,
        updatedAt:      nowISOString,
      });

      // ── 4️⃣ Respond with all necessary data for checkout ────────
      return res.json({
        success:         true,
        orderId:         order.id,
        amount:          amountPaise,
        keyId:           RAZORPAY_ID_KEY,
        name:            user.fullName,
        email:           user.primaryEmailAddress.emailAddress,
        contact:         phone,
        originalAmount:  amount * 100,
        discountAmount:  discountAmount * 100,
      });
    });

  } catch (e) {
    console.error('createOrder error:', e);
    return res.status(500).json({ success: false, msg: 'Server error' });
  }
};

export const verify = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: "Missing fields" });
    }

    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_SECRET_KEY)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Verification failed" });
    }

    await db
      .update(ordersTable)
      .set({
        transactionId: razorpay_payment_id,
        paymentStatus: 'paid',
        updatedAt:     new Date().toISOString(),
      })
      .where(eq(ordersTable.razorpay_order_id, razorpay_order_id));

    return res.json({ success: true, message: "Payment verified successfully." });
  } catch (error) {
    console.error("verify error:", error);
    return res.status(500).json({ success: false, error: "Server error during verification." });
  }
};

export const refund = async (req, res) => {
  try {
    const { orderId, amount } = req.body;
    if (!orderId || !amount) {
      return res.status(400).json({ success: false, error: "Missing orderId or amount" });
    }

    // 1) Fetch existing payment ID
    const [order] = await db
      .select({ paymentId: ordersTable.transactionId })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    if (!order?.paymentId) {
      return res.status(404).json({ success: false, error: "Order or payment not found" });
    }

    // 2) Request refund at 'optimum' speed
    const refund = await razorpay.payments.refund(order.paymentId, {
      amount,
      speed: 'optimum',
    });

    // 3) Persist refund metadata
    await db
      .update(ordersTable)
      .set({
        paymentStatus:       'refunded',
        refund_id:           refund.id,
        refund_amount:       refund.amount,
        refund_status:       refund.status,
        refund_speed:        refund.speed_processed,
        refund_initiated_at: new Date(refund.created_at * 1000),
        refund_completed_at: refund.status === 'processed'
                              ? new Date(refund.processed_at * 1000)
                              : null,
        updatedAt:           new Date().toISOString(),
      })
      .where(eq(ordersTable.id, orderId));

    // 4) Return full payload including both speeds
    return res.json({
      success: true,
      refund: {
        id:             refund.id,
        amount:         refund.amount,
        status:         refund.status,
        speedRequested: refund.speed_requested,
        speedProcessed: refund.speed_processed,
        createdAt:      refund.created_at,
        processedAt:    refund.processed_at,
        currency:       refund.currency,
      }
    });
  } catch (err) {
    console.error("refund error:", err);
    return res.status(500).json({ success: false, error: err.error_description || err.message });
  }
};
