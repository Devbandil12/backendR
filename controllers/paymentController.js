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
import { eq, sql, and, inArray, gte } from 'drizzle-orm';
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
import { sendOrderConfirmationEmail, sendAdminOrderAlert } from '../routes/notifications.js';

const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

// 🟢 1. PRE-CHECK HELPER (Read-Only)
// Runs BEFORE payment to prevent opening Razorpay if stock is 0.
export async function checkStockAvailability(cartItems) {
  for (const item of cartItems) {
    // 1. Check Main Variant
    const [variant] = await db
      .select({ stock: productVariantsTable.stock, name: productVariantsTable.name })
      .from(productVariantsTable)
      .where(eq(productVariantsTable.id, item.variantId));

    if (!variant || variant.stock < item.quantity) {
      throw new Error(`Sorry, ${variant?.name || 'Item'} is currently out of stock.`);
    }

    // 2. Check Bundle Contents (if it's a combo)
    const bundleContents = await db
      .select()
      .from(productBundlesTable)
      .where(eq(productBundlesTable.bundleVariantId, item.variantId));

    for (const content of bundleContents) {
       const requiredQty = content.quantity * item.quantity;
       const [childVariant] = await db
         .select({ stock: productVariantsTable.stock, name: productVariantsTable.name })
         .from(productVariantsTable)
         .where(eq(productVariantsTable.id, content.contentVariantId));
       
       if (!childVariant || childVariant.stock < requiredQty) {
          throw new Error(`Parts of the combo (${variant?.name}) are out of stock.`);
       }
    }
  }
}

// 🟢 2. ATOMIC REDUCE HELPER (Write)
// Runs AFTER payment inside a Transaction.
// Uses "Optimistic Concurrency" (gte) to ensure we never deduct below 0.
// 🟢 2. ATOMIC REDUCE HELPER (Write)
export async function reduceStock(cartItems, tx) {
  const affectedProductIds = new Set();
  
  // Sort items to prevent Deadlocks
  const sortedItems = [...cartItems].sort((a, b) => a.variantId.localeCompare(b.variantId));

  for (const item of sortedItems) {
    affectedProductIds.add(item.productId);

    // Check if Bundle
    const bundleContents = await tx
      .select()
      .from(productBundlesTable)
      .where(eq(productBundlesTable.bundleVariantId, item.variantId));

    if (bundleContents.length > 0) {
      // --- Bundle Logic ---
      
      // A. Reduce Bundle Parent
      const [updatedBundle] = await tx.update(productVariantsTable)
        .set({
          stock: sql`${productVariantsTable.stock} - ${item.quantity}`,
          sold: sql`${productVariantsTable.sold} + ${item.quantity}`
        })
        .where(and(
          eq(productVariantsTable.id, item.variantId),
          gte(productVariantsTable.stock, item.quantity)
        ))
        .returning({ productId: productVariantsTable.productId });

      if (!updatedBundle) { // 🟢 Fixed Check
        throw new Error(`Stock updated while you were paying. Refund initiated.`);
      }
      affectedProductIds.add(updatedBundle.productId); // 🟢 REMOVED [0]

      // B. Reduce Bundle Children
      for (const content of bundleContents) {
        const stockToReduce = content.quantity * item.quantity;
        const [updatedChild] = await tx.update(productVariantsTable)
          .set({
            stock: sql`${productVariantsTable.stock} - ${stockToReduce}`,
            sold: sql`${productVariantsTable.sold} + ${stockToReduce}`
          })
          .where(and(
            eq(productVariantsTable.id, content.contentVariantId),
            gte(productVariantsTable.stock, stockToReduce)
          ))
          .returning({ productId: productVariantsTable.productId });

        if (!updatedChild) { // 🟢 Fixed Check
           throw new Error(`Stock updated while you were paying. Refund initiated.`);
        }
        affectedProductIds.add(updatedChild.productId); // 🟢 REMOVED [0]
      }

    } else {
      // --- Standard Product Logic ---
      const [updatedVariant] = await tx.update(productVariantsTable)
        .set({
          stock: sql`${productVariantsTable.stock} - ${item.quantity}`,
          sold: sql`${productVariantsTable.sold} + ${item.quantity}`
        })
        .where(and(
          eq(productVariantsTable.id, item.variantId),
          gte(productVariantsTable.stock, item.quantity)
        ))
        .returning({ productId: productVariantsTable.productId });

      if (!updatedVariant) { // 🟢 Fixed Check
        throw new Error(`Stock updated while you were paying. Refund initiated.`);
      }
      affectedProductIds.add(updatedVariant.productId); // 🟢 REMOVED [0]
    }
  }
  return Array.from(affectedProductIds);
}

