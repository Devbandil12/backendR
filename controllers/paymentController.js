/* eslint-disable */
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../configs/index.js';
import { redis as redisClient } from '../configs/redis.js'; 
import {
  ordersTable,
  productsTable,
  orderItemsTable,
  UserAddressTable,
  productVariantsTable,
  productBundlesTable,
  addToCartTable,
  usersTable,
  walletTransactionsTable,
  orderTimeline,
  couponRedemptionsTable,
  couponsTable
} from '../configs/schema.js';
import { eq, sql, and, inArray, gte, desc } from 'drizzle-orm'; 
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
import { safeCompare } from '../helpers/safeCompare.js'; // 🟢 FIX: timing-safe signature comparison
import { sendOrderConfirmationEmail, sendAdminOrderAlert } from '../routes/notifications.js';
import { addToEmailQueue } from '../services/emailQueue.js';
import { createOrder as createShiprocketOrder } from '../services/shiprocket.service.js';

const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

// 🟢 FIX 2.6: ATOMIC INVOICE GENERATOR
async function getNextInvoiceNumber(tx) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  
  const [lastOrder] = await tx.select({ invoiceNumber: ordersTable.invoiceNumber })
    .from(ordersTable)
    .where(sql`${ordersTable.invoiceNumber} LIKE ${prefix + '%'}`)
    .orderBy(desc(ordersTable.invoiceNumber))
    .limit(1);

  let nextSeq = 1;
  if (lastOrder?.invoiceNumber) {
    const parts = lastOrder.invoiceNumber.split('-');
    if (parts.length === 3) {
      nextSeq = parseInt(parts[2], 10) + 1;
    }
  }
  return `${prefix}${String(nextSeq).padStart(5, '0')}`;
}

// 🟢 FIX (Round 3, item "no unique constraint / race condition"): the
// maxUsagePerUser / totalUsageLimit checks in priceEngine.js and
// routes/coupons.js are only advisory previews — two concurrent checkouts
// can both read "under limit" before either one commits. This is the
// actual race-safe guard: it locks the coupon row (SELECT ... FOR UPDATE)
// for the lifetime of the caller's transaction, so a second concurrent
// completion for the same coupon blocks until the first transaction
// commits or rolls back, then re-reads the true, up-to-date count.
//
// NOTE: a single blanket UNIQUE(coupon_id, user_id) index was intentionally
// NOT used instead — maxUsagePerUser can be > 1 (multi-use coupons), and a
// blanket unique index would incorrectly block those. Row-locking handles
// both single-use and multi-use coupons correctly.
//
// Call this immediately before a redemption is finalized as 'completed' —
// i.e. inside the COD/wallet order-creation transaction, and inside the
// verifyPayment transaction right before flipping a 'pending' redemption
// to 'completed'.
async function assertCouponUsageWithinLimits(tx, couponId, userId) {
  if (!couponId) return;

  const [lockedCoupon] = await tx
    .select()
    .from(couponsTable)
    .where(eq(couponsTable.id, couponId))
    .for('update');

  if (!lockedCoupon) return; // Coupon was deleted mid-flow — nothing left to enforce

  const fail = (message) => {
    const err = new Error(message);
    err.code = 'COUPON_LIMIT_REACHED';
    throw err;
  };

  if (lockedCoupon.totalUsageLimit !== null) {
    const totalCompleted = await tx.select().from(couponRedemptionsTable).where(
      and(
        eq(couponRedemptionsTable.couponId, couponId),
        eq(couponRedemptionsTable.status, 'completed')
      )
    );
    if (totalCompleted.length >= lockedCoupon.totalUsageLimit) {
      fail('The global usage limit for this coupon has just been reached.');
    }
  }

  if (lockedCoupon.maxUsagePerUser !== null && userId) {
    const userCompleted = await tx.select().from(couponRedemptionsTable).where(
      and(
        eq(couponRedemptionsTable.couponId, couponId),
        eq(couponRedemptionsTable.userId, userId),
        eq(couponRedemptionsTable.status, 'completed')
      )
    );
    if (userCompleted.length >= lockedCoupon.maxUsagePerUser) {
      fail(`You have reached the maximum usage limit (${lockedCoupon.maxUsagePerUser}) for this coupon.`);
    }
  }
}

