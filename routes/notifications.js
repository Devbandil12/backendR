import 'dotenv/config'; 
import express from 'express';
import { db } from '../configs/index.js';
import { notificationsTable, usersTable, UserAddressTable, addToCartTable, productVariantsTable, productsTable } from '../configs/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import webpush from 'web-push';
import nodemailer from 'nodemailer';

const router = express.Router();

// 🟢 1. Email Config
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("❌ CRITICAL: EMAIL_USER or EMAIL_PASS is missing in .env!");
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // Use SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // 👇 CRITICAL: Force IPv4. 
  // Node.js 18+ on Render tries IPv6 by default which gets blocked/timed out by Gmail.
  family: 4, 
});

// 🟢 2. Notification Routes (Keep existing)
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const userNotifications = await db.query.notificationsTable.findMany({
      where: eq(notificationsTable.userId, userId),
      orderBy: [desc(notificationsTable.createdAt)],
      limit: 20,
    });

    // 2. Get the count of *only* unread notifications
    const unreadResult = await db.select({ 
        count: sql`count(*)::int` 
      })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.isRead, false)
      ));

    res.json({
      notifications: userNotifications,
      unreadCount: unreadResult[0].count,
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/notifications/mark-read/user/:userId
// Marks all notifications for a user as read
router.put('/mark-read/user/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  try {
    await db.update(notificationsTable)
      .set({ isRead: true })
      .where(and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.isRead, false)
      ));
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/user/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  try {
    // This deletes all rows for the user
    await db.delete(notificationsTable)
      .where(eq(notificationsTable.userId, userId));
    
    res.json({ success: true, message: "All notifications cleared." });
  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// VAPID & Subscribe
const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
if (publicVapidKey && privateVapidKey) {
    try {
        webpush.setVapidDetails('mailto:devidauraofficial@gmail.com', publicVapidKey, privateVapidKey);
    } catch (err) { console.error("WebPush Error", err.message); }
}

router.post('/subscribe', async (req, res) => {
  const subscription = req.body;
  const { userId } = req.query;
  if (!userId || !subscription) return res.status(400).json({ error: "Missing data" });
  try {
      await db.update(usersTable).set({ pushSubscription: subscription }).where(eq(usersTable.id, userId));
      res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ error: "Failed" }); }
});

export const sendPushNotification = async (subscriptionFromDb, payload) => {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try { await webpush.sendNotification(subscriptionFromDb, JSON.stringify(payload)); } catch (err) { console.error("Push failed:", err.message); }
};

