// server/controllers/priceController.js
import { calculatePriceBreakdown } from '../helpers/priceEngine.js'; // 🟢 Import the new engine

export const getPriceBreakdown = async (req, res) => {
  try {
    const { cartItems, couponCode = null, pincode = null } = req.body;
    
    // 🟢 Call the central engine to get the breakdown
    const breakdown = await calculatePriceBreakdown(cartItems, couponCode, pincode);

    // 🟢 Return the result
    return res.json({
      success: true,
      breakdown: breakdown,
    });
    
  } catch (err) {
    console.error('getPriceBreakdown error:', err);
    return res.status(500).json({ success: false, msg: err.message || 'Server error' });
  }
};