export async function createShiprocketOrderForExistingOrder(orderId) {
  try {
    const order = await db.query.ordersTable.findFirst({
      where: eq(ordersTable.id, orderId),
      with: {
        user: true,
        address: true,
        orderItems: {
          with: {
            variant: true,
            product: true
          }
        }
      }
    });

    if (!order) {
      console.error(`❌ Order ${orderId} not found for Shiprocket sync.`);
      return;
    }

    if (!order.address) {
      console.error(`❌ Order ${orderId} has no address.`);
      return;
    }

    let totalWeight = 0;
    let maxLength = 10;
    let maxBreadth = 10;
    let maxHeight = 10;

    const shiprocketItems = order.orderItems.map(item => {
      const variant = item.variant;
      
      const itemWeight = variant?.weight ? parseFloat(variant.weight) : 0.5; 
      totalWeight += (itemWeight * item.quantity);

      if (variant) {
        if (variant.length > maxLength) maxLength = parseFloat(variant.length);
        if (variant.breadth > maxBreadth) maxBreadth = parseFloat(variant.breadth);
        if (variant.height > maxHeight) maxHeight = parseFloat(variant.height);
      }

      return {
        name: item.product.name,
        sku: variant?.sku || item.product.id,
        units: item.quantity,
        selling_price: item.price,
        discount: 0,
        tax: 0,
      };
    });

    if (totalWeight <= 0) totalWeight = 0.5;

    const orderPayload = {
      order_id: order.id,
      order_date: new Date(order.createdAt).toISOString().split('T')[0],
      pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
      billing_customer_name: order.user.name || 'Guest',
      billing_last_name: '',
      billing_address: order.address.address,
      billing_city: order.address.city,
      billing_pincode: order.address.postalCode,
      billing_state: order.address.state,
      billing_country: 'India',
      billing_email: order.user.email || 'noreply@example.com',
      billing_phone: order.address.phone || order.user.phone,
      shipping_is_billing: true,
      order_items: shiprocketItems,
      payment_method: order.paymentMode === 'cod' ? 'COD' : 'Prepaid',
      sub_total: order.totalAmount,
      length: maxLength,
      breadth: maxBreadth,
      height: maxHeight,
      weight: parseFloat(totalWeight.toFixed(2)),
    };

    const srResponse = await createShiprocketOrder(orderPayload);

    if (srResponse.order_id) {
      await db.update(ordersTable)
        .set({
          shiprocketOrderId: String(srResponse.order_id),
          shiprocketShipmentId: String(srResponse.shipment_id),
          updatedAt: new Date()
        })
        .where(eq(ordersTable.id, orderId));
      
      console.log(`✅ Shiprocket Order Created: ${srResponse.order_id}`);
    } else {
      console.error("⚠️ Shiprocket Error:", srResponse);
      throw new Error(`Shiprocket API rejected payload: ${JSON.stringify(srResponse)}`);
    }

  } catch (error) {
    console.error("❌ Failed to sync order to Shiprocket:", error);
    throw error;
  }
}

const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

