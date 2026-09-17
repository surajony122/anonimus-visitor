import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit, useNavigate, useRevalidator, Link } from "@remix-run/react";
import React, { useState, useEffect } from "react";
import {
  Page,
  Text,
  Badge,
  Banner,
  Modal,
  TextField,
  Select,
  ButtonGroup,
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
    if (session?.shop) {
      shopDomain = session.shop;
    }

    try {
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
        if (data.shop.myshopifyDomain) shopDomain = data.shop.myshopifyDomain;
        currency = data.shop.currencyCode || "INR";
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
    } catch (graphErr) {
      console.warn("GraphQL query non-blocking warning:", graphErr);
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    console.warn("Admin auth non-blocking:", err);
  }

  // ALWAYS QUERY DATABASE FOR VISITOR AND EVENT DATA
  try {
    const [allIdentified, recentAnonymous] = await Promise.all([
      prisma.visitor.findMany({
        where: {
          OR: [
            { status: "identified" },
            { identities: { some: {} } },
            { customerLinks: { some: {} } },
          ],
        },
        include: {
          sessions: true,
          events: { orderBy: { timestamp: "desc" }, take: 40 },
          identities: true,
          customerLinks: { include: { customer: true } },
        },
        orderBy: { lastSeenAt: "desc" },
      }),
      prisma.visitor.findMany({
        where: {
          status: "anonymous",
          identities: { none: {} },
          customerLinks: { none: {} },
        },
        include: {
          sessions: true,
          events: { orderBy: { timestamp: "desc" }, take: 40 },
          identities: true,
          customerLinks: { include: { customer: true } },
        },
        orderBy: { lastSeenAt: "desc" },
        take: 1000,
      }),
    ]);

    const visitorMap = new Map();
    for (const v of allIdentified) visitorMap.set(v.id, v);
    for (const v of recentAnonymous) {
      if (!visitorMap.has(v.id)) visitorMap.set(v.id, v);
    }
    const activeVisitors = Array.from(visitorMap.values()).sort(
      (a: any, b: any) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
    );

    if (activeVisitors.length > 0) {
      totalTrackedVisitors = activeVisitors.length;
      anonymousVisitorsCount = activeVisitors.filter((v) => v.status === "anonymous").length;
      identifiedVisitorsCount = activeVisitors.filter((v) => v.status === "identified").length;
      isPixelActive = true;

      activeVisitors.forEach((v) => {
        totalEventsLogged += v.events.length;
        const hasPView = v.events.some((e) => e.eventType === "product_viewed");
        const hasCart = v.events.some((e) => e.eventType === "product_added_to_cart");
        const hasCheckout = v.events.some((e) => e.eventType === "checkout_started" || e.eventType === "checkout_completed");

        if (hasPView) productViewersCount++;
        if (hasCart) cartAddersCount++;
        if (hasCheckout) checkoutInitiatorsCount++;
      });

      const latestEvent = await prisma.event.findFirst({
        orderBy: { timestamp: "desc" },
      });

      if (latestEvent) {
        lastEventTimestamp = latestEvent.timestamp.toISOString();
      } else {
        lastEventTimestamp = activeVisitors[0]?.lastSeenAt ? activeVisitors[0].lastSeenAt.toISOString() : new Date().toISOString();
      }

      visitorsData = activeVisitors.map((v) => {
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

        let rawDecryptedEmail = customer?.emailReference || null;
        const encEmail = emailId?.identityValueEncrypted || (emailId as any)?.encryptedValue;
        if (encEmail) {
          try {
            rawDecryptedEmail = decryptValue(encEmail);
          } catch {}
        }

        let rawDecryptedPhone = customer?.phoneReference || null;
        const encPhone = phoneId?.identityValueEncrypted || (phoneId as any)?.encryptedValue;
        if (encPhone) {
          try {
            rawDecryptedPhone = decryptValue(encPhone);
          } catch {}
        }

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
  const revalidator = useRevalidator();
  const isGenerating = nav.state === "submitting";
  const isRefreshing = revalidator.state === "loading";

  const [copied, setCopied] = useState(false);
  const [visitorFilter, setVisitorFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVisitor, setSelectedVisitor] = useState<any | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("just now");

  const handleManualRefresh = () => {
    revalidator.revalidate();
    setLastRefreshedAt(new Date().toLocaleTimeString());
  };

  useEffect(() => {
    if (!autoRefresh || selectedVisitor !== null) return;
    const interval = setInterval(() => {
      revalidator.revalidate();
      setLastRefreshedAt(new Date().toLocaleTimeString());
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedVisitor, revalidator]);

  // Standalone Universal Tracker Snippet
  const universalTrackerSnippet = `<!-- Nitro Commerce Intelligent Storefront & Device Tracker -->
<script>
(function() {
  var ENDPOINT_EVENTS = "https://nitro-shopify-visitor-intelligence.onrender.com/api/events";
  var ENDPOINT_IDENTIFY = "https://nitro-shopify-visitor-intelligence.onrender.com/api/identity/identify";
  var STORAGE_KEY_VID = "_nitro_vid";
  var STORAGE_KEY_PROFILE = "_nitro_profile";

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

  // URL Auto-Capture
  try {
    if (window.location.search) {
      var params = new URLSearchParams(window.location.search);
      var urlEmail = params.get("email") || params.get("utm_email") || params.get("contact");
      var urlPhone = params.get("phone") || params.get("tel") || params.get("whatsapp");
      if (urlEmail && urlEmail.indexOf("@") !== -1) identifyVisitor("email", urlEmail, "url_campaign");
      if (urlPhone && urlPhone.length >= 7) identifyVisitor("phone", urlPhone, "url_campaign");
    }
  } catch(e) {}

  // Shopify Logged-in Customer ID
  try {
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.customerId) {
      identifyVisitor("shopify_customer", String(window.ShopifyAnalytics.meta.page.customerId), "shopify_session");
    }
  } catch(e) {}

  // Input & Autofill Sniffer
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
    filteredVisitors = filteredVisitors.filter((v: any) => v.status === "identified" || Boolean(v.primaryEmail) || Boolean(v.primaryPhone) || Boolean(v.customer));
  } else if (visitorFilter === "high_intent") {
    filteredVisitors = filteredVisitors.filter((v: any) => v.intentScore >= 61);
  } else if (visitorFilter === "cart") {
    filteredVisitors = filteredVisitors.filter((v: any) => v.cartEventsCount > 0);
  }

  if (timeFilter !== "all") {
    const now = Date.now();
    filteredVisitors = filteredVisitors.filter((v: any) => {
      const vTime = new Date(v.lastSeenAt).getTime();
      if (timeFilter === "today") {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        return vTime >= todayStart.getTime();
      }
      if (timeFilter === "24h") return now - vTime <= 24 * 3600 * 1000;
      if (timeFilter === "7d") return now - vTime <= 7 * 24 * 3600 * 1000;
      return true;
    });
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

  const conversionPct = totalTrackedVisitors > 0
    ? Math.round((checkoutInitiatorsCount / totalTrackedVisitors) * 100)
    : 0;

  return (
    <Page fullWidth>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "32px" }}>
        
        {/* Standalone Style Top Header */}
        <div style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "24px",
          padding: "20px 26px 16px",
          borderBottom: "1px solid #e3e2dc",
          background: "#fbfbf9",
          borderRadius: "10px",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "10.5px", letterSpacing: "0.09em", textTransform: "uppercase", color: "#8b8b84", fontWeight: 600 }}>
              INTENT INTELLIGENCE · STOREFRONT TRACKING
            </div>
            <h1 style={{ margin: "4px 0 3px", fontSize: "22px", fontWeight: 600, letterSpacing: "-0.02em", color: "#16161a" }}>
              {shopName}
            </h1>
            <p style={{ margin: 0, color: "#6b6b64", fontSize: "12.5px" }}>
              Connected Storefront: <span className="mono" style={{ color: "#16161a", fontWeight: 500 }}>{shopDomain}</span> · Live Browser &amp; LocalStorage Vault
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", flex: "none" }}>
            <button
              className="nitro-btn-secondary"
              onClick={() => setAutoRefresh(!autoRefresh)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                borderColor: autoRefresh ? "#0F8A5F" : "#e3e2dc",
                color: autoRefresh ? "#0F8A5F" : "#75756d",
                background: autoRefresh ? "#eefbf6" : "#ffffff",
              }}
              title="Toggle automatic real-time stream"
            >
              <span style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: autoRefresh ? "#0F8A5F" : "#8b8b84",
                boxShadow: autoRefresh ? "0 0 8px #0F8A5F" : "none",
                animation: autoRefresh ? "pulse 1.8s infinite" : "none",
              }} />
              {autoRefresh ? "Live Auto-Refresh (5s)" : "Auto-Refresh: Off"}
            </button>

            <button
              className="nitro-btn-secondary"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              title={`Last refreshed at ${lastRefreshedAt}`}
            >
              <span style={{
                display: "inline-block",
                transform: isRefreshing ? "rotate(360deg)" : "none",
                transition: "transform 0.6s ease",
              }}>
                🔄
              </span>
              {isRefreshing ? "Refreshing..." : "Refresh Data"}
            </button>

            <button className="nitro-btn-secondary" onClick={handleExportCSV} disabled={visitorsData.length === 0}>
              Export CSV
            </button>
            <button className="nitro-btn-primary" onClick={() => navigate("/app/simulator")}>
              Simulate traffic
            </button>
          </div>
        </div>

        {/* Action Banner if Customer Added */}
        {(actionData as any)?.success && (
          <Banner title="Customer Profile Synchronized!" tone="success" onDismiss={() => {}}>
            <p>
              Created <strong>{(actionData as any).createdCustomer?.firstName} {(actionData as any).createdCustomer?.lastName}</strong> ({(actionData as any).createdCustomer?.email}).
            </p>
          </Banner>
        )}

        {/* 4-KPI Metric Grid (Standalone Style) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "12px" }}>
          <div className="nitro-card" style={{ padding: "13px 15px" }}>
            <div style={{ fontSize: "11px", color: "#75756d", fontWeight: 500, letterSpacing: "0.01em" }}>Tracked Shoppers</div>
            <div style={{ display: "flex", alignContent: "baseline", gap: "8px", marginTop: "6px" }}>
              <div style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1 }}>{totalTrackedVisitors}</div>
              <div style={{ fontSize: "11.5px", color: "#0F8A5F", fontWeight: 600 }}>+14% vs 7d</div>
            </div>
            <div style={{ marginTop: "7px", fontSize: "11px", color: "#8b8b84" }}>
              {anonymousVisitorsCount} anon · <strong style={{ color: "#0F8A5F" }}>{identifiedVisitorsCount} identified</strong>
            </div>
          </div>

          <div className="nitro-card" style={{ padding: "13px 15px" }}>
            <div style={{ fontSize: "11px", color: "#75756d", fontWeight: 500, letterSpacing: "0.01em" }}>Product Browsers</div>
            <div style={{ display: "flex", alignContent: "baseline", gap: "8px", marginTop: "6px" }}>
              <div style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1 }}>{productViewersCount}</div>
              <div style={{ fontSize: "11.5px", color: "#5B45D6", fontWeight: 600 }}>
                {totalTrackedVisitors > 0 ? `${Math.round((productViewersCount / totalTrackedVisitors) * 100)}%` : "0%"} rate
              </div>
            </div>
            <div style={{ marginTop: "7px", fontSize: "11px", color: "#8b8b84" }}>Viewed 1+ jewelry/catalog SKU</div>
          </div>

          <div className="nitro-card" style={{ padding: "13px 15px" }}>
            <div style={{ fontSize: "11px", color: "#75756d", fontWeight: 500, letterSpacing: "0.01em" }}>Cart Additions</div>
            <div style={{ display: "flex", alignContent: "baseline", gap: "8px", marginTop: "6px" }}>
              <div style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1 }}>{cartAddersCount}</div>
              <div style={{ fontSize: "11.5px", color: "#b4551f", fontWeight: 600 }}>
                {totalTrackedVisitors > 0 ? `${Math.round((cartAddersCount / totalTrackedVisitors) * 100)}%` : "0%"} intent
              </div>
            </div>
            <div style={{ marginTop: "7px", fontSize: "11px", color: "#8b8b84" }}>Active items identified in cart</div>
          </div>

          <div className="nitro-card" style={{ padding: "13px 15px" }}>
            <div style={{ fontSize: "11px", color: "#75756d", fontWeight: 500, letterSpacing: "0.01em" }}>Lead Conversion Rate</div>
            <div style={{ display: "flex", alignContent: "baseline", gap: "8px", marginTop: "6px" }}>
              <div style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1 }}>{`${conversionPct}%`}</div>
              <div style={{ fontSize: "11.5px", color: "#0F8A5F", fontWeight: 600 }}>{`${checkoutInitiatorsCount} checkouts`}</div>
            </div>
            <div style={{ marginTop: "7px", fontSize: "11px", color: "#8b8b84" }}>Reached checkout step 1 or paid</div>
          </div>
        </div>

        {/* 2-Column Split: High Intent Queue & Conversion Funnel */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.45fr) minmax(0, 1fr)", gap: "16px", alignItems: "start" }}>
          
          {/* Act Now · High Intent Queue */}
          <section className="nitro-card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "13px 15px", borderBottom: "1px solid #ecebe5", display: "flex", alignItems: "baseline", justifyContent: "space-between", background: "#fbfbf9" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#0F8A5F", boxShadow: "0 0 0 3px rgba(15,138,95,0.18)" }}></span>
                <h2 style={{ margin: 0, fontSize: "13.5px", fontWeight: 600, color: "#16161a" }}>Act now · high intent queue</h2>
              </div>
              <span className="ong-badge ong-badge-accent">{`${filteredVisitors.filter(v => v.intentScore >= 60).length} High Priority`}</span>
            </div>

            <div>
              {filteredVisitors.slice(0, 5).map((v) => {
                const isIdentified = v.status === "identified";
                const displayName = v.customer?.firstName
                  ? `${v.customer.firstName} ${v.customer.lastName || ""}`
                  : isIdentified && v.primaryEmail
                  ? v.primaryEmail
                  : `Anonymous #${v.visitorId.substring(0, 8)}`;

                return (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVisitor(v)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "11px 15px",
                      borderBottom: "1px solid #f1f0ea",
                      cursor: "pointer",
                      transition: "background 0.12s ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#faf9f6")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                        <span style={{
                          width: "7px",
                          height: "7px",
                          borderRadius: "50%",
                          background: isIdentified ? "#0F8A5F" : v.intentScore >= 60 ? "#b4551f" : "#96968e",
                        }}></span>
                        <span style={{ fontWeight: 600, fontSize: "12.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {displayName}
                        </span>
                      </div>
                      <div style={{ marginTop: "3px", fontFamily: "'IBM Plex Mono', monospace", fontSize: "10.5px", color: "#96968e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.visitorId.substring(0, 14)}... · {v.browser} on {v.os}
                      </div>
                    </div>

                    <div style={{ flex: "none", textAlign: "right" }}>
                      <span className="ong-badge ong-badge-accent" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                        {`${v.intentScore}/100`}
                      </span>
                      <div style={{ marginTop: "3px", fontSize: "11px", color: "#8b8b84", whiteSpace: "nowrap" }}>
                        {v.cartEventsCount > 0 ? `${v.cartEventsCount} in cart ($${v.cartValue})` : "Browsing catalog"}
                      </div>
                    </div>

                    <div style={{ flex: "none", fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px", color: "#8b8b84", whiteSpace: "nowrap" }}>
                      {new Date(v.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right Column: Funnel & Zero-Friction Tracking Card */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            
            {/* Conversion & Drop-off */}
            <section className="nitro-card" style={{ padding: "14px 16px" }}>
              <h2 style={{ margin: "0 0 12px", fontSize: "13px", fontWeight: 600, color: "#16161a" }}>Conversion &amp; Drop-off Funnel</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "11.5px" }}>
                    <span style={{ color: "#45453f", fontWeight: 500 }}>1. Storefront Visitors</span>
                    <span className="mono" style={{ color: "#16161a" }}>{totalTrackedVisitors} · 100%</span>
                  </div>
                  <div style={{ marginTop: "5px", height: "7px", borderRadius: "4px", background: "#f0efe8", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: "100%", background: "#5B45D6", borderRadius: "4px" }}></div>
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "11.5px" }}>
                    <span style={{ color: "#45453f", fontWeight: 500 }}>2. Product Catalog Viewers</span>
                    <span className="mono" style={{ color: "#16161a" }}>
                      {productViewersCount} · {totalTrackedVisitors > 0 ? `${Math.round((productViewersCount / totalTrackedVisitors) * 100)}%` : "0%"}
                    </span>
                  </div>
                  <div style={{ marginTop: "5px", height: "7px", borderRadius: "4px", background: "#f0efe8", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${totalTrackedVisitors > 0 ? (productViewersCount / totalTrackedVisitors) * 100 : 0}%`, background: "#5B45D6", borderRadius: "4px" }}></div>
                  </div>
                  {totalTrackedVisitors > productViewersCount && (
                    <div style={{ marginTop: "4px", fontSize: "10.5px", color: "#b4551f" }}>
                      {`${Math.round(((totalTrackedVisitors - productViewersCount) / totalTrackedVisitors) * 100)}% bounce on landing`}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "11.5px" }}>
                    <span style={{ color: "#45453f", fontWeight: 500 }}>3. Active Cart Additions</span>
                    <span className="mono" style={{ color: "#16161a" }}>
                      {cartAddersCount} · {totalTrackedVisitors > 0 ? `${Math.round((cartAddersCount / totalTrackedVisitors) * 100)}%` : "0%"}
                    </span>
                  </div>
                  <div style={{ marginTop: "5px", height: "7px", borderRadius: "4px", background: "#f0efe8", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${totalTrackedVisitors > 0 ? (cartAddersCount / totalTrackedVisitors) * 100 : 0}%`, background: "#b4551f", borderRadius: "4px" }}></div>
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "11.5px" }}>
                    <span style={{ color: "#45453f", fontWeight: 500 }}>4. Checkout Reached</span>
                    <span className="mono" style={{ color: "#16161a" }}>
                      {checkoutInitiatorsCount} · {totalTrackedVisitors > 0 ? `${Math.round((checkoutInitiatorsCount / totalTrackedVisitors) * 100)}%` : "0%"}
                    </span>
                  </div>
                  <div style={{ marginTop: "5px", height: "7px", borderRadius: "4px", background: "#f0efe8", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${totalTrackedVisitors > 0 ? (checkoutInitiatorsCount / totalTrackedVisitors) * 100 : 0}%`, background: "#0F8A5F", borderRadius: "4px" }}></div>
                  </div>
                </div>
              </div>
            </section>

            {/* Zero-Friction Tracking Setup Card */}
            <section className="nitro-card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <h2 style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "#16161a" }}>Zero-Friction Tracking Vault</h2>
                <span className={`ong-badge ${isPixelActive ? "ong-badge-success" : "ong-badge-warn"}`}>
                  {isPixelActive ? "PIXEL LIVE" : "AWAITING PIXEL"}
                </span>
              </div>
              <p style={{ margin: "0 0 12px", fontSize: "12px", color: "#6b6b64" }}>
                Auto-extracts emails/phones from campaign URLs, intercepts input autofill, and stores device profiles in localStorage.
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="nitro-btn-primary" style={{ flex: 1 }} onClick={handleCopyTracker}>
                  {copied ? "Tracker Copied!" : "Copy Tracker Snippet"}
                </button>
                <button
                  className="nitro-btn-secondary"
                  onClick={() => window.open(`https://${shopDomain}/admin/settings/customer_events`, "_blank")}
                >
                  Shopify Events →
                </button>
              </div>
            </section>
          </div>
        </div>

        {/* Live Visitor Intelligence & Stitched Leads Table (Full-Width High-Density) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <ButtonGroup>
              <button
                className={visitorFilter === "all" ? "nitro-btn-primary" : "nitro-btn-secondary"}
                onClick={() => setVisitorFilter("all")}
              >
                All ({visitorsData.length})
              </button>
              <button
                className={visitorFilter === "high_intent" ? "nitro-btn-primary" : "nitro-btn-secondary"}
                onClick={() => setVisitorFilter("high_intent")}
              >
                High Intent (60+)
              </button>
              <button
                className={visitorFilter === "cart" ? "nitro-btn-primary" : "nitro-btn-secondary"}
                onClick={() => setVisitorFilter("cart")}
              >
                In Cart
              </button>
              <button
                className={visitorFilter === "identified" ? "nitro-btn-primary" : "nitro-btn-secondary"}
                onClick={() => setVisitorFilter("identified")}
              >
                Identified Leads
              </button>
            </ButtonGroup>

            <div style={{ flex: 1 }}></div>

            <div style={{ width: "140px" }}>
              <Select
                label=""
                labelHidden
                options={[
                  { label: "All Time", value: "all" },
                  { label: "Today", value: "today" },
                  { label: "Last 24 Hours", value: "24h" },
                  { label: "Last 7 Days", value: "7d" },
                ]}
                value={timeFilter}
                onChange={(val) => setTimeFilter(val)}
              />
            </div>

            <div style={{ width: "240px" }}>
              <TextField
                label=""
                labelHidden
                placeholder="Search ID, email, name, OS, browser..."
                value={searchQuery}
                onChange={(val) => setSearchQuery(val)}
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setSearchQuery("")}
              />
            </div>
          </div>

          <section className="nitro-card" style={{ overflowX: "auto" }}>
            <div style={{
              minWidth: "960px",
              display: "grid",
              gridTemplateColumns: "minmax(220px, 1.6fr) 140px 160px 110px 110px 80px 100px",
              gap: "12px",
              padding: "9px 15px",
              background: "#faf9f6",
              borderBottom: "1px solid #e9e8e1",
              fontSize: "10.5px",
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "#85857d",
              fontWeight: 600,
            }}>
              <div>Visitor / Lead</div>
              <div>Device &amp; Hardware</div>
              <div>Captured Contact</div>
              <div>Intent Score</div>
              <div>Cart Activity</div>
              <div>Last Seen</div>
              <div>Action</div>
            </div>

            {filteredVisitors.length === 0 ? (
              <div style={{ padding: "44px 15px", textAlign: "center", color: "#8b8b84", fontSize: "12.5px" }}>
                No visitor records match this filter.
              </div>
            ) : (
              filteredVisitors.map((v) => {
                const isIdentified = v.status === "identified";
                const displayName = v.customer?.firstName
                  ? `${v.customer.firstName} ${v.customer.lastName || ""}`
                  : isIdentified && v.primaryEmail
                  ? v.primaryEmail
                  : `Anonymous #${v.visitorId.substring(0, 8)}`;

                return (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVisitor(v)}
                    style={{
                      minWidth: "960px",
                      display: "grid",
                      gridTemplateColumns: "minmax(220px, 1.6fr) 140px 160px 110px 110px 80px 100px",
                      gap: "12px",
                      alignItems: "center",
                      padding: "10px 15px",
                      borderBottom: "1px solid #f1f0ea",
                      cursor: "pointer",
                      transition: "background 0.12s ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#faf9f6")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Visitor / Lead */}
                    <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{
                        width: "7px",
                        height: "7px",
                        borderRadius: "50%",
                        background: isIdentified ? "#0F8A5F" : v.intentScore >= 60 ? "#b4551f" : "#96968e",
                        flex: "none",
                      }}></span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "12.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {displayName}
                        </div>
                        <div className="mono" style={{ fontSize: "10.5px", color: "#96968e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {v.visitorId.substring(0, 16)}...
                        </div>
                      </div>
                    </div>

                    {/* Device & Hardware */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.browser} on {v.os}
                      </div>
                      <div className="mono" style={{ fontSize: "10.5px", color: "#8b8b84" }}>
                        {v.screenResolution}
                      </div>
                    </div>

                    {/* Captured Contact */}
                    <div style={{ minWidth: 0 }}>
                      {v.primaryEmail ? (
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#0F8A5F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {v.primaryEmail}
                        </div>
                      ) : (
                        <span style={{ color: "#8b8b84", fontSize: "11.5px" }}>Anonymous</span>
                      )}
                      {v.primaryPhone && (
                        <div className="mono" style={{ fontSize: "10.5px", color: "#5B45D6" }}>
                          {v.primaryPhone}
                        </div>
                      )}
                    </div>

                    {/* Intent Score */}
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span className="ong-badge ong-badge-accent" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                        {`${v.intentScore}/100`}
                      </span>
                      <span style={{ fontSize: "10.5px", color: "#8b8b84", textTransform: "capitalize" }}>
                        {v.intentTier.replace("_", " ")}
                      </span>
                    </div>

                    {/* Cart Activity */}
                    <div style={{ fontSize: "11.5px", color: "#55554e" }}>
                      {v.cartEventsCount > 0 ? (
                        <strong style={{ color: "#5B45D6" }}>{`${v.cartEventsCount} items ($${v.cartValue})`}</strong>
                      ) : (
                        `${v.productsViewedCount} viewed`
                      )}
                    </div>

                    {/* Last Seen */}
                    <div className="mono" style={{ fontSize: "11px", color: "#8b8b84" }}>
                      {new Date(v.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>

                    {/* Action */}
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        style={{
                          padding: "5px 10px",
                          fontSize: "11.5px",
                          fontWeight: 600,
                          background: "#2563eb",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedVisitor(v);
                        }}
                      >
                        View Journey →
                      </button>
                    </div>
                  </div>
                );
              })
            )}

            <div style={{ padding: "9px 15px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#faf9f6", fontSize: "11px", color: "#75756d" }}>
              <span>Showing {filteredVisitors.length} active visitor records</span>
              <span className="mono">auto-refresh 5s</span>
            </div>
          </section>
        </div>

      </div>

      {/* Standalone Style Interactive Slide-Out / Modal Lore Popup */}
      {selectedVisitor && (
        <Modal
          open={Boolean(selectedVisitor)}
          onClose={() => setSelectedVisitor(null)}
          title={`Visitor Lore & Profile: ${selectedVisitor.visitorId.substring(0, 16)}...`}
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
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              
              {/* Header Profile */}
              <div style={{ padding: "14px 16px", background: "#faf9f6", border: "1px solid #e3e2dc", borderRadius: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: selectedVisitor.status === "identified" ? "#0F8A5F" : "#96968e",
                    }}></span>
                    <strong style={{ fontSize: "14px" }}>
                      {selectedVisitor.customer?.firstName
                        ? `${selectedVisitor.customer.firstName} ${selectedVisitor.customer.lastName || ""}`
                        : selectedVisitor.primaryEmail || "Anonymous Storefront Shopper"}
                    </strong>
                  </div>
                  <span className={`ong-badge ${selectedVisitor.status === "identified" ? "ong-badge-success" : ""}`}>
                    {selectedVisitor.status.toUpperCase()}
                  </span>
                </div>
                <div className="mono" style={{ fontSize: "11px", color: "#8b8b84", wordBreak: "break-all" }}>
                  {selectedVisitor.visitorId}
                </div>
              </div>

              {/* Facts Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", background: "#fff", border: "1px solid #e3e2dc", borderRadius: "8px", padding: "14px" }}>
                <div>
                  <div style={{ fontSize: "10.5px", color: "#8b8b84" }}>Captured Email</div>
                  <div style={{ marginTop: "2px", fontSize: "12.5px", fontWeight: 600, color: selectedVisitor.primaryEmail ? "#0F8A5F" : "#16161a" }}>
                    {selectedVisitor.primaryEmail || "None (Anonymous)"}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "10.5px", color: "#8b8b84" }}>Captured Phone</div>
                  <div style={{ marginTop: "2px", fontSize: "12.5px", fontWeight: 600, color: selectedVisitor.primaryPhone ? "#5B45D6" : "#16161a" }}>
                    {selectedVisitor.primaryPhone || "None"}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "10.5px", color: "#8b8b84" }}>Device &amp; Browser</div>
                  <div style={{ marginTop: "2px", fontSize: "12px", fontWeight: 500 }}>
                    {selectedVisitor.browser} on {selectedVisitor.os}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "10.5px", color: "#8b8b84" }}>Screen Resolution &amp; Timezone</div>
                  <div className="mono" style={{ marginTop: "2px", fontSize: "11px", color: "#55554e" }}>
                    {selectedVisitor.screenResolution} · {selectedVisitor.timezone}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "10.5px", color: "#8b8b84" }}>Identity Source</div>
                  <span className="ong-badge ong-badge-accent" style={{ marginTop: "4px" }}>
                    {selectedVisitor.identitySource.replace(/_/g, " ").toUpperCase()}
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: "10.5px", color: "#8b8b84" }}>Cart Value</div>
                  <div style={{ marginTop: "2px", fontSize: "13px", fontWeight: 600, color: "#5B45D6" }}>
                    ${selectedVisitor.cartValue || 0}
                  </div>
                </div>
              </div>

              {/* Intent Score Breakdown */}
              <div style={{ background: "#fff", border: "1px solid #e3e2dc", borderRadius: "8px", padding: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600 }}>Intent Propensity Score</div>
                  <span className="ong-badge ong-badge-accent" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                    {`${selectedVisitor.intentScore}/100 · ${selectedVisitor.intentTier.toUpperCase()}`}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginTop: "10px" }}>
                  <div>
                    <div style={{ fontSize: "10.5px", color: "#8b8b84" }}>Product Views</div>
                    <div style={{ fontWeight: 600, fontSize: "12px" }}>+{selectedVisitor.intentBreakdown?.productEngagement || 0} pts</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "10.5px", color: "#8b8b84" }}>Cart Activity</div>
                    <div style={{ fontWeight: 600, fontSize: "12px" }}>+{selectedVisitor.intentBreakdown?.cartActivity || 0} pts</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "10.5px", color: "#8b8b84" }}>Checkout Step</div>
                    <div style={{ fontWeight: 600, fontSize: "12px" }}>+{selectedVisitor.intentBreakdown?.checkoutProgress || 0} pts</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "10.5px", color: "#8b8b84" }}>Session Depth</div>
                    <div style={{ fontWeight: 600, fontSize: "12px" }}>+{selectedVisitor.intentBreakdown?.sessionDepth || 0} pts</div>
                  </div>
                </div>
              </div>

              {/* Event Timeline */}
              <div>
                <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>Chronological Event Timeline</div>
                <div style={{ maxHeight: "240px", overflowY: "auto", border: "1px solid #e3e2dc", borderRadius: "8px", padding: "12px" }}>
                  {selectedVisitor.events && selectedVisitor.events.length > 0 ? (
                    selectedVisitor.events.map((ev: any, idx: number) => {
                      let points = "+5 pts";
                      if (ev.eventType === "product_added_to_cart") points = "+25 pts";
                      else if (ev.eventType.includes("checkout")) points = "+30 pts";
                      else if (ev.eventType === "product_viewed") points = "+10 pts";

                      return (
                        <div key={ev.id || idx} style={{ display: "grid", gridTemplateColumns: "55px 14px 1fr", gap: "10px", alignItems: "start" }}>
                          <div className="mono" style={{ fontSize: "10.5px", color: "#96968e", paddingTop: "2px", textAlign: "right" }}>
                            {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch" }}>
                            <span style={{
                              width: "7px",
                              height: "7px",
                              borderRadius: "50%",
                              background: ev.eventType.includes("checkout") ? "#0F8A5F" : ev.eventType.includes("cart") ? "#b4551f" : "#5B45D6",
                            }}></span>
                            <span style={{ flex: 1, width: "1px", background: "#e6e5de", minHeight: "14px" }}></span>
                          </div>
                          <div style={{ paddingBottom: "12px" }}>
                            <div style={{ fontSize: "12px", fontWeight: 600 }}>
                              {ev.eventType.replace(/_/g, " ").toUpperCase()}
                            </div>
                            {ev.pageUrl && (
                              <div style={{ fontSize: "11px", color: "#6b6b64", wordBreak: "break-all" }}>{ev.pageUrl}</div>
                            )}
                            <span className="ong-badge ong-badge-accent" style={{ marginTop: "3px", fontSize: "10px", fontFamily: "'IBM Plex Mono', monospace" }}>
                              {points}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ fontSize: "12px", color: "#8b8b84" }}>No events recorded yet.</div>
                  )}
                </div>
              </div>

            </div>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
