import Razorpay from 'razorpay';
import crypto from 'crypto';

const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpayInstance = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

export const createOrder = async (req, res) => {
  try {
    const { user, phone, amount } = req.body;

    if (!user) {
      return res.status(401).send("login please");
    }

    const amountInPaise = amount * 100;
    console.log(req.body);

    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: 'razorUser@gmail.com',
    };

    razorpayInstance.orders.create(options, (err, order) => {
      if (!err) {
        res.status(200).send({
          success: true,
          msg: 'Order Created',
          order_id: order.id,
          amount: amountInPaise,
          key_id: RAZORPAY_ID_KEY,
          contact: phone,
          name: user?.fullName,
          email: user?.primaryEmailAddress?.emailAddress,
        });
      } else {
        console.error('Razorpay order creation failed:', err);
        res.status(400).send({ success: false, msg: 'Something went wrong!' });
      }
    });
  } catch (error) {
    console.error('CreateOrder error:', error.message);
    res.status(500).send({ success: false, msg: 'Server error' });
  }
};

export const verify = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const generatedSignature = crypto
      .createHmac("sha256", RAZORPAY_SECRET_KEY)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    console.log("🔍 Signature Check:");
    console.log("Generated:", generatedSignature);
    console.log("Received :", razorpay_signature);

    if (generatedSignature === razorpay_signature) {
      return res.json({ success: true, message: "Payment verified successfully." });
    } else {
      return res.status(400).json({ success: false, error: "Payment verification failed." });
    }
  } catch (error) {
    console.error("❌ Error in verify-payment:", error.message);
    return res.status(500).json({ success: false, error: "Verification error." });
  }
};

export const refund = async (req, res) => {
  try {
    const { paymentId, amount, speed } = req.body;
    if (!paymentId || !amount) {
      return res.status(400).json({ success: false, error: "Missing paymentId or amount" });
    }

    // Create refund in Razorpay
    const refund = await razorpayInstance.payments.refund(paymentId, {
      amount,
      speed: speed || 'optimum',
    });

    console.log("Refund created:", refund);
    return res.json({ success: true, refund });
  } catch (error) {
    console.error("Refund failed:", error);
    res.status(500).json({ success: false, error: error.message || "Refund failed" });
  }
};
