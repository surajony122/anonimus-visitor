import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../src/server/db/client';
import { RetentionService } from '../src/server/services/retentionService';
import { v4 as uuidv4 } from 'uuid';

describe('Retention & Privacy Erasure Service', () => {
  let shopId: string;

  beforeAll(async () => {
    const shop = await prisma.shop.upsert({
      where: { shopDomain: 'retention-test-store.myshopify.com' },
      update: {},
      create: {
        shopDomain: 'retention-test-store.myshopify.com',
        privacySettings: {
          create: {
            retentionDays: 30,
          },
        },
      },
    });
    shopId = shop.id;
  });

  it('erases single visitor and all associated records on GDPR erasure request', async () => {
    const visitorId = uuidv4();

    await prisma.visitor.create({
      data: { shopId, visitorId, status: 'anonymous' },
    });

    await prisma.event.createMany({
      data: [
        { shopId, visitorId, eventType: 'page_viewed' },
        { shopId, visitorId, eventType: 'product_viewed' },
      ],
    });

    const eventsBefore = await prisma.event.findMany({ where: { shopId, visitorId } });
    expect(eventsBefore.length).toBe(2);

    const deleteRes = await RetentionService.deleteVisitorData(shopId, visitorId);
    expect(deleteRes.success).toBe(true);

    const eventsAfter = await prisma.event.findMany({ where: { shopId, visitorId } });
    const visitorAfter = await prisma.visitor.findUnique({
      where: { shopId_visitorId: { shopId, visitorId } },
    });

    expect(eventsAfter.length).toBe(0);
    expect(visitorAfter).toBeNull();
  });
});
