import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const chartStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
      return { date, key: `${date.getFullYear()}-${date.getMonth()}` };
    });

    const [
      totalCars,
      activeBookings,
      currentCarsOnRoad,
      pendingApprovals,
      completedTrips,
      monthlyBookings,
      validBookings,
      chartPayments,
      chartBookings,
      maintenanceCount,
      bookings,
      allCars,
      bookedUsers
    ] = await Promise.all([
      prisma.car.count(),
      prisma.booking.count({ where: { status: { in: ['CONFIRMED', 'ACTIVE'] } } }),
      prisma.booking.count({ where: { status: 'ACTIVE' } }),
      prisma.booking.count({ where: { status: 'PENDING_ADMIN_APPROVAL' } }),
      prisma.booking.count({ where: { status: { in: ['COMPLETED', 'CLOSED'] } } }),
      prisma.booking.count({ where: { createdAt: { gte: startOfMonth, lt: nextMonth } } }),
      prisma.booking.findMany({
        where: { status: { in: ['CONFIRMED', 'ACTIVE', 'COMPLETED', 'CLOSED'] } },
        select: {
          fromDate: true,
          toDate: true,
          createdAt: true,
          car: { select: { pricePerDay: true } }
        }
      }),
      prisma.payment.findMany({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: chartStart, lt: nextMonth }
        },
        select: { amount: true, createdAt: true }
      }),
      prisma.booking.findMany({
        where: { createdAt: { gte: chartStart, lt: nextMonth } },
        select: { createdAt: true }
      }),
      prisma.car.count({ where: { status: 'MAINTENANCE' } }),
      prisma.booking.findMany({ select: { carId: true } }),
      prisma.car.findMany({ select: { id: true, name: true } }),
      prisma.user.findMany({
        where: { role: 'CUSTOMER', bookings: { some: {} } },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          bookings: {
            select: {
              payment: { select: { status: true, amount: true } }
            }
          }
        }
      })
    ]);

    let totalRevenue = 0;
    let monthlyRevenue = 0;

    for (const b of validBookings) {
      const diff = b.toDate.getTime() - b.fromDate.getTime();
      const days = Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000)));
      const subtotal = b.car.pricePerDay * days;
      const amount = subtotal + Math.round(subtotal * 0.05);

      totalRevenue += amount;

      if (b.createdAt >= startOfMonth && b.createdAt < nextMonth) {
        monthlyRevenue += amount;
      }
    }

    // Build the six-month charts from one bounded query per collection.
    const revenueByMonth = new Map<string, number>();
    for (const payment of chartPayments) {
      const key = `${payment.createdAt.getFullYear()}-${payment.createdAt.getMonth()}`;
      revenueByMonth.set(key, (revenueByMonth.get(key) || 0) + payment.amount);
    }
    const bookingsByMonth = new Map<string, number>();
    for (const booking of chartBookings) {
      const key = `${booking.createdAt.getFullYear()}-${booking.createdAt.getMonth()}`;
      bookingsByMonth.set(key, (bookingsByMonth.get(key) || 0) + 1);
    }
    const revenueChart = months.map(({ date, key }) => ({
      name: monthNames[date.getMonth()],
      revenue: revenueByMonth.get(key) || 0
    }));
    const bookingChart = months.map(({ date, key }) => ({
      name: monthNames[date.getMonth()],
      bookings: bookingsByMonth.get(key) || 0
    }));

    // Vehicle utilization status
    const availableCount = totalCars - currentCarsOnRoad - maintenanceCount;

    const vehicleChart = [
      { status: 'On Road', count: currentCarsOnRoad },
      { status: 'Idle Available', count: availableCount > 0 ? availableCount : 0 },
      { status: 'Maintenance', count: maintenanceCount }
    ];

    // Calculate most and least booked cars
    const carCounts: { [key: string]: { name: string; count: number } } = {};

    for (const c of allCars) {
      carCounts[c.id] = { name: c.name, count: 0 };
    }

    for (const b of bookings) {
      if (carCounts[b.carId]) {
        carCounts[b.carId].count++;
      }
    }

    const sortedCars = Object.values(carCounts).sort((a, b) => b.count - a.count);
    const mostBooked = sortedCars.length > 0 ? sortedCars[0] : { name: 'N/A', count: 0 };
    const leastBooked = sortedCars.length > 0 ? sortedCars[sortedCars.length - 1] : { name: 'N/A', count: 0 };

    const userDetails = bookedUsers.map(u => {
      const bookingsCount = u.bookings.length;
      const totalSpend = u.bookings.reduce((sum, b) => {
        if (b.payment && b.payment.status === 'COMPLETED') {
          return sum + b.payment.amount;
        }
        return sum;
      }, 0);

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone || 'N/A',
        bookingsCount,
        totalSpend
      };
    });

    return res.status(200).json({
      stats: {
        activeBookings,
        currentCarsOnRoad,
        monthlyRevenue,
        totalRevenue,
        totalCars,
        pendingApprovals,
        completedTrips,
        monthlyBookings,
        mostBooked,
        leastBooked,
        userDetails
      },
      charts: {
        revenueChart,
        bookingChart,
        vehicleChart
      }
    });
  } catch (error: any) {
    console.error('Fetch Stats Error:', error);
    return res.status(500).json({ message: 'Failed to aggregate dashboard metrics.' });
  }
};
