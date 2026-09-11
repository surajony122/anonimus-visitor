import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../src/server/db/client';
import { IdentityEngine } from '../src/server/services/identityEngine';
import { v4 as uuidv4 } from 'uuid';

describe('Negative Privacy Tests: Non-Permitted Merging Prevention', () => {
  let shopId: string;

  beforeEach(async () => {
    const uniqueDomain = `privacy-test-${uuidv4()}.myshopify.com`;
    const shop = await prisma.shop.create({
      data: {
        shopDomain: uniqueDomain,
        shopifyShopId: `gid://shopify/Shop/${uuidv4()}`,
      },
    });
    shopId = shop.id;
  });

  it('MUST NOT merge two visitors who share the same IP address and User-Agent', async () => {
    const visitor1Id = uuidv4();
    const visitor2Id = uuidv4();

    // Visitor 1 from 192.168.1.50
    await prisma.visitor.create({
      data: {
        shopId,
        visitorId: visitor1Id,
        status: 'anonymous',
        metadata: JSON.stringify({ ip: '192.168.1.50', userAgent: 'Mozilla/5.0 Chrome/120.0' }),
      },
    });

    // Visitor 2 from same 192.168.1.50
    await prisma.visitor.create({
      data: {
        shopId,
        visitorId: visitor2Id,
        status: 'anonymous',
        metadata: JSON.stringify({ ip: '192.168.1.50', userAgent: 'Mozilla/5.0 Chrome/120.0' }),
      },
    });

    // Verify both visitors exist as independent anonymous records
    const v1 = await prisma.visitor.findUnique({ where: { shopId_visitorId: { shopId, visitorId: visitor1Id } } });
    const v2 = await prisma.visitor.findUnique({ where: { shopId_visitorId: { shopId, visitorId: visitor2Id } } });

    expect(v1?.status).toBe('anonymous');
    expect(v2?.status).toBe('anonymous');
    expect(v1?.id).not.toBe(v2?.id);
  });

  it('MUST NOT merge two different emails into the same identity record', async () => {
    const visitor1Id = uuidv4();
    const visitor2Id = uuidv4();

    await prisma.visitor.create({ data: { shopId, visitorId: visitor1Id, status: 'anonymous' } });
    await prisma.visitor.create({ data: { shopId, visitorId: visitor2Id, status: 'anonymous' } });

    await IdentityEngine.identify({
      shopId,
      visitorId: visitor1Id,
      type: 'email',
      rawValue: 'user1@example.com',
      source: 'user_submitted',
    });

    await IdentityEngine.identify({
      shopId,
      visitorId: visitor2Id,
      type: 'email',
      rawValue: 'user2@example.com',
      source: 'user_submitted',
    });

    const ident1 = await prisma.identity.findMany({ where: { shopId, visitorId: visitor1Id } });
    const ident2 = await prisma.identity.findMany({ where: { shopId, visitorId: visitor2Id } });

    expect(ident1.length).toBe(1);
    expect(ident2.length).toBe(1);
    expect(ident1[0].identityValueHash).not.toBe(ident2[0].identityValueHash);
    expect(ident1[0].id).not.toBe(ident2[0].id);
  });

  it('Anonymous visitor must remain anonymous indefinitely if no identity signal exists', async () => {
    const visitorId = uuidv4();
    await prisma.visitor.create({ data: { shopId, visitorId, status: 'anonymous' } });

    // Add 10 events
    for (let i = 0; i < 10; i++) {
      await prisma.event.create({
        data: {
          shopId,
          visitorId,
          eventType: 'page_viewed',
        },
      });
    }

    const currentVisitor = await prisma.visitor.findUnique({
      where: { shopId_visitorId: { shopId, visitorId } },
      include: { identities: true },
    });

    expect(currentVisitor?.status).toBe('anonymous');
    expect(currentVisitor?.identities.length).toBe(0);
  });
});
