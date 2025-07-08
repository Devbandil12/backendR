// server/controllers/priceController.js
import { db } from '../configs/index.js';
import { productsTable, couponsTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

export const getPriceBreakdown = async (req, res) => {
  try {
    const { cartItems, couponCode = null } = req.body;
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }

    let originalTotal = 0;
    let productTotal  = 0;
    let discountAmount = 0;
    const deliveryCharge = 0;

    for (const { id, quantity } of cartItems) {
      const [p] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, id));
      if (!p) {
        return res.status(400).json({ success: false, msg: `Invalid product: ${id}` });
      }
      const basePrice       = Math.floor(p.oprice);
      const discountedPrice = Math.floor(basePrice * (1 - p.discount / 100));
      originalTotal += basePrice * quantity;
      productTotal  += discountedPrice * quantity;
    }

    if (couponCode) {
      const [c] = await db
        .select({
          discountType:  couponsTable.discountType,
          discountValue: couponsTable.discountValue,
          minOrderValue: couponsTable.minOrderValue,
          validFrom:     couponsTable.validFrom,
          validUntil:    couponsTable.validUntil,
        })
        .from(couponsTable)
        .where(eq(couponsTable.code, couponCode));
      if (!c) {
        return res.status(400).json({ success: false, msg: 'Invalid coupon code' });
      }
      const now = new Date();
      if (
        (c.validFrom && now < c.validFrom) ||
        (c.validUntil && now > c.validUntil) ||
        productTotal < c.minOrderValue
      ) {
        return res.status(400).json({ success: false, msg: 'Coupon not applicable' });
      }
      discountAmount = c.discountType === 'percent'
        ? Math.floor((c.discountValue / 100) * productTotal)
        : c.discountValue;
    }

    const total = Math.max(productTotal + deliveryCharge - discountAmount, 0);
    return res.json({
      success: true,
      breakdown: { originalTotal, productTotal, deliveryCharge, discountAmount, total },
    });
  } catch (err) {
    console.error('getPriceBreakdown error:', err);
    return res.status(500).json({ success: false, msg: 'Server error' });
  }
};