export async function checkStockAvailability(cartItems) {
  for (const item of cartItems) {
    const [variant] = await db
      .select({ stock: productVariantsTable.stock, name: productVariantsTable.name })
      .from(productVariantsTable)
      .where(eq(productVariantsTable.id, item.variantId));

    if (!variant || variant.stock < item.quantity) {
      throw new Error(`Sorry, ${variant?.name || 'Item'} is currently out of stock.`);
    }

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

export async function reduceStock(cartItems, tx) {
  const affectedProductIds = new Set();

  const sortedItems = [...cartItems].sort((a, b) => a.variantId.localeCompare(b.variantId));

  for (const item of sortedItems) {
    affectedProductIds.add(item.productId);

    const bundleContents = await tx
      .select()
      .from(productBundlesTable)
      .where(eq(productBundlesTable.bundleVariantId, item.variantId));

    if (bundleContents.length > 0) {
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

      if (!updatedBundle) {
        throw new Error(`Stock updated while you were paying. Refund initiated.`);
      }
      affectedProductIds.add(updatedBundle.productId);

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

        if (!updatedChild) {
          throw new Error(`Stock updated while you were paying. Refund initiated.`);
        }
        affectedProductIds.add(updatedChild.productId);
      }

    } else {
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

      if (!updatedVariant) {
        throw new Error(`Stock updated while you were paying. Refund initiated.`);
      }
      affectedProductIds.add(updatedVariant.productId);
    }
  }
  return Array.from(affectedProductIds);
}

// 🟢 3. SECURE CREATE ORDER
export const createOrder = async (req, res) => {
  try {
    let {
      phone,
      paymentMode = 'online',
      cartItems,
      userAddressId,
      couponCode = null,
      useWallet = false
    } = req.body;

    // 🟢 SAFEGUARD: Ensure couponCode is a strict string (Fixes React object-passing bugs)
    if (couponCode && typeof couponCode === 'object') {
        couponCode = couponCode.code;
    }

    // 🔒 RESOLVE USER FROM TOKEN
    const requesterClerkId = req.auth.userId;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, requesterClerkId));
    
    if (!user) {
      return res.status(401).json({ success: false, msg: 'Authentication failed. Please log in.' });
    }

    const dbCartItems = await db
      .select()
      .from(addToCartTable)
      .where(eq(addToCartTable.userId, user.id));

    if (dbCartItems.length === 0) {
      return res.status(400).json({ 
        success: false, 
        msg: 'Cart is empty or order has already been placed.' 
      });
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
      address.postalCode,
      user.id
    );

    let finalAmount = breakdown.total;
    let walletDeduction = 0;

    if (useWallet && user.walletBalance > 0) {
      walletDeduction = Math.min(finalAmount, user.walletBalance);
      finalAmount = finalAmount - walletDeduction;
    }

    const { discountAmount, offerDiscount, appliedOffers, codAvailable } = breakdown;
    const offerCodes = appliedOffers.map(o => o.title);

    if (paymentMode === 'cod' && !codAvailable) {
      return res.status(400).json({
        success: false,
        msg: "Cash on Delivery is not available for this address."
      });
    }

    // 🟢 SERVER-SIDE IDEMPOTENCY LOCK
    const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotencyKey;
    if (idempotencyKey && redisClient) {
      const isDuplicate = await redisClient.get(`idemp:order:${idempotencyKey}`);
      if (isDuplicate) {
        return res.status(409).json({ success: false, msg: 'Order request is already processing.' });
      }
      await redisClient.setex(`idemp:order:${idempotencyKey}`, 86400, 'locked');
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

    // SCENARIO A: Fully Paid via Wallet (finalAmount is 0)
    if (walletDeduction > 0 && finalAmount === 0) {

      const { insertedOrder, affectedProductIds } = await db.transaction(async (tx) => {
        const newInvoiceNumber = await getNextInvoiceNumber(tx); 

        const [orderResult] = await tx.insert(ordersTable).values({
          id: orderId,
          userId: user.id,
          userAddressId,
          totalAmount: 0,
          walletAmountUsed: walletDeduction,
          status: 'Order Placed',
          paymentMode: 'wallet',
          paymentStatus: 'paid',
          transactionId: `WALLET-${Date.now()}`,
          phone,
          couponId: breakdown.appliedCouponId || null, // 🟢 FIXED: Replaced removed couponCode column with couponId
          discountAmount: breakdown.discountAmount,
          offerDiscount: breakdown.offerDiscount,
          offerCodes: breakdown.appliedOffers.map(o => o.title),
          progressStep: 1,
          invoiceNumber: newInvoiceNumber 
        }).returning();

        // Record Coupon Redemption as 'completed'
        if (breakdown.appliedCouponId) {
          // 🟢 FIX: race-safe re-check under a locked coupon row before
          // finalizing this as a 'completed' redemption.
          await assertCouponUsageWithinLimits(tx, breakdown.appliedCouponId, user.id);

          await tx.insert(couponRedemptionsTable).values({
            couponId: breakdown.appliedCouponId,
            userId: user.id,
            orderId: orderId,
            status: 'completed'
          });
        }

        await tx.insert(orderTimeline).values({
            orderId: orderId,
            status: 'Order Placed',
            title: 'Order Placed',
            description: 'Order placed successfully using Wallet.',
            timestamp: new Date()
        });

        await tx.update(usersTable)
          .set({ walletBalance: sql`${usersTable.walletBalance} - ${walletDeduction}` })
          .where(eq(usersTable.id, user.id));

        await tx.insert(walletTransactionsTable).values({
          userId: user.id,
          amount: -walletDeduction,
          type: 'usage',
          description: `Used for Order #${orderId}`
        });

        await tx.insert(orderItemsTable).values(enrichedItems);
        const stockIds = await reduceStock(secureCartItems, tx);
        await tx.delete(addToCartTable).where(eq(addToCartTable.userId, user.id));

        return { insertedOrder: orderResult, affectedProductIds: stockIds };
      });

      createNotification(
        user.id,
        `Your order #${orderId} has been placed successfully.`,
        `/myorder`,
        'order'
      ).catch(err => console.error("Notification fail:", err));

      db.select().from(usersTable).where(eq(usersTable.id, user.id))
        .then(([dbUser]) => {
          if (dbUser?.email) {
            addToEmailQueue({
              userEmail: dbUser.email,
              orderDetails: insertedOrder,
              orderItems: enrichedItems,
              paymentDetails: { method: 'WALLET_FULL' }
            });
          }
        }).catch(err => console.error("Queue error:", err));

      const itemsToInvalidate = [
        { key: makeAllOrdersKey(), prefix: true },
        { key: makeUserOrdersKey(user.id), prefix: true },
        { key: makeAllProductsKey(), prefix: true },
        { key: makeCartKey(user.id) },
        { key: makeCartCountKey(user.id) },
      ];

      if (affectedProductIds && affectedProductIds.length > 0) {
        affectedProductIds.forEach(pid =>
          itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true })
        );
      }

      invalidateMultiple(itemsToInvalidate).catch(err => console.error("Cache invalidate fail:", err));
      createShiprocketOrderForExistingOrder(orderId).catch(err => console.error("Shiprocket sync fail:", err));

      return res.json({ success: true, orderId, message: "Order placed using Wallet Balance!" });
    }

    // 🟢 COD FLOW (Transactional)
    if (paymentMode === 'cod') {
      let transactionResult;
      try {
        transactionResult = await db.transaction(async (tx) => {
          const newInvoiceNumber = await getNextInvoiceNumber(tx); 

          const [insertedOrder] = await tx.insert(ordersTable).values({
            id: orderId,
            userId: user.id,
            userAddressId,
            razorpay_order_id: null,
            totalAmount: finalAmount,
            walletAmountUsed: walletDeduction,
            status: 'Order Placed',
            paymentMode: 'cod',
            transactionId: null,
            paymentStatus: 'pending',
            phone,
            couponId: breakdown.appliedCouponId || null, // 🟢 FIXED: Replaced removed couponCode column with couponId
            discountAmount: discountAmount,
            offerDiscount: offerDiscount,
            offerCodes: offerCodes,
            progressStep: 1,
            invoiceNumber: newInvoiceNumber 
          }).returning();

          // Record Coupon Redemption as 'completed'
          if (breakdown.appliedCouponId) {
            // 🟢 FIX: race-safe re-check under a locked coupon row before
            // finalizing this as a 'completed' redemption.
            await assertCouponUsageWithinLimits(tx, breakdown.appliedCouponId, user.id);

            await tx.insert(couponRedemptionsTable).values({
              couponId: breakdown.appliedCouponId,
              userId: user.id,
              orderId: orderId,
              status: 'completed'
            });
          }

          await tx.insert(orderTimeline).values({
            orderId: orderId,
            status: 'Order Placed',
            title: 'Order Placed',
            description: 'Order placed successfully via Cash on Delivery.',
            timestamp: new Date()
          });

          if (walletDeduction > 0) {
            await tx.update(usersTable)
              .set({ walletBalance: sql`${usersTable.walletBalance} - ${walletDeduction}` })
              .where(eq(usersTable.id, user.id));

            await tx.insert(walletTransactionsTable).values({
              userId: user.id,
              amount: -walletDeduction,
              type: 'usage',
              description: `Partial payment for Order #${orderId}`
            });
          }

          await tx.insert(orderItemsTable).values(enrichedItems);
          const affectedProductIds = await reduceStock(secureCartItems, tx);
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
        const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotencyKey;
        if (idempotencyKey && redisClient) await redisClient.del(`idemp:order:${idempotencyKey}`);
        return res.status(400).json({ success: false, msg: err.message || "Order failed" });
      }

      const { insertedOrder, affectedProductIds } = transactionResult;

      createNotification(
        user.id,
        `Your order #${orderId} has been placed successfully.`,
        `/myorder`,
        'order'
      ).catch(err => console.error("Notification fail:", err));

      db.select().from(usersTable).where(eq(usersTable.id, user.id))
        .then(([dbUser]) => {
          if (dbUser?.email) {
            addToEmailQueue({
              userEmail: dbUser.email,
              orderDetails: insertedOrder,
              orderItems: enrichedItems,
              paymentDetails: { method: 'COD' }
            });
          }
        }).catch(err => console.error("Queue error:", err));

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
      createShiprocketOrderForExistingOrder(orderId).catch(err => console.error("Shiprocket sync fail:", err));

      return res.json({
        success: true,
        orderId,
        message: "COD order placed successfully"
      });
    }

    // 🟢 ONLINE FLOW (Pending Order)
    const razorOrder = await razorpay.orders.create({
      amount: finalAmount * 100,
      currency: 'INR',
      receipt: user.id.slice(0, 40), // Safety clip for Razorpay limits
    });

    await db.transaction(async (tx) => {
      await tx.insert(ordersTable).values({
        id: orderId,
        userId: user.id,
        userAddressId,
        razorpay_order_id: razorOrder.id,
        totalAmount: finalAmount,
        walletAmountUsed: walletDeduction,
        status: 'pending_payment',
        paymentMode: 'online',
        transactionId: null,
        paymentStatus: 'pending',
        phone,
        couponId: breakdown.appliedCouponId || null, // 🟢 FIXED: Replaced removed couponCode column with couponId
        discountAmount,
        offerDiscount,
        offerCodes,
        progressStep: 0,
      });

      // Record Coupon Redemption as 'pending'
      if (breakdown.appliedCouponId) {
        await tx.insert(couponRedemptionsTable).values({
          couponId: breakdown.appliedCouponId,
          userId: user.id,
          orderId: orderId,
          status: 'pending'
        });
      }

      await tx.insert(orderItemsTable).values(enrichedItems);
    });

    return res.json({
      success: true,
      razorpayOrderId: razorOrder.id,
      amount: finalAmount,
      keyId: RAZORPAY_ID_KEY,
      orderId,
      breakdown: { ...breakdown, total: finalAmount, walletUsed: walletDeduction },
    });

  } catch (err) {
    console.error('createOrder error:', err);
    const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotencyKey;
    if (idempotencyKey && redisClient) {
       await redisClient.del(`idemp:order:${idempotencyKey}`);
    }
    return res.status(500).json({ success: false, msg: err.message || 'Server error' });
  }
};

