import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../configs/index.js';
// 🟢 IMPORT: all new tables
import { 
  ordersTable, 
  couponsTable, 
  productsTable, 
  orderItemsTable, 
  UserAddressTable, 
  productVariantsTable, // 🟢 New
  productBundlesTable   // 🟢 New
} from '../configs/schema.js';
import { eq, sql } from 'drizzle-orm';
// Import new helpers
import { invalidateMultiple } from '../invalidateHelpers.js';
import {
  makeAllOrdersKey,
  makeUserOrdersKey,
  makeAllProductsKey,
  makeProductKey,
  makeCartKey,
  makeCartCountKey,
} from '../cacheKeys.js';
import { getPincodeDetails } from './addressController.js';

const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

/**
 * 🟢 MODIFIED: Helper function to reduce stock for variants and bundles.
 * Now returns an array of affected parent product IDs for cache invalidation.
 */
async function reduceStock(cartItems) {
  // 🟢 Use a Set to avoid duplicate product IDs
  const affectedProductIds = new Set();

  for (const item of cartItems) {
    // 🟢 Add the main product ID
    affectedProductIds.add(item.productId);

    // 1. Check if the item is a bundle
    const bundleContents = await db
      .select()
      .from(productBundlesTable)
      .where(eq(productBundlesTable.bundleVariantId, item.variantId));

    if (bundleContents.length > 0) {
      // 2. This IS a bundle. Reduce stock of its contents.
      for (const content of bundleContents) {
        const stockToReduce = content.quantity * item.quantity;
        
        const [variant] = await db.select({ stock: productVariantsTable.stock, productId: productVariantsTable.productId }).from(productVariantsTable).where(eq(productVariantsTable.id, content.contentVariantId));
        if (!variant || variant.stock < stockToReduce) {
          throw new Error(`Not enough stock for item in bundle: ${content.contentVariantId}`);
        }
        
        // 🟢 Add the bundle content's parent product ID
        affectedProductIds.add(variant.productId);

        await db
          .update(productVariantsTable)
          .set({ 
            stock: sql`${productVariantsTable.stock} - ${stockToReduce}`,
            sold: sql`${productVariantsTable.sold} + ${stockToReduce}`
          })
          .where(eq(productVariantsTable.id, content.contentVariantId));
      }
    } else {
      // 3. This is NOT a bundle. Reduce stock normally.
      const [variant] = await db.select({ stock: productVariantsTable.stock }).from(productVariantsTable).where(eq(productVariantsTable.id, item.variantId));
      if (!variant || variant.stock < item.quantity) {
        const [product] = await db.select({ name: productsTable.name }).from(productsTable).where(eq(productsTable.id, item.productId));
        throw new Error(`Not enough stock for ${product?.name || 'product'}`);
      }

      await db
        .update(productVariantsTable)
        .set({ 
          stock: sql`${productVariantsTable.stock} - ${item.quantity}`,
          sold: sql`${productVariantsTable.sold} + ${item.quantity}`
        })
        .where(eq(productVariantsTable.id, item.variantId));
    }
  }
  // 🟢 Return the list of unique product IDs
  return Array.from(affectedProductIds);
}

