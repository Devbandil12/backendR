import Razorpay from 'razorpay';
import crypto from 'crypto';
import * as PaymentsRepository from './payments.repository.js';
import { safeCompare } from '../../utils/safeCompare.js';
import { createOrder as createShiprocketOrder } from '../../infrastructure/shipping/providers/shiprocket.js';
const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

export const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

export async function assertCouponUsageWithinLimits(tx, couponId, userId) {
  if (!couponId) return;

  const lockedCoupon = await PaymentsRepository.lockAndGetCoupon(tx, couponId);
  if (!lockedCoupon) return;

  const fail = (message) => {
    const err = new Error(message);
    err.code = 'COUPON_LIMIT_REACHED';
    throw err;
  };

  if (lockedCoupon.totalUsageLimit !== null) {
    const count = await PaymentsRepository.getCompletedCouponRedemptionsCount(tx, couponId);
    if (count >= lockedCoupon.totalUsageLimit) {
      fail('The global usage limit for this coupon has just been reached.');
    }
  }

  if (lockedCoupon.maxUsagePerUser !== null && userId) {
    const count = await PaymentsRepository.getUserCompletedCouponRedemptionsCount(tx, couponId, userId);
    if (count >= lockedCoupon.maxUsagePerUser) {
      fail(`You have reached the maximum usage limit (${lockedCoupon.maxUsagePerUser}) for this coupon.`);
    }
  }
}

export async function deductWalletBalanceOrThrow(tx, userId, amount) {
  if (!amount || amount <= 0) return;

  const updated = await PaymentsRepository.deductWalletBalance(tx, userId, amount);

  if (!updated) {
    const err = new Error('Your wallet balance changed since checkout started and is no longer sufficient for this order. Please refresh and try again.');
    err.code = 'WALLET_INSUFFICIENT';
    throw err;
  }

  return updated;
}

export async function createShiprocketOrderForExistingOrder(orderId) {
  try {
    const order = await PaymentsRepository.getOrderForShiprocketSync(orderId);

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
      await PaymentsRepository.updateOrderShiprocketIds(orderId, srResponse.order_id, srResponse.shipment_id);
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

export async function checkStockAvailability(cartItems) {
  for (const item of cartItems) {
    const variant = await PaymentsRepository.getVariantStock(item.variantId);

    if (!variant || variant.stock < item.quantity) {
      throw new Error(`Sorry, ${variant?.name || 'Item'} is currently out of stock.`);
    }

    const bundleContents = await PaymentsRepository.getBundleContents(item.variantId);

    for (const content of bundleContents) {
      const requiredQty = content.quantity * item.quantity;
      const childVariant = await PaymentsRepository.getVariantStock(content.contentVariantId);

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
    const bundleContents = await PaymentsRepository.getBundleContents(item.variantId, tx);

    if (bundleContents.length > 0) {
      const updatedBundle = await PaymentsRepository.updateVariantStockAndSold(tx, item.variantId, item.quantity);
      if (!updatedBundle) {
        throw new Error(`Stock updated while you were paying. Refund initiated.`);
      }
      affectedProductIds.add(updatedBundle.productId);

      for (const content of bundleContents) {
        const stockToReduce = content.quantity * item.quantity;
        const updatedChild = await PaymentsRepository.updateVariantStockAndSold(tx, content.contentVariantId, stockToReduce);
        if (!updatedChild) {
          throw new Error(`Stock updated while you were paying. Refund initiated.`);
        }
        affectedProductIds.add(updatedChild.productId);
      }
    } else {
      const updatedVariant = await PaymentsRepository.updateVariantStockAndSold(tx, item.variantId, item.quantity);
      if (!updatedVariant) {
        throw new Error(`Stock updated while you were paying. Refund initiated.`);
      }
      affectedProductIds.add(updatedVariant.productId);
    }
  }
  return Array.from(affectedProductIds);
}

function toE164India(phone) {
  const digitsOnly = String(phone || '').replace(/\D/g, '');
  if (digitsOnly.length === 10) return `91${digitsOnly}`;
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) return digitsOnly;
  return null;
}

export const verifyPhoneVerification = async (user, address) => {
  const normalizedPhone = toE164India(address.phone);
  if (!normalizedPhone) {
    throw { code: 'INVALID_PHONE', msg: 'Invalid phone format.', purpose: 'CHECKOUT' };
  }
  const verifiedPhone = await PaymentsRepository.getVerifiedPhone(user.id, normalizedPhone);
  if (!verifiedPhone) {
    throw { code: 'PHONE_VERIFICATION_REQUIRED', msg: 'Please verify your phone number to complete checkout.', purpose: 'CHECKOUT' };
  }
  return true;
};

export const verifyRazorpaySignature = (orderId, paymentId, signature) => {
  const generatedSignature = crypto
    .createHmac('sha256', RAZORPAY_SECRET_KEY)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeCompare(generatedSignature, signature);
};
