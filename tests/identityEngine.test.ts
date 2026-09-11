import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../src/server/db/client';
import { IdentityEngine } from '../src/server/services/identityEngine';
import { CustomerMatcher } from '../src/server/services/customerMatcher';
import { v4 as uuidv4 } from 'uuid';

describe('Identity Engine & Resolution Service', () => {
  let shopId: string;

  beforeEach(async () => {
    const uniqueDomain = `test-store-${uuidv4()}.myshopify.com`;
    const shop = await prisma.shop.create({
      data: {
        shopDomain: uniqueDomain,
        shopifyShopId: `gid://shopify/Shop/${uuidv4()}`,
      },
    });
    shopId = shop.id;
  });

  it('tracks an anonymous visitor and subsequently resolves identity upon legitimate signal', async () => {
    const visitorId = uuidv4();

    // 1. Create anonymous visitor
    const visitor = await prisma.visitor.create({
      data: {
        shopId,
        visitorId,
        status: 'anonymous',
      },
    });
    expect(visitor.status).toBe('anonymous');

    // 2. Add Day 1 historical events
    await prisma.event.createMany({
      data: [
        { shopId, visitorId, eventType: 'page_viewed' },
        { shopId, visitorId, eventType: 'product_viewed', productId: 'prod_100' },
        { shopId, visitorId, eventType: 'product_added_to_cart', productId: 'prod_100' },
      ],
    });

    const initialEvents = await prisma.event.findMany({ where: { shopId, visitorId } });
    expect(initialEvents.length).toBe(3);

    // 3. Resolve identity on Day 3 via user submitted email
    const result = await IdentityEngine.identify({
      shopId,
      visitorId,
      type: 'email',
      rawValue: 'John.Doe@Example.com',
      source: 'user_submitted',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('newly_identified');
    expect(result.confidenceScore).toBe(100);

    // 4. Verify visitor is now identified and prior 3 events remain intact
    const updatedVisitor = await prisma.visitor.findUnique({
      where: { shopId_visitorId: { shopId, visitorId } },
      include: { events: true, identities: true, auditLogs: true },
    });

    expect(updatedVisitor?.status).toBe('identified');
    expect(updatedVisitor?.events.length).toBe(3);
    expect(updatedVisitor?.identities.length).toBe(1);
    expect(updatedVisitor?.auditLogs.length).toBe(1);
    expect(updatedVisitor?.auditLogs[0].action).toBe('identity_created');
  });

  it('matches visitor to Shopify Customer profile when email matches', async () => {
    const visitorId = uuidv4();

    // Sync a customer in Shopify
    await CustomerMatcher.syncCustomer({
      shopId,
      shopifyCustomerId: 'gid://shopify/Customer/778899',
      email: 'alex@example.com',
      firstName: 'Alex',
      lastName: 'Wong',
      ordersCount: 2,
      totalSpent: 120.0,
    });

    // Create anonymous visitor
    await prisma.visitor.create({
      data: { shopId, visitorId, status: 'anonymous' },
    });

    // Visitor identifies with matching email
    const result = await IdentityEngine.identify({
      shopId,
      visitorId,
      type: 'email',
      rawValue: 'alex@example.com',
      source: 'checkout',
    });

    expect(result.matchedCustomer?.shopifyCustomerId).toBe('gid://shopify/Customer/778899');

    // Check link in DB
    const link = await prisma.visitorCustomerLink.findUnique({
      where: {
        shopId_visitorId_shopifyCustomerId: {
          shopId,
          visitorId,
          shopifyCustomerId: 'gid://shopify/Customer/778899',
        },
      },
    });
    expect(link).not.toBeNull();
    expect(link?.confidenceScore).toBe(100);
  });
});
