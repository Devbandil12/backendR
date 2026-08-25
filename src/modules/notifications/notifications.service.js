import * as NotificationsRepository from './notifications.repository.js';
import webpush from 'web-push';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const getSender = () => process.env.RESEND_FROM_EMAIL || 'Devid Aura Luxury <onboarding@resend.dev>';

const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
if (publicVapidKey && privateVapidKey) {
  try {
    webpush.setVapidDetails('mailto:devidauraofficial@gmail.com', publicVapidKey, privateVapidKey);
  } catch (err) { console.error("WebPush Error", err.message); }
}

export const createNotification = async (userId, message, link = null, type = 'general') => {
  if (!userId || !message) return;
  try {
    await NotificationsRepository.insertNotification({ userId, message, link, type });
  } catch (error) {
    console.error(`❌ Failed to create notification for user ${userId}:`, error);
  }
};

export const getUserNotifications = async (clerkId, targetUserId) => {
  const requester = await NotificationsRepository.getUserByClerkId(clerkId);
  if (!requester) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  if (requester.id !== targetUserId && requester.role !== 'admin') throw Object.assign(new Error('Forbidden'), { status: 403 });

  const notifications = await NotificationsRepository.getUserNotifications(targetUserId);
  const unreadCount = await NotificationsRepository.getUnreadNotificationCount(targetUserId);

  return { notifications, unreadCount };
};

export const markNotificationsAsRead = async (clerkId, targetUserId) => {
  const requester = await NotificationsRepository.getUserByClerkId(clerkId);
  if (!requester || (requester.id !== targetUserId && requester.role !== 'admin')) throw Object.assign(new Error('Forbidden'), { status: 403 });

  await NotificationsRepository.markNotificationsAsRead(targetUserId);
};

export const clearNotifications = async (clerkId, targetUserId) => {
  const requester = await NotificationsRepository.getUserByClerkId(clerkId);
  if (!requester || (requester.id !== targetUserId && requester.role !== 'admin')) throw Object.assign(new Error('Forbidden'), { status: 403 });

  await NotificationsRepository.clearNotifications(targetUserId);
};

export const subscribePush = async (clerkId, subscription) => {
  const user = await NotificationsRepository.getUserByClerkId(clerkId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });

  await NotificationsRepository.updatePushSubscription(user.id, subscription);
};

export const sendPushNotification = async (subscriptionFromDb, payload) => {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try { await webpush.sendNotification(subscriptionFromDb, JSON.stringify(payload)); } catch (err) { console.error("Push failed:", err.message); }
};

