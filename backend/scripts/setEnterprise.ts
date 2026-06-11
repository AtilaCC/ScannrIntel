import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'atilacostacorrea@gmail.com';
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error('User not found'); process.exit(1); }

  const sub = await prisma.subscription.upsert({
    where:  { userId: user.id },
    update: { plan: 'ENTERPRISE', status: 'ACTIVE' },
    create: {
      userId:             user.id,
      plan:               'ENTERPRISE',
      status:             'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd:   new Date('2035-01-01'),
    },
  });
  console.log('✅ Plan updated to ENTERPRISE:', sub.plan);
  await prisma.$disconnect();
}

main().catch(console.error);
