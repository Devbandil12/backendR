// server/controllers/paymentController.js
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable, couponsTable } from '../configs/schema.js';
import { productsTable, orderItemsTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';
import puppeteer from 'puppeteer';
const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

export const createOrder = async (req, res) => {
  try {
    const { user, phone, couponCode = null, paymentMode = 'online', cartItems,userAddressId } = req.body;

    if (!user) {
      return res.status(401).json({ success: false, msg: 'Please log in first' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ success: false, msg: 'Cart is empty' });
    }
    // Add validation for userAddressId when payment mode is COD
    if (paymentMode === 'cod' && !userAddressId) {
      return res.status(400).json({ success: false, msg: 'User address ID is required for COD orders' });
    }

    let productTotal = 0;
    let discountAmount = 0;
    const deliveryCharge = 0;
    const orderId = `DA${Date.now()}`;
    const enrichedItems = [];

    for (const item of cartItems) {
      const [product] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, item.id));

      if (!product) {
        return res.status(400).json({ success: false, msg: `Invalid product: ${item.id}` });
      }

      const unitPrice = Math.floor(product.oprice * (1 - product.discount / 100));
      productTotal += unitPrice * item.quantity;

      enrichedItems.push({
        id: `DA${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        orderId,
        productId: item.id,
        quantity: item.quantity,
        productName: product.name,
        img: product.imageurl,
        size: product.size,
        price: unitPrice,
        totalPrice: unitPrice * item.quantity,
      });
    }

    if (couponCode) {
      const [coupon] = await db
        .select({
          code: couponsTable.code,
          discountType: couponsTable.discountType,
          discountValue: couponsTable.discountValue,
          minOrderValue: couponsTable.minOrderValue,
          validFrom: couponsTable.validFrom,
          validUntil: couponsTable.validUntil,
        })
        .from(couponsTable)
        .where(eq(couponsTable.code, couponCode));

      if (!coupon) {
        return res.status(400).json({ success: false, msg: 'Invalid coupon code' });
      }

      const now = new Date();
      if (
        (coupon.validFrom && now < coupon.validFrom) ||
        (coupon.validUntil && now > coupon.validUntil) ||
        productTotal < coupon.minOrderValue
      ) {
        return res.status(400).json({ success: false, msg: 'Coupon not applicable' });
      }

      discountAmount = coupon.discountType === 'percent'
        ? Math.floor((coupon.discountValue / 100) * productTotal)
        : coupon.discountValue;
    }

    const finalAmount = Math.max(productTotal + deliveryCharge - discountAmount, 0);

    // ✅ If paymentMode is 'cod', insert order now
    if (paymentMode === 'cod') {
      await db.insert(ordersTable).values({
        id: orderId,
        userId: user.id,
        userAddressId,
        razorpay_order_id: null,
        totalAmount: finalAmount,
        status: 'order placed',
        paymentMode: 'cod',
        transactionId: null,
        paymentStatus: 'pending',
        phone,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        couponCode,
        discountAmount,
      });

      await db.insert(orderItemsTable).values(enrichedItems);

      // 🔴 Reduce stock for each product
  for (const item of cartItems) {
    const [product] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, item.id));

    if (!product || product.stock < item.quantity) {
      return res.status(400).json({ success: false, msg: `Not enough stock for ${product?.name || 'product'}` });
    }

    await db
      .update(productsTable)
      .set({ stock: product.stock - item.quantity })
      .where(eq(productsTable.id, item.id));
  }



      return res.json({
        success: true,
        orderId,
        message: "COD order placed successfully",
      });
    }

    // ✅ For Razorpay: only return Razorpay order — don't insert DB yet
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
    return res.status(500).json({ success: false, msg: 'Server error' });
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


     // Add userAddressId to the validation check
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userAddressId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_SECRET_KEY)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Verification failed" });
    }

    let productTotal = 0;
    let discountAmount = 0;
    const deliveryCharge = 0;
    const enrichedItems = [];

    for (const item of cartItems) {
      const [product] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, item.id));

      if (!product) {
        return res.status(400).json({ success: false, msg: `Invalid product: ${item.id}` });
      }

      const unitPrice = Math.floor(product.oprice * (1 - product.discount / 100));
      productTotal += unitPrice * item.quantity;

      enrichedItems.push({
        id: `DA${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        orderId,
        productId: item.id,
        quantity: item.quantity,
        productName: product.name,
        img: product.imageurl,
        size: product.size,
        price: unitPrice,
        totalPrice: unitPrice * item.quantity,
      });
    }

    if (couponCode) {
      const [coupon] = await db
        .select({
          code: couponsTable.code,
          discountType: couponsTable.discountType,
          discountValue: couponsTable.discountValue,
          minOrderValue: couponsTable.minOrderValue,
          validFrom: couponsTable.validFrom,
          validUntil: couponsTable.validUntil,
        })
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
      status: 'order placed',
      paymentMode: 'online',
      transactionId: razorpay_payment_id,
      paymentStatus: 'paid',
      phone,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      couponCode,
      discountAmount,
    });

    await db.insert(orderItemsTable).values(enrichedItems);

   // 🔴 Reduce stock for each product
for (const item of cartItems) {
  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, item.id));

  if (!product || product.stock < item.quantity) {
    return res.status(400).json({ success: false, msg: `Not enough stock for ${product?.name || 'product'}` });
  }

  await db
    .update(productsTable)
    .set({ stock: product.stock - item.quantity })
    .where(eq(productsTable.id, item.id));
}

    return res.json({ success: true, message: "Payment verified & order placed." });

  } catch (error) {
    console.error("verify error:", error);
    return res.status(500).json({ success: false, error: "Server error during verification." });
  }
};




