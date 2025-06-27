// app.js
import 'dotenv/config'; // load environment variables from .env
import express from 'express';
import cors from 'cors';
import http from 'http';
import payment_routes from './routes/paymentRoute.js';

const app = express();
const server = http.createServer(app);

// Enable CORS for all origins (can restrict if you like)
app.use(cors({ origin: '*' }));

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Mount payment routes under /api/payment
app.use('/api/payment', payment_routes);

// Basic health check route (optional)
app.get('/', (req, res) => {
  res.send('✅ Backend is running!');
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT} or live on Render`);
});
