import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

// Import Controllers & Middlewares
import {
  register,
  userLogin,
  adminLogin,
  getProfile,
  getAdminProfile,
  logout
} from './controllers/authController';

import {
  createCar,
  getAllCarsForAdmin,
  updateCar,
  deleteCar,
  getCarsForUser
} from './controllers/carController';

import {
  createBooking,
  getBookingById,
  getUserActiveBooking,
  getUserBookingHistory,
  getAllBookingsForAdmin,
  approveBooking,
  rejectBooking,
  processPayment,
  confirmCashPayment,
  startTrip,
  endTrip,
  closeBooking,
  getUserNotifications,
  getAdminNotifications,
  createRazorpayOrder,
  verifyRazorpayPayment
} from './controllers/bookingController';

import { getDashboardStats } from './controllers/dashboardController';
import { authenticateJWT, authenticateAdminJWT, authenticateAnyJWT, requireRole } from './middleware/auth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '15mb' })); // Support larger base64 signatures/images
app.use(cookieParser());

// REST Router mapping

// 1. Auth Routing
app.post('/api/auth/register', register);
app.post('/api/auth/login', userLogin);
app.post('/api/auth/admin-login', adminLogin);
app.post('/api/auth/logout', logout);
app.get('/api/auth/profile', authenticateJWT, getProfile);
app.get('/api/auth/admin-profile', authenticateAdminJWT, getAdminProfile);

// 2. Public / Catalog Search
app.get('/api/cars', getCarsForUser);

// 3. User Bookings
app.post('/api/bookings', authenticateJWT, requireRole(['CUSTOMER']), createBooking);
app.get('/api/bookings/active', authenticateJWT, requireRole(['CUSTOMER']), getUserActiveBooking);
app.get('/api/bookings/history', authenticateJWT, requireRole(['CUSTOMER']), getUserBookingHistory);
app.get('/api/bookings/:id', authenticateAnyJWT, getBookingById);
app.post('/api/bookings/:id/payment', authenticateJWT, requireRole(['CUSTOMER']), processPayment);
app.post('/api/bookings/:id/razorpay-order', authenticateJWT, requireRole(['CUSTOMER']), createRazorpayOrder);
app.post('/api/bookings/:id/verify-payment', authenticateJWT, requireRole(['CUSTOMER']), verifyRazorpayPayment);

// 4. Notifications
app.get('/api/notifications/user', authenticateJWT, requireRole(['CUSTOMER']), getUserNotifications);
app.get('/api/notifications/admin', authenticateAdminJWT, getAdminNotifications);

// 5. Admin Routing (All protected by isolated Admin JWT Auth)
app.post('/api/admin/cars', authenticateAdminJWT, createCar);
app.get('/api/admin/cars', authenticateAdminJWT, getAllCarsForAdmin);
app.put('/api/admin/cars/:id', authenticateAdminJWT, updateCar);
app.delete('/api/admin/cars/:id', authenticateAdminJWT, deleteCar);

app.get('/api/admin/bookings', authenticateAdminJWT, getAllBookingsForAdmin);
app.post('/api/admin/bookings/:id/approve', authenticateAdminJWT, approveBooking);
app.post('/api/admin/bookings/:id/reject', authenticateAdminJWT, rejectBooking);
app.post('/api/admin/bookings/:id/confirm-cash', authenticateAdminJWT, confirmCashPayment);
app.post('/api/admin/bookings/:id/start-trip', authenticateAdminJWT, startTrip);
app.post('/api/admin/bookings/:id/end-trip', authenticateAdminJWT, endTrip);
app.post('/api/admin/bookings/:id/close', authenticateAdminJWT, closeBooking);

app.get('/api/admin/dashboard', authenticateAdminJWT, getDashboardStats);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// Boot Application
app.listen(PORT, () => {
  console.log(`FitBros Car Rental API server listening on port ${PORT}`);
});
