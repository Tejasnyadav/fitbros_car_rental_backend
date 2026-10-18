import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { getReservationOverlapWhere, isPaymentHoldExpired } from '../utils/bookingAvailability';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const calculateBookingTotal = (pricePerDay: number, fromDate: Date, toDate: Date): number => {
  const duration = toDate.getTime() - fromDate.getTime();
  const days = Math.max(1, Math.ceil(duration / DAY_IN_MILLISECONDS));
  const subtotal = pricePerDay * days;
  return subtotal + Math.round(subtotal * 0.05);
};

const razorpayMode = (process.env.RAZORPAY_MODE || 'test').toLowerCase();
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || '';
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';

const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: razorpayKeySecret
});

const normalizeRazorpayMethod = (value?: string): string => {
  const normalized = (value || 'Card').toLowerCase();

  switch (normalized) {
    case 'upi': return 'UPI';
    case 'wallet': return 'Wallet';
    case 'netbanking': return 'NetBanking';
    case 'emi': return 'EMI';
    case 'paylater': return 'PayLater';
    case 'cash': return 'Cash';
    case 'card':
    default: return 'Card';
  }
};

const getRazorpayConfigError = () => {
  if (!razorpayKeyId || !razorpayKeySecret) {
    return 'Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the backend environment.';
  }

  return null;
};

// Helper: Check Date Overlap
const hasOverlap = async (
  carId: string,
  fromDate: Date,
  toDate: Date,
  excludeBookingId?: string
): Promise<boolean> => {
  const overlap = await prisma.booking.findFirst({
    where: {
      carId,
      ...getReservationOverlapWhere(fromDate, toDate, new Date(), excludeBookingId)
    }
  });
  return !!overlap;
};

// Create Booking Request (Customer)
export const createBooking = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id.toString();
    if (!userId) return res.status(401).json({ message: 'User unauthorized.' });

    const {
      carId,
      fromDate,
      toDate,
      destination,
      purpose,
      members,
      pickupLocation,
      license, // Base64 or URL
      aadhaar, // Base64 or URL
      pan,     // Base64 or URL
      selfie,  // Base64 or URL
      signature, // Base64 signature
      pdfUrl   // PDF URL (default is /lease_agreement.pdf)
    } = req.body;

    if (!carId || !fromDate || !toDate || !destination || !purpose || !members || !pickupLocation) {
      return res.status(400).json({ message: 'Missing trip or car details.' });
    }

    if (!license || !aadhaar || !pan || !selfie || !signature) {
      return res.status(400).json({ message: 'All KYC uploads and the electronic signature are required.' });
    }

    const start = new Date(fromDate);
    const end = new Date(toDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid pickup or return date parameters.' });
    }

    const startYear = start.getFullYear();
    const endYear = end.getFullYear();
    if (startYear < 2000 || startYear > 2100 || endYear < 2000 || endYear > 2100) {
      return res.status(400).json({ message: 'Selected dates must be within a realistic timeframe.' });
    }

    if (start <= new Date()) {
      return res.status(400).json({ message: 'Pickup date and time must be in the future.' });
    }

    if (start >= end) {
      return res.status(400).json({ message: 'Return date and time must be after pickup date and time.' });
    }

    const memberCount = Number(members);
    if (!Number.isInteger(memberCount) || memberCount < 1) {
      return res.status(400).json({ message: 'Number of members must be a positive whole number.' });
    }

    const car = await prisma.car.findUnique({ where: { id: carId }, select: { id: true, status: true } });
    if (!car) {
      return res.status(404).json({ message: 'Selected vehicle was not found.' });
    }
    if (car.status !== 'AVAILABLE') {
      return res.status(409).json({ message: 'This vehicle is currently unavailable. Please choose another car.' });
    }

    const exists = await hasOverlap(carId, start, end);
    if (exists) {
      return res.status(409).json({ message: 'This car is no longer available for the selected pickup and return times. Please choose another time or car.' });
    }

    // Create the booking and details
    const booking = await prisma.booking.create({
      data: {
        userId,
        carId,
        fromDate: start,
        toDate: end,
        destination,
        purpose,
        members: memberCount,
        pickupLocation,
        status: 'PENDING_ADMIN_APPROVAL',
        documents: {
          create: {
            license,
            aadhaar,
            pan,
            selfie
          }
        },
        agreement: {
          create: {
            signature,
            pdfUrl: pdfUrl || '/lease_agreement.pdf'
          }
        }
      },
      include: {
        car: true
      }
    });

    return res.status(201).json({
      message: 'Booking request submitted successfully for admin review.',
      booking
    });
  } catch (error: any) {
    console.error('Create Booking Error:', error);
    return res.status(500).json({ message: 'Failed to create booking request.' });
  }
};

