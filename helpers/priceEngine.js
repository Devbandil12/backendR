// server/helpers/priceEngine.js
import { db } from '../configs/index.js';
import { 
  couponsTable, 
  productVariantsTable, 
  ordersTable, 
  usersTable, 
  couponRedemptionsTable 
} from '../configs/schema.js';
import { eq, inArray, and, isNull, gte, lte, or, sql } from 'drizzle-orm';
import { getPincodeDetails } from '../controllers/addressController.js'; 

// 🟢 NEW: Import the single source of truth for segments
import { userMatchesSegment } from './segmentMatcher.js';

export const calculatePriceBreakdown = async (cartItems, couponCode, pincode, userId) => {
  // 1. Initialize totals
  let originalTotal = 0;
  let productTotal = 0;
  let manualDiscountAmount = 0;
  let offerDiscount = 0; 
  let appliedOffers = []; 

  // 2. STRICT DELIVERY CHARGE HANDLING
  let deliveryCharge = 0;
  let codAvailable = false;

  if (pincode) {
    const pincodeDetails = await getPincodeDetails(pincode);
    if (pincodeDetails) {
      deliveryCharge = pincodeDetails.deliveryCharge;
      codAvailable = pincodeDetails.codAvailable;
    }
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
  const autoCoupons = await db
    .select()
    .from(couponsTable)
    .where(
      and(
        eq(couponsTable.isAutomatic, true),
        eq(couponsTable.isActive, true), // Ensure it's active
        or(isNull(couponsTable.validFrom), lte(couponsTable.validFrom, now)),
        or(isNull(couponsTable.validUntil), gte(couponsTable.validUntil, now))
      )
    );
    
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

          // 🟢 NEW: ENFORCE Global Usage Limit
          if (c.totalUsageLimit !== null) {
              const totalRedemptions = await db.select().from(couponRedemptionsTable)
                  .where(eq(couponRedemptionsTable.couponId, c.id));
              
              if (totalRedemptions.length >= c.totalUsageLimit) {
                  throw new Error("The global usage limit for this flash coupon has been reached.");
              }
          }

          // 🟢 NEW: ENFORCE First Order Only (Using loaded relations)
          if (c.firstOrderOnly && userId) {
            if (user && (user.orders || []).length > 0) {
                throw new Error("This coupon is strictly valid for your first order only.");
            }
          }

          // 🟢 NEW: ENFORCE Max Usage Per User (Using new redemptions table)
          if (c.maxUsagePerUser !== null && userId) {
            const userRedemptions = await db.select().from(couponRedemptionsTable).where(
              and(
                eq(couponRedemptionsTable.couponId, c.id), 
                eq(couponRedemptionsTable.userId, userId)
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

  // 8. Calculate Final Total
  const total = Math.max(productTotal - offerDiscount - manualDiscountAmount + deliveryCharge, 0);

  // 9. Return result
  return { 
    originalTotal,
    productTotal,
    deliveryCharge,
    offerDiscount: offerDiscount, 
    appliedOffers, 
    discountAmount: manualDiscountAmount, 
    total,
    codAvailable,
    walletUsed: 0,
    appliedCouponId, // 🟢 Helpful to pass down to order placement!
    rejectionMessage // 🟢 Wire this up to the frontend UI
  };
};