// 🟢 1. OPTIMIZED createOrder (COD Speed Fix)
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

    // 🛑 PRE-PAYMENT CHECK
    const secureCartItems = cartItems.map(item => ({
        variantId: item.variant?.id || item.variantId,
        quantity: item.quantity,
        productId: item.product?.id || item.productId
    }));
    await checkStockAvailability(secureCartItems);

    const [address] = await db
      .select()
      .from(UserAddressTable)
      .where(eq(UserAddressTable.id, userAddressId));
      
    if (!address) {
      return res.status(404).json({ success: false, msg: "Address not found." });
    }

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

    // 🟢 COD FLOW (Transactional)
    if (paymentMode === 'cod') {
      let transactionResult;
      try {
        transactionResult = await db.transaction(async (tx) => {
            // A. Insert Order
            const [insertedOrder] = await tx.insert(ordersTable).values({
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

            // B. Insert Items
            await tx.insert(orderItemsTable).values(enrichedItems);

            // C. Atomic Reduce
            const affectedProductIds = await reduceStock(secureCartItems, tx);

            // D. Clear Cart
            const variantIdsToClear = secureCartItems.map(item => item.variantId);
            await tx.delete(addToCartTable)
              .where(and(
                eq(addToCartTable.userId, user.id), 
                inArray(addToCartTable.variantId, variantIdsToClear)
              ));

            return { insertedOrder, affectedProductIds };
        });
      } catch (err) {
        console.error("COD Order Failed (Stock/DB):", err.message);
        return res.status(400).json({ success: false, msg: err.message || "Order failed" });
      }

      const { insertedOrder, affectedProductIds } = transactionResult;

      // ⚡ FAST COD RESPONSE: Everything below runs in the background
      
      // 1. Notification (Background)
      createNotification(
        user.id,
        `Your order #${orderId} has been placed successfully.`,
        `/myorder`,
        'order'
      ).catch(err => console.error("Notification fail:", err));

      // 2. Emails (Background)
      // We don't wait for this DB call, we fire it off
      db.select().from(usersTable).where(eq(usersTable.id, user.id))
        .then(([dbUser]) => {
            if (dbUser?.email) {
                sendOrderConfirmationEmail(dbUser.email, insertedOrder, enrichedItems).catch(e => console.error("Email Error:", e));
                sendAdminOrderAlert(insertedOrder, enrichedItems).catch(e => console.error("Admin Email Error:", e));
            }
        }).catch(err => console.error("User fetch for email failed:", err));

      // 3. Cache Invalidation (Background)
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
      
      invalidateMultiple(itemsToInvalidate).catch(err => console.error("Cache invalidate fail:", err));

      // 🚀 IMMEDIATE RESPONSE
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

// 🟢 2. OPTIMIZED verifyPayment (Online Speed Fix)
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

    let transactionResult;

    try {
      transactionResult = await db.transaction(async (tx) => {
        const [updatedOrder] = await tx.update(ordersTable).set({
          status: 'Order Placed',
          paymentStatus: 'paid',
          transactionId: razorpay_payment_id,
          progressStep: 1,
          updatedAt: new Date(),
        }).where(eq(ordersTable.id, existingOrder.id)).returning();

        const affectedProductIds = await reduceStock(secureCartItems, tx);

        const variantIdsToClear = secureCartItems.map(item => item.variantId);
        await tx.delete(addToCartTable)
          .where(and(
            eq(addToCartTable.userId, user.id), 
            inArray(addToCartTable.variantId, variantIdsToClear)
          ));

        return { updatedOrder, affectedProductIds };
      });
    } catch (error) {
    console.error("verify error:", error);

    if (error.message.includes("Out of stock")) {
       try {
         await razorpay.payments.refund(req.body.razorpay_payment_id, {
           speed: 'optimum',
           notes: { reason: 'Out of stock after payment' }
         });
         
         return res.status(400).json({ 
           success: false, 
           error: "Item went out of stock just now. Your payment has been auto-refunded." 
         });

       } catch (refundError) {
         console.error("Refund failed:", refundError);
         return res.status(500).json({ 
           success: false, 
           error: "Out of stock. Payment deducted but refund failed. Please contact support." 
         });
       }
    }

    return res.status(500).json({ success: false, error: error.message || "Server error" });
  }

    const { updatedOrder, affectedProductIds } = transactionResult;

    // ⚡ FAST ONLINE RESPONSE: Side effects run in background

    // 1. Cache Invalidation (Background)
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
    invalidateMultiple(itemsToInvalidate).catch(err => console.error("Cache invalidate fail:", err));

    // 2. Notification (Background)
    createNotification(
      user.id,
      `Your order #${existingOrder.id} has been placed successfully.`,
      `/myorder`,
      'order'
    ).catch(err => console.error("Notification fail:", err));

    // 3. Emails (Background)
    // Manually fetching items and user to send email without blocking response
    (async () => {
        try {
            const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
            const orderItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, existingOrder.id));

            if (dbUser?.email && orderItems.length > 0) {
                sendOrderConfirmationEmail(dbUser.email, updatedOrder, orderItems).catch(e => console.error("Email Error:", e));
                sendAdminOrderAlert(updatedOrder, orderItems).catch(e => console.error("Admin Email Error:", e));
            }
        } catch (bgError) {
            console.error("Background email task failed:", bgError);
        }
    })();

    // 🚀 IMMEDIATE RESPONSE
    return res.json({ success: true, message: "Payment verified & order placed." });

  } catch (error) {
    console.error("verify error:", error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || "Server error during verification." 
    });
  }
};