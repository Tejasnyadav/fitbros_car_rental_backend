const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const p = await prisma.payment.findMany();
  console.log('All payments:', p);
  const bookings = await prisma.booking.findMany({ include: { payment: true, car: true }});
  for(let x of bookings) {
    console.log(`Booking ID: ${x.id}, Status: ${x.status}, Payment Status: ${x.payment?.status}, Amount: ${x.payment?.amount}`);
  }
}
main().finally(()=>prisma.$disconnect());
