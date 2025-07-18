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
    const { user, phone, couponCode = null, paymentMode = 'online', cartItems } = req.body;

    // 1️⃣ Basic validation
    if (!user) {
      return res.status(401).json({ success: false, msg: 'Please log in first' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }

    // 2️⃣ Recompute totals
    let productTotal = 0;
    let discountAmount = 0;
    const deliveryCharge = 0;

    // 3️⃣ Generate our own orderId up front!
    const orderId = `DA${Date.now()}`;

    // 4️⃣ Build enrichedItems in one pass
    const enrichedItems = [];
    for (const item of cartItems) {
      const [product] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, item.id));

      if (!product) {
        return res.status(400).json({ success: false, msg: `Invalid product: ${item.id}` });
      }

      const unitPrice = Math.floor(product.oprice * (1 - product.discount / 100));
      productTotal += unitPrice * item.quantity;

      enrichedItems.push({
        id: `DA${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        orderId,             // ← now defined
        productId: item.id,
        quantity: item.quantity,
        productName: product.name,
        img:         product.imageurl,
        size:        product.size,
        price:       unitPrice,
        totalPrice:  unitPrice * item.quantity,
      });
    }

    // 5️⃣ Apply coupon
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
        (coupon.validFrom  && now < coupon.validFrom)  ||
        (coupon.validUntil && now > coupon.validUntil) ||
        productTotal < coupon.minOrderValue
      ) {
        return res.status(400).json({ success: false, msg: 'Coupon not applicable' });
      }

      discountAmount = coupon.discountType === 'percent'
        ? Math.floor((coupon.discountValue / 100) * productTotal)
        : coupon.discountValue;
    }

    // 6️⃣ Final amount
    const finalAmount = Math.max(productTotal + deliveryCharge - discountAmount, 0);

    // 7️⃣ Razorpay order
    const razorOrder = await razorpay.orders.create({
      amount:   finalAmount * 100,
      currency: 'INR',
      receipt:  user.id,
    });

    // 8️⃣ Persist order + items
    await db.insert(ordersTable).values({
      id:                orderId,
      userId:            user.id,
      razorpay_order_id: razorOrder.id,
      totalAmount:       finalAmount,
      status:            'order placed',
      paymentMode,
      transactionId:     null,
      paymentStatus:     'created',
      phone,
      createdAt:         new Date().toISOString(),
      updatedAt:         new Date().toISOString(),
      couponCode,
      discountAmount,
    });

    await db.insert(orderItemsTable).values(enrichedItems);

    // 9️⃣ Respond
    return res.json({
      success: true,
      orderId: razorOrder.id,
      keyId:   RAZORPAY_ID_KEY,
      amount:  finalAmount,
      breakdown: { productTotal, deliveryCharge, discountAmount },
    });

  } catch (err) {
    console.error('createOrder error:', err);
    return res.status(500).json({ success: false, msg: 'Server error' });
  }
};


export const verifyPayment = async (req, res) => {
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
