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
      couponCode = null,
      paymentMode = 'online',
      cartItems,
    } = req.body;

    // 1️⃣ Validate basic request
    if (!user) {
      return res.status(401).json({ success: false, msg: 'Please log in first' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }

    // 2️⃣ Recalculate total from database (ignore client totals)
    let originalTotal = 0;
    let productTotal = 0;

    for (const item of cartItems) {
      const [product] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, item.id));

      if (!product) {
        return res.status(400).json({ success: false, msg: `Invalid product: ${item.id}` });
      }

      const discountedPrice = Math.floor(product.oprice * (1 - product.discount / 100));

      originalTotal += product.oprice * item.quantity;
      productTotal += discountedPrice * item.quantity;

      // Mutate item for secure use later
      item.productName = product.name;
      item.img = product.imageurl;
      item.size = product.size;
      item.price = discountedPrice;
    }

    // 3️⃣ Validate and apply coupon
    let discountAmount = 0;
    if (couponCode) {
      const [coupon] = await db
        .select({
          code: couponsTable.code,
          discountType: couponsTable.discountType,
          discountValue: couponsTable.discountValue,
          minOrderValue: couponsTable.minOrderValue,
          validFrom: couponsTable.validFrom,
          validUntil: couponsTable.validUntil,
        })
        .from(couponsTable)
        .where(eq(couponsTable.code, couponCode));

      if (!coupon) {
        return res.status(400).json({ success: false, msg: 'Invalid coupon code' });
      }

      const now = new Date();
      if ((coupon.validFrom && now < coupon.validFrom) ||
        (coupon.validUntil && now > coupon.validUntil) ||
        productTotal < coupon.minOrderValue) {
        return res.status(400).json({ success: false, msg: 'Coupon not applicable' });
      }

      discountAmount = coupon.discountType === 'percent'
        ? Math.floor(productTotal * (coupon.discountValue / 100))
        : coupon.discountValue;
    }

    const finalAmount = Math.max(productTotal - discountAmount, 0);


    const clientSentAmount = Number(req.body.amount); // this comes from frontend (optional in your case)

    // Compare client and server totals (rupee values)
    if (Math.abs(finalAmount - clientSentAmount) > 1) {
      return res.status(400).json({
        success: false,
        msg: `Amount mismatch: server calculated ₹${finalAmount}, but client sent ₹${clientSentAmount}. Please refresh and try again.`,
      });
    }


    // 4️⃣ Create Razorpay order
    const amountPaise = finalAmount * 100;
    const razorOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: user.id,
    });

    // 5️⃣ Store order + line items in DB transaction
    const orderId = `DA${Date.now()}`;
    await db.transaction(async (tx) => {
      await tx.insert(ordersTable).values({
        id: orderId,
        userId: user.id,
        razorpay_order_id: razorOrder.id,
        totalAmount: finalAmount,
        status: 'order placed',
        paymentMode,
        transactionId: null,
        paymentStatus: 'created',
        phone,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        couponCode,
        discountAmount,
      });

      const itemsToInsert = cartItems.map(item => ({
        id: `DA${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        orderId,
        productName: item.productName,
        img: item.img,
        size: item.size,
        productId: item.id,
        quantity: item.quantity,
        price: item.price,
        totalPrice: item.quantity * item.price,
      }));

      await tx.insert(orderItemsTable).values(itemsToInsert);
    });

    // 6️⃣ Respond with checkout data
    return res.json({
      success: true,
      orderId: razorOrder.id,
      amount: amountPaise,
      keyId: process.env.RAZORPAY_ID_KEY,
      discountAmount: discountAmount * 100,
      name: user.fullName,
      email: user.primaryEmailAddress.emailAddress,
      contact: phone,
      originalAmount: originalTotal * 100,
    });

  } catch (err) {
    console.error('createOrder error:', err);
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
        updatedAt: new Date().toISOString(),
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
        paymentStatus: 'refunded',
        refund_id: refund.id,
        refund_amount: refund.amount,
        refund_status: refund.status,
        refund_speed: refund.speed_processed,
        refund_initiated_at: new Date(refund.created_at * 1000),
        refund_completed_at: refund.status === 'processed'
          ? new Date(refund.processed_at * 1000)
          : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(ordersTable.id, orderId));

    // 4) Return full payload including both speeds
    return res.json({
      success: true,
      refund: {
        id: refund.id,
        amount: refund.amount,
        status: refund.status,
        speedRequested: refund.speed_requested,
        speedProcessed: refund.speed_processed,
        createdAt: refund.created_at,
        processedAt: refund.processed_at,
        currency: refund.currency,
      }
    });
  } catch (err) {
    console.error("refund error:", err);
    return res.status(500).json({ success: false, error: err.error_description || err.message });
  }
};
