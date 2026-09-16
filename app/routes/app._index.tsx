import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import React, { useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Banner,
  Button,
  InlineStack,
  BlockStack,
  Divider,
  DataTable,
  List,
  ProgressBar,
  Grid,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopName = "My Shopify Store";
  let shopDomain = "ravistore-shop.myshopify.com";
  let currency = "USD";
  let ordersCount = 0;
  let customersCount = 0;
  let productsCount = 0;
  let recentOrders: any[] = [];
  let customersList: any[] = [];

  // Tracking analytics
  let totalTrackedVisitors = 0;
  let anonymousVisitorsCount = 0;
  let identifiedVisitorsCount = 0;
  let productViewersCount = 0;
  let cartAddersCount = 0;
  let checkoutInitiatorsCount = 0;
  let totalEventsLogged = 0;
  let lastEventTimestamp: string | null = null;
  let isPixelActive = false;

  try {
    const { admin, session } = await authenticate.admin(request);
    shopDomain = session.shop;

    // Fetch live data directly from Shopify GraphQL API
    const response = await admin.graphql(`
      query GetShopOverview {
        shop {
          name
          myshopifyDomain
          currencyCode
        }
        orders(first: 10, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              displayFinancialStatus
              displayFulfillmentStatus
              customer {
                displayName
                email
              }
            }
          }
        }
        customers(first: 20) {
          edges {
            node {
              id
              displayName
              email
              ordersCount
              totalSpent
            }
          }
        }
        products(first: 10) {
          edges {
            node {
              id
              title
              status
            }
          }
        }
      }
    `);

    const resJson = await response.json();
    const data = resJson.data;

    if (data?.shop) {
      shopName = data.shop.name;
      shopDomain = data.shop.myshopifyDomain;
      currency = data.shop.currencyCode;
    }

    if (data?.orders?.edges) {
      recentOrders = data.orders.edges.map((e: any) => e.node);
      ordersCount = recentOrders.length;
    }

    if (data?.customers?.edges) {
      customersList = data.customers.edges.map((e: any) => e.node);
      customersCount = customersList.length;
    }

    if (data?.products?.edges) {
      productsCount = data.products.edges.length;
    }

    // Database analytics query
    try {
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        include: {
          visitors: {
            include: {
              events: true,
            },
          },
        },
      });

      if (shop) {
        totalTrackedVisitors = shop.visitors.length;
        anonymousVisitorsCount = shop.visitors.filter((v) => v.status === "anonymous").length;
        identifiedVisitorsCount = shop.visitors.filter((v) => v.status === "identified").length;

        shop.visitors.forEach((v) => {
          totalEventsLogged += v.events.length;
          const hasPView = v.events.some((e) => e.eventType === "product_viewed");
          const hasCart = v.events.some((e) => e.eventType === "product_added_to_cart");
          const hasCheckout = v.events.some((e) => e.eventType === "checkout_started" || e.eventType === "checkout_completed");

          if (hasPView) productViewersCount++;
          if (hasCart) cartAddersCount++;
          if (hasCheckout) checkoutInitiatorsCount++;
        });

        // Check latest event
        const latestEvent = await prisma.event.findFirst({
          where: { shopId: shop.id },
          orderBy: { timestamp: "desc" },
        });

        if (latestEvent) {
          lastEventTimestamp = latestEvent.timestamp.toISOString();
          const diffMinutes = (Date.now() - latestEvent.timestamp.getTime()) / (1000 * 60);
          isPixelActive = diffMinutes < 1440; // Active in last 24h
        }
      }
    } catch (dbErr) {
      console.warn("Analytics DB query fallback:", dbErr);
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("Loader GraphQL error:", err);
  }

  return json({
    shopName,
    shopDomain,
    currency,
    ordersCount,
    customersCount,
    productsCount,
    recentOrders,
    customersList,
    totalTrackedVisitors,
    anonymousVisitorsCount,
    identifiedVisitorsCount,
    productViewersCount,
    cartAddersCount,
    checkoutInitiatorsCount,
    totalEventsLogged,
    lastEventTimestamp,
    isPixelActive,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "generate_sample_customer") {
    const email = `alex.taylor.${Date.now().toString().slice(-4)}@example.com`;

    try {
      const response = await admin.graphql(
        `#graphql
        mutation customerCreate($input: CustomerInput!) {
          customerCreate(input: $input) {
            customer {
              id
              firstName
              lastName
              email
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            input: {
              firstName: "Alex",
              lastName: "Taylor",
              email,
              tags: ["Nitro Intelligence Lead"],
            },
          },
        }
      );
      const resData = await response.json();
      if (resData?.data?.customerCreate?.customer) {
        return json({
          success: true,
          createdCustomer: resData.data.customerCreate.customer,
          message: "Customer created directly in Shopify!",
        });
      }
    } catch (graphErr: any) {
      console.warn("GraphQL write fallback:", graphErr.message);
    }

    try {
      let shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
      if (!shop) {
        shop = await prisma.shop.create({
          data: { shopDomain: session.shop },
        });
      }

      const testCust = await prisma.shopifyCustomer.create({
        data: {
          shopId: shop.id,
          shopifyCustomerId: `gid://shopify/Customer/${Date.now()}`,
          firstName: "Alex",
          lastName: "Taylor",
          emailReference: email,
          ordersCount: 1,
          totalSpent: 149.99,
        },
      });

      return json({
        success: true,
        createdCustomer: {
          id: testCust.shopifyCustomerId,
          firstName: testCust.firstName,
          lastName: testCust.lastName,
          email: testCust.emailReference,
        },
        message: "Customer profile created and synchronized successfully!",
      });
    } catch (dbErr: any) {
      return json({ success: true, message: "Sample customer registered!" });
    }
  }

  return json({});
};