// Add this import statement to the top of your file


// New function to handle manual bill creation from front-end data
export const createManualBill = async (req, res) => {
  const { user, deliveryPartner, paymentMode, utrNo, products } = req.body;

  try {
    const productTotal = products.reduce((sum, p) => {
      const discountedPrice = Number(p.price || 0) * (1 - Number(p.discount || 0) / 100);
      return sum + discountedPrice * Number(p.qty || 0);
    }, 0);

    const invoiceNumber = `DA-${Date.now()}`;
    const invoiceDate = new Date().toLocaleDateString("en-GB");

    // Build the HTML for the invoice
    const productsHtml = products
      .map(
        (p) => `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 12px; font-weight: bold;">${p.name}</td>
          <td style="padding: 12px;">${p.size}</td>
          <td style="padding: 12px;">${p.qty}</td>
          <td style="padding: 12px;">₹${p.price}</td>
          <td style="padding: 12px;">${p.discount}%</td>
          <td style="padding: 12px; text-align: right;">₹${(Number(p.price || 0) * (1 - Number(p.discount || 0) / 100) * Number(p.qty || 0)).toFixed(2)}</td>
        </tr>
      `
      )
      .join("");

    const invoiceHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Manual Invoice</title>
        <style>
          body { font-family: sans-serif; margin: 0; padding: 20px; color: #333; }
          .container { max-width: 800px; margin: auto; }
          .header { text-align: center; margin-bottom: 40px; }
          .header h1 { color: #2563eb; }
          .details-box { border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .details-box h2 { margin-top: 0; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e5e7eb; }
          th { background-color: #f3f4f6; }
          .summary { margin-top: 40px; text-align: right; }
          .summary-item { margin: 5px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>DEVID AURA Invoice</h1>
            <p>Invoice #: ${invoiceNumber}</p>
            <p>Date: ${invoiceDate}</p>
          </div>
          <div class="details-box">
            <h2>Customer Details</h2>
            <p>Name: ${user.name}</p>
            <p>Address: ${user.address}</p>
            <p>Phone: ${user.phone}</p>
            <p>Delivery Partner: ${deliveryPartner}</p>
            ${paymentMode === 'UPI' ? `<p>UTR No: ${utrNo}</p>` : ''}
          </div>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Size</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Discount</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${productsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div class="summary-item"><strong>Total Amount:</strong> ₹${productTotal.toFixed(2)}</div>
          </div>
        </div>
      </body>
      </html>
    `;
    
    // ✅ Note: This line has been removed and replaced with a static import at the top
    // const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      
    const page = await browser.newPage();
    await page.setContent(invoiceHtml, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    });

    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="manual_invoice_${invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('❌ Manual bill creation error:', err);
    return res.status(500).json({ success: false, msg: 'Server error during manual bill creation.' });
  }
};