// 🟢 3. UPDATED: Luxury Invoice with Detailed Payment Info
// Added `paymentDetails` parameter to accept Razorpay data
export const sendOrderConfirmationEmail = async (userEmail, orderDetails, orderItems, paymentDetails = null) => {
  console.log(`📩 Generating Premium Email for: ${userEmail}`);

  if (!userEmail) return;

  // A. Fetch Address
  let addressHtml = "<span style='color: #999;'>Address not available</span>";
  let userName = "Valued Customer";
  try {
    if (orderDetails.userAddressId) {
        const [addr] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, orderDetails.userAddressId));
        if (addr) {
            userName = addr.name.split(' ')[0]; 
            addressHtml = `
                <div style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #111; font-size: 14px; margin-bottom: 4px;">${addr.name}</div>
                <div style="font-family: 'Montserrat', sans-serif; color: #666; font-size: 13px; line-height: 1.5;">
                    ${addr.address}<br>
                    ${addr.city}, ${addr.state} - ${addr.postalCode}
                </div>
                <div style="font-family: 'Montserrat', sans-serif; margin-top: 8px; font-size: 12px; color: #888;">
                    📱 ${addr.phone}
                </div>
            `;
        }
    }
  } catch (err) { console.error("Address Error", err); }

  // B. Product Rows
  const itemsHtml = orderItems.map(item => `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px dashed #eaeaea;">
        <div style="display: flex; align-items: center;">
            <img src="${item.img}" alt="Product" style="width: 64px; height: 64px; border-radius: 12px; object-fit: cover; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
            <div style="margin-left: 16px;">
                <p style="margin: 0; font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 700; color: #111;">${item.productName}</p>
                <p style="margin: 4px 0 0; font-family: 'Montserrat', sans-serif; font-size: 11px; color: #888; background: #f7f7f7; padding: 2px 8px; border-radius: 4px; display: inline-block;">Size: ${item.size}</p>
            </div>
        </div>
      </td>
      <td style="padding: 16px 0; border-bottom: 1px dashed #eaeaea; text-align: center; color: #555; font-family: 'Montserrat', sans-serif; font-size: 13px;">
        x${item.quantity}
      </td>
      <td style="padding: 16px 0; border-bottom: 1px dashed #eaeaea; text-align: right; font-family: 'Cormorant Garamond', serif; font-weight: 600; color: #111; font-size: 18px;">
        ₹${item.totalPrice}
      </td>
    </tr>
  `).join('');

  // C. Styles & Dates
  const theme = {
    bg: "#f4f4f5", 
    cardBg: "#ffffff", 
    gold: "#D4AF37", 
    black: "#0a0a0a", 
    shadow: "0 10px 40px rgba(0,0,0,0.08)", 
    radius: "24px" 
  };

  // 🟢 Update: Date AND Time
  const orderDateObj = orderDetails.createdAt ? new Date(orderDetails.createdAt) : new Date();
  const orderDateString = orderDateObj.toLocaleString("en-IN", {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });

  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 7);
  const deliveryString = deliveryDate.toLocaleDateString("en-IN", { weekday: 'short', day: 'numeric', month: 'short' });

  // 🟢 Update: Payment Method Logic
  let paymentDisplay = "Online Payment";
  
  if (orderDetails.paymentMode === 'cod') {
      paymentDisplay = "Cash on Delivery";
  } else if (paymentDetails) {
      // Logic to show detailed info from Razorpay object
      const method = paymentDetails.method; // 'upi', 'card', 'netbanking', 'wallet'
      
      if (method === 'upi') {
          paymentDisplay = `UPI (${paymentDetails.vpa || 'App'})`;
      } else if (method === 'card') {
          const cardInfo = paymentDetails.card || {};
          paymentDisplay = `Card (${cardInfo.network || ''} ending ${cardInfo.last4 || '****'})`;
      } else if (method === 'netbanking') {
          paymentDisplay = `Netbanking (${paymentDetails.bank || ''})`;
      } else if (method === 'wallet') {
          paymentDisplay = `Wallet (${paymentDetails.wallet || ''})`;
      } else {
          paymentDisplay = `Online (${method})`;
      }
  }

  // D. Full HTML Template
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Montserrat:wght@400;500;600&display=swap');
        body { font-family: 'Montserrat', sans-serif; }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: ${theme.bg};">
      
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" style="padding: 40px 10px;">
            
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: ${theme.cardBg}; border-radius: ${theme.radius}; overflow: hidden; box-shadow: ${theme.shadow};">
              
              <tr>
                <td style="background-color: ${theme.black}; padding: 45px 40px; text-align: center; position: relative;">
                  <div style="width: 100px; height: 100px; background: radial-gradient(circle, ${theme.gold} 0%, transparent 70%); opacity: 0.2; position: absolute; top: -20px; left: 50%; transform: translateX(-50%); border-radius: 50%;"></div>
                  
                  <h1 style="font-family: 'Cormorant Garamond', serif; color: #fff; margin: 0; font-size: 32px; letter-spacing: 3px; font-weight: 400; text-transform: uppercase; position: relative; z-index: 10;">DEVID AURA</h1>
                  <p style="font-family: 'Montserrat', sans-serif; color: ${theme.gold}; margin: 8px 0 0; font-size: 10px; letter-spacing: 3px; text-transform: uppercase; font-weight: 500;">The Essence of Luxury</p>
                </td>
              </tr>

              <tr>
                <td align="center" style="transform: translateY(-20px);">
                  <table border="0" cellspacing="0" cellpadding="0" style="background: #fff; border-radius: 50px; padding: 10px 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                    <tr>
                      <td>
                        <span style="font-size: 18px;">✨</span> 
                        <span style="font-family: 'Montserrat', sans-serif; font-weight: 700; color: ${theme.black}; font-size: 12px; margin-left: 8px; letter-spacing: 1px; text-transform: uppercase;">Order Confirmed</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding: 10px 40px 30px;">
                  <h2 style="font-family: 'Cormorant Garamond', serif; margin: 0; font-size: 28px; color: ${theme.black}; font-weight: 600;">Hello, ${userName}.</h2>
                  <p style="font-family: 'Montserrat', sans-serif; color: #666; font-size: 14px; margin: 8px 0 25px; line-height: 1.6;">
                    You've got excellent taste. We have received your order <strong style="color: ${theme.black};">#${orderDetails.id}</strong> and are preparing it with care.
                  </p>

                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: #fdfbf7; border-radius: 16px; padding: 20px; border: 1px solid #f0e6d2;">
                    <tr>
                      <td width="50%" style="border-right: 1px solid #e5e5e5; padding-right: 15px;">
                        <p style="font-family: 'Montserrat', sans-serif; font-size: 10px; text-transform: uppercase; color: #888; font-weight: 600; margin: 0 0 5px; letter-spacing: 1px;">Razorpay ID</p>
                        <p style="font-family: 'Montserrat', sans-serif; margin: 0; font-size: 13px; font-weight: 600; color: ${theme.black}; word-break: break-all;">${orderDetails.razorpay_order_id || 'N/A'}</p>
                        
                        <p style="font-family: 'Montserrat', sans-serif; font-size: 10px; text-transform: uppercase; color: #888; font-weight: 600; margin: 10px 0 5px; letter-spacing: 1px;">Order Date</p>
                        <p style="font-family: 'Montserrat', sans-serif; margin: 0; font-size: 13px; font-weight: 600; color: ${theme.black};">${orderDateString}</p>
                      </td>
                      <td width="50%" style="padding-left: 20px; vertical-align: top;">
                        <p style="font-family: 'Montserrat', sans-serif; font-size: 10px; text-transform: uppercase; color: #888; font-weight: 600; margin: 0 0 5px; letter-spacing: 1px;">Payment Mode</p>
                        <p style="font-family: 'Cormorant Garamond', serif; margin: 0; font-size: 16px; font-weight: 700; color: ${theme.black}; line-height: 1.2;">${paymentDisplay}</p>
                        
                        <p style="font-family: 'Montserrat', sans-serif; font-size: 10px; text-transform: uppercase; color: #888; font-weight: 600; margin: 10px 0 5px; letter-spacing: 1px;">Expected By</p>
                        <p style="font-family: 'Montserrat', sans-serif; margin: 0; font-size: 13px; font-weight: 600; color: ${theme.black};">${deliveryString}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding: 0 40px;">
                  <p style="font-family: 'Montserrat', sans-serif; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 15px; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">Your Collection</p>
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    ${itemsHtml}
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding: 30px 40px;">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td width="55%" valign="top" style="padding-right: 20px;">
                        <p style="font-family: 'Montserrat', sans-serif; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 15px;">Shipping To</p>
                        <div style="background: #fafafa; border-radius: 12px; padding: 15px; border: 1px solid #eee;">
                            ${addressHtml}
                        </div>
                      </td>

                      <td width="45%" valign="top">
                        <p style="font-family: 'Montserrat', sans-serif; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 15px; text-align: right;">Summary</p>
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                          <tr>
                            <td style="padding: 5px 0; color: #666; font-size: 13px; font-family: 'Montserrat', sans-serif;">Subtotal</td>
                            <td style="padding: 5px 0; color: #111; font-size: 13px; text-align: right; font-weight: 600; font-family: 'Montserrat', sans-serif;">₹${(orderDetails.totalAmount || 0) + (orderDetails.discountAmount || 0) + (orderDetails.offerDiscount || 0)}</td>
                          </tr>
                          ${orderDetails.discountAmount ? `
                          <tr>
                            <td style="padding: 5px 0; color: #2e7d32; font-size: 13px; font-family: 'Montserrat', sans-serif;">Savings</td>
                            <td style="padding: 5px 0; color: #2e7d32; font-size: 13px; text-align: right; font-family: 'Montserrat', sans-serif;">-₹${orderDetails.discountAmount}</td>
                          </tr>` : ''}
                          <tr>
                            <td style="padding: 12px 0 0; font-size: 20px; font-weight: 700; color: ${theme.black}; font-family: 'Cormorant Garamond', serif;">Total</td>
                            <td style="padding: 12px 0 0; font-size: 20px; font-weight: 700; color: ${theme.black}; text-align: right; font-family: 'Cormorant Garamond', serif;">₹${orderDetails.totalAmount}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding: 0 40px 40px;">
                  <a href="https://devidaura.com/myorder" style="background-color: ${theme.black}; color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 50px; font-weight: 600; font-size: 13px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.2); font-family: 'Montserrat', sans-serif; letter-spacing: 1px; text-transform: uppercase;">Track Your Order</a>
                </td>
              </tr>

              <tr>
                <td style="background-color: #f9f9f9; padding: 20px; text-align: center; border-top: 1px solid #eee;">
                  <p style="margin: 0; font-size: 11px; color: #999; font-family: 'Montserrat', sans-serif;">
                    Need help? <a href="mailto:support@devidaura.com" style="color: ${theme.black}; text-decoration: underline;">Contact Support</a>
                  </p>
                  <p style="margin: 10px 0 0; font-size: 11px; color: #ccc; font-family: 'Montserrat', sans-serif;">&copy; ${new Date().getFullYear()} Devid Aura. All rights reserved.</p>
                </td>
              </tr>

            </table>
            
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"Devid Aura Luxury" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `Order Confirmed: #${orderDetails.id}`,
    html: emailHtml,
  };

  try {
    console.log("📨 Sending Luxury Invoice...");
    await transporter.sendMail(mailOptions);
    console.log(`✅ Invoice sent to ${userEmail}`);
  } catch (error) {
    console.error("❌ Email FAILED:", error.message);
  }
};

