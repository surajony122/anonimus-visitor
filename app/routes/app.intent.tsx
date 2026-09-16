import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import React, { useState } from "react";
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
  DataTable,
  Button,
  TextField,
  Banner,
  Select,
} from "@shopify/polaris";
import prisma from "../db.server";
import { calculateIntentScore, DEFAULT_INTENT_CONFIG, type IntentConfig } from "../services/intentEngine.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopDomain = "ravistore-shop.myshopify.com";
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session.shop;
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  let visitors: any[] = [];
  let config: IntentConfig = DEFAULT_INTENT_CONFIG;

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (shop) {
      if (shop.settings) {
        try {
          const parsed = JSON.parse(shop.settings);
          if (parsed.intentConfig) config = { ...DEFAULT_INTENT_CONFIG, ...parsed.intentConfig };
        } catch {}
      }

      visitors = await prisma.visitor.findMany({
        where: { shopId: shop.id },
        include: {
          sessions: true,
          events: true,
          identities: true,
          customerLinks: { include: { customer: true } },
        },
        orderBy: { lastSeenAt: "desc" },
      });
    }
  } catch (dbErr) {
    console.warn("Intent DB query fallback:", dbErr);
  }

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

      const intent = calculateIntentScore(
        {
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
        },
        config
      );

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
        lastSeenAt: v.lastSeenAt ? new Date(v.lastSeenAt).toLocaleString() : "Recently",
      };
    })
    .filter((v) => v.intentTier === "high" || v.intentTier === "very_high");

  return json({ highIntentVisitors: highIntentList, config });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let shopDomain = "ravistore-shop.myshopify.com";
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session.shop;
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  try {
    let shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      shop = await prisma.shop.create({
        data: { shopDomain },
      });
    }

    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "save_weights") {
      const productViewWeight = Number(formData.get("productViewWeight") || 5);
      const repeatProductViewWeight = Number(formData.get("repeatProductViewWeight") || 10);
      const addToCartWeight = Number(formData.get("addToCartWeight") || 25);
      const checkoutStartedWeight = Number(formData.get("checkoutStartedWeight") || 30);
      const highCartValueBonus = Number(formData.get("highCartValueBonus") || 15);
      const highIntentThreshold = Number(formData.get("highIntentThreshold") || 61);

      let currentSettings: any = {};
      if (shop.settings) {
        try {
          currentSettings = JSON.parse(shop.settings);
        } catch {}
      }

      currentSettings.intentConfig = {
        ...DEFAULT_INTENT_CONFIG,
        productViewWeight,
        repeatProductViewWeight,
        addToCartWeight,
        checkoutStartedWeight,
        highCartValueBonus,
        highIntentThreshold,
      };

      await prisma.shop.update({
        where: { id: shop.id },
        data: { settings: JSON.stringify(currentSettings) },
      });

      return json({ success: true, message: "Intent scoring rules & weights updated successfully!" });
    }
  } catch (err: any) {
    console.error("Intent action error:", err);
    return json({ error: err.message || "Failed to update weights" }, { status: 500 });
  }

  return json({});
};

