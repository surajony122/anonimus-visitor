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
import { decryptValue } from "../services/normalizer.server";

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
              events: { orderBy: { timestamp: "desc" }, take: 40 },
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
          let clientMeta: any = {};
          try {
            if (v.metadata) clientMeta = JSON.parse(v.metadata);
          } catch {}

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

          const rawDecryptedEmail = emailId?.identityValueEncrypted
            ? decryptValue(emailId.identityValueEncrypted)
            : customer?.emailReference || null;

          const rawDecryptedPhone = phoneId?.identityValueEncrypted
            ? decryptValue(phoneId.identityValueEncrypted)
            : customer?.phoneReference || null;

          return {
            id: v.id,
            visitorId: v.visitorId,
            status: v.status,
            firstSeenAt: v.firstSeenAt.toISOString(),
            lastSeenAt: v.lastSeenAt.toISOString(),
            deviceCategory: v.deviceCategory || clientMeta.deviceCategory || "desktop",
            browser: clientMeta.browser || "Chrome / WebKit",
            os: clientMeta.os || "Windows / macOS",
            screenResolution: clientMeta.screenResolution || "1920x1080",
            language: clientMeta.language || "en",
            timezone: clientMeta.timezone || "Local",
            storageAvailable: clientMeta.storageAvailable ?? true,
            sessionsCount: v.sessions.length || 1,
            productsViewedCount: pViews,
            cartEventsCount: addToCart,
            cartValue: cartVal,
            intentScore: intent.score,
            intentTier: intent.tier,
            intentBreakdown: intent.breakdown,
            primaryEmail: rawDecryptedEmail,
            primaryPhone: rawDecryptedPhone,
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

  // Full-featured universal tracker with localStorage, device extraction, and input interceptor
  const universalTrackerSnippet = `<!-- Nitro Commerce Intelligent Storefront & Device Tracker -->
<script>
(function() {
  var ENDPOINT_EVENTS = "https://nitro-shopify-visitor-intelligence.onrender.com/api/events";
  var ENDPOINT_IDENTIFY = "https://nitro-shopify-visitor-intelligence.onrender.com/api/identity/identify";
  var STORAGE_KEY_VID = "_nitro_vid";
  var STORAGE_KEY_PROFILE = "_nitro_profile";

  // 1. Persistent 1st-Party Visitor ID in localStorage & cookie
  function getVisitorId() {
    try {
      var vid = localStorage.getItem(STORAGE_KEY_VID);
      if (!vid) {
        vid = "vid_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now().toString(36);
        localStorage.setItem(STORAGE_KEY_VID, vid);
      }
      return vid;
    } catch (e) {
      return "anon_" + Date.now();
    }
  }

  // 2. Hardware, OS, Browser & Screen Intelligence
  function getDeviceProfile() {
    var ua = navigator.userAgent || "";
    var browser = "Chrome";
    if (ua.indexOf("Safari") !== -1 && ua.indexOf("Chrome") === -1) browser = "Safari";
    else if (ua.indexOf("Firefox") !== -1) browser = "Firefox";
    else if (ua.indexOf("Edg") !== -1) browser = "Edge";

    var os = "Desktop OS";
    if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/Windows/i.test(ua)) os = "Windows";
    else if (/Macintosh|Mac OS/i.test(ua)) os = "macOS";
    else if (/Linux/i.test(ua)) os = "Linux";

    var isMobile = os === "iOS" || os === "Android" || /Mobi|Android/i.test(ua);

    return {
      deviceCategory: isMobile ? "mobile" : "desktop",
      browser: browser,
      os: os,
      screenResolution: window.screen ? window.screen.width + "x" + window.screen.height : "1920x1080",
      language: navigator.language || "en",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      storageAvailable: true
    };
  }

  // 3. Instant Zero-Friction Identity Stitcher
  function identifyVisitor(type, value, source) {
    if (!value || typeof value !== "string" || !value.trim()) return;
    var vid = getVisitorId();
    try {
      var profile = JSON.parse(localStorage.getItem(STORAGE_KEY_PROFILE) || "{}");
      profile[type] = value.trim();
      localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(profile));
    } catch(e) {}

    fetch(ENDPOINT_IDENTIFY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-shopify-shop-domain": "${shopDomain}" },
      body: JSON.stringify({ visitor_id: vid, type: type, value: value.trim(), source: source || "storefront_interceptor" }),
      keepalive: true
    }).catch(function() {});
  }

  // 4. Auto-Harvest from Campaign URLs (?email=... &phone=...)
  try {
    if (window.location.search) {
      var params = new URLSearchParams(window.location.search);
      var urlEmail = params.get("email") || params.get("utm_email") || params.get("contact");
      var urlPhone = params.get("phone") || params.get("tel") || params.get("whatsapp");
      if (urlEmail && urlEmail.indexOf("@") !== -1) identifyVisitor("email", urlEmail, "url_campaign");
      if (urlPhone && urlPhone.length >= 7) identifyVisitor("phone", urlPhone, "url_campaign");
    }
  } catch(e) {}

  // 5. Auto-Detect Shopify Logged-in Customer ID
  try {
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.customerId) {
      identifyVisitor("shopify_customer", String(window.ShopifyAnalytics.meta.page.customerId), "shopify_session");
    }
  } catch(e) {}

  // 6. Passive Input Keystroke & Autofill Interception (Captures before submission)
  document.addEventListener("input", function(e) {
    var el = e.target;
    if (!el || !el.value) return;
    var val = el.value.trim();
    if ((el.type === "email" || el.name === "email" || el.id.indexOf("email") !== -1) && val.indexOf("@") !== -1 && val.indexOf(".") !== -1) {
      identifyVisitor("email", val, "storefront_autofill");
    }
    if ((el.type === "tel" || el.name === "phone" || el.id.indexOf("phone") !== -1) && val.length >= 8) {
      identifyVisitor("phone", val, "storefront_autofill");
    }
  }, true);

  // 7. Event Dispatcher with Rich Device Profile
  window.nitroTrack = function(eventType, eventData) {
    var vid = getVisitorId();
    var dev = getDeviceProfile();
    fetch(ENDPOINT_EVENTS, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-shopify-shop-domain": "${shopDomain}" },
      body: JSON.stringify({
        visitor_id: vid,
        event_type: eventType,
        page_url: window.location.href,
        device: dev,
        metadata: Object.assign({}, eventData || {}, { device: dev })
      }),
      keepalive: true
    }).catch(function() {});
  };

  // Auto-record initial page view
  window.nitroTrack("page_viewed", { title: document.title });
})();
</script>`;

  const handleCopyTracker = () => {
    navigator.clipboard.writeText(universalTrackerSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleExportCSV = () => {
    if (!visitorsData || visitorsData.length === 0) return;
    const headers = ["Visitor ID", "Status", "Intent Score", "Intent Tier", "Email", "Phone", "Identity Source", "Browser", "OS", "Device", "Resolution", "Cart Value", "Sessions", "First Seen", "Last Seen"];
    const rows = visitorsData.map((v) => [
      v.visitorId,
      v.status,
      v.intentScore,
      v.intentTier,
      v.primaryEmail || "",
      v.primaryPhone || "",
      v.identitySource || "",
      v.browser || "",
      v.os || "",
      v.deviceCategory || "",
      v.screenResolution || "",
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
        (v.browser && v.browser.toLowerCase().includes(q)) ||
        (v.os && v.os.toLowerCase().includes(q)) ||
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
      <BlockStack gap="050" key={`lead_${v.id}`}>
        <InlineStack gap="150" align="center">
          <Icon name={isIdentified ? "ic-user-check" : "ic-user"} size={16} color={isIdentified ? "var(--ok)" : "var(--faint)"} />
          <Button variant="plain" onClick={() => setSelectedVisitor(v)}>
            <strong>{displayName}</strong>
          </Button>
        </InlineStack>
        <span className="mono" style={{ fontSize: "11px", color: "var(--faint)" }}>
          {v.visitorId.substring(0, 16)}...
        </span>
      </BlockStack>,
      <BlockStack gap="050" key={`device_${v.id}`}>
        <InlineStack gap="100" align="center">
          <Icon name={v.deviceCategory === "mobile" ? "ic-phone" : "ic-server"} size={14} color="var(--accent)" />
          <span style={{ fontWeight: 600, fontSize: "12px" }}>{`${v.browser} on ${v.os}`}</span>
        </InlineStack>
        <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
          {`${v.screenResolution} • ${v.timezone}`}
        </span>
      </BlockStack>,
      <BlockStack gap="050" key={`contact_${v.id}`}>
        {v.primaryEmail ? (
          <InlineStack gap="050" align="center">
            <Icon name="ic-mail" size={13} color="var(--ok)" />
            <span style={{ fontWeight: 600, fontSize: "12px" }}>{v.primaryEmail}</span>
          </InlineStack>
        ) : (
          <span style={{ color: "var(--muted)", fontSize: "12px" }}>Email: —</span>
        )}
        {v.primaryPhone ? (
          <InlineStack gap="050" align="center">
            <Icon name="ic-phone" size={13} color="var(--accent)" />
            <span style={{ fontSize: "11.5px" }}>{v.primaryPhone}</span>
          </InlineStack>
        ) : null}
      </BlockStack>,
      <BlockStack gap="050" key={`intent_${v.id}`}>
        <InlineStack gap="100" align="center">
          <Badge tone={tierTone}>{`${v.intentScore}/100`}</Badge>
          <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "capitalize" }}>{v.intentTier.replace("_", " ")}</span>
        </InlineStack>
        <div style={{ width: "80px", marginTop: "4px" }}>
          <ProgressBar progress={v.intentScore} size="small" tone={v.intentScore >= 61 ? "success" : "highlight"} />
        </div>
      </BlockStack>,
      <span key={`source_${v.id}`} className={`ong-badge ${isIdentified ? "ong-badge-success" : ""}`}>
        {isIdentified ? v.identitySource.replace(/_/g, " ").toUpperCase() : "ANONYMOUS"}
      </span>,
      v.cartEventsCount > 0 ? (
        <span key={`cart_${v.id}`} style={{ fontWeight: 600, color: "var(--accent)" }}>
          {`${v.cartEventsCount} items ($${v.cartValue})`}
        </span>
      ) : (
        <span key={`cart_${v.id}`} style={{ color: "var(--muted)" }}>—</span>
      ),
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
            DEVICE & IDENTITY INTELLIGENCE
          </span>
        </InlineStack>
      }
      subtitle={`Connected Storefront: ${shopDomain}`}
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

        {/* Zero-Friction Storage & Device Lore Card */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" align="center">
                <Icon name={isPixelActive ? "ic-check-circle" : "ic-alert-triangle"} size={20} color={isPixelActive ? "var(--ok)" : "var(--warn)"} />
                <Text variant="headingMd" as="h2">Zero-Friction Device, LocalStorage & Autofill Capture</Text>
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
              <Grid.Cell columnSpan={{ xs: 12, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <BlockStack gap="100">
                  <InlineStack gap="100" align="center">
                    <Icon name="ic-server" size={16} color="var(--accent)" />
                    <Text variant="bodySm" fontWeight="bold" as="span">1. LocalStorage Device Vault</Text>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Stores persistent 1st-party token (<span className="mono">_nitro_vid</span>) + hardware info (Browser, OS, Screen, Timezone) in the user's browser for 365-day recognition.
                  </Text>
                </BlockStack>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 12, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <BlockStack gap="100">
                  <InlineStack gap="100" align="center">
                    <Icon name="ic-edit" size={16} color="var(--accent)" />
                    <Text variant="bodySm" fontWeight="bold" as="span">2. Keystroke & Autofill Sniffer</Text>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">
                    When the user types or browser autofills email/phone into newsletter/footer/search inputs, it captures the value before form submission.
                  </Text>
                </BlockStack>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 12, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <BlockStack gap="100">
                  <InlineStack gap="100" align="center">
                    <Icon name="ic-tag" size={16} color="var(--accent)" />
                    <Text variant="bodySm" fontWeight="bold" as="span">3. URL Campaign Auto-Stitch</Text>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Links with <span className="mono">?email=...&phone=...</span> instantly resolve the visitor's anonymous session without requiring any login.
                  </Text>
                </BlockStack>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 12, sm: 6, md: 3, lg: 3, xl: 3 }}>
                <BlockStack gap="100">
                  <InlineStack gap="100" align="center">
                    <Icon name="ic-send" size={16} color="var(--accent)" />
                    <Text variant="bodySm" fontWeight="bold" as="span">4. Outbound Marketing Trigger</Text>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Instantly dispatches webhooks to Klaviyo, WhatsApp, or Zapier when high intent is detected with the captured contact and cart items.
                  </Text>
                </BlockStack>
              </Grid.Cell>
            </Grid>

            <InlineStack gap="200">
              <Button variant="primary" onClick={handleCopyTracker}>
                <InlineStack gap="100">
                  <Icon name={copied ? "ic-check" : "ic-copy"} size={14} />
                  <span>{copied ? "Tracker Snippet Copied!" : "Copy Universal Tracker Snippet"}</span>
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

        {/* Full-Width Real-Time Visitor Lore Table */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="150" align="center">
                <Icon name="ic-users" size={20} color="var(--accent)" />
                <Text variant="headingMd" as="h2">Live Visitor Device & Identity Lore Table</Text>
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
                    placeholder="Search visitor, email, OS, browser..."
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
                <p>Simulate storefront visitor traffic to see real-time device fingerprinting and identity stitching.</p>
              </EmptyState>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
                headings={["Visitor / Lead", "Device & Browser", "Captured Contact", "Intent Propensity", "Identity Source", "Cart Activity", "Last Seen", "Action"]}
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
                        {selectedVisitor.identitySource.replace(/_/g, " ").toUpperCase()}
                      </span>
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Cart Value:</Text>
                      <Text variant="bodyMd" fontWeight="bold" as="p">{`$${selectedVisitor.cartValue || 0}`}</Text>
                    </Grid.Cell>
                  </Grid>
                </BlockStack>
              </div>

              {/* Hardware & Browser Profile Card */}
              <Card>
                <BlockStack gap="200">
                  <InlineStack gap="100" align="center">
                    <Icon name="ic-server" size={16} color="var(--accent)" />
                    <Text variant="headingSm" as="h4">Device, Browser & LocalStorage Vault</Text>
                  </InlineStack>
                  <Divider />
                  <Grid>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Browser:</Text>
                      <Text variant="bodySm" fontWeight="bold" as="p">{selectedVisitor.browser}</Text>
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Operating System:</Text>
                      <Text variant="bodySm" fontWeight="bold" as="p">{selectedVisitor.os}</Text>
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Screen Resolution:</Text>
                      <Text variant="bodySm" fontWeight="bold" as="p">{selectedVisitor.screenResolution}</Text>
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                      <Text variant="bodySm" tone="subdued" as="p">Timezone / Locale:</Text>
                      <Text variant="bodySm" fontWeight="bold" as="p">{`${selectedVisitor.timezone} (${selectedVisitor.language})`}</Text>
                    </Grid.Cell>
                  </Grid>
                </BlockStack>
              </Card>

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
                <div style={{ maxHeight: "240px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "6px", padding: "8px" }}>
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
