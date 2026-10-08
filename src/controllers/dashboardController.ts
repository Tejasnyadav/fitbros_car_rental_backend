import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // 1. Metric Counts
    const totalCars = await prisma.car.count();

    const activeBookings = await prisma.booking.count({
      where: {
        status: { in: ['CONFIRMED', 'ACTIVE'] }
      }
    });

    const currentCarsOnRoad = await prisma.booking.count({
      where: {
        status: 'ACTIVE'
      }
    });

    const pendingApprovals = await prisma.booking.count({
      where: {
        status: 'PENDING_ADMIN_APPROVAL'
      }
    });

    const completedTrips = await prisma.booking.count({
      where: {
        status: { in: ['COMPLETED', 'CLOSED'] }
      }
    });

    const monthlyBookings = await prisma.booking.count({
      where: {
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth
        }
      }
    });

    // Calculate Revenues from Bookings instead of just Payments to reflect all confirmed/completed trips
    const validBookings = await prisma.booking.findMany({
      where: {
        status: { in: ['CONFIRMED', 'ACTIVE', 'COMPLETED', 'CLOSED'] }
      },
      include: { car: true }
    });

    let totalRevenue = 0;
    let monthlyRevenue = 0;

    for (const b of validBookings) {
      const diff = b.toDate.getTime() - b.fromDate.getTime();
      const days = Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
      const subtotal = b.car.pricePerDay * days;
      const amount = subtotal + Math.round(subtotal * 0.1); // Including 10% tax/fee like in bookingController

      totalRevenue += amount;

      if (b.createdAt >= startOfMonth && b.createdAt <= endOfMonth) {
        monthlyRevenue += amount;
      }
    }

    // 2. Chart Visualizations Data
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Revenue over time (last 6 months)
    const revenueChart = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      
      const monthPayments = await prisma.payment.findMany({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: start, lte: end }
        }
      });
      const rev = monthPayments.reduce((sum, p) => sum + p.amount, 0);
      revenueChart.push({
        name: monthNames[d.getMonth()],
        revenue: rev
      });
    }

    // Booking Trends over time (last 6 months)
    const bookingChart = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      
      const count = await prisma.booking.count({
        where: {
          createdAt: { gte: start, lte: end }
        }
      });
      bookingChart.push({
        name: monthNames[d.getMonth()],
        bookings: count
      });
    }

    // Vehicle utilization status
    const maintenanceCount = await prisma.car.count({ where: { status: 'MAINTENANCE' } });
    const availableCount = totalCars - currentCarsOnRoad - maintenanceCount;

    const vehicleChart = [
      { status: 'On Road', count: currentCarsOnRoad },
      { status: 'Idle Available', count: availableCount > 0 ? availableCount : 0 },
      { status: 'Maintenance', count: maintenanceCount }
    ];

    // Calculate most and least booked cars
    const bookings = await prisma.booking.findMany({
      select: { carId: true }
    });

    const carCounts: { [key: string]: { name: string; count: number } } = {};
    const allCars = await prisma.car.findMany({ select: { id: true, name: true } });
    
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

    // Query user details with spending and booking count
    const bookedUsers = await prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        bookings: { some: {} }
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        bookings: {
          select: {
            payment: {
              select: {
                status: true,
                amount: true
              }
            }
          }
        }
      }
    });

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
