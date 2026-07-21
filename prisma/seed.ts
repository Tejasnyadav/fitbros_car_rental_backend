import { PrismaClient, CarStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Database...');

  // 1. Seed default Admin
  const adminEmail = 'admin@fitbros.com';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const hashedAdminPassword = await bcrypt.hash('FitBrosAdmin2026!', 10);
    const admin = await prisma.user.create({
      data: {
        name: 'FitBros Admin',
        email: adminEmail,
        phone: '+919999999999',
        password: hashedAdminPassword,
        role: 'ADMIN'
      }
    });
    console.log(`Admin user created: ${admin.email}`);
  } else {
    console.log('Admin user already exists.');
  }

  // 2. Seed initial vehicle fleet (Hatchback, Sedan, SUV, Luxury)
  const carsCount = await prisma.car.count();
  if (carsCount === 0) {
    const initialCars = [
      {
        name: 'Mini Cooper S',
        type: 'Hatchback',
        transmission: 'Automatic',
        pricePerDay: 4500,
        image: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=600',
        status: CarStatus.AVAILABLE
      },
      {
        name: 'BMW 3 Series Gran Limousine',
        type: 'Sedan',
        transmission: 'Automatic',
        pricePerDay: 8500,
        image: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&q=80&w=600',
        status: CarStatus.AVAILABLE
      },
      {
        name: 'Land Rover Defender',
        type: 'SUV',
        transmission: 'Automatic',
        pricePerDay: 15000,
        image: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=600',
        status: CarStatus.AVAILABLE
      },
      {
        name: 'Porsche 911 Carrera',
        type: 'Luxury',
        transmission: 'Automatic',
        pricePerDay: 25000,
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&q=80&w=600',
        status: CarStatus.AVAILABLE
      }
    ];

    for (const car of initialCars) {
      const created = await prisma.car.create({ data: car });
      console.log(`Car seeded: ${created.name} (${created.type})`);
    }
  } else {
    console.log('Cars fleet already contains vehicles.');
  }

  console.log('Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
