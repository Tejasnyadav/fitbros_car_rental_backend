import { Request, Response } from 'express';
import prisma from '../config/prisma';

// Add new car (Admin Only)
export const createCar = async (req: Request, res: Response) => {
  try {
    const { name, type, transmission, pricePerDay, image, status } = req.body;

    if (!name || !type || !transmission || !pricePerDay || !image) {
      return res.status(400).json({ message: 'All car fields are required.' });
    }

    const newCar = await prisma.car.create({
      data: {
        name,
        type, // Hatchback, Sedan, SUV, Luxury
        transmission, // Manual, Automatic
        pricePerDay: parseFloat(pricePerDay),
        image,
        status: status || 'AVAILABLE'
      }
    });

    return res.status(201).json({ message: 'Car added to fleet successfully.', car: newCar });
  } catch (error: any) {
    console.error('Create Car Error:', error);
    return res.status(500).json({ message: 'Failed to add vehicle to fleet.' });
  }
};

// Get all cars (Admin Fleet Manager)
export const getAllCarsForAdmin = async (req: Request, res: Response) => {
  try {
    const cars = await prisma.car.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const now = new Date();

    // Query active/confirmed bookings overlapping the current timestamp
    const activeBookingsToday = await prisma.booking.findMany({
      where: {
        status: { notIn: ['REJECTED', 'CLOSED'] },
        fromDate: { lte: now },
        toDate: { gte: now }
      },
      select: {
        carId: true,
        status: true
      }
    });

    // Create a map of carId to status today
    const bookingStatusMap = new Map(activeBookingsToday.map(b => [b.carId, b.status]));

    const carsWithAvailability = cars.map(car => {
      const activeStatusToday = bookingStatusMap.get(car.id);
      
      let availabilityMessage = 'Available';
      let isAvailable = true;

      if (car.status === 'MAINTENANCE') {
        availabilityMessage = 'Maintenance';
        isAvailable = false;
      } else if (activeStatusToday) {
        isAvailable = false;
        if (activeStatusToday === 'ACTIVE') {
          availabilityMessage = 'On Trip';
        } else if (activeStatusToday === 'CONFIRMED') {
          availabilityMessage = 'Booked';
        } else {
          availabilityMessage = 'Reserved'; // e.g. APPROVED_PENDING_PAYMENT, PENDING_ADMIN_APPROVAL
        }
      }

      return {
        ...car,
        isAvailable,
        availabilityMessage
      };
    });

    return res.status(200).json({ cars: carsWithAvailability });
  } catch (error: any) {
    console.error('Fetch Cars Admin Error:', error);
    return res.status(500).json({ message: 'Failed to fetch fleet.' });
  }
};

// Update Car (Admin Only)
export const updateCar = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, transmission, pricePerDay, image, status } = req.body;

    const existingCar = await prisma.car.findUnique({ where: { id } });
    if (!existingCar) {
      return res.status(404).json({ message: 'Vehicle not found.' });
    }

    const updatedCar = await prisma.car.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existingCar.name,
        type: type !== undefined ? type : existingCar.type,
        transmission: transmission !== undefined ? transmission : existingCar.transmission,
        pricePerDay: pricePerDay !== undefined ? parseFloat(pricePerDay) : existingCar.pricePerDay,
        image: image !== undefined ? image : existingCar.image,
        status: status !== undefined ? status : existingCar.status
      }
    });

    return res.status(200).json({ message: 'Car details updated successfully.', car: updatedCar });
  } catch (error: any) {
    console.error('Update Car Error:', error);
    return res.status(500).json({ message: 'Failed to update vehicle details.' });
  }
};

// Delete Car (Admin Only)
export const deleteCar = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingCar = await prisma.car.findUnique({ where: { id } });
    if (!existingCar) {
      return res.status(404).json({ message: 'Vehicle not found.' });
    }

    // Optionally check if vehicle has active bookings before deletion
    const activeBooking = await prisma.booking.findFirst({
      where: {
        carId: id,
        status: { in: ['CONFIRMED', 'ACTIVE', 'PENDING_ADMIN_APPROVAL', 'APPROVED_PENDING_PAYMENT'] }
      }
    });

    if (activeBooking) {
      return res.status(400).json({ message: 'Cannot delete vehicle. It is currently locked in an active booking.' });
    }

    await prisma.car.delete({ where: { id } });
    return res.status(200).json({ message: 'Vehicle deleted from fleet successfully.' });
  } catch (error: any) {
    console.error('Delete Car Error:', error);
    return res.status(500).json({ message: 'Failed to delete vehicle.' });
  }
};

// List Cars with Date Range Availability Check (User Catalog)
export const getCarsForUser = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, type, transmission } = req.query;

    // Filters object for Prisma
    const filters: any = {
      status: 'AVAILABLE' // Must be active fleet
    };

    if (type) {
      filters.type = { in: (type as string).split(',') };
    }
    if (transmission) {
      filters.transmission = transmission as string;
    }

    // Get all cars matching types/transmissions
    const cars = await prisma.car.findMany({
      where: filters,
      orderBy: { pricePerDay: 'asc' }
    });

    // If dates are provided, verify availability against bookings
    if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      const end = new Date(toDate as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: 'Invalid pickup or return date parameters.' });
      }

      const startYear = start.getFullYear();
      const endYear = end.getFullYear();
      if (startYear < 2000 || startYear > 2100 || endYear < 2000 || endYear > 2100) {
        return res.status(400).json({ message: 'Selected dates must be within a realistic timeframe.' });
      }

      // Query bookings overlapping this window
      // Overlap formula: start <= booking.toDate AND end >= booking.fromDate
      const overlappingBookings = await prisma.booking.findMany({
        where: {
          status: { notIn: ['REJECTED', 'CLOSED'] },
          fromDate: { lte: end },
          toDate: { gte: start }
        },
        select: {
          carId: true
        }
      });

      // Map unique unavailable car IDs
      const bookedCarIds = new Set(overlappingBookings.map(b => b.carId));

      const carsWithAvailability = cars.map(car => ({
        ...car,
        isAvailable: !bookedCarIds.has(car.id),
        availabilityMessage: bookedCarIds.has(car.id) 
          ? 'Already booked for selected dates' 
          : 'Available'
      }));

      return res.status(200).json({ cars: carsWithAvailability });
    }

    // If no dates provided, flag everything as available (requires date entry)
    const carsWithAvailability = cars.map(car => ({
      ...car,
      isAvailable: true,
      availabilityMessage: 'Select dates to verify availability'
    }));

    return res.status(200).json({ cars: carsWithAvailability });
  } catch (error: any) {
    console.error('Fetch User Cars Error:', error);
    return res.status(500).json({ message: 'Failed to search fleet catalog.' });
  }
};
