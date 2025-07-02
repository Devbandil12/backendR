// src/controllers/paymentController.js

import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../configs';                     // adjust path to your DB config
import { ordersTable } from '../configs/schema';     // your Drizzle schema
import { eq } from 'drizzle-orm';

const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

/**
 * Creates a new Razorpay order.
 */
export const createOrder = async (req, res) => {
  try {
    const { user, phone, amount } = req.body;
    if (!user) {
      return res.status(401).json({ success: false, msg: "Please log in." });
    }

    const amountInPaise = amount * 100;
    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`,    // customize as needed
    };

    razorpay.orders.create(options, (err, order) => {
      if (err) {
        console.error('Razorpay order creation failed:', err);
        return res
          .status(400)
          .json({ success: false, msg: 'Could not create order.' });
      }

      res.status(200).json({
        success: true,
        msg: 'Order created',
        orderId: order.id,
        amount: amountInPaise,
        keyId: RAZORPAY_ID_KEY,
        name: user.fullName,
        email: user.primaryEmailAddress?.emailAddress,
        contact: phone,
      });
    });
  } catch (error) {
    console.error('CreateOrder error:', error);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
};

/**
 * Verifies a completed payment by checking the HMAC signature.
 */
export const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    // Generate HMAC on server
    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_SECRET_KEY)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature === razorpay_signature) {
      return res.json({ success: true, msg: "Payment verified successfully." });
    } else {
      return res
        .status(400)
        .json({ success: false, error: "Payment verification failed." });
    }
  } catch (error) {
    console.error('verifyPayment error:', error);
    res.status(500).json({ success: false, error: 'Verification error.' });
  }
};

/**
 * Issues a refund for a payment and persists the refund details.
 */
export const refundPayment = async (req, res) => {
  try {
    const { transactionId, paymentId, amount, speed } = req.body;
    if (!transactionId || !paymentId || !amount) {
      return res.status(400).json({
        success: false,
        error: "Missing transactionId, paymentId, or amount",
      });
    }

    // 1) Issue refund via Razorpay SDK
    const refund = await razorpay.payments.refund(paymentId, {
      amount,
      speed: speed || 'optimum',
    });

    console.log('Refund created:', refund);

    // 2) Persist refund details in your orders table
    await db
      .update(ordersTable)
      .set({
        refund_id:           refund.id,
        refund_amount:       refund.amount,
        refund_status:       refund.status,
        refund_speed:        refund.speed,
        refund_initiated_at: new Date(refund.created_at * 1000).toISOString(),
        refund_completed_at:
          refund.status === 'processed' && refund.processed_at
            ? new Date(refund.processed_at * 1000).toISOString()
            : null,
        // Optionally update your order status column
        status: refund.status === 'processed' ? 'Order Cancelled' : undefined,
      })
      .where(eq(ordersTable.transaction_id, transactionId));

    // 3) Return refund object to client
    res.json({ success: true, refund });
  } catch (error) {
    console.error('refundPayment error:', error);
    res
      .status(500)
      .json({ success: false, error: error.message || 'Refund failed.' });
  }
};
