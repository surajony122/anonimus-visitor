import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import React from "react";
import {
  Page,
  Layout,
  LegacyCard,
  Grid,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Divider,
  List,
  DataTable,
  Button,
} from "@shopify/polaris";
import prisma from "../db.server";
import { calculateIntentScore } from "../services/intentEngine.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopDomain = "ravistore-shop.myshopify.com";
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session.shop;
  } catch {}

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return json({ highIntentVisitors: [] });
  }

  const visitors = await prisma.visitor.findMany({
    where: { shopId: shop.id },
    include: {
      sessions: true,
      events: true,
      identities: true,
      customerLinks: { include: { customer: true } },
    },
    orderBy: { lastSeenAt: "desc" },
  });

  const highIntentList = visitors
    .map((v) => {
      const pViews = v.events.filter((e) => e.eventType === "product_viewed").length;
      const uniqueProductIds = new Set(
        v.events
          .filter((e) => e.eventType === "product_viewed" && e.productId)
          .map((e) => e.productId!)
      );
      const repeatViews = Math.max(0, pViews - uniqueProductIds.size);
      const cViews = v.events.filter((e) => e.eventType === "collection_viewed").length;
      const searches = v.events.filter((e) => e.eventType === "search_submitted").length;
      const addToCart = v.events.filter((e) => e.eventType === "product_added_to_cart").length;
      const cartViews = v.events.filter((e) => e.eventType === "cart_viewed").length;
      const checkouts = v.events.filter((e) => e.eventType === "checkout_started").length;
      const checkoutsCompleted = v.events.filter((e) => e.eventType === "checkout_completed").length;

      let cartVal = 0;
      v.events.forEach((e) => {
        if (e.metadata) {
          try {
            const meta = JSON.parse(e.metadata);
            if (meta.cartValue || meta.price) {
              cartVal = Math.max(cartVal, Number(meta.cartValue || meta.price || 0));
            }
          } catch {}
        }
      });

      const intent = calculateIntentScore({
        productViewsCount: pViews,
        repeatProductViews: repeatViews,
        collectionViewsCount: cViews,
        searchesCount: searches,
        addedToCartCount: addToCart,
        cartViewedCount: cartViews,
        cartValue: cartVal,
        checkoutStartedCount: checkouts,
        checkoutCompletedCount: checkoutsCompleted,
        sessionsCount: v.sessions.length || 1,
      });

      const primaryEmail = v.identities.find((i) => i.identityType === "email")?.identityValueEncrypted || null;
      const customer = v.customerLinks[0]?.customer || null;

      return {
        id: v.id,
        visitorId: v.visitorId,
        status: v.status,
        productsViewedCount: pViews,
        uniqueProductsCount: uniqueProductIds.size,
        cartEventsCount: addToCart,
        cartValue: cartVal,
        sessionsCount: v.sessions.length,
        intentScore: intent.score,
        intentTier: intent.tier,
        primaryEmail,
        customer,
      };
    })
    .filter((v) => v.intentTier === "high" || v.intentTier === "very_high");

  return json({ highIntentVisitors: highIntentList });
};

export default function IntentAnalyticsRoute() {
  const { highIntentVisitors } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const rows = highIntentVisitors.map((v: any) => {
    return [
      <BlockStack key={`hiv_${v.id}`} gap="100">
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {v.status === "identified"
            ? v.customer?.firstName || v.primaryEmail || "Identified Customer"
            : `Anonymous #${v.visitorId.substring(0, 8)}`}
        </Text>
        <Text variant="bodySm" tone="subdued" as="span">
          {`Status: ${v.status}`}
        </Text>
      </BlockStack>,
      <Badge tone="success">{`${v.intentScore}/100`}</Badge>,
      `${v.productsViewedCount} products (${v.uniqueProductsCount} unique)`,
      v.cartEventsCount > 0 ? `${v.cartEventsCount} items ($${v.cartValue})` : "0 items",
      `${v.sessionsCount} sessions`,
      <Button size="slim" onClick={() => navigate(`/app/visitors/${v.visitorId}`)}>
        Inspect Intent Journey
      </Button>,
    ];
  });

  return (
    <Page
      title="Visitor Intent Intelligence"
      subtitle="Autonomous behavioral intent scoring based on first-party storefront engagement signals"
    >
      <BlockStack gap="400">
        <Layout>
          <Layout.Section>
            <LegacyCard title="Behavioral Intent Scoring Rules & Weights" sectioned>
              <BlockStack gap="300">
                <Text variant="bodyMd" as="p">
                  The Intent Engine aggregates micro-conversions and repeated interactions to calculate a real-time propensity score (0–100):
                </Text>
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                    <BlockStack gap="200">
                      <Text variant="headingXs" as="h4">Product Engagement Factors</Text>
                      <List type="bullet">
                        <List.Item>Single Product View: <strong>+5 pts</strong></List.Item>
                        <List.Item>Repeated View on Same SKU: <strong>+10 pts</strong></List.Item>
                        <List.Item>Collection Browsing: <strong>+2 pts</strong></List.Item>
                        <List.Item>Storefront Search Query: <strong>+4 pts</strong></List.Item>
                      </List>
                    </BlockStack>
                  </Grid.Cell>

                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                    <BlockStack gap="200">
                      <Text variant="headingXs" as="h4">High-Conversion Factors</Text>
                      <List type="bullet">
                        <List.Item>Product Added to Cart: <strong>+25 pts</strong></List.Item>
                        <List.Item>Cart Page / Drawer Viewed: <strong>+15 pts</strong></List.Item>
                        <List.Item>High Cart Value ($100+): <strong>+15 pts</strong></List.Item>
                        <List.Item>Checkout Flow Initiated: <strong>+30 pts</strong></List.Item>
                      </List>
                    </BlockStack>
                  </Grid.Cell>
                </Grid>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <LegacyCard title="Intent Tiers" sectioned>
              <BlockStack gap="200">
                <div>
                  <InlineStack align="space-between">
                    <Badge tone="success">Very High Intent (81-100)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Ready to buy, checkout initiated</Text>
                </div>
                <Divider />
                <div>
                  <InlineStack align="space-between">
                    <Badge tone="attention">High Intent (61-80)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Multiple repeat product views or cart</Text>
                </div>
                <Divider />
                <div>
                  <InlineStack align="space-between">
                    <Badge tone="info">Medium Intent (31-60)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Browsing categories and catalog</Text>
                </div>
                <Divider />
                <div>
                  <InlineStack align="space-between">
                    <Badge>Low Intent (0-30)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Casual single-page visitors</Text>
                </div>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>
        </Layout>

        <LegacyCard title={`High & Very High Intent Visitors (${highIntentVisitors.length})`} sectioned>
          <BlockStack gap="300">
            <Text variant="bodySm" tone="subdued" as="p">
              Prioritized list of anonymous and identified shoppers showing strong conversion intent.
            </Text>
            {highIntentVisitors.length === 0 ? (
              <Text variant="bodyMd" tone="subdued" as="p">No high-intent visitors detected yet.</Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                headings={["Visitor / Customer", "Score", "Product Engagement", "Cart Status", "Sessions", "Action"]}
                rows={rows as any}
              />
            )}
          </BlockStack>
        </LegacyCard>
      </BlockStack>
    </Page>
  );
}