export const sendAdminOrderAlert = async (orderDetails, orderItems) => {
    const adminEmail = process.env.EMAIL_USER;
    if (!adminEmail) return;

    console.log(`👮 Sending Admin Alert for Order #${orderDetails.id}`);

    const itemsList = orderItems.map(item => 
        `<li>${item.productName} (${item.size}) x ${item.quantity} - ₹${item.totalPrice}</li>`
    ).join('');

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
        await transporter.sendMail({
            from: `"Devid Aura System" <${process.env.EMAIL_USER}>`,
            to: adminEmail, // Sending TO the admin (same as sender)
            subject: `[ADMIN] New Order #${orderDetails.id} - ₹${orderDetails.totalAmount}`,
            html: html
        });
        console.log(`✅ Admin alert sent to ${adminEmail}`);
    } catch (error) {
        console.error("❌ Admin Alert FAILED:", error.message);
    }
};


// ------------------------------------------------------------------
// 🟢 REUSABLE RECOVERY LOGIC (Exported for Cron)
// ------------------------------------------------------------------
export const executeRecoveryForUsers = async (userIds) => {
    console.log(`🚀 Processing Recovery for ${userIds.length} users in parallel...`);

    // ✅ OPTIMIZED: Process all users simultaneously
    const results = await Promise.all(userIds.map(async (userId) => {
        try {
            // 1. Fetch User
            const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
            if (!user) return 0; // Skip

            // 2. Fetch Cart Items
            const cartItems = await db.select({
                productName: productsTable.name,
                img: productsTable.imageurl,
                size: productVariantsTable.size,
                price: productVariantsTable.oprice,
                quantity: addToCartTable.quantity
            })
            .from(addToCartTable)
            .innerJoin(productVariantsTable, eq(addToCartTable.variantId, productVariantsTable.id))
            .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
            .where(eq(addToCartTable.userId, userId));

            if (cartItems.length === 0) return 0; // Skip if empty

            const formattedItems = cartItems.map(item => ({
                ...item,
                img: Array.isArray(item.img) ? item.img[0] : item.img,
                totalPrice: item.price * item.quantity
            }));

            // 3. Send Notifications (Run Push & Email in parallel for this specific user too)
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

            await Promise.all(tasks); // Wait for both to finish sending
            return 1; // Return 1 success count

        } catch (err) {
            console.error(`❌ Failed recovery for user ${userId}:`, err.message);
            return 0; // Return 0 on failure
        }
    }));

    // Sum up all the 1s returned from the successful promises
    const successCount = results.reduce((sum, count) => sum + count, 0);
    return successCount;
};

