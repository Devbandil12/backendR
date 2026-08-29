import { redis as redisClient } from '../../config/redis.js';
import { invalidateMultiple } from '../../infrastructure/cache/cache.invalidate.js';
import {
  makeAllOrdersKey,
  makeUserOrdersKey,
  makeAllProductsKey,
  makeProductKey,
  makeCartKey,
  makeCartCountKey,
} from '../../infrastructure/cache/cache.keys.js';
import { calculatePriceBreakdown } from '../../modules/checkout/pricing.service.js';
import { createNotification } from '../../modules/notifications/notifications.service.js';
import { addToEmailQueue } from '../../infrastructure/queues/email.queue.js';
import * as PaymentsService from './payments.service.js';
import * as PaymentsRepository from './payments.repository.js';

const { RAZORPAY_ID_KEY } = process.env;

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

    if (couponCode && typeof couponCode === 'object') {
        couponCode = couponCode.code;
    }

    const user = await PaymentsRepository.getUserByClerkId(req.auth.userId);
      
    if (!user) {
      return res.status(401).json({ success: false, msg: 'Authentication failed. Please log in.' });
    }

    const dbCartItems = await PaymentsRepository.getCartItemsByUser(user.id);

    if (dbCartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty or order has already been placed.' });
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }

    const secureCartItems = cartItems.map(item => ({
      variantId: item.variant?.id || item.variantId,
      quantity: item.quantity,
      productId: item.product?.id || item.productId
    }));
    await PaymentsService.checkStockAvailability(secureCartItems);

    const address = await PaymentsRepository.getAddressById(userAddressId);

    if (!address) {
      return res.status(404).json({ success: false, msg: "Address not found." });
    }

    const breakdown = await calculatePriceBreakdown(secureCartItems, couponCode, address.postalCode, user.id);

    let finalAmount = breakdown.total;
    let walletDeduction = 0;

    if (useWallet && user.walletBalance > 0) {
      walletDeduction = Math.min(finalAmount, user.walletBalance);
      finalAmount = finalAmount - walletDeduction;
    }

    const { discountAmount, offerDiscount, appliedOffers, codAvailable } = breakdown;
    const offerCodes = appliedOffers.map(o => o.title);

    if (paymentMode === 'cod' && !codAvailable) {
      return res.status(400).json({ success: false, msg: "Cash on Delivery is not available for this address." });
    }

    if (paymentMode === 'cod' && user.codDisabled) {
      return res.status(400).json({
        success: false, code: 'COD_DISABLED',
        msg: "Cash on Delivery isn't available on this account right now — please pay online to place this order.",
      });
    }

    try {
      await PaymentsService.verifyPhoneVerification(user, address);
    } catch (err) {
      return res.status(403).json({ success: false, code: err.code, msg: err.msg, purpose: err.purpose });
    }

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
      const variant = await PaymentsRepository.getVariantStock(item.variant.id);
      const product = await PaymentsRepository.getProductSummary(item.product.id);

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

    // SCENARIO A: Fully Paid via Wallet
    if (walletDeduction > 0 && finalAmount === 0) {
      const { insertedOrder, affectedProductIds } = await PaymentsRepository.executeTransaction(async (tx) => {
        const newInvoiceNumber = await PaymentsRepository.getNextInvoiceNumber(tx); 

        const orderResult = await PaymentsRepository.insertOrder(tx, {
          id: orderId, userId: user.id, userAddressId, totalAmount: 0,
          walletAmountUsed: walletDeduction, status: 'Order Placed', paymentMode: 'wallet',
          paymentStatus: 'paid', transactionId: `WALLET-${Date.now()}`, phone,
          couponId: breakdown.appliedCouponId || null, discountAmount: breakdown.discountAmount,
          offerDiscount: breakdown.offerDiscount, offerCodes: breakdown.appliedOffers.map(o => o.title),
          progressStep: 1, invoiceNumber: newInvoiceNumber 
        });

        if (breakdown.appliedCouponId) {
          await PaymentsService.assertCouponUsageWithinLimits(tx, breakdown.appliedCouponId, user.id);
          await PaymentsRepository.insertCouponRedemption(tx, {
            couponId: breakdown.appliedCouponId, userId: user.id, orderId: orderId, status: 'completed'
          });
        }

        await PaymentsRepository.insertOrderTimeline(tx, {
            orderId: orderId, status: 'Order Placed', title: 'Order Placed',
            description: 'Order placed successfully using Wallet.', timestamp: new Date()
        });

        await PaymentsService.deductWalletBalanceOrThrow(tx, user.id, walletDeduction);

        await PaymentsRepository.insertWalletTransaction(tx, {
          userId: user.id, amount: -walletDeduction, type: 'usage', description: `Used for Order #${orderId}`
        });

        await PaymentsRepository.insertOrderItems(tx, enrichedItems);
        const stockIds = await PaymentsService.reduceStock(secureCartItems, tx);
        await PaymentsRepository.clearCartItems(tx, user.id);

        return { insertedOrder: orderResult, affectedProductIds: stockIds };
      });

      createNotification(user.id, `Your order #${orderId} has been placed successfully.`, `/myorder`, 'order').catch(err => console.error("Notification fail:", err));

      if (user.email) {
        addToEmailQueue({ userEmail: user.email, orderDetails: insertedOrder, orderItems: enrichedItems, paymentDetails: { method: 'WALLET_FULL' } });
      }

      const itemsToInvalidate = [
        { key: makeAllOrdersKey(), prefix: true }, { key: makeUserOrdersKey(user.id), prefix: true },
        { key: makeAllProductsKey(), prefix: true }, { key: makeCartKey(user.id) }, { key: makeCartCountKey(user.id) },
      ];

      if (affectedProductIds && affectedProductIds.length > 0) {
        affectedProductIds.forEach(pid => itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true }));
      }

      invalidateMultiple(itemsToInvalidate).catch(err => console.error("Cache invalidate fail:", err));
      PaymentsService.createShiprocketOrderForExistingOrder(orderId).catch(err => console.error("Shiprocket sync fail:", err));

      return res.json({ success: true, orderId, message: "Order placed using Wallet Balance!" });
    }

    // COD FLOW
    if (paymentMode === 'cod') {
      let transactionResult;
      try {
        transactionResult = await PaymentsRepository.executeTransaction(async (tx) => {
          const newInvoiceNumber = await PaymentsRepository.getNextInvoiceNumber(tx); 

          const insertedOrder = await PaymentsRepository.insertOrder(tx, {
            id: orderId, userId: user.id, userAddressId, razorpay_order_id: null,
            totalAmount: finalAmount, walletAmountUsed: walletDeduction, status: 'Order Placed',
            paymentMode: 'cod', transactionId: null, paymentStatus: 'pending', phone,
            couponId: breakdown.appliedCouponId || null, discountAmount: discountAmount,
            offerDiscount: offerDiscount, offerCodes: offerCodes, progressStep: 1, invoiceNumber: newInvoiceNumber 
          });

          if (breakdown.appliedCouponId) {
            await PaymentsService.assertCouponUsageWithinLimits(tx, breakdown.appliedCouponId, user.id);
            await PaymentsRepository.insertCouponRedemption(tx, {
              couponId: breakdown.appliedCouponId, userId: user.id, orderId: orderId, status: 'completed'
            });
          }

          await PaymentsRepository.insertOrderTimeline(tx, {
            orderId: orderId, status: 'Order Placed', title: 'Order Placed',
            description: 'Order placed successfully via Cash on Delivery.', timestamp: new Date()
          });

          if (walletDeduction > 0) {
            await PaymentsService.deductWalletBalanceOrThrow(tx, user.id, walletDeduction);
            await PaymentsRepository.insertWalletTransaction(tx, {
              userId: user.id, amount: -walletDeduction, type: 'usage', description: `Partial payment for Order #${orderId}`
            });
          }

          await PaymentsRepository.insertOrderItems(tx, enrichedItems);
          const affectedProductIds = await PaymentsService.reduceStock(secureCartItems, tx);
          const variantIdsToClear = secureCartItems.map(item => item.variantId);
          await PaymentsRepository.clearCartItems(tx, user.id, variantIdsToClear);

          return { insertedOrder, affectedProductIds };
        });
      } catch (err) {
        console.error("COD Order Failed (Stock/DB):", err.message);
        if (idempotencyKey && redisClient) await redisClient.del(`idemp:order:${idempotencyKey}`);
        return res.status(400).json({ success: false, msg: err.message || "Order failed" });
      }

      const { insertedOrder, affectedProductIds } = transactionResult;

      createNotification(user.id, `Your order #${orderId} has been placed successfully.`, `/myorder`, 'order').catch(err => console.error("Notification fail:", err));

      if (user.email) {
        addToEmailQueue({ userEmail: user.email, orderDetails: insertedOrder, orderItems: enrichedItems, paymentDetails: { method: 'COD' } });
      }

      const itemsToInvalidate = [
        { key: makeAllOrdersKey(), prefix: true }, { key: makeUserOrdersKey(user.id), prefix: true },
        { key: makeAllProductsKey(), prefix: true }, { key: makeCartKey(user.id) }, { key: makeCartCountKey(user.id) },
      ];
      affectedProductIds.forEach(pid => itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true }));

      invalidateMultiple(itemsToInvalidate).catch(err => console.error("Cache invalidate fail:", err));
      PaymentsService.createShiprocketOrderForExistingOrder(orderId).catch(err => console.error("Shiprocket sync fail:", err));

      return res.json({ success: true, orderId, message: "COD order placed successfully" });
    }

    // ONLINE FLOW
    const razorOrder = await PaymentsService.razorpay.orders.create({
      amount: finalAmount * 100, currency: 'INR', receipt: user.id.slice(0, 40),
    });

    await PaymentsRepository.executeTransaction(async (tx) => {
      await PaymentsRepository.insertOrder(tx, {
        id: orderId, userId: user.id, userAddressId, razorpay_order_id: razorOrder.id,
        totalAmount: finalAmount, walletAmountUsed: walletDeduction, status: 'pending_payment',
        paymentMode: 'online', transactionId: null, paymentStatus: 'pending', phone,
        couponId: breakdown.appliedCouponId || null, discountAmount, offerDiscount,
        offerCodes, progressStep: 0,
      });

      if (breakdown.appliedCouponId) {
        await PaymentsRepository.insertCouponRedemption(tx, {
          couponId: breakdown.appliedCouponId, userId: user.id, orderId: orderId, status: 'pending'
        });
      }

      await PaymentsRepository.insertOrderItems(tx, enrichedItems);
    });

    return res.json({
      success: true, razorpayOrderId: razorOrder.id, amount: finalAmount,
      keyId: RAZORPAY_ID_KEY, orderId, breakdown: { ...breakdown, total: finalAmount, walletUsed: walletDeduction },
    });

  } catch (err) {
    console.error('createOrder error:', err);
    const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotencyKey;
    if (idempotencyKey && redisClient) {
       await redisClient.del(`idemp:order:${idempotencyKey}`);
    }
    if (err.code === 'WALLET_INSUFFICIENT' || err.code === 'COUPON_LIMIT_REACHED') {
      return res.status(400).json({ success: false, msg: err.message });
    }
    return res.status(500).json({ success: false, msg: err.message || 'Server error' });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, cartItems, userAddressId } = req.body;

    const user = await PaymentsRepository.getUserByClerkId(req.auth.userId);
    if (!user) return res.status(401).json({ success: false, error: "Unauthorized" });

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userAddressId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    if (!PaymentsService.verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ success: false, error: "Verification failed" });
    }

    const existingOrder = await PaymentsRepository.getOrderByRazorpayId(razorpay_order_id);
    if (!existingOrder) return res.status(404).json({ success: false, error: "Order not found." });
    
    if (existingOrder.userId !== user.id) return res.status(403).json({ success: false, error: "Forbidden: Not your order." });

    if (existingOrder.paymentStatus === 'paid') return res.json({ success: true, message: "Order already paid." });

    const secureCartItems = cartItems.map(item => ({ variantId: item.variant.id, quantity: item.quantity, productId: item.product.id }));

    const payment = await PaymentsService.razorpay.payments.fetch(razorpay_payment_id);

    if (payment.amount !== existingOrder.totalAmount * 100) {
      console.error(`Mismatch: Razorpay Paid ${payment.amount} !== DB Expected ${existingOrder.totalAmount * 100}`);
      await PaymentsService.razorpay.payments.refund(razorpay_payment_id, { amount: payment.amount, speed: 'optimum' });
      return res.status(400).json({ success: false, error: "Payment amount mismatch. Refund initiated." });
    }

    let transactionResult;
    const razorpayContact = payment.contact ? String(payment.contact).replace(/\D/g, '').slice(-10) : null;
    if (razorpayContact && /^[6-9]\d{9}$/.test(razorpayContact) && razorpayContact !== existingOrder.phone) {
      PaymentsRepository.storePaymentContact(existingOrder.id, razorpayContact, user.id);
    }

    try {
      transactionResult = await PaymentsRepository.executeTransaction(async (tx) => {
        const lockedOrder = await PaymentsRepository.getOrderByIdLocked(tx, existingOrder.id);

        if (lockedOrder.paymentStatus === 'paid') return { alreadyPaid: true };

        const newInvoiceNumber = await PaymentsRepository.getNextInvoiceNumber(tx);

        const updatedOrder = await PaymentsRepository.updateOrder(tx, existingOrder.id, {
          status: 'Order Placed', paymentStatus: 'paid', transactionId: razorpay_payment_id,
          progressStep: 1, updatedAt: new Date(), invoiceNumber: newInvoiceNumber 
        });

        if (existingOrder.couponId) {
          await PaymentsService.assertCouponUsageWithinLimits(tx, existingOrder.couponId, user.id);
        }

        await PaymentsRepository.updateCouponRedemptionStatus(tx, existingOrder.id, 'completed');

        await PaymentsRepository.insertOrderTimeline(tx, {
            orderId: existingOrder.id, status: 'Order Placed', title: 'Order Placed',
            description: 'Payment verified and order placed successfully.', timestamp: new Date()
        });

        if (existingOrder.walletAmountUsed > 0) {
            await PaymentsService.deductWalletBalanceOrThrow(tx, user.id, existingOrder.walletAmountUsed);
            await PaymentsRepository.insertWalletTransaction(tx, {
                userId: user.id, amount: -existingOrder.walletAmountUsed, type: 'usage',
                description: `Used for Order #${existingOrder.id}`
            });
        }

        const affectedProductIds = await PaymentsService.reduceStock(secureCartItems, tx);

        const variantIdsToClear = secureCartItems.map(item => item.variantId);
        await PaymentsRepository.clearCartItems(tx, user.id, variantIdsToClear);

        return { updatedOrder, affectedProductIds };
      });
    } catch (error) {
      console.error("verify error:", error);
      if (error.message.includes("Out of stock")) {
        try {
          await PaymentsService.razorpay.payments.refund(req.body.razorpay_payment_id, { speed: 'optimum', notes: { reason: 'Out of stock after payment' } });
          return res.status(400).json({ success: false, error: "Item went out of stock just now. Your payment has been auto-refunded." });
        } catch (refundError) {
          return res.status(500).json({ success: false, error: "Out of stock. Payment deducted but refund failed. Please contact support." });
        }
      }

      if (error.code === "COUPON_LIMIT_REACHED") {
        try {
          await PaymentsService.razorpay.payments.refund(req.body.razorpay_payment_id, { speed: 'optimum', notes: { reason: 'Coupon usage limit reached at verification time' } });
          return res.status(400).json({ success: false, error: "This coupon's usage limit was reached just before your payment completed. Your payment has been auto-refunded." });
        } catch (refundError) {
          return res.status(500).json({ success: false, error: "Coupon limit reached. Payment deducted but refund failed. Please contact support." });
        }
      }

      if (error.code === "WALLET_INSUFFICIENT") {
        try {
          await PaymentsService.razorpay.payments.refund(req.body.razorpay_payment_id, { speed: 'optimum', notes: { reason: 'Wallet balance insufficient at verification time' } });
          return res.status(400).json({ success: false, error: "Your wallet balance changed since checkout started and this order can no longer be completed. Your payment has been auto-refunded." });
        } catch (refundError) {
          return res.status(500).json({ success: false, error: "Wallet balance issue. Payment deducted but refund failed. Please contact support." });
        }
      }
      return res.status(500).json({ success: false, error: error.message || "Server error" });
    }

    if (transactionResult.alreadyPaid) return res.json({ success: true, message: "Payment already verified & processed." });

    const { updatedOrder, affectedProductIds } = transactionResult;

    const itemsToInvalidate = [
      { key: makeAllOrdersKey(), prefix: true }, { key: makeUserOrdersKey(user.id), prefix: true },
      { key: makeAllProductsKey(), prefix: true }, { key: makeCartKey(user.id) }, { key: makeCartCountKey(user.id) },
    ];
    affectedProductIds.forEach(pid => itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true }));
    invalidateMultiple(itemsToInvalidate).catch(err => console.error("Cache invalidate fail:", err));

    createNotification(user.id, `Your order #${existingOrder.id} has been placed successfully.`, `/myorder`, 'order').catch(err => console.error("Notification fail:", err));

    PaymentsRepository.getOrderItemsByOrderId(existingOrder.id).then((dbOrderItems) => {
      if (user.email && dbOrderItems.length > 0) {
        addToEmailQueue({ userEmail: user.email, orderDetails: updatedOrder, orderItems: dbOrderItems, paymentDetails: req.body });
      }
    }).catch(e => console.error("Queue error:", e));

    PaymentsService.createShiprocketOrderForExistingOrder(existingOrder.id).catch(err => console.error("Shiprocket sync fail:", err));

    return res.json({ success: true, message: "Payment verified & order placed." });

  } catch (error) {
    console.error("verify error:", error);
    return res.status(500).json({ success: false, error: error.message || "Server error during verification." });
  }
};
