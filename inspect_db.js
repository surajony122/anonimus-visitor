const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
  try {
    const shops = await prisma.shop.findMany();
    const visitorCount = await prisma.visitor.count();
    const eventCount = await prisma.event.count();
    const sessionCount = await prisma.storefrontSession.count();
    const identityCount = await prisma.visitorIdentity.count();
    const customerCount = await prisma.customer.count();
    const linkCount = await prisma.customerVisitorLink.count();

    console.log('=== DATABASE DATA COUNTS ===');
    console.log('Shops in DB:', shops.length, shops.map(s => ({ domain: s.shopDomain, currency: s.currencyCode })));
    console.log('Total Visitors:', visitorCount);
    console.log('Total Events:', eventCount);
    console.log('Total Sessions:', sessionCount);
    console.log('Total Identities (Emails/Phones):', identityCount);
    console.log('Total Customers:', customerCount);
    console.log('Total Customer Links:', linkCount);

    if (visitorCount > 0) {
      const recentVisitors = await prisma.visitor.findMany({
        take: 5,
        orderBy: { lastSeenAt: 'desc' },
        include: {
          identities: true,
          sessions: true,
          events: { take: 3 }
        }
      });
      console.log('\n=== RECENT VISITORS SAMPLE ===');
      console.log(JSON.stringify(recentVisitors, null, 2));
    }

    if (eventCount > 0) {
      const recentEvents = await prisma.event.findMany({
        take: 5,
        orderBy: { timestamp: 'desc' }
      });
      console.log('\n=== RECENT EVENTS SAMPLE ===');
      console.log(JSON.stringify(recentEvents, null, 2));
    }

  } catch (err) {
    console.error('Database inspection error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

inspect();
