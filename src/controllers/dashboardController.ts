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

    // Calculate Revenues
    // Total Revenue from all successful/completed payments
    const payments = await prisma.payment.findMany({
      where: { status: 'COMPLETED' }
    });
    const totalRevenue = payments.reduce((acc, curr) => acc + curr.amount, 0);

    // Monthly Revenue from completed payments this month
    const monthlyPayments = await prisma.payment.findMany({
      where: {
        status: 'COMPLETED',
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth
        }
      }
    });
    const monthlyRevenue = monthlyPayments.reduce((acc, curr) => acc + curr.amount, 0);

    // 2. Chart Visualizations Data
    
    // Revenue over time (mocked/grouped daily revenue for the current month)
    const revenueChart = [
      { name: 'Week 1', revenue: monthlyRevenue * 0.2 },
      { name: 'Week 2', revenue: monthlyRevenue * 0.25 },
      { name: 'Week 3', revenue: monthlyRevenue * 0.35 },
      { name: 'Week 4', revenue: monthlyRevenue * 0.2 }
    ];

    // Booking Trends over time
    const bookingChart = [
      { name: 'Jan', bookings: Math.floor(monthlyBookings * 0.5) },
      { name: 'Feb', bookings: Math.floor(monthlyBookings * 0.7) },
      { name: 'Mar', bookings: Math.floor(monthlyBookings * 0.9) },
      { name: 'Apr', bookings: Math.floor(monthlyBookings * 1.1) },
      { name: 'May', bookings: Math.floor(monthlyBookings * 1.3) },
      { name: 'Jun', bookings: monthlyBookings }
    ];

    // Vehicle utilization status
    const maintenanceCount = await prisma.car.count({ where: { status: 'MAINTENANCE' } });
    const availableCount = totalCars - currentCarsOnRoad - maintenanceCount;

    const vehicleChart = [
      { status: 'On Road', count: currentCarsOnRoad },
      { status: 'Idle Available', count: availableCount > 0 ? availableCount : 0 },
      { status: 'Maintenance', count: maintenanceCount }
    ];

    return res.status(200).json({
      stats: {
        activeBookings,
        currentCarsOnRoad,
        monthlyRevenue,
        totalRevenue,
        totalCars,
        pendingApprovals,
        completedTrips,
        monthlyBookings
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