export const sendOrderConfirmationEmail = async (userEmail, orderDetails, orderItems, paymentDetails = null) => {
  console.log(`📩 Generating Premium Email for: ${userEmail}`);
  if (!userEmail) return;

  let addressHtml = "<span style='color: #999;'>Address not available</span>";
  let userName = "Valued Customer";
  
  try {
    if (orderDetails.userAddressId) {
      const addr = await NotificationsRepository.getAddressById(orderDetails.userAddressId);
      if (addr) {
        userName = addr.name.split(' ')[0];
        addressHtml = `
            <div style="font-family: 'Manrope', sans-serif; font-weight: 700; color: #111; font-size: 14px; margin-bottom: 6px;">${addr.name}</div>
            <div style="font-family: 'Manrope', sans-serif; color: #666; font-size: 13px; line-height: 1.6;">
                ${addr.address}<br>
                ${addr.city}, ${addr.state} - ${addr.postalCode}
            </div>
            <div style="font-family: 'Manrope', sans-serif; margin-top: 10px; font-size: 12px; color: #555; background: #f0f0f0; display: inline-block; padding: 4px 8px; border-radius: 4px;">
                📞 ${addr.phone}
            </div>
        `;
      }
    }
  } catch (err) { console.error("Address Error", err); }

  const formatMoney = (amount) => `₹${Number(amount).toLocaleString('en-IN')}`;
  
  let mrpTotal = 0;
  const variantIds = orderItems.map(i => i.variantId).filter(Boolean);
  
  if (variantIds.length > 0) {
    try {
        const variants = await NotificationsRepository.getVariantsByIds(variantIds);
        
        mrpTotal = orderItems.reduce((sum, item) => {
            const variant = variants.find(v => v.id === item.variantId);
            const oprice = (variant && Number(variant.oprice)) ? Number(variant.oprice) : (Number(item.totalPrice) / item.quantity);
            return sum + (oprice * item.quantity);
        }, 0);
    } catch (e) {
        console.error("Error fetching MRPs:", e);
        mrpTotal = orderItems.reduce((acc, item) => acc + (parseFloat(item.totalPrice) || 0), 0);
    }
  } else {
    mrpTotal = orderItems.reduce((acc, item) => acc + (parseFloat(item.totalPrice) || 0), 0);
  }

  const itemSoldTotal = orderItems.reduce((acc, item) => acc + (parseFloat(item.totalPrice) || 0), 0);
  const productSavings = Math.max(0, mrpTotal - itemSoldTotal);
  const couponDiscount = parseFloat(orderDetails.discountAmount) || 0;
  const walletUsed = parseFloat(orderDetails.walletAmountUsed) || 0;
  const finalTotal = parseFloat(orderDetails.totalAmount) || 0;
  const calculatedDelivery = Math.max(0, finalTotal - itemSoldTotal + couponDiscount + walletUsed);
  const deliveryCharge = calculatedDelivery > 1 ? calculatedDelivery : 0;

  const itemsHtml = orderItems.map(item => {
    const isFree = item.totalPrice <= 0;
    const priceDisplay = isFree 
        ? `<span style="color: #D4AF37; font-weight: 800; font-size: 11px; letter-spacing: 1px; border: 1px solid #D4AF37; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">Free Gift</span>` 
        : `<span style="font-family: 'Manrope', sans-serif; font-weight: 600; color: #111;">${formatMoney(item.totalPrice)}</span>`;

    return `
    <tr>
      <td style="padding: 20px 0; border-bottom: 1px solid #f0f0f0;">
        <div style="display: flex; align-items: flex-start;">
            <div style="position: relative;">
              <img src="${item.img}" alt="Product" style="width: 70px; height: 70px; border-radius: 8px; object-fit: cover; border: 1px solid #eaeaea;">
            </div>
            <div style="margin-left: 16px; padding-top: 2px;">
                <p style="margin: 0; font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 700; color: #111; line-height: 1.2;">${item.productName}</p>
                <p style="margin: 4px 0 0; font-family: 'Manrope', sans-serif; font-size: 12px; color: #666;">Size: ${item.size}ml</p>
            </div>
        </div>
      </td>
      <td style="padding: 16px 0; border-bottom: 1px dashed #eaeaea; text-align: center; color: #555; font-family: 'Montserrat', sans-serif; font-size: 13px;">
        x${item.quantity}
      </td>
      <td style="padding: 16px 0; border-bottom: 1px dashed #eaeaea; text-align: right; font-family: 'Cormorant Garamond', serif; font-weight: 600; color: #111; font-size: 18px;">
        ${priceDisplay}
      </td>
    </tr>
  `}).join('');

  const theme = { bg: "#f4f4f5", cardBg: "#ffffff", gold: "#D4AF37", black: "#0a0a0a", shadow: "0 10px 40px rgba(0,0,0,0.08)", radius: "24px" };

  const orderDateString = (orderDetails.createdAt ? new Date(orderDetails.createdAt) : new Date()).toLocaleString("en-IN", {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
  });
  
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 7);
  const deliveryString = deliveryDate.toLocaleDateString("en-IN", { weekday: 'short', day: 'numeric', month: 'short' });

  let paymentDisplay = "Online Payment";
  if (orderDetails.paymentMode === 'cod') paymentDisplay = "Cash on Delivery";
  else if (orderDetails.paymentMode === 'wallet') paymentDisplay = "Wallet Balance";
  else if (paymentDetails?.method) paymentDisplay = `Online (${paymentDetails.method})`;

  const showTransactionId = orderDetails.paymentMode !== 'cod' && orderDetails.paymentMode !== 'wallet' && orderDetails.razorpay_order_id;

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');
        body { font-family: 'Manrope', sans-serif; -webkit-font-smoothing: antialiased; background-color: #f4f4f5; margin: 0; padding: 0; }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: ${theme.bg};">
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" style="padding: 40px 10px;">
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: ${theme.cardBg}; border-radius: ${theme.radius}; overflow: hidden; box-shadow: ${theme.shadow};">
              <tr>
                <td style="background-color: ${theme.black}; padding: 5px 35px 40px; text-align: center; position: relative;">
                  <div style="width: 100px; height: 50px; background: radial-gradient(circle, ${theme.gold} 0%, transparent 70%); opacity: 0.2; position: absolute; top: -20px; left: 50%; transform: translateX(-50%); border-radius: 50%;"></div>
                  <h1 style="font-family: 'Cormorant Garamond', serif; color: #fff; margin: 0; font-size: 32px; letter-spacing: 3px; font-weight: 400; text-transform: uppercase; position: relative; z-index: 10;">DEVID AURA</h1>
                  <p style="font-family: 'Manrope', sans-serif; color: ${theme.gold}; margin: 8px 0 0; font-size: 10px; letter-spacing: 3px; text-transform: uppercase; font-weight: 500;">The Essence of Luxury</p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding: 20px 40px;">
                  <div style="background: #fcfbf8; border: 1px solid #f0e6d2; color: #8a6d3b; padding: 10px 24px; display: inline-block; border-radius: 50px; margin-bottom: 25px;">
                    <span style="font-size: 14px;">✨</span> 
                    <span style="font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 12px; letter-spacing: 0.5px; margin-left: 6px; text-transform: uppercase; color: #000;">Order Confirmed</span>
                  </div>
                  <h2 align="left" style="font-family: 'Cormorant Garamond', serif; font-size: 28px; font-weight: 600; color: #111; margin: 0 0 10px; line-height: 1.1;">Hello, ${userName}</h2>
                  <p align="left" style="font-family: 'Manrope', sans-serif; font-size: 14px; color: #666; margin: 0; line-height: 1.6;">
                    We are getting your order <strong style="color: ${theme.black};">#${orderDetails.id}</strong> ready. We will notify you once it ships.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding: 20px 40px;">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: #fafafa; border-radius: 12px; padding: 20px;">
                    <tr>
                      <td width="50%" style="padding-bottom: 15px; border-right: 1px solid #eaeaea; padding-right: 15px;">
                        <p style="font-size: 10px; text-transform: uppercase; color: #999; margin: 0 0 4px; font-weight: 700; letter-spacing: 0.5px;">Order Date</p>
                        <p style="font-size: 13px; color: #111; margin: 0; font-weight: 600;">${orderDateString}</p>
                      </td>
                      <td width="50%" style="padding-bottom: 15px; padding-left: 20px;">
                        <p style="font-size: 10px; text-transform: uppercase; color: #999; margin: 0 0 4px; font-weight: 700; letter-spacing: 0.5px;">Estimated Delivery</p>
                        <p style="font-size: 13px; color: #111; margin: 0; font-weight: 600;">${deliveryString}</p>
                      </td>
                    </tr>
                    <tr>
                      <td ${showTransactionId ? 'width="50%"' : 'colspan="2"'} style="padding-top: 15px; ${showTransactionId ? 'border-right: 1px solid #eaeaea; padding-right: 15px;' : ''} border-top: 1px solid #eaeaea;">
                        <p style="font-size: 10px; text-transform: uppercase; color: #999; margin: 0 0 4px; font-weight: 700; letter-spacing: 0.5px;">Payment Method</p>
                        <p style="font-size: 13px; color: #111; margin: 0; font-weight: 600;">${paymentDisplay}</p>
                      </td>
                      ${showTransactionId ? `
                      <td width="50%" style="padding-top: 15px; padding-left: 20px; border-top: 1px solid #eaeaea;">
                        <p style="font-size: 10px; text-transform: uppercase; color: #999; margin: 0 0 4px; font-weight: 700; letter-spacing: 0.5px;">Transaction ID</p>
                        <p style="font-size: 13px; color: #111; margin: 0; font-weight: 500; font-family: monospace;">${orderDetails.razorpay_order_id}</p>
                      </td>` : ''}
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding: 10px 40px;">
                  <p style="font-family: 'Manrope', sans-serif; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #111; margin-bottom: 10px; border-bottom: 1px solid #ddd; display: inline-block; padding-bottom: 5px;">Your Selection</p>
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    ${itemsHtml}
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px 40px 50px;">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td width="50%" valign="top" style="padding-right: 20px;">
                        <p style="font-family: 'Manrope', sans-serif; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 15px;">Shipping To</p>
                        ${addressHtml}
                      </td>
                      <td width="50%" valign="top">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                          <tr><td style="padding: 5px 0; color: #666; font-size: 13px;">MRP Subtotal</td><td style="padding: 5px 0; color: #111; font-size: 13px; text-align: right; font-weight: 600;">${formatMoney(mrpTotal)}</td></tr>
                          ${productSavings > 0 ? `<tr><td style="padding: 5px 0; color: #2e7d32; font-size: 13px;">Product Discount</td><td style="padding: 5px 0; color: #2e7d32; font-size: 13px; text-align: right; font-weight: 600;">-${formatMoney(productSavings)}</td></tr>` : ''}
                          ${couponDiscount > 0 ? `<tr><td style="padding: 5px 0; color: #2e7d32; font-size: 13px;">Coupon ${orderDetails.couponCode ? `<span style="font-size:10px; color:#555; background:#eee; padding:2px 5px; border-radius:3px; margin-left:4px;">${orderDetails.couponCode}</span>` : ''}</td><td style="padding: 5px 0; color: #2e7d32; font-size: 13px; text-align: right; font-weight: 600;">-${formatMoney(couponDiscount)}</td></tr>` : ''}
                          ${walletUsed > 0 ? `<tr><td style="padding: 5px 0; color: #2e7d32; font-size: 13px;">Wallet Used</td><td style="padding: 5px 0; color: #2e7d32; font-size: 13px; text-align: right; font-weight: 600;">-${formatMoney(walletUsed)}</td></tr>` : ''}
                          <tr><td style="padding: 5px 0; color: #666; font-size: 13px;">Shipping Charge</td><td style="padding: 5px 0; color: #111; font-size: 13px; text-align: right; font-weight: 600;">${deliveryCharge === 0 ? '<span style="color: #2e7d32;">Free</span>' : formatMoney(deliveryCharge)}</td></tr>
                          <tr><td style="padding-top: 12px; border-top: 1px dashed #eaeaea;"><span style="font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 700; color: ${theme.black};">Grand Total</span></td><td style="padding-top: 12px; border-top: 1px dashed #eaeaea; text-align: right;"><span style="font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 700; color: ${theme.black};">${formatMoney(finalTotal)}</span></td></tr>
                          <tr><td colspan="2" style="font-size: 10px; color: #999; text-align: right; padding-top: 4px;">Inc. of all taxes</td></tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr><td align="center" style="padding: 0 40px 40px;"><a href="https://devidaura.com/myorder" style="background-color: ${theme.black}; color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 50px; font-weight: 600; font-size: 13px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.2); font-family: 'Montserrat', sans-serif; letter-spacing: 1px; text-transform: uppercase;">Track Your Order</a></td></tr>
              <tr><td style="background-color: #f9f9f9; padding: 20px; text-align: center; border-top: 1px solid #eee;"><p style="margin: 0; font-size: 11px; color: #999; font-family: 'Montserrat', sans-serif;">Need help? <a href="mailto:support@devidaura.com" style="color: ${theme.black}; text-decoration: underline;">Contact Support</a></p><p style="margin: 10px 0 0; font-size: 11px; color: #ccc; font-family: 'Montserrat', sans-serif;">&copy; ${new Date().getFullYear()} Devid Aura. All rights reserved.</p></td></tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: getSender(),
      to: [userEmail],
      subject: `Order Confirmed: #${orderDetails.id}`,
      html: emailHtml,
    });
    if (error) throw new Error(error.message);
  } catch (error) { console.error("❌ Email FAILED:", error.message); throw error; }
};