export const createOrder = async (req, res) => {
  try {
    // 🔴 Assumes cartItems = [{ variantId, quantity, productId }]
    const { user, phone, couponCode = null, paymentMode = 'online', cartItems, userAddressId } = req.body;

    if (!user) {
      return res.status(401).json({ success: false, msg: 'Please log in first' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }
    if (paymentMode === 'cod' && !userAddressId) {
      return res.status(400).json({ success: false, msg: 'User address ID is required for COD orders' });
    }

    const [address] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, userAddressId));
    if (!address) {
      return res.status(404).json({ success: false, msg: "Address not found." });
    }

    let productTotal = 0;
    let discountAmount = 0;
    const pincodeDetails = await getPincodeDetails(address.postalCode);
    const deliveryCharge = pincodeDetails.deliveryCharge;
    const orderId = `DA${Date.now()}`;
    const enrichedItems = [];

    for (const item of cartItems) {
      const [variant] = await db
        .select()
        .from(productVariantsTable)
        .where(eq(productVariantsTable.id, item.variantId));
      
      if (!variant) {
        return res.status(400).json({ success: false, msg: `Invalid product variant: ${item.variantId}` });
      }

      const [product] = await db
        .select({ name: productsTable.name, imageurl: productsTable.imageurl })
        .from(productsTable)
        .where(eq(productsTable.id, item.productId)); 

      if (!product) {
         return res.status(400).json({ success: false, msg: `Invalid product: ${item.productId}` });
      }

      const unitPrice = Math.floor(variant.oprice * (1 - variant.discount / 100));
      productTotal += unitPrice * item.quantity;

      enrichedItems.push({
        id: `DA${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        orderId,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        productName: `${product.name} (${variant.name})`,
        img: product.imageurl[0],
        size: variant.size,
        price: unitPrice,
        totalPrice: unitPrice * item.quantity,
      });
    }

    // ... (Coupon logic is unchanged)
    if (couponCode) {
      const [coupon] = await db
        .select()
        .from(couponsTable)
        .where(eq(couponsTable.code, couponCode));

      if (coupon) {
         const now = new Date();
         if (
           !(coupon.validFrom && now < coupon.validFrom) &&
           !(coupon.validUntil && now > coupon.validUntil) &&
           productTotal >= coupon.minOrderValue
         ) {
           discountAmount = coupon.discountType === 'percent'
           ? Math.floor((coupon.discountValue / 100) * productTotal)
           : coupon.discountValue;
         }
      }
    }

    const finalAmount = Math.max(productTotal + deliveryCharge - discountAmount, 0);

    if (paymentMode === 'cod' && !pincodeDetails.codAvailable) {
      return res.status(400).json({ success: false, msg: "Cash on Delivery is not available for this address." });
    }

    if (paymentMode === 'cod') {
      await db.insert(ordersTable).values({
        id: orderId,
        userId: user.id,
        userAddressId,
        razorpay_order_id: null,
        totalAmount: finalAmount,
        status: 'Order Placed',
        paymentMode: 'cod',
        transactionId: null,
        paymentStatus: 'pending',
        phone,
        couponCode,
        discountAmount,
        progressStep: 1, // Drizzle schema shows integer
        // 🟢 REMOVED: createdAt/updatedAt. defaultNow() handles this.
      });

      await db.insert(orderItemsTable).values(enrichedItems);

      // 🟢 Use new stock reduction logic
      const affectedProductIds = await reduceStock(cartItems);

      // 🟢 MODIFIED: Cache invalidation
      const itemsToInvalidate = [
        { key: makeAllOrdersKey(), prefix: true },
        { key: makeUserOrdersKey(user.id), prefix: true },
        { key: makeAllProductsKey(), prefix: true }, 
        { key: makeCartKey(user.id) }, 
        { key: makeCartCountKey(user.id) },
      ];
      
      // 🟢 CRITICAL FIX: Add all affected product pages to the invalidation list
      affectedProductIds.forEach(pid => {
        itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true });
      });
      
      await invalidateMultiple(itemsToInvalidate);

      return res.json({
        success: true,
        orderId,
        message: "COD order placed successfully",
      });
    }

    // ✅ For Razorpay:
    const razorOrder = await razorpay.orders.create({
      amount: finalAmount * 100,
      currency: 'INR',
      receipt: user.id,
    });

    return res.json({
      success: true,
      razorpayOrderId: razorOrder.id,
      amount: finalAmount,
      keyId: RAZORPAY_ID_KEY,
      orderId,
      breakdown: { productTotal, deliveryCharge, discountAmount },
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
      phone,
      cartItems, // 🔴 Assumes cartItems = [{ variantId, quantity, productId }]
      couponCode = null,
      orderId,
      userAddressId,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userAddressId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    // ... (Signature verification is unchanged)
    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_SECRET_KEY)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Verification failed" });
    }

    const [address] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, userAddressId));
    if (!address) {
      return res.status(404).json({ success: false, msg: "Address not found for verification." });
    }

    // 🟢 Re-calculate price based on variants
    let productTotal = 0;
    let discountAmount = 0;
    const pincodeDetails = await getPincodeDetails(address.postalCode);
    const deliveryCharge = pincodeDetails.deliveryCharge;
    const enrichedItems = [];

    for (const item of cartItems) {
      const [variant] = await db
        .select()
        .from(productVariantsTable)
        .where(eq(productVariantsTable.id, item.variantId));
      
      if (!variant) {
        return res.status(400).json({ success: false, msg: `Invalid product variant: ${item.variantId}` });
      }

      const [product] = await db
        .select({ name: productsTable.name, imageurl: productsTable.imageurl })
        .from(productsTable)
        .where(eq(productsTable.id, item.productId)); 

      if (!product) {
         return res.status(400).json({ success: false, msg: `Invalid product: ${item.productId}` });
      }

      const unitPrice = Math.floor(variant.oprice * (1 - variant.discount / 100));
      productTotal += unitPrice * item.quantity;

      enrichedItems.push({
        id: `DA${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        orderId,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        productName: `${product.name} (${variant.name})`,
        img: product.imageurl[0],
        size: variant.size,
        price: unitPrice,
        totalPrice: unitPrice * item.quantity,
      });
    }
    
    // ... (Coupon logic is unchanged)
    if (couponCode) {
      const [coupon] = await db
        .select()
        .from(couponsTable)
        .where(eq(couponsTable.code, couponCode));
        
      if (coupon) {
         const now = new Date();
         if (
           !(coupon.validFrom && now < coupon.validFrom) &&
           !(coupon.validUntil && now > coupon.validUntil) &&
           productTotal >= coupon.minOrderValue
         ) {
           discountAmount = coupon.discountType === 'percent'
           ? Math.floor((coupon.discountValue / 100) * productTotal)
           : coupon.discountValue;
         }
      }
    }

    const finalAmount = Math.max(productTotal + deliveryCharge - discountAmount, 0);

    await db.insert(ordersTable).values({
      id: orderId,
      userId: user.id,
      userAddressId,
      razorpay_order_id,
      totalAmount: finalAmount,
      status: 'Order Placed',
      paymentMode: 'online',
      transactionId: razorpay_payment_id,
      paymentStatus: 'paid',
      phone,
      couponCode,
      discountAmount,
      progressStep: 1, // Drizzle schema shows integer
      // 🟢 REMOVED: createdAt/updatedAt. defaultNow() handles this.
    });

    await db.insert(orderItemsTable).values(enrichedItems);

    // 🟢 Use new stock reduction logic
    const affectedProductIds = await reduceStock(cartItems);

    // 🟢 MODIFIED: Cache invalidation
    const itemsToInvalidate = [
      { key: makeAllOrdersKey(), prefix: true },
      { key: makeUserOrdersKey(user.id), prefix: true },
      { key: makeAllProductsKey(), prefix: true },
      { key: makeCartKey(user.id) },
      { key: makeCartCountKey(user.id) },
    ];

    // 🟢 CRITICAL FIX: Add all affected product pages to the invalidation list
    affectedProductIds.forEach(pid => {
      itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true });
    });

    await invalidateMultiple(itemsToInvalidate);

    return res.json({ success: true, message: "Payment verified & order placed." });

  } catch (error) {
    console.error("verify error:", error);
    return res.status(500).json({ success: false, error: error.message || "Server error during verification." });
  }
};