// Get Single Booking Details
export const getBookingById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        car: true,
        user: {
          select: { id: true, name: true, email: true, phone: true }
        },
        documents: true,
        agreement: true,
        payment: true,
        invoice: true
      }
    });

    if (!booking) {
      return res.status(404).json({ message: 'Booking details not found.' });
    }

    // Role check: Customer can only view their own bookings, admin can view all
    if (req.user?.role === 'CUSTOMER' && booking.userId !== req.user.id.toString()) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    return res.status(200).json({ booking });
  } catch (error: any) {
    console.error('Fetch Booking Error:', error);
    return res.status(500).json({ message: 'Failed to retrieve booking information.' });
  }
};

// Get User Active Booking (Status other than CLOSED or REJECTED)
export const getUserActiveBooking = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id.toString();

    const booking = await prisma.booking.findFirst({
      where: {
        userId,
        status: { notIn: ['REJECTED', 'CLOSED'] }
      },
      include: {
        car: true,
        payment: true,
        invoice: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json({ booking });
  } catch (error: any) {
    console.error('Fetch User Active Booking Error:', error);
    return res.status(500).json({ message: 'Failed to fetch active booking details.' });
  }
};

// Get User Booking History (CLOSED and REJECTED bookings)
export const getUserBookingHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id.toString();

    const bookings = await prisma.booking.findMany({
      where: {
        userId,
        status: { in: ['REJECTED', 'CLOSED'] }
      },
      include: {
        car: true,
        payment: true,
        invoice: true
      },
      orderBy: { fromDate: 'desc' }
    });

    return res.status(200).json({ bookings });
  } catch (error: any) {
    console.error('Fetch User History Error:', error);
    return res.status(500).json({ message: 'Failed to fetch booking history.' });
  }
};

// Admin List Bookings (with Date and Status Filters)
export const getAllBookingsForAdmin = async (req: Request, res: Response) => {
  try {
    const { dateFilter, status, startDate, endDate } = req.query;

    const filters: any = {};

    // Apply Status Filter
    if (status) {
      filters.status = status;
    }

    // Apply Date Filter on pickup Date (fromDate)
    const now = new Date();
    if (dateFilter === 'Today') {
      const todayStart = new Date(now.setHours(0, 0, 0, 0));
      const todayEnd = new Date(now.setHours(23, 59, 59, 999));
      filters.fromDate = { gte: todayStart, lte: todayEnd };
    } else if (dateFilter === 'This Week') {
      const first = now.getDate() - now.getDay(); // First day is Sunday
      const weekStart = new Date(new Date(now.setDate(first)).setHours(0, 0, 0, 0));
      const weekEnd = new Date(new Date(now.setDate(first + 6)).setHours(23, 59, 59, 999));
      filters.fromDate = { gte: weekStart, lte: weekEnd };
    } else if (dateFilter === 'This Month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      filters.fromDate = { gte: monthStart, lte: monthEnd };
    } else if (dateFilter === 'Custom' && startDate && endDate) {
      filters.fromDate = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string)
      };
    }

    const bookings = await prisma.booking.findMany({
      where: filters,
      include: {
        user: { select: { name: true, email: true } },
        car: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json({ bookings });
  } catch (error: any) {
    console.error('Fetch Admin Bookings Error:', error);
    return res.status(500).json({ message: 'Failed to load bookings.' });
  }
};

// Admin KYC Approve
export const approveBooking = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });

    if (booking.status !== 'PENDING_ADMIN_APPROVAL') {
      return res.status(400).json({ message: 'Booking is not in pending approval state.' });
    }

    if (await hasOverlap(booking.carId, booking.fromDate, booking.toDate, booking.id)) {
      return res.status(409).json({ message: 'This booking conflicts with another active reservation and cannot be approved.' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { status: 'APPROVED_PENDING_PAYMENT' }
    });

    return res.status(200).json({ message: 'Booking documents approved successfully. Unlocked payment gateway.', booking: updated });
  } catch (error: any) {
    console.error('Approve Booking Error:', error);
    return res.status(500).json({ message: 'Failed to approve booking.' });
  }
};

