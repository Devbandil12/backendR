import express from "express";
import { db } from "../configs/index.js";
import { ticketsTable, ticketMessagesTable, usersTable } from "../configs/schema.js";
import { eq, desc, asc, or } from "drizzle-orm"; 
import nodemailer from "nodemailer"; // 👈 Required for sending emails

const router = express.Router();

// 1. Configure Email Transporter (Gmail)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail (e.g. devidauraofficial@gmail.com)
    pass: process.env.EMAIL_PASS, // Your App Password
  },
});

const generateTicketId = () => `SUP-${Date.now()}`;

// GET all tickets (For Admin)
router.get("/", async (req, res) => {
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

// GET tickets by User Email
router.get("/user/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });

    let searchCondition;
    if (user) {
        searchCondition = or(eq(ticketsTable.userId, user.id), eq(ticketsTable.guestEmail, email));
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

// POST Create New Ticket (Sends confirmation email)
router.post("/", async (req, res) => {
  const { userId, email, phone, name, subject, message } = req.body;
  try {
    // 1. Save Ticket to DB
    const [newTicket] = await db.insert(ticketsTable).values({
      id: generateTicketId(),
      userId: userId || null,
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

        // Email to You (Admin)
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

// 🟢 POST Reply to Ticket (Sends notification on reply)
router.post("/:ticketId/reply", async (req, res) => {
  const { ticketId } = req.params;
  const { message, senderRole } = req.body; 

  try {
    // 1. Fetch current ticket (to get user's email)
    const ticket = await db.query.ticketsTable.findFirst({
        where: eq(ticketsTable.id, ticketId)
    });

    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.status && ticket.status.toLowerCase() === 'closed') {
        return res.status(400).json({ error: "This ticket is permanently closed." });
    }

    // 2. Add Reply to DB
    const [newMessage] = await db.insert(ticketMessagesTable).values({
      ticketId,
      senderRole,
      message
    }).returning();

    await db.update(ticketsTable)
      .set({ updatedAt: new Date() }) 
      .where(eq(ticketsTable.id, ticketId));

    // 3. Send Notification Email
    try {
        const isUserReplying = senderRole === 'user';
        
        // LOGIC: If User replies -> Send to Admin. If Admin replies -> Send to User.
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
            console.log(`✅ Reply notification sent to ${targetEmail}`);
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

// PATCH Update Ticket Status
router.patch("/:ticketId/status", async (req, res) => {
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