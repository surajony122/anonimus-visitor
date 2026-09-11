import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Grid,
  Text,
  Badge,
  ProgressBar,
  Banner,
  Button,
  InlineStack,
  BlockStack,
  Divider,
} from "@shopify/polaris";
import { Users, UserCheck, TrendingUp, Sparkles, Activity } from "lucide-react";
import prisma from "../db.server";
import { calculateIntentScore } from "../services/intentEngine.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain,
        shopifyShopId: "gid://shopify/Shop/1234567890",
        installedAt: new Date(),
        privacySettings: {
          create: {
            retentionDays: 90,
            trackingEnabled: true,
            analyticsEnabled: true,
          },
        },
      },
    });
  }

  const shopId = shop.id;

  const [
    totalVisitors,
    anonymousVisitors,
    identifiedVisitors,
    totalSessions,
    totalEvents,
    pageViews,
    productViews,
    addCartEvents,
    checkoutEvents,
    completedOrders,
    allVisitors,
  ] = await Promise.all([
    prisma.visitor.count({ where: { shopId } }),
    prisma.visitor.count({ where: { shopId, status: "anonymous" } }),
    prisma.visitor.count({ where: { shopId, status: "identified" } }),
    prisma.storefrontSession.count({ where: { shopId } }),
    prisma.event.count({ where: { shopId } }),
    prisma.event.count({ where: { shopId, eventType: "page_viewed" } }),
    prisma.event.count({ where: { shopId, eventType: "product_viewed" } }),
    prisma.event.count({ where: { shopId, eventType: "product_added_to_cart" } }),
    prisma.event.count({ where: { shopId, eventType: "checkout_started" } }),
    prisma.event.count({ where: { shopId, eventType: "checkout_completed" } }),
    prisma.visitor.findMany({
      where: { shopId },
      include: { events: true, sessions: true },
    }),
  ]);

  const identificationRate =
    totalVisitors > 0 ? ((identifiedVisitors / totalVisitors) * 100).toFixed(1) : "0.0";

  let lowIntent = 0;
  let mediumIntent = 0;
  let highIntent = 0;
  let veryHighIntent = 0;

  allVisitors.forEach((v) => {
    const pViews = v.events.filter((e) => e.eventType === "product_viewed").length;
    const addToCart = v.events.filter((e) => e.eventType === "product_added_to_cart").length;
    const checkouts = v.events.filter((e) => e.eventType === "checkout_started").length;
    const checkoutsDone = v.events.filter((e) => e.eventType === "checkout_completed").length;

    const score = calculateIntentScore({
      productViewsCount: pViews,
      addedToCartCount: addToCart,
      checkoutStartedCount: checkouts,
      checkoutCompletedCount: checkoutsDone,
      sessionsCount: v.sessions.length,
    });

    if (score.tier === "very_high") veryHighIntent++;
    else if (score.tier === "high") highIntent++;
    else if (score.tier === "medium") mediumIntent++;
    else lowIntent++;
  });

  return json({
    shopDomain,
    summary: {
      totalVisitors,
      anonymousVisitors,
      identifiedVisitors,
      identificationRate: `${identificationRate}%`,
      totalSessions,
      totalEvents,
      highIntentVisitors: highIntent + veryHighIntent,
    },
    funnel: {
      pageViews,
      productViews,
      addToCarts: addCartEvents,
      checkoutsStarted: checkoutEvents,
      ordersCompleted: completedOrders,
    },
    intentDistribution: {
      low: lowIntent,
      medium: mediumIntent,
      high: highIntent,
      veryHigh: veryHighIntent,
    },
  });
};

