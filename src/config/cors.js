// src/config/cors.js
export const corsOptions = {
  origin: [
    'https://www.devidaura.com',
    'https://devidaura.com',
    'http://localhost:5173',
    'http://localhost:4173',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true,
};