// Admin KYC Reject
export const rejectBooking = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });

    if (booking.status !== 'PENDING_ADMIN_APPROVAL') {
      return res.status(400).json({ message: 'Booking is not in pending approval state.' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { status: 'REJECTED' }
    });

    return res.status(200).json({ message: 'Booking documents rejected successfully.', booking: updated });
  } catch (error: any) {
    console.error('Reject Booking Error:', error);
    return res.status(500).json({ message: 'Failed to reject booking.' });
  }
};

// Delete Booking and its related KYC, agreement, payment, and invoice records (Admin Only)
export const deleteBooking = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id }, select: { id: true } });

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    await prisma.$transaction([
      prisma.document.deleteMany({ where: { bookingId: id } }),
      prisma.agreement.deleteMany({ where: { bookingId: id } }),
      prisma.payment.deleteMany({ where: { bookingId: id } }),
      prisma.invoice.deleteMany({ where: { bookingId: id } }),
      prisma.booking.delete({ where: { id } })
    ]);

    return res.status(200).json({ message: 'Booking and its related records were deleted.' });
  } catch (error: any) {
    console.error('Delete Booking Error:', error);
    return res.status(500).json({ message: 'Failed to delete booking.' });
  }
};

// Process Dummy Payment (Customer)
export const processPayment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { method } = req.body;

    if (!method) {
      return res.status(400).json({ message: 'Payment method is required.' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { car: true, payment: true }
    });
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });

    if (booking.status !== 'APPROVED_PENDING_PAYMENT') {
      return res.status(400).json({ message: 'Booking must be approved by admin prior to payment.' });
    }

    if (booking.payment) {
      return res.status(400).json({ message: 'A payment method has already been selected for this booking.' });
    }

    if (isPaymentHoldExpired(booking.updatedAt)) {
      return res.status(409).json({ message: 'The payment window expired. Please contact support to arrange a new booking.' });
    }

    if (method !== 'Cash') {
      return res.status(400).json({ message: 'Online payments must be processed through Razorpay checkout.' });
    }

    const payment = await prisma.payment.create({
      data: {
        bookingId: id,
        method,
        amount: calculateBookingTotal(booking.car.pricePerDay, booking.fromDate, booking.toDate),
        status: 'PENDING'
      }
    });
    const updatedBooking = { ...booking, payment, invoice: null };

    return res.status(200).json({
      message: 'Cash payment choice logged. Booking is pending admin verification of cash.',
      booking: updatedBooking
    });
  } catch (error: any) {
    console.error('Payment Processing Error:', error);
    return res.status(500).json({ message: 'Failed to process payment.' });
  }
};