// 🟢 ROUTE: Manual Trigger (Admin Button)
router.post('/recover-abandoned', async (req, res) => {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: "No users provided" });
    }
    
    // 🚀 FIRE AND FORGET: 
    // We do NOT use 'await'. We start the function and immediately reply to the user.
    executeRecoveryForUsers(userIds)
        .then(count => console.log(`✅ Background Process Finished: ${count} emails sent.`))
        .catch(err => console.error("❌ Background Process Error:", err));

    // Respond INSTANTLY to the frontend
    res.json({ success: true, message: `Recovery initiated for ${userIds.length} users!` });
});


// 🟢 HELPER: Luxury Abandoned Cart Email
export const sendAbandonedCartEmail = async (userEmail, userName, cartItems) => {
  console.log(`📩 Sending Abandoned Cart Email to: ${userEmail}`);

  if (!userEmail) return;

  // Calculate Total
  const cartTotal = cartItems.reduce((acc, item) => acc + item.totalPrice, 0);

  // Generate Product Rows
  const itemsHtml = cartItems.map(item => `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px dashed #eaeaea;">
        <div style="display: flex; align-items: center;">
            <img src="${item.img}" alt="Product" style="width: 64px; height: 64px; border-radius: 12px; object-fit: cover; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
            <div style="margin-left: 16px;">
                <p style="margin: 0; font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 700; color: #111;">${item.productName}</p>
                <p style="margin: 4px 0 0; font-family: 'Montserrat', sans-serif; font-size: 11px; color: #888; background: #f7f7f7; padding: 2px 8px; border-radius: 4px; display: inline-block;">Size: ${item.size}</p>
            </div>
        </div>
      </td>
      <td style="padding: 16px 0; border-bottom: 1px dashed #eaeaea; text-align: right; font-family: 'Cormorant Garamond', serif; font-weight: 600; color: #111; font-size: 18px;">
        ₹${item.totalPrice}
      </td>
    </tr>
  `).join('');

  // Styles
  const theme = {
    bg: "#f4f4f5", 
    cardBg: "#ffffff", 
    gold: "#D4AF37", 
    black: "#0a0a0a", 
    shadow: "0 10px 40px rgba(0,0,0,0.08)", 
    radius: "24px" 
  };

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Montserrat:wght@400;500;600&display=swap');
        body { font-family: 'Montserrat', sans-serif; }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: ${theme.bg};">
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" style="padding: 40px 10px;">
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: ${theme.cardBg}; border-radius: ${theme.radius}; overflow: hidden; box-shadow: ${theme.shadow};">
              
              <tr>
                <td style="background-color: ${theme.black}; padding: 45px 40px; text-align: center; position: relative;">
                  <h1 style="font-family: 'Cormorant Garamond', serif; color: #fff; margin: 0; font-size: 32px; letter-spacing: 3px; font-weight: 400; text-transform: uppercase;">DEVID AURA</h1>
                  <p style="font-family: 'Montserrat', sans-serif; color: ${theme.gold}; margin: 8px 0 0; font-size: 10px; letter-spacing: 3px; text-transform: uppercase; font-weight: 500;">Don't let them go</p>
                </td>
              </tr>

              <tr>
                <td align="center" style="transform: translateY(-20px);">
                  <table border="0" cellspacing="0" cellpadding="0" style="background: #fff; border-radius: 50px; padding: 10px 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                    <tr>
                      <td>
                        <span style="font-size: 18px;">🛒</span> 
                        <span style="font-family: 'Montserrat', sans-serif; font-weight: 700; color: ${theme.black}; font-size: 12px; margin-left: 8px; letter-spacing: 1px; text-transform: uppercase;">Items Reserved</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding: 20px 50px 10px; text-align: center;">
                  <h2 style="font-family: 'Cormorant Garamond', serif; margin: 0; font-size: 28px; color: ${theme.black}; font-weight: 600;">You forgot something...</h2>
                  <p style="font-family: 'Montserrat', sans-serif; color: #666; font-size: 14px; margin: 15px 0 20px; line-height: 1.6;">
                    Hi ${userName.split(' ')[0]}, we noticed you left some luxury items in your cart. We have saved them for you, but they are selling out fast.
                  </p>
                </td>
              </tr>

              <tr>
                <td style="padding: 0 40px;">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    ${itemsHtml}
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding: 20px 40px;">
                   <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="right" style="font-family: 'Montserrat', sans-serif; font-size: 12px; color: #888; padding-right: 15px;">Cart Total</td>
                        <td align="right" style="font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 700; color: ${theme.black};">₹${cartTotal}</td>
                      </tr>
                   </table>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding: 10px 40px 40px;">
                  <a href="https://devidaura.com/cart" style="background-color: ${theme.black}; color: #ffffff; padding: 16px 50px; text-decoration: none; border-radius: 50px; font-weight: 600; font-size: 13px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.2); font-family: 'Montserrat', sans-serif; letter-spacing: 1px; text-transform: uppercase;">Complete Purchase</a>
                </td>
              </tr>

              <tr>
                <td style="background-color: #f9f9f9; padding: 20px; text-align: center; border-top: 1px solid #eee;">
                  <p style="margin: 0; font-size: 11px; color: #999; font-family: 'Montserrat', sans-serif;">Devid Aura • Luxury Fragrances</p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"Devid Aura Concierge" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `Items waiting in your cart 🛒`,
    html: emailHtml,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Abandoned Cart Email sent to ${userEmail}`);
  } catch (error) {
    console.error("❌ Email FAILED:", error.message);
  }
};

export const sendPromotionalEmail = async (userEmail, userName, couponCode, description, discountValue, discountType) => {
  console.log(`📩 Sending Promo Email to: ${userEmail}`);
  if (!userEmail) return;

  const discountDisplay = discountType === 'percent' ? `${discountValue}% OFF` : 
                          discountType === 'flat' ? `₹${discountValue} OFF` : 'Free Gift';

  const theme = {
    bg: "#f4f4f5", cardBg: "#ffffff", gold: "#D4AF37", black: "#0a0a0a", radius: "24px" 
  };

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: ${theme.bg}; font-family: 'Montserrat', sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" style="padding: 40px 10px;">
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: ${theme.cardBg}; border-radius: ${theme.radius}; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.08);">
              <tr>
                <td style="background-color: ${theme.black}; padding: 45px 40px; text-align: center;">
                  <h1 style="color: #fff; margin: 0; font-size: 28px; letter-spacing: 2px;">DEVID AURA</h1>
                  <p style="color: ${theme.gold}; margin: 5px 0 0; font-size: 10px; letter-spacing: 2px; text-transform: uppercase;">Exclusive Offer For You</p>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 40px 30px; text-align: center;">
                  <h2 style="color: ${theme.black}; margin: 0 0 15px; font-size: 24px;">Hello, ${userName}</h2>
                  <p style="color: #666; font-size: 14px; line-height: 1.6;">We've created a special offer just for you.</p>
                  
                  <div style="background: #fdfbf7; border: 1px dashed ${theme.gold}; border-radius: 12px; padding: 20px; margin: 25px 0;">
                    <p style="color: #888; font-size: 12px; text-transform: uppercase; margin: 0 0 5px;">Your Code</p>
                    <p style="color: ${theme.black}; font-size: 32px; font-weight: bold; margin: 0; letter-spacing: 2px;">${couponCode}</p>
                    <p style="color: ${theme.gold}; font-weight: 600; margin: 10px 0 0;">${discountDisplay}</p>
                  </div>
                  
                  <p style="color: #666; font-size: 13px;">${description || "Use this code at checkout to redeem your reward."}</p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding: 0 40px 40px;">
                  <a href="https://devidaura.com" style="background-color: ${theme.black}; color: #ffffff; padding: 15px 40px; text-decoration: none; border-radius: 50px; font-weight: 600; font-size: 13px;">Shop Now</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: `"Devid Aura Rewards" <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: `🎁 A special gift for you: ${discountDisplay}`,
      html: emailHtml,
    });
    console.log(`✅ Promo Email sent to ${userEmail}`);
  } catch (error) {
    console.error("❌ Promo Email FAILED:", error.message);
  }
};

export default router;