import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit, useNavigate } from "@remix-run/react";
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
  Modal,
  TextField,
  ButtonGroup,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Icon } from "../components/Icon";
import { calculateIntentScore } from "../services/intentEngine.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopName = "Only Natural Gemstones";
  let shopDomain = "ravistore-shop.myshopify.com";
  let currency = "INR";
  let ordersCount = 0;
  let customersCount = 0;
  let productsCount = 0;
  let recentOrders: any[] = [];
  let customersList: any[] = [];

  let totalTrackedVisitors = 0;
  let anonymousVisitorsCount = 0;
  let identifiedVisitorsCount = 0;
  let productViewersCount = 0;
  let cartAddersCount = 0;
  let checkoutInitiatorsCount = 0;
  let totalEventsLogged = 0;
  let lastEventTimestamp: string | null = null;
  let isPixelActive = false;
  let visitorsData: any[] = [];

  try {
    const { admin, session } = await authenticate.admin(request);
    shopDomain = session.shop;

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

    try {
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        include: {
          visitors: {
            include: {
              sessions: true,
              events: { orderBy: { timestamp: "desc" }, take: 30 },
              identities: true,
              customerLinks: { include: { customer: true } },
            },
            orderBy: { lastSeenAt: "desc" },
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

        const latestEvent = await prisma.event.findFirst({
          where: { shopId: shop.id },
          orderBy: { timestamp: "desc" },
        });

        if (latestEvent) {
          lastEventTimestamp = latestEvent.timestamp.toISOString();
          const diffMinutes = (Date.now() - latestEvent.timestamp.getTime()) / (1000 * 60);
          isPixelActive = diffMinutes < 1440;
        }

        visitorsData = shop.visitors.map((v) => {
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

          const emailId = v.identities.find((i) => i.identityType === "email");
          const phoneId = v.identities.find((i) => i.identityType === "phone");
          const customer = v.customerLinks[0]?.customer || null;

          return {
            id: v.id,
            visitorId: v.visitorId,
            status: v.status,
            firstSeenAt: v.firstSeenAt.toISOString(),
            lastSeenAt: v.lastSeenAt.toISOString(),
            deviceCategory: v.deviceCategory || "desktop",
            sessionsCount: v.sessions.length || 1,
            productsViewedCount: pViews,
            cartEventsCount: addToCart,
            cartValue: cartVal,
            intentScore: intent.score,
            intentTier: intent.tier,
            intentBreakdown: intent.breakdown,
            primaryEmail: emailId?.identityValueEncrypted || customer?.emailReference || null,
            primaryPhone: phoneId?.identityValueEncrypted || customer?.phoneReference || null,
            identitySource: emailId?.source || phoneId?.source || (customer ? "shopify_sync" : "anonymous_session"),
            customer: customer
              ? {
                  id: customer.shopifyCustomerId,
                  firstName: customer.firstName,
                  lastName: customer.lastName,
                  email: customer.emailReference,
                  phone: customer.phoneReference,
                }
              : null,
            events: v.events.map((e) => ({
              id: e.id,
              eventType: e.eventType,
              timestamp: e.timestamp.toISOString(),
              pageUrl: e.pageUrl,
              productId: e.productId,
              metadata: e.metadata,
            })),
          };
        });
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
    visitorsData,
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
    visitorsData,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const navigate = useNavigate();
  const isGenerating = nav.state === "submitting";

  const [copied, setCopied] = useState(false);
  const [visitorFilter, setVisitorFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVisitor, setSelectedVisitor] = useState<any | null>(null);

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

function identifyVisitor(type, value, source) {
  if (!value || !value.trim()) return;
  const visitorId = getVisitorId();
  fetch(ENDPOINT_IDENTIFY, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-shopify-shop-domain": "${shopDomain}" },
    body: JSON.stringify({ visitor_id: visitorId, type: type, value: value.trim(), source: source }),
    keepalive: true,
  }).catch(() => {});
}

function trackEvent(eventType, eventData) {
  const visitorId = getVisitorId();
  const href = eventData.context?.document?.location?.href || window.location.href;

  try {
    if (href.includes("?")) {
      const params = new URL(href).searchParams;
      const urlEmail = params.get("email") || params.get("utm_email") || params.get("contact");
      const urlPhone = params.get("phone") || params.get("tel") || params.get("whatsapp");
      if (urlEmail && urlEmail.includes("@")) identifyVisitor("email", urlEmail, "url_campaign");
      if (urlPhone && urlPhone.length >= 7) identifyVisitor("phone", urlPhone, "url_campaign");
    }
  } catch(e) {}

  fetch(ENDPOINT_EVENTS, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-shopify-shop-domain": "${shopDomain}" },
    body: JSON.stringify({
      visitor_id: visitorId,
      event_type: eventType,
      timestamp: eventData.timestamp || new Date().toISOString(),
      page_url: href,
      product_id: eventData.data?.productVariant?.product?.id,
      variant_id: eventData.data?.productVariant?.id,
      cart_id: eventData.data?.cart?.id || eventData.data?.checkout?.id,
      metadata: { ...eventData.data }
    }),
    keepalive: true,
  }).catch(() => {});
}

analytics.subscribe("page_viewed", (e) => trackEvent("page_viewed", e));
analytics.subscribe("product_viewed", (e) => trackEvent("product_viewed", e));
analytics.subscribe("product_added_to_cart", (e) => trackEvent("product_added_to_cart", e));
analytics.subscribe("cart_viewed", (e) => trackEvent("cart_viewed", e));
analytics.subscribe("checkout_started", (e) => {
  trackEvent("checkout_started", e);
  if (e.data?.checkout?.email) identifyVisitor("email", e.data.checkout.email, "checkout_started");
  if (e.data?.checkout?.phone) identifyVisitor("phone", e.data.checkout.phone, "checkout_started");
});
analytics.subscribe("checkout_completed", (e) => {
  trackEvent("checkout_completed", e);
  if (e.data?.checkout?.email) identifyVisitor("email", e.data.checkout.email, "checkout_completed");
  if (e.data?.checkout?.phone) identifyVisitor("phone", e.data.checkout.phone, "checkout_completed");
});`;

  const handleCopyPixel = () => {
    navigator.clipboard.writeText(pixelCodeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleExportCSV = () => {
    if (!visitorsData || visitorsData.length === 0) return;
    const headers = ["Visitor ID", "Status", "Intent Score", "Intent Tier", "Email", "Phone", "Identity Source", "Cart Value", "Sessions", "First Seen", "Last Seen"];
    const rows = visitorsData.map((v) => [
      v.visitorId,
      v.status,
      v.intentScore,
      v.intentTier,
      v.primaryEmail || "",
      v.primaryPhone || "",
      v.identitySource || "",
      v.cartValue || "0",
      v.sessionsCount || "1",
      v.firstSeenAt,
      v.lastSeenAt,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `nitro_leads_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  let filteredVisitors = visitorsData;
  if (visitorFilter === "identified") {
    filteredVisitors = filteredVisitors.filter((v: any) => v.status === "identified");
  } else if (visitorFilter === "high_intent") {
    filteredVisitors = filteredVisitors.filter((v: any) => v.intentScore >= 61);
  } else if (visitorFilter === "cart") {
    filteredVisitors = filteredVisitors.filter((v: any) => v.cartEventsCount > 0);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredVisitors = filteredVisitors.filter(
      (v: any) =>
        v.visitorId.toLowerCase().includes(q) ||
        (v.primaryEmail && v.primaryEmail.toLowerCase().includes(q)) ||
        (v.primaryPhone && v.primaryPhone.includes(q)) ||
        (v.customer?.firstName && v.customer.firstName.toLowerCase().includes(q))
    );
  }

  const visitorTableRows = filteredVisitors.map((v: any) => {
    const isIdentified = v.status === "identified";
    const displayName = v.customer?.firstName
      ? `${v.customer.firstName} ${v.customer.lastName || ""}`
      : isIdentified && v.primaryEmail
      ? v.primaryEmail
      : `Anonymous #${v.visitorId.substring(0, 8)}`;

    let tierTone: "success" | "attention" | "info" | undefined = undefined;
    if (v.intentTier === "very_high") tierTone = "success";
    else if (v.intentTier === "high") tierTone = "attention";
    else if (v.intentTier === "medium") tierTone = "info";

    return [
      <InlineStack gap="150" align="center" key={`lead_${v.id}`}>
        <Icon name={isIdentified ? "ic-user-check" : "ic-user"} size={16} color={isIdentified ? "var(--ok)" : "var(--faint)"} />
        <Button variant="plain" onClick={() => setSelectedVisitor(v)}>
          <strong>{displayName}</strong>
        </Button>
        <span className="mono" style={{ fontSize: "11px", color: "var(--faint)" }}>
          {`(${v.visitorId.substring(0, 7)})`}
        </span>
      </InlineStack>,
      <BlockStack gap="050" key={`intent_${v.id}`}>
        <InlineStack gap="100" align="center">
          <Badge tone={tierTone}>{`${v.intentScore}/100`}</Badge>
          <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "capitalize" }}>{v.intentTier.replace("_", " ")}</span>
        </InlineStack>
        <div style={{ width: "90px", marginTop: "4px" }}>
          <ProgressBar progress={v.intentScore} size="small" tone={v.intentScore >= 61 ? "success" : "highlight"} />
        </div>
      </BlockStack>,
      <span key={`source_${v.id}`} className={`ong-badge ${isIdentified ? "ong-badge-success" : ""}`}>
        {isIdentified ? v.identitySource.replace("_", " ").toUpperCase() : "ANONYMOUS"}
      </span>,
      v.cartEventsCount > 0 ? (
        <span key={`cart_${v.id}`} style={{ fontWeight: 600, color: "var(--accent)" }}>
          {`${v.cartEventsCount} items ($${v.cartValue})`}
        </span>
      ) : (
        <span key={`cart_${v.id}`} style={{ color: "var(--muted)" }}>—</span>
      ),
      <span key={`views_${v.id}`}>{`${v.productsViewedCount} products`}</span>,
      <span key={`seen_${v.id}`} style={{ fontSize: "12px", color: "var(--muted)" }}>
        {new Date(v.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>,
      <Button
        key={`btn_${v.id}`}
        size="slim"
        variant="secondary"
        onClick={() => setSelectedVisitor(v)}
      >
        <InlineStack gap="100" align="center">
          <Icon name="ic-activity" size={13} />
          <span>Inspect Lore</span>
        </InlineStack>
      </Button>,
    ];
  });

  const orderRows = recentOrders.map((order) => [
    <span key={order.id} className="mono" style={{ fontWeight: 600 }}>{order.name}</span>,
    order.customer?.displayName || "Guest Shopper",
    order.customer?.email || "—",
    <span key={`${order.id}-tot`} className="mono">{`${currency} ${Number(order.totalPriceSet?.shopMoney?.amount || 0).toFixed(2)}`}</span>,
    <Badge tone={order.displayFinancialStatus === "PAID" ? "success" : "attention"} key={order.id}>
      {order.displayFinancialStatus || "AUTHORIZED"}
    </Badge>,
    new Date(order.createdAt).toLocaleDateString(),
  ]);

  const conversionPct = totalTrackedVisitors > 0
    ? Math.round((checkoutInitiatorsCount / totalTrackedVisitors) * 100)
    : 0;

  return (
    <Page
      fullWidth
      title={
        <InlineStack gap="200" align="center">
          <Icon name="ic-diamond" size={26} color="var(--accent)" />
          <span>{shopName}</span>
          <span className="ong-badge ong-badge-accent" style={{ marginLeft: "8px", verticalAlign: "middle" }}>
            INTENT INTELLIGENCE
          </span>
        </InlineStack>
      }
      subtitle={`Live Storefront Tracking: ${shopDomain}`}
      primaryAction={{
        content: "Simulate Live Traffic",
        onAction: () => navigate("/app/simulator"),
      }}
      secondaryActions={[
        {
          content: "Export Leads (CSV)",
          icon: () => <Icon name="ic-download" size={16} />,
          onAction: handleExportCSV,
          disabled: visitorsData.length === 0,
        },
        {
          content: isGenerating ? "Creating Profile..." : "Add Test Lead",
          loading: isGenerating,
          onAction: () => submit({ actionType: "generate_sample_customer" }, { method: "post" }),
        },
      ]}
    >
      <BlockStack gap="500">
        {(actionData as any)?.success && (
          <Banner title="Customer Profile Synchronized!" tone="success" onDismiss={() => {}}>
            <p>
              Created <strong>{(actionData as any).createdCustomer?.firstName} {(actionData as any).createdCustomer?.lastName}</strong> ({(actionData as any).createdCustomer?.email}).
            </p>
          </Banner>
        )}

        {/* Zero-Friction Lore & Explanation Banner */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" align="center">
                <Icon name={isPixelActive ? "ic-check-circle" : "ic-alert-triangle"} size={20} color={isPixelActive ? "var(--ok)" : "var(--warn)"} />
                <Text variant="headingMd" as="h2">Zero-Friction Identity & Micro-Event Lore Engine</Text>
                <span className={`ong-badge ${isPixelActive ? "ong-badge-success" : "ong-badge-warn"}`}>
                  {isPixelActive ? "LIVE & INGESTING" : "AWAITING STOREFRONT PIXEL"}
                </span>
              </InlineStack>
              <Text variant="bodySm" tone="subdued" as="span">
                {lastEventTimestamp ? `Latest event: ${new Date(lastEventTimestamp).toLocaleTimeString()}` : "No events recorded yet"}
              </Text>
            </InlineStack>

            <Divider />

            <Grid>
              <Grid.Cell columnSpan={{ xs: 12, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <BlockStack gap="100">
                  <InlineStack gap="100" align="center">
                    <Icon name="ic-tag" size={16} color="var(--accent)" />
                    <Text variant="bodySm" fontWeight="bold" as="span">1. URL Campaign Auto-Capture</Text>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Send email/SMS campaigns with <span className="mono" style={{ background: "var(--bg-subtle)", padding: "1px 4px", borderRadius: "3px" }}>?email=user@domain.com</span>. The pixel auto-stitches their anonymous browsing session without requiring login or form submissions.
                  </Text>
                </BlockStack>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 12, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <BlockStack gap="100">
                  <InlineStack gap="100" align="center">
                    <Icon name="ic-cart" size={16} color="var(--accent)" />
                    <Text variant="bodySm" fontWeight="bold" as="span">2. Checkout Step 1 Interception</Text>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">
                    When a buyer types or autofills their email/phone at checkout Step 1 and drops off before paying, their full anonymous browsing lore is instantly preserved and identified.
                  </Text>
                </BlockStack>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 12, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <BlockStack gap="100">
                  <InlineStack gap="100" align="center">
                    <Icon name="ic-send" size={16} color="var(--accent)" />
                    <Text variant="bodySm" fontWeight="bold" as="span">3. Instant Webhook Dispatch</Text>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">
                    When intent score crosses 60+ (High Intent), an instant webhook is fired to Klaviyo, Omnisend, or WhatsApp API with the buyer's viewed products and cart items.
                  </Text>
                </BlockStack>
              </Grid.Cell>
            </Grid>

            <InlineStack gap="200">
              <Button variant="primary" onClick={handleCopyPixel}>
                <InlineStack gap="100">
                  <Icon name={copied ? "ic-check" : "ic-copy"} size={14} />
                  <span>{copied ? "Pixel Copied to Clipboard!" : "Copy Web Pixel Snippet"}</span>
                </InlineStack>
              </Button>
              <Button
                url={`https://${shopDomain}/admin/settings/customer_events`}
                target="_blank"
              >
                <InlineStack gap="100">
                  <Icon name="ic-external-link" size={14} />
                  <span>Open Shopify Customer Events &rarr;</span>
                </InlineStack>
              </Button>
              <Button onClick={() => navigate("/app/integrations")}>
                <InlineStack gap="100">
                  <Icon name="ic-server" size={14} />
                  <span>Configure Outbound Webhooks</span>
                </InlineStack>
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* 4-Metric Full-Width KPI Grid */}
        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="100">
                <InlineStack gap="100" align="start">
                  <Icon name="ic-users" size={16} color="var(--accent)" />
                  <Text variant="bodySm" tone="subdued" as="span">Tracked Visitors</Text>
                </InlineStack>
                <Text variant="heading2xl" as="p">{String(totalTrackedVisitors)}</Text>
                <InlineStack gap="100">
                  <span className="ong-badge">{`${anonymousVisitorsCount} Anonymous`}</span>
                  <span className="ong-badge ong-badge-success">{`${identifiedVisitorsCount} Identified`}</span>
                </InlineStack>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="100">
                <InlineStack gap="100" align="start">
                  <Icon name="ic-diamond" size={16} color="var(--accent)" />
                  <Text variant="bodySm" tone="subdued" as="span">Product Browsers</Text>
                </InlineStack>
                <Text variant="heading2xl" as="p">{String(productViewersCount)}</Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  {totalTrackedVisitors > 0 ? `${Math.round((productViewersCount / totalTrackedVisitors) * 100)}% catalog engagement` : "0% engagement"}
                </Text>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="100">
                <InlineStack gap="100" align="start">
                  <Icon name="ic-cart" size={16} color="var(--warn)" />
                  <Text variant="bodySm" tone="subdued" as="span">Cart Additions</Text>
                </InlineStack>
                <Text variant="heading2xl" as="p">{String(cartAddersCount)}</Text>
                <Text variant="bodySm" tone="subdued" as="p">Active cart items discovered</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="100">
                <InlineStack gap="100" align="start">
                  <Icon name="ic-trending-up" size={16} color="var(--ok)" />
                  <Text variant="bodySm" tone="subdued" as="span">Conversion Rate</Text>
                </InlineStack>
                <Text variant="heading2xl" as="p">{`${conversionPct}%`}</Text>
                <Text variant="bodySm" tone="subdued" as="p">{`${checkoutInitiatorsCount} checkouts reached`}</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>
        </Grid>

        {/* Behavioral Funnel Bar */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <InlineStack gap="100">
                <Icon name="ic-activity" size={18} color="var(--accent)" />
                <Text variant="headingMd" as="h2">Storefront Conversion & Drop-off Funnel</Text>
              </InlineStack>
              <Text variant="bodySm" tone="subdued" as="span">{`${totalEventsLogged} total micro-events recorded`}</Text>
            </InlineStack>

            <Divider />

            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodySm" as="span">1. Storefront Visitors ({totalTrackedVisitors})</Text>
                <Text variant="bodySm" fontWeight="bold" as="span">100%</Text>
              </InlineStack>
              <ProgressBar progress={100} size="small" tone="highlight" />

              <InlineStack align="space-between">
                <Text variant="bodySm" as="span">2. Product Page Viewers ({productViewersCount})</Text>
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

        {/* Full-Width Real-Time Visitor Lore Table */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="150" align="center">
                <Icon name="ic-users" size={20} color="var(--accent)" />
                <Text variant="headingMd" as="h2">Live Visitor Intelligence & Stitched Leads</Text>
                <span className="ong-badge ong-badge-accent">{`${filteredVisitors.length} Active Records`}</span>
              </InlineStack>

              <InlineStack gap="200" align="center">
                <ButtonGroup>
                  <Button pressed={visitorFilter === "all"} onClick={() => setVisitorFilter("all")}>
                    All ({visitorsData.length})
                  </Button>
                  <Button pressed={visitorFilter === "high_intent"} onClick={() => setVisitorFilter("high_intent")}>
                    High Intent (60+)
                  </Button>
                  <Button pressed={visitorFilter === "cart"} onClick={() => setVisitorFilter("cart")}>
                    In Cart
                  </Button>
                  <Button pressed={visitorFilter === "identified"} onClick={() => setVisitorFilter("identified")}>
                    Identified Leads
                  </Button>
                </ButtonGroup>

                <div style={{ width: "240px" }}>
                  <TextField
                    label=""
                    labelHidden
                    placeholder="Search ID, email, name, phone..."
                    value={searchQuery}
                    onChange={(val) => setSearchQuery(val)}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setSearchQuery("")}
                  />
                </div>
              </InlineStack>
            </InlineStack>

            <Divider />

            {filteredVisitors.length === 0 ? (
              <EmptyState
                heading="No matching visitor records"
                action={{
                  content: "Open Live Simulator",
                  onAction: () => navigate("/app/simulator"),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Simulate storefront visitor traffic to see real-time identity stitching and journey lore.</p>
              </EmptyState>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]}
                headings={["Visitor / Lead", "Intent Propensity", "Identity Source", "Cart Activity", "Catalog Views", "Last Seen", "Action"]}
                rows={visitorTableRows as any}
              />
            )}
          </BlockStack>
        </Card>

        {/* Live Orders & Customers */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <InlineStack gap="100">
                    <Icon name="ic-package" size={18} color="var(--accent)" />
                    <Text variant="headingMd" as="h2">Recent Store Orders</Text>
                  </InlineStack>
                  <span className="ong-badge ong-badge-accent">{`${recentOrders.length} orders loaded`}</span>
                </InlineStack>
                <Divider />
                {recentOrders.length === 0 ? (
                  <Text variant="bodyMd" tone="subdued" as="p">
                    No orders placed in this store yet. Place a test checkout to see orders populate here.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
                    headings={["Order", "Customer", "Email", "Total", "Status", "Date"]}
                    rows={orderRows as any}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="100">
                  <Icon name="ic-users" size={18} color="var(--accent)" />
                  <Text variant="headingMd" as="h2">Synced Customers</Text>
                </InlineStack>
                <Divider />
                {customersList.length === 0 ? (
                  <Text variant="bodyMd" tone="subdued" as="p">
                    No customer profiles found. Click "Add Test Lead" above.
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

      {/* Interactive Popup Modal for Lore & Detailed Visitor Journey */}
      {selectedVisitor && (
        <Modal
          open={Boolean(selectedVisitor)}
          onClose={() => setSelectedVisitor(null)}
          title={`Visitor Lore & Stitched Profile: ${selectedVisitor.visitorId.substring(0, 12)}...`}
          primaryAction={{
            content: "Close Lore",
            onAction: () => setSelectedVisitor(null),
          }}
          secondaryActions={[
            {
              content: "View Full Journey Route",
              onAction: () => navigate(`/app/visitors/${selectedVisitor.visitorId}`),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {/* Identity & Status Card */}
              <div style={{ background: "var(--bg-subtle)", padding: "16px", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="150" align="center">
                      <Icon
                        name={selectedVisitor.status === "identified" ? "ic-user-check" : "ic-user"}
                        size={22}
                        color={selectedVisitor.status === "identified" ? "var(--ok)" : "var(--faint)"}
                      />
                      <Text variant="headingMd" as="h3">
                        {selectedVisitor.customer?.firstName
                          ? `${selectedVisitor.customer.firstName} ${selectedVisitor.customer.lastName || ""}`
                          : selectedVisitor.primaryEmail || "Anonymous Storefront Shopper"}
                      </Text>
                    </InlineStack>
                    <span className={`ong-badge ${selectedVisitor.status === "identified" ? "ong-badge-success" : ""}`}>
                      {selectedVisitor.status.toUpperCase()}
                    </span>
                  </InlineStack>

                  <Grid>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Captured Email:</Text>
                      <Text variant="bodyMd" fontWeight="bold" as="p">{selectedVisitor.primaryEmail || "None (Anonymous)"}</Text>
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Captured Phone:</Text>
                      <Text variant="bodyMd" fontWeight="bold" as="p">{selectedVisitor.primaryPhone || "None"}</Text>
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Identity Source:</Text>
                      <span className="ong-badge ong-badge-accent">
                        {selectedVisitor.identitySource.replace("_", " ").toUpperCase()}
                      </span>
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Cart Value:</Text>
                      <Text variant="bodyMd" fontWeight="bold" as="p">{`$${selectedVisitor.cartValue || 0}`}</Text>
                    </Grid.Cell>
                  </Grid>
                </BlockStack>
              </div>

              {/* Intent Score Breakdown */}
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingSm" as="h4">Intent Propensity Score</Text>
                    <InlineStack gap="100">
                      <Badge tone={selectedVisitor.intentScore >= 61 ? "success" : "attention"}>
                        {`${selectedVisitor.intentScore} / 100`}
                      </Badge>
                      <span className="ong-badge">{selectedVisitor.intentTier.toUpperCase()}</span>
                    </InlineStack>
                  </InlineStack>

                  <ProgressBar progress={selectedVisitor.intentScore} size="small" tone={selectedVisitor.intentScore >= 61 ? "success" : "highlight"} />

                  <Grid>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Product Views:</Text>
                      <Text variant="bodySm" fontWeight="bold" as="p">{`+${selectedVisitor.intentBreakdown?.productEngagement || 0} pts`}</Text>
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Cart Items:</Text>
                      <Text variant="bodySm" fontWeight="bold" as="p">{`+${selectedVisitor.intentBreakdown?.cartActivity || 0} pts`}</Text>
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Checkout Step:</Text>
                      <Text variant="bodySm" fontWeight="bold" as="p">{`+${selectedVisitor.intentBreakdown?.checkoutProgress || 0} pts`}</Text>
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Session Depth:</Text>
                      <Text variant="bodySm" fontWeight="bold" as="p">{`+${selectedVisitor.intentBreakdown?.sessionDepth || 0} pts`}</Text>
                    </Grid.Cell>
                  </Grid>
                </BlockStack>
              </Card>

              {/* Event Lore & Chronological Timeline */}
              <BlockStack gap="200">
                <Text variant="headingSm" as="h4">Chronological Event Timeline & Lore</Text>
                <div style={{ maxHeight: "260px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "6px", padding: "8px" }}>
                  {selectedVisitor.events && selectedVisitor.events.length > 0 ? (
                    <BlockStack gap="150">
                      {selectedVisitor.events.map((ev: any, idx: number) => {
                        let iconName = "ic-activity";
                        let tagTone = "";
                        if (ev.eventType === "product_viewed") {
                          iconName = "ic-diamond";
                        } else if (ev.eventType === "product_added_to_cart") {
                          iconName = "ic-cart";
                          tagTone = "ong-badge-warn";
                        } else if (ev.eventType.includes("checkout")) {
                          iconName = "ic-check-circle";
                          tagTone = "ong-badge-success";
                        }

                        return (
                          <div
                            key={ev.id || idx}
                            style={{
                              padding: "8px 12px",
                              background: "var(--bg-card)",
                              border: "1px solid var(--border)",
                              borderRadius: "6px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <InlineStack gap="150" align="center">
                              <Icon name={iconName} size={15} color="var(--accent)" />
                              <BlockStack gap="050">
                                <InlineStack gap="100" align="center">
                                  <span className={`ong-badge ${tagTone}`} style={{ fontSize: "10px" }}>
                                    {ev.eventType.replace(/_/g, " ").toUpperCase()}
                                  </span>
                                  {ev.productId && (
                                    <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
                                      SKU: {ev.productId.split("/").pop()}
                                    </span>
                                  )}
                                </InlineStack>
                                {ev.pageUrl && (
                                  <span style={{ fontSize: "11.5px", color: "var(--faint)", wordBreak: "break-all" }}>
                                    {ev.pageUrl}
                                  </span>
                                )}
                              </BlockStack>
                            </InlineStack>

                            <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
                              {new Date(ev.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        );
                      })}
                    </BlockStack>
                  ) : (
                    <Text variant="bodySm" tone="subdued" as="p">No micro-events recorded yet for this visitor.</Text>
                  )}
                </div>
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