// Confirm Cash Payment (Admin Only)
export const confirmCashPayment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { payment: true }
    });

    if (!booking || !booking.payment) {
      return res.status(404).json({ message: 'Booking or payment log not found.' });
    }

    if (booking.payment.method !== 'Cash') {
      return res.status(400).json({ message: 'This booking is not set to Cash payment.' });
    }

    if (booking.status !== 'APPROVED_PENDING_PAYMENT' || booking.payment.status !== 'PENDING') {
      return res.status(400).json({ message: 'This cash payment is no longer awaiting confirmation.' });
    }

    if (await hasOverlap(booking.carId, booking.fromDate, booking.toDate, booking.id)) {
      return res.status(409).json({ message: 'This booking now conflicts with another active reservation and cannot be confirmed.' });
    }

    const invoiceNum = `INV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        payment: {
          update: {
            status: 'COMPLETED'
          }
        },
        invoice: {
          create: {
            invoiceNumber: invoiceNum
          }
        }
      },
      include: { payment: true, invoice: true }
    });

    return res.status(200).json({ message: 'Cash payment confirmed. Booking status updated to Confirmed.', booking: updated });
  } catch (error: any) {
    console.error('Confirm Cash Payment Error:', error);
    return res.status(500).json({ message: 'Failed to confirm cash receipt.' });
  }
};

// Start Trip (Admin Only)
export const startTrip = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });

    if (booking.status !== 'CONFIRMED') {
      return res.status(400).json({ message: 'Booking must be CONFIRMED before starting trip.' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { status: 'ACTIVE' }
    });

    return res.status(200).json({ message: 'Trip successfully marked as ACTIVE.', booking: updated });
  } catch (error: any) {
    console.error('Start Trip Error:', error);
    return res.status(500).json({ message: 'Failed to start trip.' });
  }
};

// End Trip (Admin Only)
export const endTrip = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });

    if (booking.status !== 'ACTIVE') {
      return res.status(400).json({ message: 'Booking must be ACTIVE to mark as COMPLETED.' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { status: 'COMPLETED' }
    });

    return res.status(200).json({ message: 'Trip marked as COMPLETED.', booking: updated });
  } catch (error: any) {
    console.error('End Trip Error:', error);
    return res.status(500).json({ message: 'Failed to end trip.' });
  }
};

// Close Booking & Move to Past Bookings Archive (Admin Only)
export const closeBooking = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });

    if (booking.status !== 'COMPLETED') {
      return res.status(400).json({ message: 'Booking must be COMPLETED (trip ended) before check-in closure.' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { status: 'CLOSED' }
    });

    return res.status(200).json({ message: 'Booking successfully closed and archived.', booking: updated });
  } catch (error: any) {
    console.error('Close Booking Error:', error);
    return res.status(500).json({ message: 'Failed to close and archive booking.' });
  }
};

// Dynamic Notification Engine
export const getUserNotifications = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id.toString();
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Fetch all bookings for user
    const bookings = await prisma.booking.findMany({
      where: { userId },
      include: { car: true },
      orderBy: { updatedAt: 'desc' }
    });

    const notifications = [];

    for (const b of bookings) {
      if (b.status === 'PENDING_ADMIN_APPROVAL') {
        notifications.push({
          id: `${b.id}-submit`,
          type: 'submitted',
          title: 'Booking Request Submitted',
          message: `Your booking request for the ${b.car.name} has been submitted for admin verification.`,
          date: b.createdAt
        });
      } else if (b.status === 'APPROVED_PENDING_PAYMENT') {
        notifications.push({
          id: `${b.id}-approved`,
          type: 'approved',
          title: 'Booking Approved',
          message: `Congratulations! Your booking request for the ${b.car.name} has been approved. Please unlock by completing payment.`,
          date: b.updatedAt
        });
      } else if (b.status === 'REJECTED') {
        notifications.push({
          id: `${b.id}-rejected`,
          type: 'rejected',
          title: 'Booking KYC Rejected',
          message: `Unfortunately, your booking request for the ${b.car.name} was rejected. Please verify documents.`,
          date: b.updatedAt
        });
      } else if (b.status === 'CONFIRMED') {
        notifications.push({
          id: `${b.id}-paid`,
          type: 'confirmed',
          title: 'Payment Received',
          message: `Payment received successfully! Your booking for the ${b.car.name} is now CONFIRMED.`,
          date: b.updatedAt
        });
      } else if (b.status === 'ACTIVE') {
        notifications.push({
          id: `${b.id}-active`,
          type: 'active',
          title: 'Trip Active',
          message: `Your rental session for the ${b.car.name} is now ACTIVE. Safe driving!`,
          date: b.updatedAt
        });
      } else if (b.status === 'COMPLETED') {
        notifications.push({
          id: `${b.id}-completed`,
          type: 'completed',
          title: 'Trip Completed',
          message: `Your rental session for the ${b.car.name} has completed. Pending admin return checkout check.`,
          date: b.updatedAt
        });
      } else if (b.status === 'CLOSED') {
        notifications.push({
          id: `${b.id}-closed`,
          type: 'closed',
          title: 'Booking Closed',
          message: `Your booking for the ${b.car.name} has been successfully closed. Thank you!`,
          date: b.updatedAt
        });
      }
    }

    return res.status(200).json({ notifications });
  } catch (error: any) {
    console.error('Fetch User Notifications Error:', error);
    return res.status(500).json({ message: 'Failed to fetch user notifications.' });
  }
};

// Admin Notifications API
export const getAdminNotifications = async (req: Request, res: Response) => {
  try {
    const bookings = await prisma.booking.findMany({
      include: {
        user: { select: { name: true } },
        car: { select: { name: true } }
      },
      orderBy: { updatedAt: 'desc' },
      take: 20
    });

    const notifications = [];

    for (const b of bookings) {
      if (b.status === 'PENDING_ADMIN_APPROVAL') {
        notifications.push({
          id: `${b.id}-admin-new`,
          title: 'New Booking Request',
          message: `New booking request submitted by ${b.user.name} for the ${b.car.name}.`,
          date: b.createdAt
        });
      } else if (b.status === 'CONFIRMED') {
        notifications.push({
          id: `${b.id}-admin-pay`,
          title: 'Payment Completed',
          message: `Booking #${b.id.substring(18)} paid by ${b.user.name} for ${b.car.name}.`,
          date: b.updatedAt
        });
      } else if (b.status === 'COMPLETED') {
        notifications.push({
          id: `${b.id}-admin-end`,
          title: 'Trip Completed',
          message: `Vehicle ${b.car.name} returned by ${b.user.name}. Ready for return confirmation check.`,
          date: b.updatedAt
        });
      }
    }

    return res.status(200).json({ notifications });
  } catch (error: any) {
    console.error('Fetch Admin Notifications Error:', error);
    return res.status(500).json({ message: 'Failed to load notifications.' });
  }
};

