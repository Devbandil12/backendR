/* eslint-disable */
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../configs/index.js';
import {
  ordersTable,
  productsTable,
  orderItemsTable,
  UserAddressTable,
  productVariantsTable,
  productBundlesTable,
  addToCartTable,
  usersTable
} from '../configs/schema.js';
import { eq, sql, and, inArray } from 'drizzle-orm';
import { invalidateMultiple } from '../invalidateHelpers.js';
import {
  makeAllOrdersKey,
  makeUserOrdersKey,
  makeAllProductsKey,
  makeProductKey,
  makeCartKey,
  makeCartCountKey,
} from '../cacheKeys.js';
import { calculatePriceBreakdown } from '../helpers/priceEngine.js';
import { createNotification } from '../helpers/notificationManager.js';
// 🟢 Import Email Helper
import { sendOrderConfirmationEmail, sendAdminOrderAlert } from '../routes/notifications.js';

const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

// Helper: Reduce Stock
async function reduceStock(cartItems) {
  const affectedProductIds = new Set();
  for (const item of cartItems) {
    affectedProductIds.add(item.productId);

    const bundleContents = await db
      .select()
      .from(productBundlesTable)
      .where(eq(productBundlesTable.bundleVariantId, item.variantId));

    if (bundleContents.length > 0) {
      const [comboVariant] = await db
        .select({ stock: productVariantsTable.stock })
        .from(productVariantsTable)
        .where(eq(productVariantsTable.id, item.variantId));

      if (!comboVariant || comboVariant.stock < item.quantity) {
        const [product] = await db
          .select({ name: productsTable.name })
          .from(productsTable)
          .where(eq(productsTable.id, item.productId));
        throw new Error(`Not enough stock for ${product?.name || 'combo'}`);
      }
      
      await db.update(productVariantsTable)
        .set({
          stock: sql`${productVariantsTable.stock} - ${item.quantity}`,
          sold: sql`${productVariantsTable.sold} + ${item.quantity}`
        })
        .where(eq(productVariantsTable.id, item.variantId));

      for (const content of bundleContents) {
        const stockToReduce = content.quantity * item.quantity;
        const [variant] = await db
          .select({ 
            stock: productVariantsTable.stock, 
            productId: productVariantsTable.productId 
          })
          .from(productVariantsTable)
          .where(eq(productVariantsTable.id, content.contentVariantId));

        if (!variant || variant.stock < stockToReduce) {
          throw new Error(
            `Not enough stock for item in bundle: ${content.contentVariantId}`
          );
        }
        affectedProductIds.add(variant.productId);
        
        await db.update(productVariantsTable)
          .set({
            stock: sql`${productVariantsTable.stock} - ${stockToReduce}`,
            sold: sql`${productVariantsTable.sold} + ${stockToReduce}`
          })
          .where(eq(productVariantsTable.id, content.contentVariantId));
      }
    } else {
      const [variant] = await db
        .select({ stock: productVariantsTable.stock })
        .from(productVariantsTable)
        .where(eq(productVariantsTable.id, item.variantId));

      if (!variant || variant.stock < item.quantity) {
        const [product] = await db
          .select({ name: productsTable.name })
          .from(productsTable)
          .where(eq(productsTable.id, item.productId));
        throw new Error(`Not enough stock for ${product?.name || 'product'}`);
      }
      
      await db.update(productVariantsTable)
        .set({
          stock: sql`${productVariantsTable.stock} - ${item.quantity}`,
          sold: sql`${productVariantsTable.sold} + ${item.quantity}`
        })
        .where(eq(productVariantsTable.id, item.variantId));
    }
  }
  return Array.from(affectedProductIds);
}

