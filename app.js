// app.js

import 'dotenv/config';                   // loads .env into process.env
import express from 'express';
import cors from 'cors';
import http from 'http';
import payment_routes from './routes/paymentRoute.js'; // <- default import

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Mount your payment routes
app.use('/api/payment', payment_routes);
server.listen(3000, () => {
  console.log('🚀 Server is running on http://localhost:3000');
});
