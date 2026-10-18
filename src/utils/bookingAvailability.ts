import { Prisma } from '@prisma/client';

export const ADMIN_REVIEW_HOLD_MS = 24 * 60 * 60 * 1000;
export const PAYMENT_HOLD_MS = 30 * 60 * 1000;

export const getBlockingBookingStatusWhere = (now: Date = new Date()): Prisma.BookingWhereInput => ({
  OR: [
    { status: { in: ['CONFIRMED', 'ACTIVE', 'COMPLETED'] } },
    {
      status: 'PENDING_ADMIN_APPROVAL',
      updatedAt: { gte: new Date(now.getTime() - ADMIN_REVIEW_HOLD_MS) }
    },
    {
      status: 'APPROVED_PENDING_PAYMENT',
      updatedAt: { gte: new Date(now.getTime() - PAYMENT_HOLD_MS) }
    }
  ]
});

export const getReservationOverlapWhere = (
  fromDate: Date,
  toDate: Date,
  now: Date = new Date(),
  excludeBookingId?: string
): Prisma.BookingWhereInput => ({
  ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
  fromDate: { lt: toDate },
  toDate: { gt: fromDate },
  ...getBlockingBookingStatusWhere(now)
});

export const isPaymentHoldExpired = (updatedAt: Date, now: Date = new Date()): boolean =>
  now.getTime() - updatedAt.getTime() >= PAYMENT_HOLD_MS;
