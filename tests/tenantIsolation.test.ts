import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../src/server/db/client';
import { v4 as uuidv4 } from 'uuid';

describe('Multi-Tenant Isolation Verification', () => {
  let storeAId: string;
  let storeBId: string;

  beforeAll(async () => {
    const storeA = await prisma.shop.upsert({
      where: { shopDomain: 'store-a.myshopify.com' },
      update: {},
      create: { shopDomain: 'store-a.myshopify.com' },
    });
    const storeB = await prisma.shop.upsert({
      where: { shopDomain: 'store-b.myshopify.com' },
      update: {},
      create: { shopDomain: 'store-b.myshopify.com' },
    });
    storeAId = storeA.id;
    storeBId = storeB.id;
  });

  it('guarantees Store A queries never leak or return Store B visitors or events', async () => {
    const vidA = uuidv4();
    const vidB = uuidv4();

    // Create visitor in Store A
    await prisma.visitor.create({
      data: { shopId: storeAId, visitorId: vidA, status: 'anonymous' },
    });
    await prisma.event.create({
      data: { shopId: storeAId, visitorId: vidA, eventType: 'page_viewed' },
    });

    // Create visitor in Store B
    await prisma.visitor.create({
      data: { shopId: storeBId, visitorId: vidB, status: 'anonymous' },
    });
    await prisma.event.create({
      data: { shopId: storeBId, visitorId: vidB, eventType: 'page_viewed' },
    });

    // Query Store A
    const storeAVisitors = await prisma.visitor.findMany({ where: { shopId: storeAId } });
    const storeAEvents = await prisma.event.findMany({ where: { shopId: storeAId } });

    expect(storeAVisitors.some((v) => v.visitorId === vidA)).toBe(true);
    expect(storeAVisitors.some((v) => v.visitorId === vidB)).toBe(false);

    expect(storeAEvents.every((e) => e.shopId === storeAId)).toBe(true);
  });
});
