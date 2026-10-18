import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { getBlockingBookingStatusWhere, getReservationOverlapWhere } from '../utils/bookingAvailability';

// Add new car (Admin Only)
export const createCar = async (req: Request, res: Response) => {
  try {
    const { name, type, transmission, pricePerDay, image, status, fuelType = 'Petrol', seatingCapacity = 5, displayOrder = 0 } = req.body;

    if (!name || !type || !transmission || !pricePerDay || !image) {
      return res.status(400).json({ message: 'All car fields are required.' });
    }

    if (!['Petrol', 'Diesel'].includes(fuelType) || !Number.isInteger(Number(seatingCapacity)) || Number(seatingCapacity) < 1 || Number(seatingCapacity) > 100 || !Number.isInteger(Number(displayOrder)) || Number(displayOrder) < 0) {
      return res.status(400).json({ message: 'Fuel type, seating capacity, or display order is invalid.' });
    }

    const newCar = await prisma.car.create({
      data: {
        name,
        type, // Hatchback, Sedan, SUV, Luxury
        transmission, // Manual, Automatic
        fuelType,
        seatingCapacity: Number(seatingCapacity),
        displayOrder: Number(displayOrder),
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
    cars.sort((first, second) =>
      (first.displayOrder ?? 0) - (second.displayOrder ?? 0)
      || second.createdAt.getTime() - first.createdAt.getTime()
    );

    const now = new Date();

    // Only unexpired holds and confirmed trips should affect current fleet availability.
    const activeBookingsToday = await prisma.booking.findMany({
      where: {
        ...getReservationOverlapWhere(now, new Date(now.getTime() + 1), now)
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
    const { name, type, transmission, pricePerDay, image, status, fuelType, seatingCapacity, displayOrder } = req.body;

    const existingCar = await prisma.car.findUnique({ where: { id } });
    if (!existingCar) {
      return res.status(404).json({ message: 'Vehicle not found.' });
    }

    if (fuelType !== undefined && !['Petrol', 'Diesel'].includes(fuelType)) {
      return res.status(400).json({ message: 'Fuel type must be Petrol or Diesel.' });
    }
    if (seatingCapacity !== undefined && (!Number.isInteger(Number(seatingCapacity)) || Number(seatingCapacity) < 1 || Number(seatingCapacity) > 100)) {
      return res.status(400).json({ message: 'Seating capacity must be a whole number between 1 and 100.' });
    }
    if (displayOrder !== undefined && (!Number.isInteger(Number(displayOrder)) || Number(displayOrder) < 0)) {
      return res.status(400).json({ message: 'Display order must be a non-negative whole number.' });
    }

    const updatedCar = await prisma.car.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existingCar.name,
        type: type !== undefined ? type : existingCar.type,
        transmission: transmission !== undefined ? transmission : existingCar.transmission,
        fuelType: fuelType !== undefined ? fuelType : existingCar.fuelType,
        seatingCapacity: seatingCapacity !== undefined ? Number(seatingCapacity) : existingCar.seatingCapacity,
        displayOrder: displayOrder !== undefined ? Number(displayOrder) : existingCar.displayOrder,
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
    const now = new Date();
    const activeBooking = await prisma.booking.findFirst({
      where: {
        carId: id,
        toDate: { gt: now },
        ...getBlockingBookingStatusWhere(now)
      }
    });

    if (activeBooking) {
      return res.status(400).json({ message: 'Cannot delete vehicle. It is currently locked in an active booking.' });
    }

    // Prisma MongoDB does not automatically cascade delete relations that don't have onDelete: Cascade
    // We must manually delete the bookings associated with this car.
    // (Documents, Agreements, Payments, Invoices cascade from Booking automatically if configured in schema)
    await prisma.booking.deleteMany({ where: { carId: id } });

    await prisma.car.delete({ where: { id } });
    return res.status(200).json({ message: 'Vehicle and all its historical bookings deleted from fleet successfully.' });
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
      where: filters
    });
    cars.sort((first, second) =>
      (first.displayOrder ?? 0) - (second.displayOrder ?? 0)
      || first.pricePerDay - second.pricePerDay
    );

    // If dates are provided, verify availability against bookings
    if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      const end = new Date(toDate as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: 'Invalid pickup or return date parameters.' });
      }

      if (start >= end) {
        return res.status(400).json({ message: 'Return date and time must be after pickup date and time.' });
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
          carId: { in: cars.map(car => car.id) },
          ...getReservationOverlapWhere(start, end)
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