// Create Razorpay Order (Customer)
export const createRazorpayOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id.toString();

    if (!userId) return res.status(401).json({ message: 'User unauthorized.' });

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { car: true, payment: true }
    });

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    if (booking.userId !== userId) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    if (booking.status !== 'APPROVED_PENDING_PAYMENT') {
      return res.status(400).json({ message: 'Booking must be approved by admin prior to payment.' });
    }

    if (booking.payment) {
      return res.status(400).json({ message: 'A payment method has already been selected for this booking.' });
    }

    if (isPaymentHoldExpired(booking.updatedAt)) {
      return res.status(409).json({ message: 'The payment window expired. Please contact support to arrange a new booking.' });
    }

    const razorpayConfigError = getRazorpayConfigError();
    if (razorpayConfigError) {
      return res.status(500).json({ message: razorpayConfigError });
    }

    const totalAmount = calculateBookingTotal(booking.car.pricePerDay, booking.fromDate, booking.toDate);

    // Razorpay orders expect the amount in paise (1 INR = 100 Paise)
    const amountInPaise = Math.round(totalAmount * 100);

    if (amountInPaise < 100) {
      return res.status(400).json({ message: 'Razorpay order amount must be at least 100 paise.' });
    }

    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: booking.id
    };

    const order = await razorpay.orders.create(options);

    return res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: razorpayKeyId,
      mode: razorpayMode
    });
  } catch (error: any) {
    console.error('Create Razorpay Order Error:', error);
    return res.status(500).json({ message: 'Failed to initiate Razorpay order.' });
  }
};

// Verify Razorpay Payment (Customer)
export const verifyRazorpayPayment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      payment_method,
      method,
      paymentMethod
    } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Missing Razorpay payment parameters.' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { car: true, payment: true }
    });

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    if (booking.status !== 'APPROVED_PENDING_PAYMENT') {
      return res.status(400).json({ message: 'Booking is not in approved pending payment state.' });
    }

    if (booking.payment) {
      return res.status(400).json({ message: 'A payment method has already been selected for this booking.' });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!keySecret) {
      return res.status(500).json({ message: 'Razorpay secret is missing. Check the backend environment configuration.' });
    }

    // Create HMAC SHA256 signature
    const hmac = crypto.createHmac('sha256', keySecret);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generatedSignature = hmac.digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ message: 'Payment signature verification failed. Transaction tampered.' });
    }

    if (await hasOverlap(booking.carId, booking.fromDate, booking.toDate, booking.id)) {
      console.error('Verified payment conflicts with another reservation; manual refund review required.', {
        bookingId: id,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id
      });
      return res.status(409).json({ message: 'Payment was received, but this booking now conflicts with another reservation. Please contact support for assistance.' });
    }

    const totalAmount = calculateBookingTotal(booking.car.pricePerDay, booking.fromDate, booking.toDate);

    const invoiceNum = `INV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    let resolvedPaymentMethod = normalizeRazorpayMethod(payment_method || method || paymentMethod);

    try {
      const razorpayPaymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
      if (razorpayPaymentDetails?.method) {
        resolvedPaymentMethod = normalizeRazorpayMethod(razorpayPaymentDetails.method);
      }
    } catch (fetchError) {
      console.warn('Razorpay payment fetch failed; falling back to request-derived method.', fetchError);
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        payment: {
          create: {
            method: resolvedPaymentMethod,
            amount: totalAmount,
            status: 'COMPLETED'
          }
        },
        invoice: {
          create: {
            invoiceNumber: invoiceNum
          }
        }
      },
      include: { payment: true, invoice: true }
    });

    if (updated.payment) {
      console.log('Razorpay payment verified for booking', id, {
        method: updated.payment.method,
        amount: updated.payment.amount,
        status: updated.payment.status,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id
      });
    }

    return res.status(200).json({
      message: 'Payment verified and booking confirmed successfully.',
      booking: updated
    });
  } catch (error: any) {
    console.error('Verify Razorpay Payment Error:', error);
    return res.status(500).json({ message: 'Failed to verify payment.' });
  }
};
