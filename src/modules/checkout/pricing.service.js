// server/modules/checkout/pricing.service.js
import { db } from '../../db/client.js';
import { 
  couponsTable, 
  productVariantsTable, 
  ordersTable, 
  usersTable, 
  couponRedemptionsTable 
} from '../../db/schema/index.js';
import { eq, inArray, and, isNull, gte, lte, or, sql } from 'drizzle-orm';
import { getPincodeDetails } from '../addresses/addresses.repository.js';

// 🟢 NEW: Import the single source of truth for segments
import { userMatchesSegment } from '../risk/segment-matcher.service.js';

// 🟢 NEW: Redis cache for the automatic-offers list (see getActiveAutomaticOffers below)
import { redis } from '../../config/redis.js';

const AUTO_OFFERS_CACHE_KEY = 'coupons:auto-offers:raw';
const AUTO_OFFERS_CACHE_TTL_SECONDS = 60;

/**
 * 🟢 FIX (Round 3, item 2.4/efficiency): calculatePriceBreakdown fires on
 * essentially every cart/address keystroke during checkout, and was doing a
 * full table scan of every automatic coupon on every single call. Automatic
 * offers rarely change, so cache the active list in Redis with a short TTL,
 * and invalidate it immediately on coupon create/update/delete (see
 * routes/coupons.js, which already invalidates "coupons:auto-offers" for the
 * public /automatic-offers endpoint — it now also invalidates this raw key).
 */
async function getActiveAutomaticOffers() {
  try {
    if (redis.status === 'ready') {
      const cached = await redis.get(AUTO_OFFERS_CACHE_KEY);
      if (cached) return JSON.parse(cached);
    }
  } catch (err) {
    console.error('[priceEngine] Auto-offer cache read failed:', err.message);
  }

  const now = new Date();
  const offers = await db
    .select()
    .from(couponsTable)
    .where(
      and(
        eq(couponsTable.isAutomatic, true),
        eq(couponsTable.isActive, true),
        or(isNull(couponsTable.validFrom), lte(couponsTable.validFrom, now)),
        or(isNull(couponsTable.validUntil), gte(couponsTable.validUntil, now))
      )
    );

  try {
    if (redis.status === 'ready') {
      await redis.set(AUTO_OFFERS_CACHE_KEY, JSON.stringify(offers), 'EX', AUTO_OFFERS_CACHE_TTL_SECONDS);
    }
  } catch (err) {
    console.error('[priceEngine] Auto-offer cache write failed:', err.message);
  }

  return offers;
}