export const sendAdminOrderAlert = async (orderDetails, orderItems) => {
  const adminEmail = process.env.EMAIL_USER;
  if (!adminEmail) return;

  const itemsList = orderItems.map(item => `<li>${item.productName} (${item.size}) x ${item.quantity} - ₹${item.totalPrice}</li>`).join('');

  const html = `
        <h3>🚀 New Order Received!</h3>
        <p><strong>Order ID:</strong> ${orderDetails.id}</p>
        <p><strong>Amount:</strong> ₹${orderDetails.totalAmount}</p>
        <p><strong>Payment Mode:</strong> ${orderDetails.paymentMode}</p>
        <p><strong>Customer ID:</strong> ${orderDetails.userId}</p>
        <hr/>
        <h4>Items:</h4>
        <ul>${itemsList}</ul>
        <hr/>
        <p>Login to admin panel to view details.</p>
    `;

  try {
    const { data, error } = await resend.emails.send({
      from: getSender(),
      to: [adminEmail],
      subject: `[ADMIN] New Order #${orderDetails.id} - ₹${orderDetails.totalAmount}`,
      html: html
    });
    if (error) throw new Error(error.message);
  } catch (error) { console.error("❌ Admin Alert FAILED:", error.message); throw error; }
};

export const sendAbandonedCartEmail = async (userEmail, userName, cartItems) => {
  if (!userEmail) return;
  const cartTotal = cartItems.reduce((acc, item) => acc + item.totalPrice, 0);

  const itemsHtml = cartItems.map(item => `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px dashed #eaeaea;">
        <div style="display: flex; align-items: center;">
            <img src="${item.img}" alt="Product" style="width: 64px; height: 64px; border-radius: 12px; object-fit: cover; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
            <div style="margin-left: 16px;">
                <p style="margin: 0; font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 700; color: #111;">${item.productName}</p>
                <p style="margin: 4px 0 0; font-family: 'Manrope', sans-serif; font-size: 11px; color: #888; background: #f7f7f7; padding: 2px 8px; border-radius: 4px; display: inline-block;">Size: ${item.size}</p>
            </div>
        </div>
      </td>
      <td style="padding: 16px 0; border-bottom: 1px dashed #eaeaea; text-align: right; font-family: 'Cormorant Garamond', serif; font-weight: 600; color: #111; font-size: 18px;">
        ₹${item.totalPrice}
      </td>
    </tr>
  `).join('');

  const theme = { bg: "#f4f4f5", cardBg: "#ffffff", gold: "#D4AF37", black: "#0a0a0a", shadow: "0 10px 40px rgba(0,0,0,0.08)", radius: "24px" };

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: ${theme.bg}; font-family: 'Manrope', sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" style="padding: 40px 10px;">
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: ${theme.cardBg}; border-radius: ${theme.radius}; overflow: hidden; box-shadow: ${theme.shadow};">
              <tr><td style="background-color: ${theme.black}; padding: 45px 40px; text-align: center; position: relative;"><h1 style="font-family: 'Cormorant Garamond', serif; color: #fff; margin: 0; font-size: 32px; letter-spacing: 3px; font-weight: 400; text-transform: uppercase;">DEVID AURA</h1><p style="font-family: 'Manrope', sans-serif; color: ${theme.gold}; margin: 8px 0 0; font-size: 10px; letter-spacing: 3px; text-transform: uppercase; font-weight: 500;">Don't let them go</p></td></tr>
              <tr><td align="center" style="transform: translateY(-20px);"><table border="0" cellspacing="0" cellpadding="0" style="background: #fff; border-radius: 50px; padding: 10px 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);"><tr><td><span style="font-size: 18px;">🛒</span> <span style="font-family: 'Manrope', sans-serif; font-weight: 700; color: ${theme.black}; font-size: 12px; margin-left: 8px; letter-spacing: 1px; text-transform: uppercase;">Items Reserved</span></td></tr></table></td></tr>
              <tr><td style="padding: 20px 50px 10px; text-align: center;"><h2 style="font-family: 'Cormorant Garamond', serif; margin: 0; font-size: 28px; color: ${theme.black}; font-weight: 600;">You forgot something...</h2><p style="font-family: 'Manrope', sans-serif; color: #666; font-size: 14px; margin: 15px 0 20px; line-height: 1.6;">Hi ${userName.split(' ')[0]}, we noticed you left some luxury items in your cart. We have saved them for you, but they are selling out fast.</p></td></tr>
              <tr><td style="padding: 0 40px;"><table width="100%" border="0" cellspacing="0" cellpadding="0">${itemsHtml}</table></td></tr>
              <tr><td style="padding: 20px 40px;"><table width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td align="right" style="font-family: 'Manrope', sans-serif; font-size: 12px; color: #888; padding-right: 15px;">Cart Total</td><td align="right" style="font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 700; color: ${theme.black};">₹${cartTotal}</td></tr></table></td></tr>
              <tr><td align="center" style="padding: 10px 40px 40px;"><a href="https://devidaura.com/cart" style="background-color: ${theme.black}; color: #ffffff; padding: 16px 50px; text-decoration: none; border-radius: 50px; font-weight: 600; font-size: 13px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.2); font-family: 'Montserrat', sans-serif; letter-spacing: 1px; text-transform: uppercase;">Complete Purchase</a></td></tr>
              <tr><td style="background-color: #f9f9f9; padding: 20px; text-align: center; border-top: 1px solid #eee;"><p style="margin: 0; font-size: 11px; color: #999; font-family: 'Manrope', sans-serif;">Devid Aura • Luxury Fragrances</p></td></tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: getSender(),
      to: [userEmail],
      subject: `Items waiting in your cart 🛒`,
      html: emailHtml,
    });
    if (error) throw new Error(error.message);
  } catch (error) { console.error("❌ Email FAILED:", error.message); }
};

