// server/helpers/priceEngine.js
import { db } from '../configs/index.js';
import { couponsTable, productVariantsTable } from '../configs/schema.js';
import { eq, inArray, and, isNull, gte, lte, or } from 'drizzle-orm';
import { getPincodeDetails } from '../controllers/addressController.js'; 

export const calculatePriceBreakdown = async (cartItems, couponCode, pincode) => {
  // 1. Initialize totals
  let originalTotal = 0;
  let productTotal = 0;
  let manualDiscountAmount = 0;
  let offerDiscount = 0; 
  let appliedOffers = []; 

  // 🟢 FIX 1: STRICT DELIVERY CHARGE HANDLING
  // Only fetch details if a valid pincode is provided. 
  // If pincode is null/undefined (Cart View), deliveryCharge must be 0.
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
     // Return zeroed out structure if empty
     return { 
       originalTotal: 0, productTotal: 0, deliveryCharge: 0, 
       offerDiscount: 0, appliedOffers: [], discountAmount: 0, 
       total: 0, codAvailable: false, walletUsed: 0 
     };
  }
  
  const fullCart = await db.query.productVariantsTable.findMany({
    where: inArray(productVariantsTable.id, variantIds),
    with: {
      product: {
        columns: { category: true, mrp: true } // Added mrp just in case
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
          discountAmount = cheapestItem.discountedPrice * numFreeItems;
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

  // 6. --- MANUAL COUPON LOGIC ---
  let manualCoupon = null;
  if (couponCode) {
      const [c] = await db.select().from(couponsTable).where(
        and(
          eq(couponsTable.code, couponCode),
          eq(couponsTable.isAutomatic, false) 
        )
      );
      
      if (c) {
          const now = new Date();
          if (
              !(c.validFrom && now < c.validFrom) &&
              !(c.validUntil && now > c.validUntil) &&
              productTotal >= c.minOrderValue &&
              fullCartWithQuantities.reduce((acc, item) => acc + item.quantity, 0) >= c.minItemCount
          ) {
              let couponDiscount = 0;
              if (c.discountType === 'percent') {
                couponDiscount = Math.floor((c.discountValue / 100) * productTotal);
                if (c.maxDiscountAmount && couponDiscount > c.maxDiscountAmount) {
                  couponDiscount = c.maxDiscountAmount;
                }
              } else {
                couponDiscount = c.discountValue;
              }
              manualCoupon = { amount: couponDiscount };
          }
      }
  }

  // 7. --- APPLY THE WINNING DISCOUNT ---
  if (manualCoupon) {
    manualDiscountAmount = manualCoupon.amount;
    offerDiscount = 0;
    appliedOffers = []; 
  } else if (bestAutoOffer) {
    manualDiscountAmount = 0;
    offerDiscount = bestAutoOffer.amount;
    appliedOffers = [bestAutoOffer]; 
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
    walletUsed: 0 // 🟢 Added Default
  };
};