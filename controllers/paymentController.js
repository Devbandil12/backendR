// server/controllers/paymentController.js
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable, couponsTable } from '../configs/schema.js';
import { productsTable, orderItemsTable } from '../configs/schema.js';
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

    // 1️⃣ Basic validation
    if (!user) {
      return res.status(401).json({ success: false, msg: 'Please log in first' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }

    // 2️⃣ Recompute all totals on the server
    let productTotal = 0;
    let discountAmount = 0;
    const deliveryCharge = 0;

    // Fetch each product, sum up discounted prices
    for (const item of cartItems) {
      const [product] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, item.id));

      if (!product) {
        return res.status(400).json({ success: false, msg: `Invalid product: ${item.id}` });
      }

      // unit price after product-level discount
      const unitPrice = Math.floor(product.oprice * (1 - product.discount / 100));
      productTotal += unitPrice * item.quantity;

      // Attach these for DB insert later
      item.productName = product.name;
      item.img = product.imageurl;
      item.size = product.size;
      item.price = unitPrice;
    }

    // 3️⃣ Apply coupon (if provided)
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
      if (
        (coupon.validFrom && now < coupon.validFrom) ||
        (coupon.validUntil && now > coupon.validUntil) ||
        productTotal < coupon.minOrderValue
      ) {
        return res.status(400).json({ success: false, msg: 'Coupon not applicable' });
      }

      discountAmount = coupon.discountType === 'percent'
        ? Math.floor((coupon.discountValue / 100) * productTotal)
        : coupon.discountValue;
    }

    // 4️⃣ Final server-computed amount (in rupees)
    const finalAmount = Math.max(productTotal + deliveryCharge - discountAmount, 0);

    // 5️⃣ Create Razorpay order (in paise)
    const razorOrder = await razorpay.orders.create({
      amount: finalAmount * 100,
      currency: 'INR',
      receipt: user.id,
    });

    // 6️⃣ Persist order + items in a transaction
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
        totalPrice: item.price * item.quantity,
      }));

      await tx.insert(orderItemsTable).values(itemsToInsert);
    });

    // 7️⃣ Respond with authoritative amounts & breakdown
    return res.json({
      success: true,
      orderId: razorOrder.id,
      keyId: process.env.RAZORPAY_ID_KEY,
      amount: finalAmount,           // rupees
      breakdown: {
        productTotal,
        deliveryCharge,
        discountAmount,
      },
    });

  } catch (err) {
    console.error('createOrder error:', err.stack || err.message || err);
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

     // 1) Fetch paymentId and current status/refundId
    const [order] = await db
      .select({
        paymentId: ordersTable.transactionId,
        status:    ordersTable.status,
        refundId:  ordersTable.refund_id,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    if (order.status !== "order placed") {
      return res.status(400).json({
        success: false,
        error: "Cannot cancel/refund after order has progressed",
      });
    }
    if (order.refundId) {
      return res.status(400).json({
        success: false,
        error: "Refund already initiated for this order",
      });
    }
    if (!order.paymentId) {
      return res.status(404).json({
        success: false,
        error: "No payment found to refund",
      });
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



export const getPriceBreakdown = async (req, res) => {
  try {
    const { cartItems, couponCode = null } = req.body;

    // Validate cart input
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }

    let originalTotal = 0;
    let productTotal = 0;
    let discountAmount = 0;
    const deliveryCharge = 0;

    // Calculate product total and original price
    for (const { id, quantity } of cartItems) {
      const [product] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, id));

      if (!product) {
        return res.status(400).json({ success: false, msg: `Invalid product: ${id}` });
      }

      const basePrice = Math.floor(product.oprice || 0);
      const discountedPrice = Math.floor(basePrice * (1 - (product.discount || 0) / 100));

      originalTotal += basePrice * quantity;
      productTotal += discountedPrice * quantity;
    }

    // Validate and apply coupon
    if (couponCode) {
      const [coupon] = await db
        .select({
          discountType:  couponsTable.discountType,
          discountValue: couponsTable.discountValue,
          minOrderValue: couponsTable.minOrderValue,
          validFrom:     couponsTable.validFrom,
          validUntil:    couponsTable.validUntil,
        })
        .from(couponsTable)
        .where(eq(couponsTable.code, couponCode));

      if (!coupon) {
        return res.status(400).json({ success: false, msg: 'Invalid coupon code' });
      }

      const now = new Date();
      if (
        (coupon.validFrom && now < new Date(coupon.validFrom)) ||
        (coupon.validUntil && now > new Date(coupon.validUntil)) ||
        productTotal < (coupon.minOrderValue || 0)
      ) {
        return res.status(400).json({ success: false, msg: 'Coupon not applicable' });
      }

      discountAmount = coupon.discountType === 'percent'
        ? Math.floor((coupon.discountValue / 100) * productTotal)
        : coupon.discountValue;
    }

    // Final total
    const total = Math.max(productTotal + deliveryCharge - discountAmount, 0);

    return res.json({
      success: true,
      breakdown: {
        originalTotal,
        productTotal,
        deliveryCharge,
        discountAmount,
        total,
      },
    });

  } catch (err) {
    console.error('getPriceBreakdown error:', err.stack || err);
    return res.status(500).json({ success: false, msg: 'Server error' });
  }
};
