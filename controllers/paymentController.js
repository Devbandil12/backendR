// server/controllers/paymentController.js
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable, couponsTable } from '../configs/schema.js';
import { productsTable, orderItemsTable, UserAddressTable } from '../configs/schema.js';
import { eq, sql } from 'drizzle-orm';
// Import new helpers
import { invalidateMultiple } from '../invalidateHelpers.js';
import {
  makeAllOrdersKey,
  makeUserOrdersKey,
  makeAllProductsKey,
  makeProductKey,
  makeCartKey,
  makeCartCountKey,
} from '../cacheKeys.js';
import { getPincodeDetails } from './addressController.js';
const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

export const createOrder = async (req, res) => {
  try {
    const { user, phone, couponCode = null, paymentMode = 'online', cartItems, userAddressId } = req.body;

    if (!user) {
      return res.status(401).json({ success: false, msg: 'Please log in first' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }
    // Add validation for userAddressId when payment mode is COD
    if (paymentMode === 'cod' && !userAddressId) {
      return res.status(400).json({ success: false, msg: 'User address ID is required for COD orders' });
    }

    const [address] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, userAddressId));
    if (!address) {
      return res.status(404).json({ success: false, msg: "Address not found." });
    }

    let productTotal = 0;
    let discountAmount = 0;
    const pincodeDetails = await getPincodeDetails(address.postalCode);
    const deliveryCharge = pincodeDetails.deliveryCharge;
    
    // 🟢 orderId is declared here, *before* it is used in the loop
    const orderId = `DA${Date.now()}`;
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
        orderId, // 🟢 Now this is safe to use
        productId: item.id,
        quantity: item.quantity,
        productName: product.name,
        img: product.imageurl[0],
        size: product.size,
        price: unitPrice,
        totalPrice: unitPrice * item.quantity,
      });
    }

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

    const finalAmount = Math.max(productTotal + deliveryCharge - discountAmount, 0);

    if (paymentMode === 'cod' && !pincodeDetails.codAvailable) {
      return res.status(400).json({ success: false, msg: "Cash on Delivery is not available for this address." });
    }

    // ✅ If paymentMode is 'cod', insert order now
    if (paymentMode === 'cod') {
      await db.insert(ordersTable).values({
        id: orderId,
        userId: user.id,
        userAddressId,
        razorpay_order_id: null,
        totalAmount: finalAmount,
        status: 'Order Placed',
        paymentMode: 'cod',
        transactionId: null,
        paymentStatus: 'pending',
        phone,
        // 🟢 REMOVED: createdAt: new Date().toISOString(),
        // 🟢 REMOVED: updatedAt: new Date().toISOString(),
        couponCode,
        discountAmount,
        progressStep: '1',
      });

      await db.insert(orderItemsTable).values(enrichedItems);

      // Collect items for cache invalidation
      const itemsToInvalidate = [
        { key: makeAllOrdersKey() },
        { key: makeUserOrdersKey(user.id) },
        { key: makeAllProductsKey() },
        { key: makeCartKey(user.id) }, // Invalidate cart
        { key: makeCartCountKey(user.id) }, // Invalidate cart count
      ];

      // 🔴 Reduce stock for each product
      for (const item of cartItems) {
        const [product] = await db
          .select({ stock: productsTable.stock, name: productsTable.name }) // Select only what you need
          .from(productsTable)
          .where(eq(productsTable.id, item.id));

        if (!product || product.stock < item.quantity) {
          return res.status(400).json({ success: false, msg: `Not enough stock for ${product?.name || 'product'}` });
        }

        // ✅ CORRECTED: Use sql operator for atomic update
        await db
          .update(productsTable)
          .set({ stock: sql`${productsTable.stock} - ${item.quantity}` })
          .where(eq(productsTable.id, item.id));
        
        // Add product-specific key
        itemsToInvalidate.push({ key: makeProductKey(item.id) });
      }

      // Invalidate all at once
      await invalidateMultiple(itemsToInvalidate);

      return res.json({
        success: true,
        orderId,
        message: "COD order placed successfully",
      });
    }

    // ✅ For Razorpay: only return Razorpay order — don't insert DB yet
    const razorOrder = await razorpay.orders.create({
      amount: finalAmount * 100,
      currency: 'INR',
      receipt: user.id,
    });

    return res.json({
      success: true,
      razorpayOrderId: razorOrder.id,
      amount: finalAmount,
      keyId: RAZORPAY_ID_KEY,
      orderId,
      breakdown: { productTotal, deliveryCharge, discountAmount },
    });

  } catch (err) {
    console.error('createOrder error:', err);
    return res.status(500).json({ success: false, msg: 'Server error' });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      user,
      phone,
      cartItems,
      couponCode = null,
      orderId,
      userAddressId,
    } = req.body;


    // Add userAddressId to the validation check
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userAddressId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_SECRET_KEY)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Verification failed" });
    }

    const [address] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, userAddressId));
    if (!address) {
      // 🟢 FIXED: This was 4404, changed to 404
      return res.status(404).json({ success: false, msg: "Address not found for verification." });
    }

    let productTotal = 0;
    let discountAmount = 0;
    const pincodeDetails = await getPincodeDetails(address.postalCode);
    const deliveryCharge = pincodeDetails.deliveryCharge;
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
        orderId,
        productId: item.id,
        quantity: item.quantity,
        productName: product.name,
        img: product.imageurl[0],
        size: product.size,
        price: unitPrice,
        totalPrice: unitPrice * item.quantity,
      });
    }

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

      if (coupon) {
        const now = new Date();
        if (
          !(coupon.validFrom && now < coupon.validFrom) &&
          !(coupon.validUntil && now > coupon.validUntil) &&
          productTotal >= coupon.minOrderValue
        ) {
          discountAmount = coupon.discountType === 'percent'
            ? Math.floor((coupon.discountValue / 100) * productTotal)
            : coupon.discountValue;
        }
      }
    }

    const finalAmount = Math.max(productTotal + deliveryCharge - discountAmount, 0);

    await db.insert(ordersTable).values({
      id: orderId,
      userId: user.id,
      userAddressId,
      razorpay_order_id,
      totalAmount: finalAmount,
      status: 'Order Placed',
      paymentMode: 'online',
      transactionId: razorpay_payment_id,
      paymentStatus: 'paid',
      phone,
      // 🟢 REMOVED: createdAt: new Date().toISOString(),
      // 🟢 REMOVED: updatedAt: new Date().toISOString(),
      couponCode,
      discountAmount,
      progressStep: '1',
    });

    await db.insert(orderItemsTable).values(enrichedItems);

    // Collect items for cache invalidation
    const itemsToInvalidate = [
      { key: makeAllOrdersKey() },
      { key: makeUserOrdersKey(user.id) },
      { key: makeAllProductsKey() },
      { key: makeCartKey(user.id) }, // Invalidate cart
      { key: makeCartCountKey(user.id) }, // Invalidate cart count
    ];

    // 🔴 Reduce stock for each product
    for (const item of cartItems) {
      const [product] = await db
        .select({ stock: productsTable.stock, name: productsTable.name }) // Select only what you need
        .from(productsTable)
        .where(eq(productsTable.id, item.id));

      if (!product || product.stock < item.quantity) {
        return res.status(400).json({ success: false, msg: `Not enough stock for ${product?.name || 'product'}` });
      }

      // ✅ CORRECTED: Use sql operator for atomic update
      await db
        .update(productsTable)
        .set({ stock: sql`${productsTable.stock} - ${item.quantity}` })
        .where(eq(productsTable.id, item.id));
      
      // Add product-specific key
      itemsToInvalidate.push({ key: makeProductKey(item.id) });
    }

    // Invalidate all at once
    await invalidateMultiple(itemsToInvalidate);

    return res.json({ success: true, message: "Payment verified & order placed." });

  } catch (error) {
    console.error("verify error:", error);
    return res.status(500).json({ success: false, error: "Server error during verification." });
  }
};