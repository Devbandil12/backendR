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
  addToCartTable
} from '../configs/schema.js';
import { eq, sql, and, inArray } from 'drizzle-orm';
import { invalidateMultiple } from '../invalidateHelpers.js';
import {
  makeAllOrdersKey,
  makeUserOrdersKey,
  makeAllProductsKey,
  makeProductKey,
  makeCartKey,
  makeCartCountKey,
} from '../cacheKeys.js';
// 🟢 1. Import the new Promotions Engine
//    (Adjust the path '../helpers/priceEngine.js' if your file is in a different folder)
import { calculatePriceBreakdown } from '../helpers/priceEngine.js';


const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

// 🟢 START: UPDATED reduceStock function
async function reduceStock(cartItems) {
  const affectedProductIds = new Set();
  for (const item of cartItems) {
    affectedProductIds.add(item.productId); // Add the main product ID

    const bundleContents = await db
      .select()
      .from(productBundlesTable)
      .where(eq(productBundlesTable.bundleVariantId, item.variantId));

    if (bundleContents.length > 0) {
      // --- START: MODIFIED BUNDLE LOGIC ---

      // 1. REDUCE STOCK OF THE COMBO WRAPPER ITSELF
      const [comboVariant] = await db.select({ stock: productVariantsTable.stock }).from(productVariantsTable).where(eq(productVariantsTable.id, item.variantId));
      if (!comboVariant || comboVariant.stock < item.quantity) {
        // This error check is important, it references the *combo's* product name
        const [product] = await db.select({ name: productsTable.name }).from(productsTable).where(eq(productsTable.id, item.productId));
        throw new Error(`Not enough stock for ${product?.name || 'combo'}`);
      }
      await db
        .update(productVariantsTable)
        .set({
          stock: sql`${productVariantsTable.stock} - ${item.quantity}`,
          sold: sql`${productVariantsTable.sold} + ${item.quantity}`
        })
        .where(eq(productVariantsTable.id, item.variantId));

      // 2. REDUCE STOCK OF THE CONTENTS (This is your existing logic)
      for (const content of bundleContents) {
        const stockToReduce = content.quantity * item.quantity;
        const [variant] = await db.select({ stock: productVariantsTable.stock, productId: productVariantsTable.productId }).from(productVariantsTable).where(eq(productVariantsTable.id, content.contentVariantId));
        if (!variant || variant.stock < stockToReduce) {
          throw new Error(`Not enough stock for item in bundle: ${content.contentVariantId}`);
        }
        affectedProductIds.add(variant.productId); // Add the content's product ID
        await db
          .update(productVariantsTable)
          .set({
            stock: sql`${productVariantsTable.stock} - ${stockToReduce}`,
            sold: sql`${productVariantsTable.sold} + ${stockToReduce}` // Your original code did this, which counts sold for contents too
          })
          .where(eq(productVariantsTable.id, content.contentVariantId));
      }
      // --- END: MODIFIED BUNDLE LOGIC ---

    } else {
      // --- This is your existing logic for non-bundle items ---
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
  return Array.from(affectedProductIds);
}
// 🟢 END: UPDATED reduceStock function

export const createOrder = async (req, res) => {
  try {
    // 🟢 2. Get the *inputs* from the frontend
    const {
      user,
      phone,
      paymentMode = 'online',
      cartItems, // This is [{ variantId, quantity, productId, ... }]
      userAddressId,
      couponCode = null // Get the manual coupon code
    } = req.body;

    // --- (Validation) ---
    if (!user) {
      return res.status(401).json({ success: false, msg: 'Please log in first' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }

    // 🟢 3. Fetch the address *first* to get the pincode
    const [address] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, userAddressId));
    if (!address) {
      return res.status(404).json({ success: false, msg: "Address not found." });
    }

    // 🟢 4. --- SECURE PRICE CALCULATION ---
    // The backend re-calculates the price using the secure engine
    // We only pass the *necessary* cart info (variantId, quantity)
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

    const {
      total,
      discountAmount, // Manual coupon discount
      offerDiscount,  // Automatic offer discount
      appliedOffers,
      codAvailable
    } = breakdown;

    const offerCodes = appliedOffers.map(o => o.title);
    // --- (End Secure Price Calculation) ---

    if (paymentMode === 'cod' && !userAddressId) {
      return res.status(400).json({ success: false, msg: 'User address ID is required for COD orders' });
    }
    if (paymentMode === 'cod' && !codAvailable) {
      return res.status(400).json({ success: false, msg: "Cash on Delivery is not available for this address." });
    }

    const orderId = `DA${Date.now()}`;
    const enrichedItems = [];

    // 🟢 5. Build the orderItems list for the DB
    for (const item of cartItems) {
      // ✅ FIX: Added `name: productVariantsTable.name` to this query
      const [variant] = await db.select({ size: productVariantsTable.size, oprice: productVariantsTable.oprice, discount: productVariantsTable.discount, name: productVariantsTable.name }).from(productVariantsTable).where(eq(productVariantsTable.id, item.variant.id));
      const [product] = await db.select({ name: productsTable.name, imageurl: productsTable.imageurl }).from(productsTable).where(eq(productsTable.id, item.product.id));

      let unitPrice = Math.floor(variant.oprice * (1 - variant.discount / 100));

      // Check if this item was made free by an offer
      const freeOffer = appliedOffers.find(o => o.appliesToVariantId === item.variant.id);
      if (freeOffer) {
        unitPrice = 0; // This item is free
      }

      enrichedItems.push({
        id: `DA${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        orderId,
        productId: item.product.id,
        variantId: item.variant.id,
        quantity: item.quantity,
        // ✅ FIX: Changed `item.variant.name` to `variant.name`
        productName: `${product.name} (${variant.name})`,
        img: product.imageurl[0],
        size: variant.size,
        price: unitPrice,
        totalPrice: unitPrice * item.quantity,
      });
    }

    if (paymentMode === 'cod') {
      // 🟢 6. Insert order using secure, backend-calculated data
      await db.insert(ordersTable).values({
        id: orderId,
        userId: user.id,
        userAddressId,
        razorpay_order_id: null,
        totalAmount: total, // Use secure total
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
      });

      await db.insert(orderItemsTable).values(enrichedItems);

      // (This is the single, correct call to reduceStock)
      const affectedProductIds = await reduceStock(secureCartItems);

      // (Clear cart logic)
      const variantIdsToClear = secureCartItems.map(item => item.variantId);
      await db.delete(addToCartTable).where(
        and(
          eq(addToCartTable.userId, user.id),
          inArray(addToCartTable.variantId, variantIdsToClear)
        )
      );

      // (Cache invalidation)
      const itemsToInvalidate = [
        { key: makeAllOrdersKey(), prefix: true },
        { key: makeUserOrdersKey(user.id), prefix: true },
        { key: makeAllProductsKey(), prefix: true },
        { key: makeCartKey(user.id) },
        // ✅ FIX: Added missing closing brace }
        { key: makeCartCountKey(user.id) },
      ];
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

    // For Razorpay:
    const razorOrder = await razorpay.orders.create({
      amount: total * 100, // 🟢 Use the secure total
      currency: 'INR',
      receipt: user.id,
    });

    return res.json({
      success: true,
      razorpayOrderId: razorOrder.id,
      amount: total,
      keyId: RAZORPAY_ID_KEY,
      orderId,
      breakdown: breakdown, // Pass the secure breakdown to the verify step
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
      cartItems,
      couponCode = null,
      orderId,
      userAddressId,
    } = req.body;

    // --- (Signature verification) ---
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userAddressId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }
    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_SECRET_KEY)
      // ✅ FIX: Removed stray 's'
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Verification failed" });
    }

    // 🟢 6. --- SECURE PRICE RE-CALCULATION ---
    const [address] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, userAddressId));
    if (!address) {
      return res.status(404).json({ success: false, msg: "Address not found for verification." });
    }

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

    const {
      total,
      discountAmount,
      offerDiscount,
      appliedOffers
    } = breakdown;

    const offerCodes = appliedOffers.map(o => o.title);

    // 🟢 7. --- FINAL SECURITY CHECK ---
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (payment.amount !== total * 100) {
      // ✅ FIX: Removed stray 'Â'
      await razorpay.payments.refund(razorpay_payment_id, {
        amount: payment.amount,
        speed: 'optimum',
      });
      return res.status(400).json({ success: false, error: "Payment amount mismatch. Order cancelled and refund initiated." });
    }
    // --- (Price is validated) ---

    // 🟢 8. Build enriched items
    const enrichedItems = [];
    for (const item of cartItems) {
      // ✅ FIX: Added `name: productVariantsTable.name` to this query
      const [variant] = await db.select({ size: productVariantsTable.size, oprice: productVariantsTable.oprice, discount: productVariantsTable.discount, name: productVariantsTable.name }).from(productVariantsTable).where(eq(productVariantsTable.id, item.variant.id));
      const [product] = await db.select({ name: productsTable.name, imageurl: productsTable.imageurl }).from(productsTable).where(eq(productsTable.id, item.product.id));

      let unitPrice = Math.floor(variant.oprice * (1 - variant.discount / 100));
      const freeOffer = appliedOffers.find(o => o.appliesToVariantId === item.variant.id);
      if (freeOffer) {
        unitPrice = 0;
      }

      enrichedItems.push({
        id: `DA${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        orderId,
        productId: item.product.id,
        variantId: item.variant.id,
        quantity: item.quantity,
        // ✅ FIX: Changed `item.variant.name` to `variant.name`
        productName: `${product.name} (${variant.name})`,
        img: product.imageurl[0],
        size: variant.size,
        price: unitPrice,
        totalPrice: unitPrice * item.quantity,
      });
    }

    // 🟢 9. Insert the order
    await db.insert(ordersTable).values({
      id: orderId,
      // ✅ FIX: Removed stray 'E'
      userId: user.id,
      userAddressId,
      razorpay_order_id,
      totalAmount: total,
      status: 'Order Placed',
      paymentMode: 'online',
      transactionId: razorpay_payment_id,
      paymentStatus: 'paid',
      phone,
      couponCode: couponCode,
      discountAmount: discountAmount,
      offerDiscount: offerDiscount,
      offerCodes: offerCodes,
      progressStep: 1,
    });

    await db.insert(orderItemsTable).values(enrichedItems);

    // (This is the single, correct call to reduceStock)
    const affectedProductIds = await reduceStock(secureCartItems);

    // (Clear cart and cache invalidation)
    const variantIdsToClear = secureCartItems.map(item => item.variantId);
    await db.delete(addToCartTable).where(
      and(
        eq(addToCartTable.userId, user.id),
        inArray(addToCartTable.variantId, variantIdsToClear)
      )
    );

    const itemsToInvalidate = [
      { key: makeAllOrdersKey(), prefix: true },
      { key: makeUserOrdersKey(user.id), prefix: true },
      { key: makeAllProductsKey(), prefix: true },
      { key: makeCartKey(user.id) },
      // ✅ FIX: Added missing closing brace }
      { key: makeCartCountKey(user.id) },
    ];
    affectedProductIds.forEach(pid => {
      itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true });
      // Removed stray 'I' that was in the original file
    });

    await invalidateMultiple(itemsToInvalidate);

    return res.json({ success: true, message: "Payment verified & order placed." });

  } catch (error) {
    console.error("verify error:", error);
    return res.status(500).json({ success: false, error: error.message || "Server error during verification." });
  }
};