const express         =require("express")
const multer          =require('multer')
const pdf             =require("pdf-parse")
const { db }          =require("../configs/index.js")               
const { eq }          =require("drizzle-orm")
const Razorpay        =require("razorpay")
const { ordersTable } =require("../configs/schema.js")
const payment_route = express();

const bodyParser = require('body-parser');
payment_route.use(bodyParser.json());
payment_route.use(bodyParser.urlencoded({ extended:false }));

const path = require('path');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

const paymentController = require('../controllers/paymentController');
const { and } = require("drizzle-orm")

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

payment_route.post("/getdata",upload.single("file"),async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
  
      // req.file.buffer contains the PDF file
      const dataBuffer = req.file.buffer;
      const result = await pdf(dataBuffer);
  
      res.status(200).json({ text: result.text });
    } catch (error) {
      console.error("Error processing file:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

payment_route.post('/createOrder', paymentController.createOrder);
payment_route.post('/verify-payment', paymentController.verify);


 payment_route.post("/:orderId/refund", async (req, res) => {
  const { orderId } = req.params;
  const { reason,userid } = req.body;

  try {
    // 1) Lookup payment_id from your DB
    const [order] = await db
      .select({ paymentId: ordersTable.transactionId })
      .from(ordersTable)
      .where(eq(ordersTable.id, Number(orderId)));

    if (!order || !order.paymentId) {
      return res.status(404).json({ error: "Order or payment not found" });
    }
     const refund = await razorpay.payments.refund(order.paymentId, {
      amount: undefined, // omit to refund full amount, or specify in paise
      speed: "normal",   // or 'optimum' / 'instant'
      notes: { reason: reason || "User-initiated cancellation" },
    });

    // 3) Update your DB: mark paymentStatus = 'refunded'
    await db
      .update(ordersTable)
      .set({ paymentStatus: "refunded", status: "Order Cancelled" })
      .where(eq(ordersTable.id, Number(orderId)));

    // 4) (Optional) send notification email here…

    res.json({ success: true, refund });
  }
    // 2) Issue refund request to Razorpay
   
  catch (err) {
    console.error("Refund error:", err);
    res.status(500).json({ error: "Refund failed" });
  }
});


module.exports = payment_route;