export default function IntentAnalyticsRoute() {
  const { highIntentVisitors, config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  const [pViewWeight, setPViewWeight] = useState(String(config.productViewWeight ?? 5));
  const [repeatWeight, setRepeatWeight] = useState(String(config.repeatProductViewWeight ?? 10));
  const [atcWeight, setAtcWeight] = useState(String(config.addToCartWeight ?? 25));
  const [checkoutWeight, setCheckoutWeight] = useState(String(config.checkoutStartedWeight ?? 30));
  const [cartBonus, setCartBonus] = useState(String(config.highCartValueBonus ?? 15));
  const [threshold, setThreshold] = useState(String(config.highIntentThreshold ?? 61));

  const [filter, setFilter] = useState("all");

  const handleSaveWeights = () => {
    const fd = new FormData();
    fd.append("actionType", "save_weights");
    fd.append("productViewWeight", pViewWeight);
    fd.append("repeatProductViewWeight", repeatWeight);
    fd.append("addToCartWeight", atcWeight);
    fd.append("checkoutStartedWeight", checkoutWeight);
    fd.append("highCartValueBonus", cartBonus);
    fd.append("highIntentThreshold", threshold);
    submit(fd, { method: "POST" });
  };

  const handleExportCSV = () => {
    const headers = ["Visitor ID", "Status", "Intent Score", "Intent Tier", "Products Viewed", "Cart Items", "Cart Value", "Last Seen"];
    const rows = highIntentVisitors.map((v: any) => [
      v.visitorId,
      v.status,
      v.intentScore,
      v.intentTier,
      v.productsViewedCount,
      v.cartEventsCount,
      `$${v.cartValue}`,
      v.lastSeenAt,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r: any[]) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `nitro_high_intent_leads_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredVisitors = highIntentVisitors.filter((v: any) => {
    if (filter === "cart") return v.cartEventsCount > 0;
    if (filter === "identified") return v.status === "identified";
    return true;
  });

  const rows = filteredVisitors.map((v: any) => {
    return [
      <BlockStack key={`hiv_${v.id}`} gap="050">
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {v.status === "identified"
            ? v.customer?.firstName || v.primaryEmail || "Identified Customer"
            : `Anonymous #${v.visitorId.substring(0, 8)}`}
        </Text>
        <Text variant="bodySm" tone="subdued" as="span">
          {`Status: ${v.status} | Last seen: ${v.lastSeenAt}`}
        </Text>
      </BlockStack>,
      <Badge key={`score_${v.id}`} tone={v.intentTier === "very_high" ? "success" : "attention"}>
        {`${v.intentScore}/100 (${v.intentTier?.toUpperCase()})`}
      </Badge>,
      `${v.productsViewedCount} products (${v.uniqueProductsCount} unique)`,
      v.cartEventsCount > 0 ? `${v.cartEventsCount} items ($${v.cartValue})` : "0 items",
      `${v.sessionsCount} sessions`,
      <Button key={`btn_${v.id}`} size="slim" onClick={() => navigate(`/app/visitors/${v.visitorId}`)}>
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
        {actionData && (actionData as any).message && (
          <Banner tone="success">
            <p>{(actionData as any).message}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <LegacyCard title="Customizable Intent Scoring Weights" sectioned>
              <BlockStack gap="400">
                <Text variant="bodyMd" as="p">
                  Customize the score points awarded for micro-conversions to calibrate lead propensity for your store catalog:
                </Text>

                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <TextField
                      label="Product View (pts)"
                      type="number"
                      value={pViewWeight}
                      onChange={setPViewWeight}
                      autoComplete="off"
                    />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <TextField
                      label="Repeat SKU View (pts)"
                      type="number"
                      value={repeatWeight}
                      onChange={setRepeatWeight}
                      autoComplete="off"
                    />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <TextField
                      label="Add to Cart (pts)"
                      type="number"
                      value={atcWeight}
                      onChange={setAtcWeight}
                      autoComplete="off"
                    />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <TextField
                      label="Start Checkout (pts)"
                      type="number"
                      value={checkoutWeight}
                      onChange={setCheckoutWeight}
                      autoComplete="off"
                    />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <TextField
                      label="High Cart ($100+) Bonus"
                      type="number"
                      value={cartBonus}
                      onChange={setCartBonus}
                      autoComplete="off"
                    />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <TextField
                      label="High Intent Threshold"
                      type="number"
                      value={threshold}
                      onChange={setThreshold}
                      autoComplete="off"
                    />
                  </Grid.Cell>
                </Grid>

                <InlineStack align="end">
                  <Button variant="primary" onClick={handleSaveWeights} loading={isSubmitting}>
                    Save Scoring Configuration
                  </Button>
                </InlineStack>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <LegacyCard title="Propensity Tiers" sectioned>
              <BlockStack gap="200">
                <div>
                  <InlineStack align="space-between">
                    <Badge tone="success">Very High (81-100)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Ready to buy &bull; checkout begun</Text>
                </div>
                <Divider />
                <div>
                  <InlineStack align="space-between">
                    <Badge tone="attention">High ({threshold}+)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Repeat views &bull; cart active</Text>
                </div>
                <Divider />
                <div>
                  <InlineStack align="space-between">
                    <Badge tone="info">Medium (31-60)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Browsing categories</Text>
                </div>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>
        </Layout>

        <LegacyCard
          title={`High Intent Leads Queue (${filteredVisitors.length})`}
          sectioned
          actions={[
            {
              content: "Export Leads to CSV",
              onAction: handleExportCSV,
              disabled: filteredVisitors.length === 0,
            },
          ]}
        >
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text variant="bodySm" tone="subdued" as="p">
                Visitors showing high conversion propensity, ranked by real-time intent score.
              </Text>
              <Select
                label=""
                labelHidden
                options={[
                  { label: "All High Intent", value: "all" },
                  { label: "With Items in Cart", value: "cart" },
                  { label: "Identified Only", value: "identified" },
                ]}
                value={filter}
                onChange={setFilter}
              />
            </InlineStack>

            {filteredVisitors.length === 0 ? (
              <Text variant="bodyMd" tone="subdued" as="p">No high-intent visitors matching this filter yet.</Text>
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