export const calculatePriceBreakdown = async (cartItems, couponCode, pincode, userId) => {
  // 1. Initialize totals
  let originalTotal = 0;
  let productTotal = 0;
  let manualDiscountAmount = 0;
  let offerDiscount = 0; 
  let appliedOffers = []; 

  // 2. FETCH SERVICEABILITY FROM REDIS
  let deliveryCharge = 0;
  let codAvailable = false;
  let estimatedDeliveryDays = null;

  if (pincode) {
    if (redis.status === "ready") {
      const cachedSvc = await redis.get(`shiprocket:svc:${pincode}`);
      if (cachedSvc) {
        const parsedSvc = JSON.parse(cachedSvc);
        codAvailable = parsedSvc.codAvailable;
        estimatedDeliveryDays = parsedSvc.estimatedDeliveryDays;
      }
    }
  }

  // 🟢 NEW: Part C — a user auto-switched to prepaid-only (2+ refused COD
  // deliveries) never sees COD as available, regardless of pincode.
  if (codAvailable && userId) {
    const [codUser] = await db.select({ codDisabled: usersTable.codDisabled }).from(usersTable).where(eq(usersTable.id, userId));
    if (codUser?.codDisabled) codAvailable = false;
  }

  // 3. Get full cart item details from DB
  const variantIds = cartItems.map(item => item.variantId);
  if (variantIds.length === 0) {
      return { 
        originalTotal: 0, productTotal: 0, deliveryCharge: 0, 
        offerDiscount: 0, appliedOffers: [], discountAmount: 0, 
        total: 0, codAvailable: false, walletUsed: 0,
        appliedCouponId: null, rejectionMessage: null
      };
  }
  
  const fullCart = await db.query.productVariantsTable.findMany({
    where: inArray(productVariantsTable.id, variantIds),
    with: {
      product: {
        // 🟢 FIXED: Removed the dead 'mrp' reference
        columns: { category: true } 
      }
    }
  });

  const cartMap = new Map(fullCart.map(v => [v.id, v]));

  const fullCartWithQuantities = cartItems.map(item => {
    const fullVariant = cartMap.get(item.variantId);
    if (!fullVariant) throw new Error(`Invalid variant ID: ${item.variantId}`);
    
    const discountedPrice = Math.floor(fullVariant.oprice * (1 - fullVariant.discount / 100));
    return {
      ...fullVariant,
      quantity: item.quantity,
      discountedPrice: discountedPrice
    };
  });

  // 4. Calculate initial totals
  for (const item of fullCartWithQuantities) {
    originalTotal += item.oprice * item.quantity;
    productTotal += item.discountedPrice * item.quantity;
  }

  // 5. --- AUTOMATIC PROMOTION ENGINE ---
  const now = new Date();
  // 🟢 FIX: Was a direct DB hit on every call; now Redis-cached (60s TTL).
  const autoCoupons = await getActiveAutomaticOffers();
    
  let bestAutoOffer = null;

  for (const offer of autoCoupons) {
    let offerIsValid = true;
    let discountAmount = 0;
    let appliesToVariantId = null;

    if (offer.minOrderValue > 0 && productTotal < offer.minOrderValue) offerIsValid = false;
    if (offer.minItemCount > 0 && fullCartWithQuantities.reduce((acc, item) => acc + item.quantity, 0) < offer.minItemCount) offerIsValid = false;

    if (offerIsValid) {
      if (offer.discountType === 'free_item' && offer.cond_requiredCategory && offer.action_targetSize && !offer.action_buyX) {
        const hasRequiredCategory = fullCartWithQuantities.some(v => v.product.category === offer.cond_requiredCategory);
        if (hasRequiredCategory) {
          const itemToMakeFree = fullCartWithQuantities.find(v => 
            v.size === offer.action_targetSize &&
            v.discountedPrice <= (offer.action_targetMaxPrice || Infinity) &&
            v.product.category !== offer.cond_requiredCategory
          );
          if (itemToMakeFree) {
            discountAmount = itemToMakeFree.discountedPrice;
            appliesToVariantId = itemToMakeFree.id;
          } else { offerIsValid = false; }
        } else { offerIsValid = false; }
      }
      
      if (offer.discountType === 'free_item' && offer.action_buyX && offer.action_getY && offer.action_targetSize && !offer.cond_requiredSize) {
        const matchingItems = fullCartWithQuantities.filter(v => v.size === offer.action_targetSize);
        const totalMatchingQty = matchingItems.reduce((acc, item) => acc + item.quantity, 0);
        const buyX = offer.action_buyX;
        const getY = offer.action_getY;
        const numFreeItems = Math.floor(totalMatchingQty / (buyX + getY)) * getY;

        if (numFreeItems > 0) {
          const cheapestItem = matchingItems.sort((a, b) => a.discountedPrice - b.discountedPrice)[0];
          // 🟢 FIXED: Clamp to ensure we never discount more items than exist in the cart
          const actualFreeItems = Math.min(numFreeItems, cheapestItem.quantity);
          discountAmount = cheapestItem.discountedPrice * actualFreeItems;
        } else { offerIsValid = false; }
      }
      
      if (offer.discountType === 'free_item' && offer.action_buyX && offer.action_getY && offer.cond_requiredSize && offer.action_targetSize) {
        const matchingBoughtItems = fullCartWithQuantities.filter(v => v.size === offer.cond_requiredSize);
        const totalBoughtQty = matchingBoughtItems.reduce((acc, item) => acc + item.quantity, 0);

        if (totalBoughtQty >= offer.action_buyX) {
          const itemToMakeFree = fullCartWithQuantities.find(v => 
            v.size === offer.action_targetSize &&
            v.discountedPrice <= (offer.action_targetMaxPrice || Infinity)
          );
          if (itemToMakeFree) {
            const numFreeItems = Math.min(
              Math.floor(totalBoughtQty / offer.action_buyX) * offer.action_getY,
              itemToMakeFree.quantity
            );
            discountAmount = itemToMakeFree.discountedPrice * numFreeItems;
            appliesToVariantId = itemToMakeFree.id;
          } else { offerIsValid = false; }
        } else { offerIsValid = false; }
      }

      if (offer.discountType === 'percent') {
        let rawDiscount = Math.floor(productTotal * (offer.discountValue / 100));
        if (offer.maxDiscountAmount && rawDiscount > offer.maxDiscountAmount) {
          discountAmount = offer.maxDiscountAmount;
        } else {
          discountAmount = rawDiscount;
        }
      }

      if (offer.discountType === 'flat') {
        discountAmount = offer.discountValue;
      }
    }
    
    if (offerIsValid && discountAmount > (bestAutoOffer?.amount || 0)) {
      bestAutoOffer = {
        title: offer.code,
        amount: discountAmount,
        appliesToVariantId: appliesToVariantId,
        offer: offer 
      };
    }
  }

  // 6. --- MANUAL COUPON LOGIC (STRICT ENFORCEMENT) ---
  let manualCoupon = null;
  
  if (couponCode) {
      const [c] = await db.select().from(couponsTable).where(
        and(
          eq(couponsTable.code, couponCode),
          eq(couponsTable.isAutomatic, false) 
        )
      );
      
      if (c) {
          if (!c.isActive) throw new Error("This coupon is no longer active.");

          let user = null;
          if (userId) {
              // 🟢 NEW: Fetch full user context for accurate history validation
              user = await db.query.usersTable.findFirst({
                  where: eq(usersTable.id, userId),
                  with: { orders: true }
              });
          }

          // 🟢 FIX: An abandoned Razorpay checkout (status: 'pending_payment', never
          // actually paid) or a cancelled order must not count as "this user has
          // already ordered" — otherwise a genuinely first-time customer whose
          // payment once failed gets permanently locked out of a first-order coupon.
          const realOrders = user
            ? (user.orders || []).filter(o => o.status !== 'pending_payment' && o.status !== 'Order Cancelled')
            : [];

          // 🟢 NEW: ENFORCE Target Segment
          if (c.targetCategory) {
              if (!user) throw new Error("You must be logged in to use this targeted coupon.");
              if (!userMatchesSegment(user, user.orders || [], c.targetCategory)) {
                  throw new Error("You do not meet the eligibility criteria for this coupon segment.");
              }
          }

          // 🟢 NEW: ENFORCE Targeted User
          if (c.targetUserId && c.targetUserId !== userId) {
            throw new Error("This coupon is not valid for your account.");
          }

          // 🟢 FIX: ENFORCE Global Usage Limit — only count redemptions that actually
          // completed. A 'pending' row from an abandoned Razorpay checkout (or a
          // 'cancelled' row from a cancelled order) must not permanently consume a
          // slot in a limited flash-sale coupon.
          if (c.totalUsageLimit !== null) {
              const totalRedemptions = await db.select().from(couponRedemptionsTable)
                  .where(and(
                    eq(couponRedemptionsTable.couponId, c.id),
                    eq(couponRedemptionsTable.status, 'completed')
                  ));
              
              if (totalRedemptions.length >= c.totalUsageLimit) {
                  throw new Error("The global usage limit for this flash coupon has been reached.");
              }
          }

          // 🟢 FIX: ENFORCE First Order Only using realOrders (excludes abandoned
          // online-payment attempts and cancelled orders — see filter above)
          if (c.firstOrderOnly && userId) {
            if (realOrders.length > 0) {
                throw new Error("This coupon is strictly valid for your first order only.");
            }
          }

          // 🟢 FIX: ENFORCE Max Usage Per User — same status filter as above. This is
          // still just the preview-time check; the race-safe, money-changing check
          // now lives in paymentController.js's assertCouponUsageWithinLimits(),
          // which locks the coupon row inside the actual order/payment transaction.
          if (c.maxUsagePerUser !== null && userId) {
            const userRedemptions = await db.select().from(couponRedemptionsTable).where(
              and(
                eq(couponRedemptionsTable.couponId, c.id), 
                eq(couponRedemptionsTable.userId, userId),
                eq(couponRedemptionsTable.status, 'completed')
              )
            );
            
            if (userRedemptions.length >= c.maxUsagePerUser) {
              throw new Error(`You have reached the maximum usage limit (${c.maxUsagePerUser}) for this coupon.`);
            }
          }

          // Verify dates and cart minimums
          if (c.validFrom && now < c.validFrom) throw new Error("This coupon is not yet valid.");
          if (c.validUntil && now > c.validUntil) throw new Error("This coupon has expired.");
          if (productTotal < c.minOrderValue) throw new Error(`Cart total must be at least ₹${c.minOrderValue} to use this coupon.`);
          if (fullCartWithQuantities.reduce((acc, item) => acc + item.quantity, 0) < c.minItemCount) throw new Error(`Add at least ${c.minItemCount} items to use this coupon.`);
          
          // Calculate manual discount
          let couponDiscount = 0;
          if (c.discountType === 'percent') {
            couponDiscount = Math.floor((c.discountValue / 100) * productTotal);
            if (c.maxDiscountAmount && couponDiscount > c.maxDiscountAmount) {
              couponDiscount = c.maxDiscountAmount;
            }
          } else {
            couponDiscount = c.discountValue;
          }
          manualCoupon = { ...c, amount: couponDiscount };
      } else {
          throw new Error("Invalid or unrecognized coupon code.");
      }
  }

  // 7. --- APPLY THE WINNING DISCOUNT (Math.max Showdown) ---
  let appliedCouponId = null;
  let rejectionMessage = null;
  
  const autoDiscountAmount = bestAutoOffer ? bestAutoOffer.amount : 0;
  const manualDiscountAmountCalc = manualCoupon ? manualCoupon.amount : 0;

  // 🟢 FIXED: The customer always gets the best possible deal
  const autoWins = bestAutoOffer && (autoDiscountAmount > manualDiscountAmountCalc);

  if (manualCoupon && !autoWins) {
    manualDiscountAmount = manualDiscountAmountCalc;
    offerDiscount = 0;
    appliedOffers = [manualCoupon]; 
    appliedCouponId = manualCoupon.id;
  } else if (bestAutoOffer) {
    manualDiscountAmount = 0;
    offerDiscount = autoDiscountAmount;
    appliedOffers = [bestAutoOffer.offer]; 
    appliedCouponId = bestAutoOffer.offer.id;
    
    // Alert the user if their code worked but the site sale was better
    if (manualCoupon && autoDiscountAmount > manualDiscountAmountCalc) {
        rejectionMessage = `Your code was valid for ₹${manualDiscountAmountCalc} off, but we kept the ₹${autoDiscountAmount} automatic site offer to give you the best deal!`;
    }
  }

  // 8. FETCH SHIPPING RULES & CALCULATE DELIVERY CHARGE
  // Delivery charge should only apply after we know the final product total minus discounts!
  const cartTotalBeforeShipping = Math.max(productTotal - offerDiscount - manualDiscountAmount, 0);
  
  // We fetch rules from shippingRulesTable (default to 999 threshold and 50 fee)
  let freeShippingThreshold = 999;
  let flatShippingRate = 50;
  
  try {
    const rules = await db.query.shippingRulesTable.findFirst();
    if (rules) {
      freeShippingThreshold = rules.freeShippingThreshold;
      flatShippingRate = rules.flatShippingRate;
    }
  } catch (err) {
    console.error("[priceEngine] Failed to load shipping rules:", err.message);
  }

  // If cart total is >= the threshold, shipping is free!
  if (cartTotalBeforeShipping >= freeShippingThreshold) {
    deliveryCharge = 0;
  } else {
    deliveryCharge = flatShippingRate;
  }

  // 9. Calculate Final Total
  const total = cartTotalBeforeShipping + deliveryCharge;

  // 10. Return result
  return { 
    originalTotal,
    productTotal,
    deliveryCharge,
    offerDiscount: offerDiscount, 
    appliedOffers, 
    discountAmount: manualDiscountAmount, 
    total,
    codAvailable,
    estimatedDeliveryDays,
    walletUsed: 0,
    appliedCouponId, // 🟢 Helpful to pass down to order placement!
    rejectionMessage // 🟢 Wire this up to the frontend UI
  };
};