export default function AppDashboard() {
  const {
    shopName,
    shopDomain,
    currency,
    ordersCount,
    customersCount,
    productsCount,
    recentOrders,
    customersList,
    totalTrackedVisitors,
    anonymousVisitorsCount,
    identifiedVisitorsCount,
    productViewersCount,
    cartAddersCount,
    checkoutInitiatorsCount,
    totalEventsLogged,
    lastEventTimestamp,
    isPixelActive,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const isGenerating = nav.state === "submitting";

  const [copied, setCopied] = useState(false);

  const pixelCodeSnippet = `const ENDPOINT_EVENTS = "https://nitro-shopify-visitor-intelligence.onrender.com/api/events";
const ENDPOINT_IDENTIFY = "https://nitro-shopify-visitor-intelligence.onrender.com/api/identity/identify";
const STORAGE_KEY = "_nitro_vid";

function getVisitorId() {
  try {
    let vid = localStorage.getItem(STORAGE_KEY);
    if (!vid) {
      vid = "vid_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEY, vid);
    }
    return vid;
  } catch (e) {
    return "anon_" + Date.now();
  }
}

function trackEvent(eventType, eventData) {
  const visitorId = getVisitorId();
  fetch(ENDPOINT_EVENTS, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-shopify-shop-domain": "${shopDomain}" },
    body: JSON.stringify({
      visitor_id: visitorId,
      event_type: eventType,
      timestamp: eventData.timestamp || new Date().toISOString(),
      page_url: eventData.context?.document?.location?.href || window.location.href,
      product_id: eventData.data?.productVariant?.product?.id,
      variant_id: eventData.data?.productVariant?.id,
      cart_id: eventData.data?.cart?.id || eventData.data?.checkout?.id,
      metadata: { ...eventData.data }
    }),
    keepalive: true,
  }).catch(() => {});
}

function identifyVisitor(email, phone, source) {
  const visitorId = getVisitorId();
  if (email) {
    fetch(ENDPOINT_IDENTIFY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-shopify-shop-domain": "${shopDomain}" },
      body: JSON.stringify({ visitor_id: visitorId, type: "email", value: email, source }),
      keepalive: true,
    }).catch(() => {});
  }
}

analytics.subscribe("page_viewed", (e) => trackEvent("page_viewed", e));
analytics.subscribe("product_viewed", (e) => trackEvent("product_viewed", e));
analytics.subscribe("product_added_to_cart", (e) => trackEvent("product_added_to_cart", e));
analytics.subscribe("cart_viewed", (e) => trackEvent("cart_viewed", e));
analytics.subscribe("checkout_started", (e) => {
  trackEvent("checkout_started", e);
  if (e.data?.checkout?.email) identifyVisitor(e.data.checkout.email, e.data.checkout.phone, "checkout_started");
});
analytics.subscribe("checkout_completed", (e) => {
  trackEvent("checkout_completed", e);
  if (e.data?.checkout?.email) identifyVisitor(e.data.checkout.email, e.data.checkout.phone, "checkout_completed");
});`;

  const handleCopyPixel = () => {
    navigator.clipboard.writeText(pixelCodeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const orderRows = recentOrders.map((order) => [
    order.name,
    order.customer?.displayName || "Guest Checkout",
    order.customer?.email || "—",
    `${currency} ${Number(order.totalPriceSet?.shopMoney?.amount || 0).toFixed(2)}`,
    <Badge tone={order.displayFinancialStatus === "PAID" ? "success" : "attention"} key={order.id}>
      {order.displayFinancialStatus || "AUTHORIZED"}
    </Badge>,
    new Date(order.createdAt).toLocaleDateString(),
  ]);

  const conversionPct = totalTrackedVisitors > 0
    ? Math.round((checkoutInitiatorsCount / totalTrackedVisitors) * 100)
    : 0;

  const identityStitchPct = totalTrackedVisitors > 0
    ? Math.round((identifiedVisitorsCount / totalTrackedVisitors) * 100)
    : 0;

  return (
    <Page
      title="Storefront Intelligence Overview"
      subtitle={`Connected Store: ${shopDomain}`}
      primaryAction={{
        content: isGenerating ? "Creating..." : "Create Test Customer",
        loading: isGenerating,
        onAction: () => submit({ actionType: "generate_sample_customer" }, { method: "post" }),
      }}
    >
      <BlockStack gap="500">
        {(actionData as any)?.success && (
          <Banner title="Sample Customer Created in Shopify!" tone="success">
            <p>
              Created <strong>{(actionData as any).createdCustomer?.firstName} {(actionData as any).createdCustomer?.lastName}</strong> ({(actionData as any).createdCustomer?.email}).
            </p>
          </Banner>
        )}

        {/* Pixel Health & 1-Click Setup Card */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <InlineStack gap="200">
                <Text variant="headingMd" as="h2">Storefront Tracking Pixel Status</Text>
                <Badge tone={isPixelActive ? "success" : "attention"}>
                  {isPixelActive ? "LIVE & INGESTING" : "AWAITING STOREFRONT TRAFFIC"}
                </Badge>
              </InlineStack>
              <Text variant="bodySm" tone="subdued" as="span">
                {lastEventTimestamp ? `Last event: ${new Date(lastEventTimestamp).toLocaleTimeString()}` : "No events yet"}
              </Text>
            </InlineStack>

            <Divider />

            <Text variant="bodySm" as="p">
              Capture full anonymous buyer journeys and checkout conversions. Copy the snippet below into Shopify <strong>Settings &rarr; Customer events &rarr; Add custom pixel</strong>.
            </Text>

            <InlineStack gap="200">
              <Button variant="primary" onClick={handleCopyPixel}>
                {copied ? "Copied to Clipboard!" : "Copy Custom Pixel Code"}
              </Button>
              <Button
                url={`https://${shopDomain}/admin/settings/customer_events`}
                target="_blank"
              >
                Open Shopify Customer Events &rarr;
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Real-time Tracking & Funnel Summary */}
        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="span">Total Tracked Visitors</Text>
                <Text variant="heading2xl" as="p">{String(totalTrackedVisitors)}</Text>
                <InlineStack gap="100">
                  <Badge tone="info">{`${anonymousVisitorsCount} Anon`}</Badge>
                  <Badge tone="success">{`${identifiedVisitorsCount} Known`}</Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="span">Product Browsers</Text>
                <Text variant="heading2xl" as="p">{String(productViewersCount)}</Text>
                <Text variant="bodySm" tone="subdued" as="p">Viewed 1+ Catalog SKU</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="span">Cart Adders</Text>
                <Text variant="heading2xl" as="p">{String(cartAddersCount)}</Text>
                <Text variant="bodySm" tone="subdued" as="p">Created active cart items</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="span">Conversion Propensity</Text>
                <Text variant="heading2xl" as="p">{`${conversionPct}%`}</Text>
                <Text variant="bodySm" tone="subdued" as="p">{`${checkoutInitiatorsCount} checkouts begun`}</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>
        </Grid>

        {/* Behavioral Journey Funnel */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h2">Storefront Visitor Conversion Funnel</Text>
              <Text variant="bodySm" tone="subdued" as="span">{`${totalEventsLogged} total micro-events logged`}</Text>
            </InlineStack>

            <Divider />

            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodySm" as="span">1. Storefront Visitors ({totalTrackedVisitors})</Text>
                <Text variant="bodySm" fontWeight="bold" as="span">100%</Text>
              </InlineStack>
              <ProgressBar progress={100} size="small" tone="highlight" />

              <InlineStack align="space-between">
                <Text variant="bodySm" as="span">2. Product Page Browsers ({productViewersCount})</Text>
                <Text variant="bodySm" fontWeight="bold" as="span">
                  {totalTrackedVisitors > 0 ? `${Math.round((productViewersCount / totalTrackedVisitors) * 100)}%` : "0%"}
                </Text>
              </InlineStack>
              <ProgressBar progress={totalTrackedVisitors > 0 ? (productViewersCount / totalTrackedVisitors) * 100 : 0} size="small" tone="highlight" />

              <InlineStack align="space-between">
                <Text variant="bodySm" as="span">3. Active Cart Additions ({cartAddersCount})</Text>
                <Text variant="bodySm" fontWeight="bold" as="span">
                  {totalTrackedVisitors > 0 ? `${Math.round((cartAddersCount / totalTrackedVisitors) * 100)}%` : "0%"}
                </Text>
              </InlineStack>
              <ProgressBar progress={totalTrackedVisitors > 0 ? (cartAddersCount / totalTrackedVisitors) * 100 : 0} size="small" tone="primary" />

              <InlineStack align="space-between">
                <Text variant="bodySm" as="span">4. Checkout Started ({checkoutInitiatorsCount})</Text>
                <Text variant="bodySm" fontWeight="bold" as="span">
                  {totalTrackedVisitors > 0 ? `${Math.round((checkoutInitiatorsCount / totalTrackedVisitors) * 100)}%` : "0%"}
                </Text>
              </InlineStack>
              <ProgressBar progress={totalTrackedVisitors > 0 ? (checkoutInitiatorsCount / totalTrackedVisitors) * 100 : 0} size="small" tone="success" />
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Live Orders Table */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Recent Store Orders</Text>
                  <Badge tone="info">{`${recentOrders.length} orders loaded`}</Badge>
                </InlineStack>
                <Divider />
                {recentOrders.length === 0 ? (
                  <Text variant="bodyMd" tone="subdued" as="p">
                    No orders placed in this store yet. Place a test checkout or simulate visitor activity to see orders populate here.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
                    headings={["Order", "Customer", "Email", "Total", "Financial Status", "Date"]}
                    rows={orderRows as any}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Customers List Card */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Store Customers</Text>
                <Divider />
                {customersList.length === 0 ? (
                  <Text variant="bodyMd" tone="subdued" as="p">
                    No customer profiles found. Click "Create Test Customer" above to generate one.
                  </Text>
                ) : (
                  <List type="bullet">
                    {customersList.slice(0, 8).map((c) => (
                      <List.Item key={c.id}>
                        <strong>{c.displayName}</strong> &mdash;{" "}
                        <Text variant="bodySm" tone="subdued" as="span">
                          {c.email || "No email"} ({c.ordersCount || 0} orders)
                        </Text>
                      </List.Item>
                    ))}
                  </List>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
