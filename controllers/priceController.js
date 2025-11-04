// server/controllers/priceController.js
import { db } from '../configs/index.js';
// 🟢 IMPORT: Import productVariantsTable and inArray
import { productsTable, couponsTable, productVariantsTable } from '../configs/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { getPincodeDetails } from './addressController.js';

export const getPriceBreakdown = async (req, res) => {
  try {
    // 🟢 cartItems should now be: [{ variantId, quantity, productId }]
    const { cartItems, couponCode = null, pincode = null } = req.body;
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }

    const pincodeDetails = await getPincodeDetails(pincode);
    const deliveryCharge = pincodeDetails.deliveryCharge;
    const codAvailable = pincodeDetails.codAvailable;

    let originalTotal = 0;
    let productTotal = 0;
    let discountAmount = 0;

    // 🟢 NEW: Get all variant data at once
    const variantIds = cartItems.map(item => item.variantId);
    if (variantIds.length === 0) {
       return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }
    
    const variants = await db.select()
      .from(productVariantsTable)
      .where(inArray(productVariantsTable.id, variantIds));

    const variantsMap = new Map(variants.map(v => [v.id, v]));
    
    let comboItemCount = 0; // Count 20ml items

    for (const { variantId, quantity } of cartItems) {
      const v = variantsMap.get(variantId); // Get variant from our map
      if (!v) {
        return res.status(400).json({ success: false, msg: `Invalid variant: ${variantId}` });
      }
      
      // 🟢 CHECK FOR COMBO: Check if it's a 20ml item
      if (v.size === 20) {
        comboItemCount += quantity;
      }
      
      const basePrice = Math.floor(v.oprice);
      const discountedPrice = Math.floor(basePrice * (1 - v.discount / 100));
      originalTotal += basePrice * quantity;
      productTotal += discountedPrice * quantity;
    }

    // 🟢 NEW: Apply Combo Discount
    // You can change these rules
    const COMBO_SIZE = 4;
    const COMBO_DISCOUNT_PER_BUNDLE = 200; // e.g., ₹200 off every 4 bottles
    
    if (comboItemCount >= COMBO_SIZE) {
      const comboCount = Math.floor(comboItemCount / COMBO_SIZE);
      const comboDiscount = comboCount * COMBO_DISCOUNT_PER_BUNDLE;
      discountAmount += comboDiscount; // Add combo discount
    }

    // Apply coupon discount (on top of product discounts, but before combo)
    if (couponCode) {
        const [c] = await db.select({
            discountType: couponsTable.discountType,
            discountValue: couponsTable.discountValue,
            minOrderValue: couponsTable.minOrderValue,
            validFrom: couponsTable.validFrom,
            validUntil: couponsTable.validUntil,
        }).from(couponsTable).where(eq(couponsTable.code, couponCode));

        if (c) {
            const now = new Date();
            // Check if coupon is valid for the *post-discount* total
            if (
                !(c.validFrom && now < c.validFrom) &&
                !(c.validUntil && now > c.validUntil) &&
                productTotal >= c.minOrderValue
            ) {
                const couponDiscount = c.discountType === 'percent'
                    ? Math.floor((c.discountValue / 100) * productTotal)
                    : c.discountValue;
                
                discountAmount += couponDiscount; // Add coupon discount
            }
        }
    }

    const total = Math.max(productTotal + deliveryCharge - discountAmount, 0);

    return res.json({
      success: true,
      breakdown: { originalTotal, productTotal, deliveryCharge, discountAmount, total, codAvailable },
    });
  } catch (err) {
    console.error('getPriceBreakdown error:', err);
    return res.status(500).json({ success: false, msg: 'Server error' });
  }
};