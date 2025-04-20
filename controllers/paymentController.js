const Razorpay = require('razorpay'); 
const crypto=require("crypto")
const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpayInstance = new Razorpay({
    key_id: RAZORPAY_ID_KEY,
    key_secret: RAZORPAY_SECRET_KEY
});



const createOrder = async(req,res)=>{
    try {
        const {user,phone}=req.body
        if(!user)return res.status(401).send("login please")
        const amount = req.body.amount*100
        console.log(req.body)
        const options = {
            amount: amount,
            currency: 'INR',
            receipt: 'razorUser@gmail.com'
        }

        razorpayInstance.orders.create(options, 
            (err, order)=>{
                if(!err){
                    res.status(200).send({
                        success:true,
                        msg:'Order Created',
                        order_id:order.id,
                        amount:amount,
                        key_id:RAZORPAY_ID_KEY,
                       
                        contact:phone,
                        name: user?.fullName,
                        email: user?.primaryEmailAddress.emailAddress
                    });
                }
                else{
                    res.status(400).send({success:false,msg:'Something went wrong!'});
                }
            }
        );

    } catch (error) {
        console.log(error.message);
    }
}
const verify=async(req,res)=>{


  try {
    
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET_KEY)
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
}


module.exports = {
   verify,
    createOrder
}