export const executeRecoveryForUsers = async (userIds) => {
  const results = await Promise.all(userIds.map(async (userId) => {
    try {
      const user = await NotificationsRepository.getUserById(userId);
      if (!user) return 0;

      const cartItems = await NotificationsRepository.getCartItemsByUserId(userId);
      if (cartItems.length === 0) return 0;

      const formattedItems = cartItems.map(item => ({
        ...item,
        img: Array.isArray(item.img) ? item.img[0] : item.img,
        totalPrice: item.price * item.quantity
      }));

      const tasks = [];
      if (user.pushSubscription) {
        tasks.push(
          sendPushNotification(user.pushSubscription, {
            title: "Still thinking about it? 🤔",
            body: "Your luxury items are waiting! Complete your order before they sell out.",
            url: "/cart"
          }).catch(err => console.error(`Push failed for ${user.email}`))
        );
      }
      if (user.email) {
        tasks.push(
          sendAbandonedCartEmail(user.email, user.name, formattedItems)
            .catch(err => console.error(`Email failed for ${user.email}`))
        );
      }
      await Promise.all(tasks);
      return 1;
    } catch (err) {
      console.error(`❌ Failed recovery for user ${userId}:`, err.message);
      return 0;
    }
  }));

  return results.reduce((sum, count) => sum + count, 0);
};

