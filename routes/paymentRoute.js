const express = require('express');
const multer = require('multer');
const pdf=require("pdf-parse")
const payment_route = express();

const bodyParser = require('body-parser');
payment_route.use(bodyParser.json());
payment_route.use(bodyParser.urlencoded({ extended:false }));

const path = require('path');



const paymentController = require('../controllers/paymentController');

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


module.exports = payment_route;