export default function OverviewDashboard() {
  const { shopDomain, summary, funnel, intentDistribution } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const totalIntent =
    (intentDistribution.low +
      intentDistribution.medium +
      intentDistribution.high +
      intentDistribution.veryHigh) || 1;

  return (
    <Page
      title="Storefront Visitor Intelligence"
      subtitle={`Connected Store: ${shopDomain}`}
      primaryAction={{
        content: "Interactive Simulator",
        icon: Sparkles,
        onAction: () => navigate("/app/simulator"),
      }}
    >
      <BlockStack gap="500">
        <Banner title="Shopify Remix Architecture Active" tone="success">
          <p>
            Operating with official Shopify Remix framework, first-party tracking, deterministic identity graphs, and zero invasive browser snooping.
          </p>
        </Banner>

        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <LegacyCard sectioned>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingSm" as="h3">Total Visitors</Text>
                  <Users size={20} color="#5c5f62" />
                </InlineStack>
                <Text variant="headingXl" as="p">{String(summary.totalVisitors)}</Text>
                <Text variant="bodySm" tone="subdued" as="p">First-party persistent visitors</Text>
              </BlockStack>
            </LegacyCard>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <LegacyCard sectioned>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingSm" as="h3">Identification Rate</Text>
                  <UserCheck size={20} color="#008060" />
                </InlineStack>
                <InlineStack gap="200" align="start">
                  <Text variant="headingXl" as="p">{summary.identificationRate}</Text>
                  <Badge tone="success">{`${summary.identifiedVisitors} Known`}</Badge>
                </InlineStack>
                <Text variant="bodySm" tone="subdued" as="p">
                  {`${summary.anonymousVisitors} Anonymous`}
                </Text>
              </BlockStack>
            </LegacyCard>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <LegacyCard sectioned>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingSm" as="h3">High-Intent Visitors</Text>
                  <TrendingUp size={20} color="#d97706" />
                </InlineStack>
                <Text variant="headingXl" as="p">{String(summary.highIntentVisitors)}</Text>
                <Text variant="bodySm" tone="subdued" as="p">Propensity score &ge; 61/100</Text>
              </BlockStack>
            </LegacyCard>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <LegacyCard sectioned>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingSm" as="h3">Recorded Events</Text>
                  <Activity size={20} color="#2563eb" />
                </InlineStack>
                <Text variant="headingXl" as="p">{String(summary.totalEvents)}</Text>
                <Text variant="bodySm" tone="subdued" as="p">Storefront touchpoints</Text>
              </BlockStack>
            </LegacyCard>
          </Grid.Cell>
        </Grid>

        <Layout>
          <Layout.Section>
            <LegacyCard title="Storefront Activity Funnel" sectioned>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodyMd" as="span">Page Views</Text>
                    <Text variant="bodyMd" fontWeight="bold" as="span">{String(funnel.pageViews)}</Text>
                  </InlineStack>
                  <ProgressBar progress={100} size="small" tone="primary" />
                </BlockStack>

                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodyMd" as="span">Product Views</Text>
                    <Text variant="bodyMd" fontWeight="bold" as="span">{String(funnel.productViews)}</Text>
                  </InlineStack>
                  <ProgressBar
                    progress={funnel.pageViews > 0 ? (funnel.productViews / funnel.pageViews) * 100 : 0}
                    size="small"
                    tone="primary"
                  />
                </BlockStack>

                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodyMd" as="span">Add To Carts</Text>
                    <Text variant="bodyMd" fontWeight="bold" as="span">{String(funnel.addToCarts)}</Text>
                  </InlineStack>
                  <ProgressBar
                    progress={funnel.productViews > 0 ? (funnel.addToCarts / funnel.productViews) * 100 : 0}
                    size="small"
                    tone="highlight"
                  />
                </BlockStack>

                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodyMd" as="span">Checkouts Started</Text>
                    <Text variant="bodyMd" fontWeight="bold" as="span">{String(funnel.checkoutsStarted)}</Text>
                  </InlineStack>
                  <ProgressBar
                    progress={funnel.addToCarts > 0 ? (funnel.checkoutsStarted / funnel.addToCarts) * 100 : 0}
                    size="small"
                    tone="success"
                  />
                </BlockStack>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <LegacyCard title="Visitor Intent Distribution" sectioned>
              <BlockStack gap="300">
                <div>
                  <InlineStack align="space-between">
                    <Badge tone="success">Very High (81-100)</Badge>
                    <Text variant="bodyMd" fontWeight="bold" as="span">{String(intentDistribution.veryHigh)}</Text>
                  </InlineStack>
                  <ProgressBar progress={(intentDistribution.veryHigh / totalIntent) * 100} size="small" tone="success" />
                </div>

                <div>
                  <InlineStack align="space-between">
                    <Badge tone="attention">High (61-80)</Badge>
                    <Text variant="bodyMd" fontWeight="bold" as="span">{String(intentDistribution.high)}</Text>
                  </InlineStack>
                  <ProgressBar progress={(intentDistribution.high / totalIntent) * 100} size="small" tone="highlight" />
                </div>

                <div>
                  <InlineStack align="space-between">
                    <Badge tone="info">Medium (31-60)</Badge>
                    <Text variant="bodyMd" fontWeight="bold" as="span">{String(intentDistribution.medium)}</Text>
                  </InlineStack>
                  <ProgressBar progress={(intentDistribution.medium / totalIntent) * 100} size="small" tone="primary" />
                </div>

                <div>
                  <InlineStack align="space-between">
                    <Badge>Low (0-30)</Badge>
                    <Text variant="bodyMd" fontWeight="bold" as="span">{String(intentDistribution.low)}</Text>
                  </InlineStack>
                  <ProgressBar progress={(intentDistribution.low / totalIntent) * 100} size="small" />
                </div>

                <Divider />
                <Button fullWidth onClick={() => navigate("/app/visitors")}>
                  Explore Visitor Directory &rarr;
                </Button>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