// 🟢 4. SECURE VERIFY PAYMENT
export const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      cartItems,
      couponCode = null,
      userAddressId,
    } = req.body;

    const requesterClerkId = req.auth.userId;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, requesterClerkId));
    
    if (!user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userAddressId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_SECRET_KEY)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (!safeCompare(generatedSignature, razorpay_signature)) {
      return res.status(400).json({ success: false, error: "Verification failed" });
    }

    const [existingOrder] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.razorpay_order_id, razorpay_order_id));

    if (!existingOrder) {
      return res.status(404).json({ success: false, error: "Order not found." });
    }
    
    if (existingOrder.userId !== user.id) {
        return res.status(403).json({ success: false, error: "Forbidden: Not your order." });
    }

    if (existingOrder.paymentStatus === 'paid') {
      return res.json({ success: true, message: "Order already paid." });
    }

    const secureCartItems = cartItems.map(item => ({
      variantId: item.variant.id,
      quantity: item.quantity,
      productId: item.product.id
    }));

    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    if (payment.amount !== existingOrder.totalAmount * 100) {
      console.error(`Mismatch: Razorpay Paid ${payment.amount} !== DB Expected ${existingOrder.totalAmount * 100}`);
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
        
        // 🟢 FIX 2.2: FRESH READ INSIDE TRANSACTION
        const [lockedOrder] = await tx.select()
          .from(ordersTable)
          .where(eq(ordersTable.id, existingOrder.id));

        if (lockedOrder.paymentStatus === 'paid') {
          return { alreadyPaid: true };
        }

        const newInvoiceNumber = await getNextInvoiceNumber(tx);

        const [updatedOrder] = await tx.update(ordersTable).set({
          status: 'Order Placed',
          paymentStatus: 'paid',
          transactionId: razorpay_payment_id,
          progressStep: 1,
          updatedAt: new Date(),
          invoiceNumber: newInvoiceNumber 
        }).where(eq(ordersTable.id, existingOrder.id)).returning();

        // Lock in the Coupon Redemption status to 'completed'
        // 🟢 FIX: race-safe re-check under a locked coupon row — this is the
        // real point where an online order's coupon usage becomes permanent,
        // so it's the point that must be race-safe.
        if (existingOrder.couponId) {
          await assertCouponUsageWithinLimits(tx, existingOrder.couponId, user.id);
        }

        await tx.update(couponRedemptionsTable)
          .set({ status: 'completed' })
          .where(eq(couponRedemptionsTable.orderId, existingOrder.id));

        await tx.insert(orderTimeline).values({
            orderId: existingOrder.id,
            status: 'Order Placed',
            title: 'Order Placed',
            description: 'Payment verified and order placed successfully.',
            timestamp: new Date()
        });

        if (existingOrder.walletAmountUsed > 0) {
            await tx.update(usersTable)
                .set({ walletBalance: sql`${usersTable.walletBalance} - ${existingOrder.walletAmountUsed}` })
                .where(eq(usersTable.id, user.id));

            await tx.insert(walletTransactionsTable).values({
                userId: user.id,
                amount: -existingOrder.walletAmountUsed,
                type: 'usage',
                description: `Used for Order #${existingOrder.id}`
            });
        }

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

      // 🟢 FIX: another concurrent checkout beat this one to the coupon's usage
      // limit while this payment was being verified — auto-refund rather than
      // leave the customer charged with no valid order.
      if (error.code === "COUPON_LIMIT_REACHED") {
        try {
          await razorpay.payments.refund(req.body.razorpay_payment_id, {
            speed: 'optimum',
            notes: { reason: 'Coupon usage limit reached at verification time' }
          });

          return res.status(400).json({
            success: false,
            error: "This coupon's usage limit was reached just before your payment completed. Your payment has been auto-refunded."
          });

        } catch (refundError) {
          console.error("Refund failed:", refundError);
          return res.status(500).json({
            success: false,
            error: "Coupon limit reached. Payment deducted but refund failed. Please contact support."
          });
        }
      }

      return res.status(500).json({ success: false, error: error.message || "Server error" });
    }

    if (transactionResult.alreadyPaid) {
      return res.json({ success: true, message: "Payment already verified & processed." });
    }

    const { updatedOrder, affectedProductIds } = transactionResult;

    // ⚡ FAST ONLINE RESPONSE: Side effects run in background
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

    createNotification(
      user.id,
      `Your order #${existingOrder.id} has been placed successfully.`,
      `/myorder`,
      'order'
    ).catch(err => console.error("Notification fail:", err));

    Promise.all([
      db.select().from(usersTable).where(eq(usersTable.id, user.id)),
      db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, existingOrder.id))
    ]).then(([[dbUser], dbOrderItems]) => {
      if (dbUser?.email && dbOrderItems.length > 0) {
        addToEmailQueue({
          userEmail: dbUser.email,
          orderDetails: updatedOrder,
          orderItems: dbOrderItems, 
          paymentDetails: req.body
        });
      }
    }).catch(e => console.error("Queue error:", e));

    createShiprocketOrderForExistingOrder(existingOrder.id).catch(err => console.error("Shiprocket sync fail:", err));

    return res.json({ success: true, message: "Payment verified & order placed." });

  } catch (error) {
    console.error("verify error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Server error during verification."
    });
  }
};