// ✅ file: routes/contact.js
import express from "express";
import { db } from "../configs/index.js";
import { ticketsTable, ticketMessagesTable, usersTable } from "../configs/schema.js";
import { eq, desc, asc, or } from "drizzle-orm"; 
import nodemailer from "nodemailer";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// 1. Configure Email Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const generateTicketId = () => `SUP-${Date.now()}`;

// 🛡️ SECURITY: Simple In-Memory Rate Limiter for Guest Tickets
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 Hour
const MAX_TICKETS_PER_IP = 3; // Max 3 tickets per hour per IP

const checkRateLimit = (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, []);
    }

    const timestamps = rateLimitMap.get(ip);
    // Filter out old timestamps
    const recentTimestamps = timestamps.filter(time => now - time < RATE_LIMIT_WINDOW);
    
    if (recentTimestamps.length >= MAX_TICKETS_PER_IP) {
        return res.status(429).json({ error: "Too many tickets created. Please try again later." });
    }

    recentTimestamps.push(now);
    rateLimitMap.set(ip, recentTimestamps);
    
    // Cleanup map periodically (optional optimization)
    if (rateLimitMap.size > 1000) rateLimitMap.clear(); 

    next();
};

/* ======================================================
   🔒 GET ALL TICKETS (Admin Only)
====================================================== */
router.get("/", requireAuth, verifyAdmin, async (req, res) => {
  try {
    const tickets = await db.query.ticketsTable.findMany({
      with: {
        messages: { orderBy: [asc(ticketMessagesTable.createdAt)] },
        user: true,
      },
      orderBy: [desc(ticketsTable.updatedAt)],
    });
    res.json(tickets);
  } catch (error) {
    console.error("❌ Error fetching tickets:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🔒 GET USER TICKETS (Owner or Admin)
   - Verifies the requester owns the email
====================================================== */
router.get("/user/:email", requireAuth, async (req, res) => {
  try {
    const { email } = req.params;
    const requesterClerkId = req.auth.userId;

    // 1. Resolve Requester
    const requester = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true, role: true, email: true }
    });
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    // 🔒 2. OWNERSHIP CHECK
    if (requester.email !== email && requester.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: You can only view your own tickets." });
    }

    // 3. Logic to find tickets (by ID or Email)
    const targetUser = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });

    let searchCondition;
    if (targetUser) {
        searchCondition = or(eq(ticketsTable.userId, targetUser.id), eq(ticketsTable.guestEmail, email));
    } else {
        searchCondition = eq(ticketsTable.guestEmail, email);
    }

    const tickets = await db.query.ticketsTable.findMany({
      where: searchCondition,
      with: { messages: { orderBy: [asc(ticketMessagesTable.createdAt)] } },
      orderBy: [desc(ticketsTable.createdAt)],
    });
    res.json(tickets);
  } catch (error) {
    console.error("❌ Error fetching user tickets:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🟢 POST CREATE TICKET (Public - Rate Limited)
   - Allows guests to create tickets
   - Ignores body.userId to prevent spoofing
   - 🛡️ Protected by checkRateLimit
====================================================== */
router.post("/", checkRateLimit, async (req, res) => {
  // 🔒 Security: Do not extract 'userId' from body. 
  // We rely on email matching for history association.
  const { email, phone, name, subject, message } = req.body;
  
  if (!email || !message) return res.status(400).json({ error: "Email and message are required" });

  try {
    // 1. Save Ticket to DB
    const [newTicket] = await db.insert(ticketsTable).values({
      id: generateTicketId(),
      userId: null, // Always null for public submission (safer)
      guestEmail: email,
      guestPhone: phone,
      subject: subject || "New Support Query",
      status: "open"
    }).returning();

    await db.insert(ticketMessagesTable).values({
      ticketId: newTicket.id,
      senderRole: 'user',
      message: message
    });

    // 2. Send Emails
    try {
        // Email to User
        await transporter.sendMail({
            from: `"Devid Aura Support" <${process.env.EMAIL_USER}>`,
            to: email, 
            subject: `Ticket Received: ${newTicket.id}`,
            text: `Hi ${name || 'there'},\n\nWe received your message regarding "${subject}".\nTicket ID: ${newTicket.id}\n\nWe will get back to you shortly.\n\n- Team Devid Aura`
        });

        // Email to Admin
        await transporter.sendMail({
            from: `"Devid Aura System" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER, 
            subject: `New Ticket (${newTicket.id}) from ${name}`,
            text: `Subject: ${subject}\nFrom: ${email}\n\nMessage:\n${message}`
        });
    } catch (err) {
        console.error("⚠️ Failed to send creation emails:", err.message);
    }

    res.status(201).json(newTicket);
  } catch (error) {
    console.error("❌ Error creating ticket:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🔒 POST REPLY (Authenticated)
   - Enforces senderRole based on Token
====================================================== */
router.post("/:ticketId/reply", requireAuth, async (req, res) => {
  const { ticketId } = req.params;
  const { message } = req.body; // Ignore senderRole from body
  const requesterClerkId = req.auth.userId;

  try {
    // 1. Identify Actor
    const actor = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true, role: true, email: true }
    });
    if (!actor) return res.status(401).json({ error: "Unauthorized" });

    // 2. Fetch Ticket
    const ticket = await db.query.ticketsTable.findFirst({
        where: eq(ticketsTable.id, ticketId)
    });

    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.status && ticket.status.toLowerCase() === 'closed') {
        return res.status(400).json({ error: "This ticket is permanently closed." });
    }

    // 3. Determine Role & Validate Access
    let senderRole = 'user';
    if (actor.role === 'admin') {
        senderRole = 'admin';
    } else {
        // If not admin, must be owner
        const isOwner = (ticket.userId === actor.id) || (ticket.guestEmail === actor.email);
        if (!isOwner) {
            return res.status(403).json({ error: "Forbidden: Not your ticket" });
        }
    }

    // 4. Add Reply
    const [newMessage] = await db.insert(ticketMessagesTable).values({
      ticketId,
      senderRole,
      message
    }).returning();

    await db.update(ticketsTable)
      .set({ updatedAt: new Date() }) 
      .where(eq(ticketsTable.id, ticketId));

    // 5. Send Notification
    try {
        const isUserReplying = senderRole === 'user';
        const targetEmail = isUserReplying ? process.env.EMAIL_USER : ticket.guestEmail;
        
        const emailSubject = isUserReplying 
            ? `New Reply on Ticket ${ticketId}` 
            : `Update on your Support Ticket ${ticketId}`;
        
        const emailBody = isUserReplying
            ? `User has replied to ticket ${ticketId}:\n\n"${message}"\n\nGo to Admin Panel to respond.`
            : `Support has replied to your ticket:\n\n"${message}"\n\nReply to this email or check your dashboard to continue the conversation.`;

        if (targetEmail) {
            await transporter.sendMail({
                from: `"Devid Aura Support" <${process.env.EMAIL_USER}>`,
                to: targetEmail,
                subject: emailSubject,
                text: emailBody
            });
        }
    } catch (emailErr) {
        console.error("⚠️ Failed to send reply notification:", emailErr.message);
    }

    res.status(201).json(newMessage);
  } catch (error) {
    console.error("❌ Error replying:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🔒 PATCH STATUS (Admin Only)
====================================================== */
router.patch("/:ticketId/status", requireAuth, verifyAdmin, async (req, res) => {
  const { ticketId } = req.params;
  const { status } = req.body; 

  if (!status) return res.status(400).json({ error: "Status is required" });

  try {
    const [updatedTicket] = await db.update(ticketsTable)
      .set({ status: status, updatedAt: new Date() })
      .where(eq(ticketsTable.id, ticketId))
      .returning();
      
    if (!updatedTicket) return res.status(404).json({ error: "Ticket not found" });

    res.json(updatedTicket);
  } catch (error) {
    console.error("❌ Error updating status:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;