export const createOrder = async (req, res) => {
  try {
    const {
      user,
      phone,
      paymentMode = 'online',
      cartItems,
      userAddressId,
      couponCode = null
    } = req.body;

    if (!user) {
      return res.status(401).json({ success: false, msg: 'Please log in first' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }

    const [address] = await db
      .select()
      .from(UserAddressTable)
      .where(eq(UserAddressTable.id, userAddressId));
      
    if (!address) {
      return res.status(404).json({ success: false, msg: "Address not found." });
    }

    const secureCartItems = cartItems.map(item => ({
      variantId: item.variant.id,
      quantity: item.quantity,
      productId: item.product.id
    }));

    const breakdown = await calculatePriceBreakdown(
      secureCartItems,
      couponCode,
      address.postalCode
    );

    const { total, discountAmount, offerDiscount, appliedOffers, codAvailable } = breakdown;
    const offerCodes = appliedOffers.map(o => o.title);

    if (paymentMode === 'cod' && !codAvailable) {
      return res.status(400).json({ 
        success: false, 
        msg: "Cash on Delivery is not available for this address." 
      });
    }

    const orderId = `DA${Date.now()}`;
    const enrichedItems = [];

    for (const item of cartItems) {
      const [variant] = await db
        .select({ 
          size: productVariantsTable.size, 
          oprice: productVariantsTable.oprice, 
          discount: productVariantsTable.discount, 
          name: productVariantsTable.name 
        })
        .from(productVariantsTable)
        .where(eq(productVariantsTable.id, item.variant.id));

      const [product] = await db
        .select({ 
          name: productsTable.name, 
          imageurl: productsTable.imageurl 
        })
        .from(productsTable)
        .where(eq(productsTable.id, item.product.id));

      let unitPrice = Math.floor(variant.oprice * (1 - variant.discount / 100));
      const freeOffer = appliedOffers.find(o => o.appliesToVariantId === item.variant.id);
      if (freeOffer) unitPrice = 0;

      enrichedItems.push({
        id: `DA${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        orderId,
        productId: item.product.id,
        variantId: item.variant.id,
        quantity: item.quantity,
        productName: `${product.name} (${variant.name})`,
        img: product.imageurl[0],
        size: variant.size,
        price: unitPrice,
        totalPrice: unitPrice * item.quantity,
      });
    }

    // 🟢 COD FLOW
    if (paymentMode === 'cod') {
      const insertedOrder = await db.insert(ordersTable).values({
        id: orderId,
        userId: user.id,
        userAddressId,
        razorpay_order_id: null,
        totalAmount: total,
        status: 'Order Placed',
        paymentMode: 'cod',
        transactionId: null,
        paymentStatus: 'pending',
        phone,
        couponCode: couponCode,
        discountAmount: discountAmount,
        offerDiscount: offerDiscount,
        offerCodes: offerCodes,
        progressStep: 1,
      }).returning();

      await db.insert(orderItemsTable).values(enrichedItems);

      const affectedProductIds = await reduceStock(secureCartItems);

      await createNotification(
        user.id,
        `Your order #${orderId} has been placed successfully.`,
        `/myorder`,
        'order'
      );

      // 📧 COD Email
      const [dbUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, user.id));
        
      if (dbUser?.email) {
        await sendOrderConfirmationEmail(dbUser.email, insertedOrder[0], enrichedItems);
        await sendAdminOrderAlert(insertedOrder[0], enrichedItems);
      }

      const variantIdsToClear = secureCartItems.map(item => item.variantId);
      await db.delete(addToCartTable)
        .where(and(
          eq(addToCartTable.userId, user.id), 
          inArray(addToCartTable.variantId, variantIdsToClear)
        ));

      const itemsToInvalidate = [
        { key: makeAllOrdersKey(), prefix: true },
        { key: makeUserOrdersKey(user.id), prefix: true },
        { key: makeAllProductsKey(), prefix: true },
        { key: makeCartKey(user.id) },
        { key: makeCartCountKey(user.id) },
      ];
      affectedProductIds.forEach(pid => 
        itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true })
      );
      await invalidateMultiple(itemsToInvalidate);

      return res.json({ 
        success: true, 
        orderId, 
        message: "COD order placed successfully" 
      });
    }

    // 🟢 ONLINE FLOW (Pending Order)
    const razorOrder = await razorpay.orders.create({
      amount: total * 100,
      currency: 'INR',
      receipt: user.id,
    });

    await db.insert(ordersTable).values({
      id: orderId,
      userId: user.id,
      userAddressId,
      razorpay_order_id: razorOrder.id,
      totalAmount: total,
      status: 'pending_payment',
      paymentMode: 'online',
      transactionId: null,
      paymentStatus: 'pending',
      phone,
      couponCode,
      discountAmount,
      offerDiscount,
      offerCodes,
      progressStep: 0,
    });

    await db.insert(orderItemsTable).values(enrichedItems);

    return res.json({
      success: true,
      razorpayOrderId: razorOrder.id,
      amount: total,
      keyId: RAZORPAY_ID_KEY,
      orderId,
      breakdown: breakdown,
    });

  } catch (err) {
    console.error('createOrder error:', err);
    return res.status(500).json({ success: false, msg: err.message || 'Server error' });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      user,
      cartItems,
      couponCode = null,
      userAddressId,
    } = req.body;

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

    // 1. Fetch Existing Order
    const [existingOrder] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.razorpay_order_id, razorpay_order_id));

    if (!existingOrder) {
      return res.status(404).json({ success: false, error: "Order not found." });
    }
    if (existingOrder.paymentStatus === 'paid') {
      return res.json({ success: true, message: "Order already paid." });
    }

    // 2. Security Checks
    const [address] = await db
      .select()
      .from(UserAddressTable)
      .where(eq(UserAddressTable.id, userAddressId));

    const secureCartItems = cartItems.map(item => ({ 
      variantId: item.variant.id, 
      quantity: item.quantity, 
      productId: item.product.id 
    }));
    
    const breakdown = await calculatePriceBreakdown(
      secureCartItems, 
      couponCode, 
      address.postalCode
    );

    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (payment.amount !== breakdown.total * 100) {
      await razorpay.payments.refund(
        razorpay_payment_id, 
        { amount: payment.amount, speed: 'optimum' }
      );
      return res.status(400).json({ 
        success: false, 
        error: "Payment amount mismatch. Refund initiated." 
      });
    }

    // 🟢 3. UPDATE ORDER & RETURN IT
    // Added .returning() to get the updated order object for the email
    const [updatedOrder] = await db.update(ordersTable).set({
      status: 'Order Placed',
      paymentStatus: 'paid',
      transactionId: razorpay_payment_id,
      progressStep: 1,
      updatedAt: new Date(),
    }).where(eq(ordersTable.id, existingOrder.id)).returning();

    // 4. Reduce Stock
    const affectedProductIds = await reduceStock(secureCartItems);

    // 5. Clear Cart
    const variantIdsToClear = secureCartItems.map(item => item.variantId);
    await db.delete(addToCartTable)
      .where(and(
        eq(addToCartTable.userId, user.id), 
        inArray(addToCartTable.variantId, variantIdsToClear)
      ));

    // 6. Invalidate Cache
    const itemsToInvalidate = [
      { key: makeAllOrdersKey(), prefix: true },
      { key: makeUserOrdersKey(user.id), prefix: true },
      { key: makeAllProductsKey(), prefix: true },
      { key: makeCartKey(user.id) },
      { key: makeCartCountKey(user.id) },
    ];
    affectedProductIds.forEach(pid => 
      itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true })
    );
    await invalidateMultiple(itemsToInvalidate);

    // 7. Send In-App Notification
    await createNotification(
      user.id,
      `Your order #${orderId} has been placed successfully.`,
      `/myorder`,
      'order'
    );

    // 🟢 8. SEND EMAIL MANUALLY HERE (The Fix)
    // We send the email here so the user doesn't have to wait for the webhook.
    try {
      const [dbUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, user.id));
        
      const orderItems = await db
        .select()
        .from(orderItemsTable)
        .where(eq(orderItemsTable.orderId, existingOrder.id));

      if (dbUser?.email && orderItems.length > 0) {
        console.log(`📧 Sending Online Order Email to ${dbUser.email}`);
        await sendOrderConfirmationEmail(dbUser.email, updatedOrder, orderItems);
        await sendAdminOrderAlert(updatedOrder, orderItems);
      }
    } catch (emailError) {
      console.error("⚠️ Manual email send failed in verifyPayment:", emailError);
      // Do not fail the request; the Webhook is still a backup
    }

    return res.json({ success: true, message: "Payment verified & order placed." });

  } catch (error) {
    console.error("verify error:", error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || "Server error during verification." 
    });
  }
};