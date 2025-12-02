import express from "express";
import { db } from "../configs/index.js";
import { ticketsTable, ticketMessagesTable, usersTable } from "../configs/schema.js";
import { eq, desc, asc, or } from "drizzle-orm"; 

const router = express.Router();

// Helper to generate IDs
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

// POST Create New Ticket
router.post("/", async (req, res) => {
  const { userId, email, phone, name, subject, message } = req.body;
  try {
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

    res.status(201).json(newTicket);
  } catch (error) {
    console.error("❌ Error creating ticket:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST Reply to Ticket
router.post("/:ticketId/reply", async (req, res) => {
  const { ticketId } = req.params;
  const { message, senderRole } = req.body; 

  try {
    // 1. Fetch current ticket to check status
    const ticket = await db.query.ticketsTable.findFirst({
        where: eq(ticketsTable.id, ticketId)
    });

    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    // ⛔ STRICT CHECK: If status is closed (case-insensitive), block reply
    if (ticket.status && ticket.status.toLowerCase() === 'closed') {
        return res.status(400).json({ error: "This ticket is permanently closed." });
    }

    // 2. Add Message
    const [newMessage] = await db.insert(ticketMessagesTable).values({
      ticketId,
      senderRole,
      message
    }).returning();

    // 3. Update Timestamp ONLY
    await db.update(ticketsTable)
      .set({ updatedAt: new Date() }) 
      .where(eq(ticketsTable.id, ticketId));

    res.status(201).json(newMessage);
  } catch (error) {
    console.error("❌ Error replying:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 FIXED: PATCH Update Ticket Status
router.patch("/:ticketId/status", async (req, res) => {
  const { ticketId } = req.params;
  const { status } = req.body; 

  // 1. Validate Input
  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  try {
    console.log(`🔹 Updating Ticket ${ticketId} to status: ${status}`);

    // 2. Perform Update
    const [updatedTicket] = await db.update(ticketsTable)
      .set({ status: status, updatedAt: new Date() })
      .where(eq(ticketsTable.id, ticketId))
      .returning();
      
    // 3. Check if update actually happened
    if (!updatedTicket) {
        console.error(`❌ Ticket ${ticketId} not found or update failed.`);
        return res.status(404).json({ error: "Ticket not found" });
    }

    console.log("✅ Ticket Updated Successfully:", updatedTicket.id);
    res.json(updatedTicket);

  } catch (error) {
    console.error("❌ Error updating status:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;