export const sendPromotionalEmail = async (userEmail, userName, couponCode, description, discountValue, discountType) => {
  if (!userEmail) return;

  const discountDisplay = discountType === 'percent' ? `${discountValue}% OFF` :
    discountType === 'flat' ? `₹${discountValue} OFF` : 'Free Gift';

  const theme = { bg: "#f4f4f5", cardBg: "#ffffff", gold: "#D4AF37", black: "#0a0a0a", radius: "24px" };

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: ${theme.bg}; font-family: 'Manrope', sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" style="padding: 40px 10px;">
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: ${theme.cardBg}; border-radius: ${theme.radius}; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.08);">
              <tr><td style="background-color: ${theme.black}; padding: 45px 40px; text-align: center;"><h1 style="color: #fff; margin: 0; font-size: 28px; letter-spacing: 2px;">DEVID AURA</h1><p style="color: ${theme.gold}; margin: 5px 0 0; font-size: 10px; letter-spacing: 2px; text-transform: uppercase;">Exclusive Offer For You</p></td></tr>
              <tr><td style="padding: 40px 40px 30px; text-align: center;"><h2 style="color: ${theme.black}; margin: 0 0 15px; font-size: 24px;">Hello, ${userName}</h2><p style="color: #666; font-size: 14px; line-height: 1.6;">We've created a special offer just for you.</p><div style="background: #fdfbf7; border: 1px dashed ${theme.gold}; border-radius: 12px; padding: 20px; margin: 25px 0;"><p style="color: #888; font-size: 12px; text-transform: uppercase; margin: 0 0 5px;">Your Code</p><p style="color: ${theme.black}; font-size: 32px; font-weight: bold; margin: 0; letter-spacing: 2px;">${couponCode}</p><p style="color: ${theme.gold}; font-weight: 600; margin: 10px 0 0;">${discountDisplay}</p></div><p style="color: #666; font-size: 13px;">${description || "Use this code at checkout to redeem your reward."}</p></td></tr>
              <tr><td align="center" style="padding: 0 40px 40px;"><a href="https://devidaura.com" style="background-color: ${theme.black}; color: #ffffff; padding: 15px 40px; text-decoration: none; border-radius: 50px; font-weight: 600; font-size: 13px;">Shop Now</a></td></tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: getSender(),
      to: [userEmail],
      subject: `🎁 A special gift for you: ${discountDisplay}`,
      html: emailHtml,
    });
    if (error) throw new Error(error.message);
  } catch (error) { console.error("❌ Promo Email FAILED:", error.message); }
};
