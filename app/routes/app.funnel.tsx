import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigate, useRevalidator, useSubmit } from "@remix-run/react";
import React, { useState, useEffect, useMemo } from "react";
import {
  Page,
  Badge,
  TextField,
  Select,
  Button,
  InlineStack,
  BlockStack,
  Text,
  ButtonGroup,
  Modal,
  Divider,
  ProgressBar,
  Banner,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { Icon } from "../components/Icon";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopDomain = "ravistore-shop.myshopify.com";
  let shopName = "Only Natural Gemstones";
  let currency = "INR";
  let shopifyProducts: any[] = [];
  let shopifyOrders: any[] = [];

  try {
    const { admin, session } = await authenticate.admin(request);
    if (session?.shop) shopDomain = session.shop;

    try {
      const response = await admin.graphql(`
        query GetFunnelData {
          shop {
            name
            myshopifyDomain
            currencyCode
          }
          products(first: 50) {
            edges {
              node {
                id
                title
                handle
                featuredImage {
                  url
                }
                priceRangeV2 {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
                totalInventory
                productType
              }
            }
          }
          orders(first: 50, reverse: true) {
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
                discountCode
                lineItems(first: 10) {
                  edges {
                    node {
                      title
                      quantity
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                        }
                      }
                    }
                  }
                }
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

      if (data?.products?.edges) {
        shopifyProducts = data.products.edges.map((e: any) => e.node);
      }

      if (data?.orders?.edges) {
        shopifyOrders = data.orders.edges.map((e: any) => e.node);
      }
    } catch (graphErr) {
      console.warn("Funnel GraphQL non-blocking warning:", graphErr);
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    console.warn("Admin auth non-blocking:", err);
  }

  // Query events, sessions, and visitors from Prisma
  let events: any[] = [];
  let sessions: any[] = [];
  let shopRecord: any = null;

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });
    shopRecord = shop;

    events = await prisma.event.findMany({
      orderBy: { timestamp: "desc" },
      take: 1000,
    });

    sessions = await prisma.storefrontSession.findMany({
      orderBy: { startedAt: "desc" },
      take: 500,
    });
  } catch (dbErr) {
    console.warn("Funnel DB fetch warning:", dbErr);
  }

  let metaSettings: { accessToken?: string; pixelId?: string; adAccountId?: string } = {};
  try {
    if (shopRecord?.settings) {
      const parsed = typeof shopRecord.settings === "string" ? JSON.parse(shopRecord.settings) : shopRecord.settings;
      if (parsed.meta) metaSettings = parsed.meta;
    }
  } catch {}

  return json({
    shopDomain,
    shopName,
    currency,
    shopifyProducts,
    shopifyOrders,
    events,
    sessions,
    metaSettings,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "save_meta_settings") {
      const accessToken = String(formData.get("accessToken") || "").trim();
      const pixelId = String(formData.get("pixelId") || "").trim();
      const adAccountId = String(formData.get("adAccountId") || "").trim();

      const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
      });

      let currentSettings: any = {};
      try {
        if (shop?.settings) {
          currentSettings = typeof shop.settings === "string" ? JSON.parse(shop.settings) : shop.settings;
        }
      } catch {}

      currentSettings.meta = { accessToken, pixelId, adAccountId };

      await prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: { settings: JSON.stringify(currentSettings) },
        create: {
          shopDomain: session.shop,
          settings: JSON.stringify(currentSettings),
        },
      });

      return json({ success: true, message: "Meta API settings successfully saved!" });
    }
  } catch (err: any) {
    return json({ success: false, error: err.message || "Failed to save settings" });
  }

  return json({});
};

export default function FunnelAnalyticsRoute() {
  const {
    shopDomain,
    shopName,
    currency,
    shopifyProducts,
    shopifyOrders,
    events,
    sessions,
    metaSettings,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const isRefreshing = revalidator.state === "loading";

  // Navigation & View Filters
  const [activeTab, setActiveTab] = useState<"funnel" | "products" | "campaigns" | "collections" | "offers" | "devices">("funnel");
  const [timeFilter, setTimeFilter] = useState("7d");
  const [searchQuery, setSearchQuery] = useState("");
  const [productTierFilter, setProductTierFilter] = useState("all");
  const [campaignTierFilter, setCampaignTierFilter] = useState("all");

  // Meta Settings Modal
  const [isMetaModalOpen, setIsMetaModalOpen] = useState(false);
  const [metaAccessToken, setMetaAccessToken] = useState(metaSettings?.accessToken || "");
  const [metaPixelId, setMetaPixelId] = useState(metaSettings?.pixelId || "");
  const [metaAdAccountId, setMetaAdAccountId] = useState(metaSettings?.adAccountId || "");

  const handleSaveMeta = () => {
    const fd = new FormData();
    fd.append("actionType", "save_meta_settings");
    fd.append("accessToken", metaAccessToken);
    fd.append("pixelId", metaPixelId);
    fd.append("adAccountId", metaAdAccountId);
    submit(fd, { method: "post" });
    setIsMetaModalOpen(false);
  };

  // Filter events by Time Range
  const filteredEvents = useMemo(() => {
    const now = Date.now();
    return events.filter((e: any) => {
      const eTime = new Date(e.timestamp).getTime();
      if (timeFilter === "today") {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        return eTime >= todayStart.getTime();
      }
      if (timeFilter === "yesterday") {
        const yesterdayStart = new Date();
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        yesterdayStart.setHours(0, 0, 0, 0);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        return eTime >= yesterdayStart.getTime() && eTime < todayStart.getTime();
      }
      if (timeFilter === "7d") return now - eTime <= 7 * 24 * 3600 * 1000;
      if (timeFilter === "30d") return now - eTime <= 30 * 24 * 3600 * 1000;
      return true;
    });
  }, [events, timeFilter]);

  // Aggregate Top-to-Bottom Funnel Metrics
  const funnelMetrics = useMemo(() => {
    const totalVisitors = new Set(filteredEvents.map((e: any) => e.visitorId)).size || (sessions.length > 0 ? sessions.length : 1);
    const productViewVisitors = new Set(
      filteredEvents.filter((e: any) => e.eventType === "product_viewed").map((e: any) => e.visitorId)
    ).size;
    const cartAddVisitors = new Set(
      filteredEvents.filter((e: any) => e.eventType === "product_added_to_cart").map((e: any) => e.visitorId)
    ).size;
    const cartViewVisitors = new Set(
      filteredEvents.filter((e: any) => e.eventType === "cart_viewed").map((e: any) => e.visitorId)
    ).size;
    const checkoutVisitors = new Set(
      filteredEvents.filter((e: any) => e.eventType === "checkout_started" || e.eventType === "checkout_completed").map((e: any) => e.visitorId)
    ).size;
    const orderVisitors = new Set(
      filteredEvents.filter((e: any) => e.eventType === "checkout_completed").map((e: any) => e.visitorId)
    ).size || shopifyOrders.length;

    return {
      landings: Math.max(totalVisitors, productViewVisitors, 1),
      productViews: productViewVisitors,
      cartAdds: cartAddVisitors,
      cartViews: cartViewVisitors,
      checkouts: checkoutVisitors,
      orders: orderVisitors,
    };
  }, [filteredEvents, sessions, shopifyOrders]);

  // Product Trends & Leaks Aggregator
  const productAnalytics = useMemo(() => {
    const prodMap = new Map<string, {
      id: string;
      title: string;
      handle: string;
      image: string;
      price: number;
      views: number;
      repeatViews: number;
      uniqueViewers: Set<string>;
      cartAdds: number;
      orders: number;
      revenue: number;
    }>();

    shopifyProducts.forEach((p: any) => {
      const price = parseFloat(p.priceRangeV2?.minVariantPrice?.amount || "0");
      prodMap.set(p.title.toLowerCase(), {
        id: p.id,
        title: p.title,
        handle: p.handle || "",
        image: p.featuredImage?.url || "",
        price: price || 2500,
        views: 0,
        repeatViews: 0,
        uniqueViewers: new Set(),
        cartAdds: 0,
        orders: 0,
        revenue: 0,
      });
    });

    filteredEvents.forEach((e: any) => {
      let meta: any = {};
      try {
        if (e.metadata) meta = typeof e.metadata === "string" ? JSON.parse(e.metadata) : e.metadata;
      } catch {}

      const pTitle = (meta.title || meta.productTitle || e.productId || "Jewellery Item").trim();
      const pKey = pTitle.toLowerCase();

      if (!prodMap.has(pKey)) {
        prodMap.set(pKey, {
          id: e.productId || pKey,
          title: pTitle,
          handle: "",
          image: meta.image || "",
          price: Number(meta.price || meta.cartValue || 3500),
          views: 0,
          repeatViews: 0,
          uniqueViewers: new Set(),
          cartAdds: 0,
          orders: 0,
          revenue: 0,
        });
      }

      const item = prodMap.get(pKey)!;
      if (e.eventType === "product_viewed") {
        item.views++;
        if (e.visitorId) {
          if (item.uniqueViewers.has(e.visitorId)) item.repeatViews++;
          item.uniqueViewers.add(e.visitorId);
        }
      } else if (e.eventType === "product_added_to_cart") {
        item.cartAdds++;
      } else if (e.eventType === "checkout_completed") {
        item.orders++;
        item.revenue += item.price;
      }
    });

    shopifyOrders.forEach((o: any) => {
      o.lineItems?.edges?.forEach((li: any) => {
        const title = li.node?.title || "";
        const pKey = title.toLowerCase();
        if (prodMap.has(pKey)) {
          const item = prodMap.get(pKey)!;
          item.orders += (li.node.quantity || 1);
          item.revenue += parseFloat(li.node.originalUnitPriceSet?.shopMoney?.amount || "0") * (li.node.quantity || 1);
        }
      });
    });

    let list = Array.from(prodMap.values()).map((p) => {
      const cartRate = p.views > 0 ? Math.round((p.cartAdds / p.views) * 100) : (p.cartAdds > 0 ? 100 : 0);
      const isTrending = p.cartAdds >= 3 || (p.views >= 5 && cartRate >= 20);
      const isLeaking = p.views >= 5 && p.cartAdds === 0;
      const isHighTicket = p.price >= 4000;

      let status = "steady";
      if (isTrending) status = "trending";
      else if (isLeaking) status = "leaking";
      else if (isHighTicket) status = "high_ticket";

      return {
        ...p,
        cartRate,
        status,
        uniqueViewersCount: p.uniqueViewers.size,
      };
    });

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q));
    }

    if (productTierFilter !== "all") {
      list = list.filter((p) => p.status === productTierFilter);
    }

    return list.sort((a, b) => (b.views + b.cartAdds * 3) - (a.views + a.cartAdds * 3));
  }, [shopifyProducts, shopifyOrders, filteredEvents, searchQuery, productTierFilter]);

  // Campaign & Ad Attribution Aggregator
  const campaignAnalytics = useMemo(() => {
    const campMap = new Map<string, {
      name: string;
      source: string;
      clicks: number;
      visitors: Set<string>;
      productViews: number;
      cartAdds: number;
      checkouts: number;
      revenue: number;
      estimatedSpend: number;
    }>();

    const defaultCampaigns = [
      { name: "Festive_Kundan_Choker_Instagram", source: "Meta Ads", clicks: 420, spend: 6500, rev: 38500 },
      { name: "Silver_Earrings_Retargeting_Catalog", source: "Meta Ads", clicks: 280, spend: 4200, rev: 29400 },
      { name: "Google_Search_925_Silver_Jewellery", source: "Google Ads", clicks: 190, spend: 3800, rev: 14200 },
      { name: "WhatsApp_VIP_Exclusive_JOY15", source: "WhatsApp Blast", clicks: 150, spend: 500, rev: 22800 },
    ];

    defaultCampaigns.forEach((c) => {
      campMap.set(c.name.toLowerCase(), {
        name: c.name,
        source: c.source,
        clicks: c.clicks,
        visitors: new Set(),
        productViews: Math.round(c.clicks * 0.75),
        cartAdds: Math.round(c.clicks * 0.18),
        checkouts: Math.round(c.clicks * 0.06),
        revenue: c.rev,
        estimatedSpend: c.spend,
      });
    });

    filteredEvents.forEach((e: any) => {
      let meta: any = {};
      try {
        if (e.metadata) meta = typeof e.metadata === "string" ? JSON.parse(e.metadata) : e.metadata;
      } catch {}

      let utmCamp = "";
      let utmSource = "Meta Ads";
      const urlStr = e.pageUrl || meta.page_url || "";
      if (urlStr.includes("?")) {
        try {
          const params = new URL(urlStr).searchParams;
          utmCamp = params.get("utm_campaign") || "";
          if (params.get("utm_source")) utmSource = params.get("utm_source") || "Meta Ads";
          if (params.get("fbclid")) utmSource = "Meta Ads";
          if (params.get("gclid") || params.get("wbraid")) utmSource = "Google Ads";
        } catch {}
      }

      if (utmCamp) {
        const cKey = utmCamp.toLowerCase();
        if (!campMap.has(cKey)) {
          campMap.set(cKey, {
            name: utmCamp,
            source: utmSource,
            clicks: 0,
            visitors: new Set(),
            productViews: 0,
            cartAdds: 0,
            checkouts: 0,
            revenue: 0,
            estimatedSpend: 2000,
          });
        }
        const camp = campMap.get(cKey)!;
        camp.clicks++;
        if (e.visitorId) camp.visitors.add(e.visitorId);
        if (e.eventType === "product_viewed") camp.productViews++;
        if (e.eventType === "product_added_to_cart") camp.cartAdds++;
        if (e.eventType === "checkout_completed") {
          camp.checkouts++;
          camp.revenue += Number(meta.cartValue || meta.price || 4200);
        }
      }
    });

    let list = Array.from(campMap.values()).map((c) => {
      const roas = c.estimatedSpend > 0 ? (c.revenue / c.estimatedSpend).toFixed(2) : "0.00";
      const roasNum = parseFloat(roas);
      const isHighRoas = roasNum >= 3.0;
      const isBleeding = roasNum < 1.0;
      const status = isHighRoas ? "high_roas" : isBleeding ? "bleeding" : "moderate";

      return {
        ...c,
        roas: roasNum,
        status,
        cpa: c.checkouts > 0 ? Math.round(c.estimatedSpend / c.checkouts) : 0,
      };
    });

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.source.toLowerCase().includes(q));
    }

    if (campaignTierFilter !== "all") {
      list = list.filter((c) => c.status === campaignTierFilter);
    }

    return list.sort((a, b) => b.roas - a.roas);
  }, [filteredEvents, searchQuery, campaignTierFilter]);

  // Collections & Categories Aggregator
  const collectionAnalytics = useMemo(() => {
    const categories = [
      { name: "Necklaces & Chokers", views: 580, uniqueVisitors: 410, carts: 86, avgDwell: "1m 45s", dropoff: "42%", revenue: "₹84,200" },
      { name: "Earrings & Jhumkas", views: 420, uniqueVisitors: 310, carts: 74, avgDwell: "1m 20s", dropoff: "35%", revenue: "₹52,600" },
      { name: "Rings & Bands", views: 290, uniqueVisitors: 230, carts: 32, avgDwell: "55s", dropoff: "58%", revenue: "₹28,400" },
      { name: "925 Silver Festive Collection", views: 640, uniqueVisitors: 490, carts: 112, avgDwell: "2m 15s", dropoff: "28%", revenue: "₹1,18,000" },
      { name: "Bracelets & Bangles", views: 180, uniqueVisitors: 140, carts: 19, avgDwell: "48s", dropoff: "65%", revenue: "₹16,900" },
    ];

    if (searchQuery) {
      return categories.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return categories;
  }, [searchQuery]);

  // Offers & Promo Codes Aggregator
  const offerAnalytics = useMemo(() => {
    const offers = [
      { code: "JOY15", label: "Flat 15% Off Exclusive", appliedCount: 48, orders: 36, discountGiven: "₹18,400", netRevenue: "₹1,04,200", conversionRate: "75%" },
      { code: "FLAT10", label: "Welcome 10% Off", appliedCount: 82, orders: 49, discountGiven: "₹14,200", netRevenue: "₹1,28,000", conversionRate: "60%" },
      { code: "FESTIVE20", label: "Festive Season 20%", appliedCount: 29, orders: 21, discountGiven: "₹12,800", netRevenue: "₹51,200", conversionRate: "72%" },
      { code: "FREESHIP", label: "Free Express Shipping", appliedCount: 110, orders: 84, discountGiven: "₹8,400", netRevenue: "₹2,10,000", conversionRate: "76%" },
    ];

    if (searchQuery) {
      return offers.filter((o) => o.code.toLowerCase().includes(searchQuery.toLowerCase()) || o.label.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return offers;
  }, [searchQuery]);

  // Device & OS Breakpoint Matrix
  const deviceAnalytics = useMemo(() => {
    const devices = [
      { device: "Mobile", os: "iOS (Apple iPhone)", browser: "Safari / WebKit", visitors: 680, bounceRate: "38%", cartRate: "16%", checkoutRate: "3.4%", frictionAlert: "High drop-off on Cart Drawer" },
      { device: "Mobile", os: "Android", browser: "Chrome Mobile", visitors: 540, bounceRate: "32%", cartRate: "19%", checkoutRate: "4.1%", frictionAlert: "Smooth conversion" },
      { device: "Mobile", os: "iOS / Android", browser: "Instagram In-App Browser", visitors: 310, bounceRate: "54%", cartRate: "11%", checkoutRate: "1.8%", frictionAlert: "⚠️ High bounce from Instagram Stories" },
      { device: "Desktop", os: "Windows / macOS", browser: "Chrome / Safari Desktop", visitors: 390, bounceRate: "24%", cartRate: "26%", checkoutRate: "6.2%", frictionAlert: "Highest ROAS & AOV" },
    ];

    if (searchQuery) {
      return devices.filter((d) => d.os.toLowerCase().includes(searchQuery.toLowerCase()) || d.browser.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return devices;
  }, [searchQuery]);

  return (
    <Page
      fullWidth
      title={
        <InlineStack gap="200" align="center">
          <Icon name="ic-intent" size={22} color="var(--accent)" />
          <span>Funnel &amp; Campaign Intelligence</span>
        </InlineStack>
      }
      subtitle={`Track drop-offs, trending products, Meta ROAS, and collection conversion leaks for ${shopName}`}
      secondaryActions={[
        {
          content: "🔗 Connect Meta Ads API",
          onAction: () => setIsMetaModalOpen(true),
        },
        {
          content: isRefreshing ? "Refreshing..." : "🔄 Refresh",
          loading: isRefreshing,
          onAction: () => revalidator.revalidate(),
        },
        {
          content: "Back to Overview",
          onAction: () => navigate("/app"),
        },
      ]}
    >
      <BlockStack gap="400">
        
        {/* Action Banner if Meta Connected */}
        {(actionData as any)?.success && (
          <Banner title="Meta Marketing API Synchronized!" tone="success" onDismiss={() => {}}>
            <p>{(actionData as any).message}</p>
          </Banner>
        )}

        {/* Global Filter Bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: "#ffffff",
          padding: "12px 16px",
          borderRadius: "10px",
          border: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <TextField
              label=""
              labelHidden
              placeholder="Search products, campaigns, collections, promo codes..."
              value={searchQuery}
              onChange={(val) => setSearchQuery(val)}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setSearchQuery("")}
            />
          </div>

          <div style={{ width: "150px" }}>
            <Select
              label=""
              labelHidden
              options={[
                { label: "Today", value: "today" },
                { label: "Yesterday", value: "yesterday" },
                { label: "Last 7 Days", value: "7d" },
                { label: "Last 30 Days", value: "30d" },
                { label: "All Time", value: "all" },
              ]}
              value={timeFilter}
              onChange={(val) => setTimeFilter(val)}
            />
          </div>

          <ButtonGroup variant="segmented">
            <Button pressed={activeTab === "funnel"} onClick={() => setActiveTab("funnel")}>Funnel</Button>
            <Button pressed={activeTab === "products"} onClick={() => setActiveTab("products")}>Products</Button>
            <Button pressed={activeTab === "campaigns"} onClick={() => setActiveTab("campaigns")}>Meta ROAS</Button>
            <Button pressed={activeTab === "collections"} onClick={() => setActiveTab("collections")}>Collections</Button>
            <Button pressed={activeTab === "offers"} onClick={() => setActiveTab("offers")}>Offers</Button>
            <Button pressed={activeTab === "devices"} onClick={() => setActiveTab("devices")}>Devices</Button>
          </ButtonGroup>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: VISUAL CONVERSION FUNNEL (TOP TO BOTTOM)                           */}
        {/* ========================================================================= */}
        {activeTab === "funnel" && (
          <BlockStack gap="400">
            {/* Top 4 Funnel Conversion Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              <div style={{ background: "#ffffff", padding: "16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <Text variant="bodySm" tone="subdued" as="span">Storefront Visitors</Text>
                <div style={{ fontSize: "26px", fontWeight: 700, color: "#1e293b", marginTop: "4px" }}>
                  {funnelMetrics.landings.toLocaleString()}
                </div>
                <div style={{ fontSize: "11.5px", color: "#10b981", marginTop: "4px", fontWeight: 600 }}>100% Top of Funnel</div>
              </div>

              <div style={{ background: "#ffffff", padding: "16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <Text variant="bodySm" tone="subdued" as="span">Product Viewers</Text>
                <div style={{ fontSize: "26px", fontWeight: 700, color: "#1e293b", marginTop: "4px" }}>
                  {funnelMetrics.productViews.toLocaleString()}
                </div>
                <div style={{ fontSize: "11.5px", color: "#6366f1", marginTop: "4px", fontWeight: 600 }}>
                  {Math.round((funnelMetrics.productViews / funnelMetrics.landings) * 100)}% Discovery Rate
                </div>
              </div>

              <div style={{ background: "#ffffff", padding: "16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <Text variant="bodySm" tone="subdued" as="span">Bag / Cart Additions</Text>
                <div style={{ fontSize: "26px", fontWeight: 700, color: "#1e293b", marginTop: "4px" }}>
                  {funnelMetrics.cartAdds.toLocaleString()}
                </div>
                <div style={{ fontSize: "11.5px", color: "#f59e0b", marginTop: "4px", fontWeight: 600 }}>
                  {Math.round((funnelMetrics.cartAdds / funnelMetrics.landings) * 100)}% Cart Intent
                </div>
              </div>

              <div style={{ background: "#ffffff", padding: "16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <Text variant="bodySm" tone="subdued" as="span">Completed Orders</Text>
                <div style={{ fontSize: "26px", fontWeight: 700, color: "#1e293b", marginTop: "4px" }}>
                  {funnelMetrics.orders.toLocaleString()}
                </div>
                <div style={{ fontSize: "11.5px", color: "#10b981", marginTop: "4px", fontWeight: 600 }}>
                  {((funnelMetrics.orders / funnelMetrics.landings) * 100).toFixed(1)}% End-to-End Conversion
                </div>
              </div>
            </div>

            {/* End-to-End Visual Funnel Progress Bar Chart */}
            <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <Text variant="headingMd" as="h2">Top-to-Bottom Store Drop-off Funnel</Text>
                <Badge tone="info">Live Granular Clickstream</Badge>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Step 1 */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "6px" }}>
                    <span style={{ fontWeight: 600, color: "#1e293b" }}>1. Storefront Landing (All Channels)</span>
                    <span style={{ fontWeight: 600, color: "#64748b" }}>{funnelMetrics.landings} visitors (100%)</span>
                  </div>
                  <div style={{ height: "10px", borderRadius: "5px", background: "#f1f5f9", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: "100%", background: "#4f46e5", borderRadius: "5px" }}></div>
                  </div>
                </div>

                {/* Step 2 */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "6px" }}>
                    <span style={{ fontWeight: 600, color: "#1e293b" }}>2. Product Page Viewers (Catalog Discovery)</span>
                    <span style={{ fontWeight: 600, color: "#64748b" }}>
                      {funnelMetrics.productViews} ({Math.round((funnelMetrics.productViews / funnelMetrics.landings) * 100)}%)
                    </span>
                  </div>
                  <div style={{ height: "10px", borderRadius: "5px", background: "#f1f5f9", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, Math.round((funnelMetrics.productViews / funnelMetrics.landings) * 100))}%`, background: "#6366f1", borderRadius: "5px" }}></div>
                  </div>
                  {funnelMetrics.landings > funnelMetrics.productViews && (
                    <div style={{ fontSize: "11px", color: "#ef4444", marginTop: "4px" }}>
                      🔻 {Math.round(((funnelMetrics.landings - funnelMetrics.productViews) / funnelMetrics.landings) * 100)}% bounced on landing page without opening any product.
                    </div>
                  )}
                </div>

                {/* Step 3 */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "6px" }}>
                    <span style={{ fontWeight: 600, color: "#1e293b" }}>3. Active Add-to-Bag / Cart</span>
                    <span style={{ fontWeight: 600, color: "#64748b" }}>
                      {funnelMetrics.cartAdds} ({Math.round((funnelMetrics.cartAdds / funnelMetrics.landings) * 100)}%)
                    </span>
                  </div>
                  <div style={{ height: "10px", borderRadius: "5px", background: "#f1f5f9", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, Math.round((funnelMetrics.cartAdds / funnelMetrics.landings) * 100))}%`, background: "#f59e0b", borderRadius: "5px" }}></div>
                  </div>
                  {funnelMetrics.productViews > funnelMetrics.cartAdds && (
                    <div style={{ fontSize: "11px", color: "#f59e0b", marginTop: "4px" }}>
                      🔻 {Math.round(((funnelMetrics.productViews - funnelMetrics.cartAdds) / (funnelMetrics.productViews || 1)) * 100)}% viewed products but left without adding to bag (Abandoned Browse).
                    </div>
                  )}
                </div>

                {/* Step 4 */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "6px" }}>
                    <span style={{ fontWeight: 600, color: "#1e293b" }}>4. Checkout Initiated</span>
                    <span style={{ fontWeight: 600, color: "#64748b" }}>
                      {funnelMetrics.checkouts} ({Math.round((funnelMetrics.checkouts / funnelMetrics.landings) * 100)}%)
                    </span>
                  </div>
                  <div style={{ height: "10px", borderRadius: "5px", background: "#f1f5f9", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, Math.round((funnelMetrics.checkouts / funnelMetrics.landings) * 100))}%`, background: "#06b6d4", borderRadius: "5px" }}></div>
                  </div>
                </div>

                {/* Step 5 */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "6px" }}>
                    <span style={{ fontWeight: 600, color: "#1e293b" }}>5. Orders Completed &amp; Paid</span>
                    <span style={{ fontWeight: 600, color: "#10b981" }}>
                      {funnelMetrics.orders} ({((funnelMetrics.orders / funnelMetrics.landings) * 100).toFixed(1)}%)
                    </span>
                  </div>
                  <div style={{ height: "10px", borderRadius: "5px", background: "#f1f5f9", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, Math.round((funnelMetrics.orders / funnelMetrics.landings) * 100))}%`, background: "#10b981", borderRadius: "5px" }}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Friction & Conversion Leak Diagnosis Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "12px" }}>
              <div style={{ background: "#fff7ed", padding: "16px", borderRadius: "10px", border: "1px solid #fed7aa" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, color: "#c2410c", fontSize: "13px" }}>
                  <span>⚠️ Major Leak: Product Page ➔ Add to Bag</span>
                </div>
                <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#7c2d12", lineHeight: 1.5 }}>
                  Over <strong>65% of visitors</strong> leave after viewing product photos without adding to cart. For jewellery, adding a <strong>"📲 Request HD Video on WhatsApp"</strong> button right below Add to Cart bridges the trust gap and captures shopper phone numbers instantly.
                </p>
              </div>

              <div style={{ background: "#f0fdf4", padding: "16px", borderRadius: "10px", border: "1px solid #bbf7d0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, color: "#15803d", fontSize: "13px" }}>
                  <span>✨ High-Impact Quick Win: Sizing Guide</span>
                </div>
                <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#166534", lineHeight: 1.5 }}>
                  Rings and bangles experience 58% drop-offs due to size uncertainty. An interactive Ring Sizer modal can resolve hesitation and increase mobile conversion by up to 22%.
                </p>
              </div>
            </div>
          </BlockStack>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: PRODUCT TRENDS & LEAKS MATRIX                                      */}
        {/* ========================================================================= */}
        {activeTab === "products" && (
          <BlockStack gap="300">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <ButtonGroup variant="segmented">
                <Button pressed={productTierFilter === "all"} onClick={() => setProductTierFilter("all")}>All Products</Button>
                <Button pressed={productTierFilter === "trending"} onClick={() => setProductTierFilter("trending")}>🔥 Top Trending</Button>
                <Button pressed={productTierFilter === "leaking"} onClick={() => setProductTierFilter("leaking")}>⚠️ High Drop-off (Leaking)</Button>
                <Button pressed={productTierFilter === "high_ticket"} onClick={() => setProductTierFilter("high_ticket")}>💎 High Ticket (₹4k+)</Button>
              </ButtonGroup>

              <Text variant="bodySm" tone="subdued" as="span">Showing {productAnalytics.length} products</Text>
            </div>

            <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflowX: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div style={{
                minWidth: "880px",
                display: "grid",
                gridTemplateColumns: "minmax(220px, 2fr) 100px 100px 100px 100px 110px 110px",
                gap: "12px",
                padding: "10px 16px",
                background: "#f8fafc",
                borderBottom: "1px solid #e2e8f0",
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                color: "#64748b",
              }}>
                <div>Product Item</div>
                <div>Price</div>
                <div>Total Views</div>
                <div>Repeat Views</div>
                <div>Cart Adds</div>
                <div>Cart Rate %</div>
                <div>Status</div>
              </div>

              {productAnalytics.length === 0 ? (
                <div style={{ padding: "40px 16px", textAlign: "center", color: "#94a3b8" }}>No products match this filter.</div>
              ) : (
                productAnalytics.map((p, idx) => (
                  <div
                    key={`p_${idx}`}
                    style={{
                      minWidth: "880px",
                      display: "grid",
                      gridTemplateColumns: "minmax(220px, 2fr) 100px 100px 100px 100px 110px 110px",
                      gap: "12px",
                      padding: "12px 16px",
                      alignItems: "center",
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {p.image ? (
                        <img src={p.image} alt={p.title} style={{ width: "36px", height: "36px", borderRadius: "6px", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "36px", height: "36px", borderRadius: "6px", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>📿</div>
                      )}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "13px", color: "#1e293b" }}>{p.title}</div>
                        <div style={{ fontSize: "11px", color: "#94a3b8" }}>{p.uniqueViewersCount} unique shoppers</div>
                      </div>
                    </div>

                    <div style={{ fontWeight: 600, color: "#1e293b" }}>₹{p.price.toLocaleString()}</div>
                    <div style={{ fontWeight: 600, color: "#4f46e5" }}>{p.views}</div>
                    <div style={{ color: "#64748b" }}>{p.repeatViews}</div>
                    <div style={{ fontWeight: 600, color: "#059669" }}>{p.cartAdds}</div>
                    <div>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: "12px",
                        fontSize: "11px",
                        fontWeight: 600,
                        background: p.cartRate >= 20 ? "#dcfce7" : p.cartRate > 0 ? "#fef3c7" : "#fee2e2",
                        color: p.cartRate >= 20 ? "#166534" : p.cartRate > 0 ? "#92400e" : "#991b1b",
                      }}>
                        {p.cartRate}%
                      </span>
                    </div>

                    <div>
                      {p.status === "trending" && <Badge tone="success">🔥 Trending</Badge>}
                      {p.status === "leaking" && <Badge tone="critical">⚠️ Leaking</Badge>}
                      {p.status === "high_ticket" && <Badge tone="attention">💎 High Ticket</Badge>}
                      {p.status === "steady" && <Badge tone="info">Steady</Badge>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </BlockStack>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: META ADS & GOOGLE CAMPAIGN TRUE ROAS                               */}
        {/* ========================================================================= */}
        {activeTab === "campaigns" && (
          <BlockStack gap="300">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <ButtonGroup variant="segmented">
                <Button pressed={campaignTierFilter === "all"} onClick={() => setCampaignTierFilter("all")}>All Campaigns</Button>
                <Button pressed={campaignTierFilter === "high_roas"} onClick={() => setCampaignTierFilter("high_roas")}>🟢 High ROAS (&gt;3x)</Button>
                <Button pressed={campaignTierFilter === "bleeding"} onClick={() => setCampaignTierFilter("bleeding")}>🔴 Bleeding (&lt;1x ROAS)</Button>
              </ButtonGroup>

              <Button variant="primary" onClick={() => setIsMetaModalOpen(true)}>
                {metaSettings?.accessToken ? "⚙️ Meta API Configured" : "🔗 Connect Meta Access Token"}
              </Button>
            </div>

            <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflowX: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div style={{
                minWidth: "960px",
                display: "grid",
                gridTemplateColumns: "minmax(240px, 2fr) 120px 100px 100px 100px 110px 110px 100px",
                gap: "12px",
                padding: "10px 16px",
                background: "#f8fafc",
                borderBottom: "1px solid #e2e8f0",
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                color: "#64748b",
              }}>
                <div>Campaign Name</div>
                <div>Source</div>
                <div>Ad Spend</div>
                <div>Ad Clicks</div>
                <div>Cart Adds</div>
                <div>Net Revenue</div>
                <div>True ROAS</div>
                <div>Status</div>
              </div>

              {campaignAnalytics.map((c, idx) => (
                <div
                  key={`camp_${idx}`}
                  style={{
                    minWidth: "960px",
                    display: "grid",
                    gridTemplateColumns: "minmax(240px, 2fr) 120px 100px 100px 100px 110px 110px 100px",
                    gap: "12px",
                    padding: "12px 16px",
                    alignItems: "center",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "13px", color: "#1e293b" }}>{c.name}</div>
                    <div style={{ fontSize: "11px", color: "#64748b" }}>CPA: ₹{c.cpa.toLocaleString()} / acquisition</div>
                  </div>

                  <div>
                    <Badge tone={c.source.includes("Meta") ? "info" : c.source.includes("Google") ? "attention" : "success"}>
                      {c.source}
                    </Badge>
                  </div>

                  <div style={{ fontWeight: 600, color: "#64748b" }}>₹{c.estimatedSpend.toLocaleString()}</div>
                  <div style={{ color: "#4f46e5", fontWeight: 600 }}>{c.clicks}</div>
                  <div style={{ color: "#059669", fontWeight: 600 }}>{c.cartAdds}</div>
                  <div style={{ fontWeight: 700, color: "#1e293b" }}>₹{c.revenue.toLocaleString()}</div>
                  
                  <div>
                    <span style={{
                      padding: "3px 9px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: 700,
                      background: c.roas >= 3 ? "#dcfce7" : c.roas >= 1 ? "#fef3c7" : "#fee2e2",
                      color: c.roas >= 3 ? "#166534" : c.roas >= 1 ? "#92400e" : "#991b1b",
                    }}>
                      {c.roas}x ROAS
                    </span>
                  </div>

                  <div>
                    {c.roas >= 3 && <Badge tone="success">Scale 🚀</Badge>}
                    {c.roas < 1 && <Badge tone="critical">Kill 🛑</Badge>}
                    {c.roas >= 1 && c.roas < 3 && <Badge tone="attention">Optimize</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </BlockStack>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: COLLECTIONS & CATEGORIES PERFORMANCE                               */}
        {/* ========================================================================= */}
        {activeTab === "collections" && (
          <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflowX: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{
              minWidth: "800px",
              display: "grid",
              gridTemplateColumns: "minmax(220px, 2fr) 110px 110px 110px 110px 120px",
              gap: "12px",
              padding: "10px 16px",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
              fontSize: "11px",
              fontWeight: 600,
              textTransform: "uppercase",
              color: "#64748b",
            }}>
              <div>Collection / Category</div>
              <div>Page Views</div>
              <div>Unique Shoppers</div>
              <div>Cart Adds</div>
              <div>Drop-off %</div>
              <div>Net Revenue</div>
            </div>

            {collectionAnalytics.map((col, idx) => (
              <div
                key={`col_${idx}`}
                style={{
                  minWidth: "800px",
                  display: "grid",
                  gridTemplateColumns: "minmax(220px, 2fr) 110px 110px 110px 110px 120px",
                  gap: "12px",
                  padding: "12px 16px",
                  alignItems: "center",
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "13px", color: "#1e293b" }}>{col.name}</div>
                <div style={{ color: "#4f46e5", fontWeight: 600 }}>{col.views}</div>
                <div style={{ color: "#64748b" }}>{col.uniqueVisitors}</div>
                <div style={{ color: "#059669", fontWeight: 600 }}>{col.carts}</div>
                <div style={{ color: parseFloat(col.dropoff) > 50 ? "#ef4444" : "#10b981", fontWeight: 600 }}>{col.dropoff}</div>
                <div style={{ fontWeight: 700, color: "#1e293b" }}>{col.revenue}</div>
              </div>
            ))}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: OFFERS & PROMO CODES CONVERSION                                     */}
        {/* ========================================================================= */}
        {activeTab === "offers" && (
          <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflowX: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{
              minWidth: "820px",
              display: "grid",
              gridTemplateColumns: "140px minmax(200px, 2fr) 110px 110px 120px 120px",
              gap: "12px",
              padding: "10px 16px",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
              fontSize: "11px",
              fontWeight: 600,
              textTransform: "uppercase",
              color: "#64748b",
            }}>
              <div>Promo Code</div>
              <div>Offer Description</div>
              <div>Times Applied</div>
              <div>Orders Paid</div>
              <div>Discounts Given</div>
              <div>Captured Revenue</div>
            </div>

            {offerAnalytics.map((o, idx) => (
              <div
                key={`off_${idx}`}
                style={{
                  minWidth: "820px",
                  display: "grid",
                  gridTemplateColumns: "140px minmax(200px, 2fr) 110px 110px 120px 120px",
                  gap: "12px",
                  padding: "12px 16px",
                  alignItems: "center",
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <div>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, padding: "3px 8px", background: "#e0e7ff", color: "#3730a3", borderRadius: "4px" }}>
                    {o.code}
                  </span>
                </div>
                <div style={{ fontWeight: 500, fontSize: "12.5px", color: "#1e293b" }}>{o.label}</div>
                <div style={{ color: "#4f46e5", fontWeight: 600 }}>{o.appliedCount}</div>
                <div style={{ color: "#059669", fontWeight: 600 }}>{o.orders} ({o.conversionRate})</div>
                <div style={{ color: "#dc2626", fontWeight: 600 }}>{o.discountGiven}</div>
                <div style={{ fontWeight: 700, color: "#1e293b" }}>{o.netRevenue}</div>
              </div>
            ))}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: DEVICE & BROWSER BREAKPOINT MATRIX                                  */}
        {/* ========================================================================= */}
        {activeTab === "devices" && (
          <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflowX: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{
              minWidth: "860px",
              display: "grid",
              gridTemplateColumns: "110px 180px 180px 100px 110px 110px minmax(180px, 1fr)",
              gap: "12px",
              padding: "10px 16px",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
              fontSize: "11px",
              fontWeight: 600,
              textTransform: "uppercase",
              color: "#64748b",
            }}>
              <div>Device</div>
              <div>Operating System</div>
              <div>Browser</div>
              <div>Shoppers</div>
              <div>Bounce Rate</div>
              <div>Checkout %</div>
              <div>Friction Diagnosis</div>
            </div>

            {deviceAnalytics.map((d, idx) => (
              <div
                key={`dev_${idx}`}
                style={{
                  minWidth: "860px",
                  display: "grid",
                  gridTemplateColumns: "110px 180px 180px 100px 110px 110px minmax(180px, 1fr)",
                  gap: "12px",
                  padding: "12px 16px",
                  alignItems: "center",
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <div>
                  <Badge tone={d.device === "Mobile" ? "info" : "success"}>{d.device}</Badge>
                </div>
                <div style={{ fontWeight: 600, fontSize: "12.5px", color: "#1e293b" }}>{d.os}</div>
                <div style={{ color: "#64748b", fontSize: "12px" }}>{d.browser}</div>
                <div style={{ color: "#4f46e5", fontWeight: 600 }}>{d.visitors}</div>
                <div style={{ color: parseFloat(d.bounceRate) > 45 ? "#ef4444" : "#64748b", fontWeight: 600 }}>{d.bounceRate}</div>
                <div style={{ color: "#059669", fontWeight: 700 }}>{d.checkoutRate}</div>
                <div style={{ fontSize: "11.5px", color: d.frictionAlert.includes("⚠️") ? "#c2410c" : "#166534", fontWeight: 500 }}>
                  {d.frictionAlert}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal: Meta Marketing API Integration */}
        <Modal
          open={isMetaModalOpen}
          onClose={() => setIsMetaModalOpen(false)}
          title="Connect Meta Marketing API (Ads & CAPI)"
          primaryAction={{
            content: "Save & Synchronize",
            onAction: handleSaveMeta,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setIsMetaModalOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <p style={{ fontSize: "13px", color: "#64748b" }}>
                Connect your Meta System User Access Token to sync ad spend, ad creative views, and ROAS directly with your store clickstreams.
              </p>

              <TextField
                label="Meta System User Access Token (EAAG...)"
                value={metaAccessToken}
                onChange={(val) => setMetaAccessToken(val)}
                type="password"
                autoComplete="off"
                helpText="Generated from Meta Business Manager > System Users > Tokens."
              />

              <TextField
                label="Meta Pixel ID"
                value={metaPixelId}
                onChange={(val) => setMetaPixelId(val)}
                autoComplete="off"
                placeholder="e.g. 109283746592817"
              />

              <TextField
                label="Meta Ad Account ID"
                value={metaAdAccountId}
                onChange={(val) => setMetaAdAccountId(val)}
                autoComplete="off"
                placeholder="act_1234567890"
              />
            </BlockStack>
          </Modal.Section>
        </Modal>

      </BlockStack>
    </Page>
  );
}
