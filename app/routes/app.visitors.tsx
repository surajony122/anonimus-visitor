import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import React, { useState } from "react";
import {
  Page,
  LegacyCard,
  DataTable,
  Badge,
  TextField,
  Select,
  Button,
  InlineStack,
  BlockStack,
  Text,
  ButtonGroup,
  EmptyState,
} from "@shopify/polaris";
import prisma from "../db.server";
import { calculateIntentScore } from "../services/intentEngine.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopDomain = "ravistore-shop.myshopify.com";
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session.shop;
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("DEBUG VISITORS AUTH ERROR:", err);
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return json({ visitors: [] });
  }

  const visitors = await prisma.visitor.findMany({
    where: { shopId: shop.id },
    include: {
      sessions: true,
      events: { orderBy: { timestamp: "desc" } },
      identities: true,
      customerLinks: { include: { customer: true } },
    },
    orderBy: { lastSeenAt: "desc" },
  });

  const enriched = visitors.map((v) => {
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
      firstSeenAt: v.firstSeenAt.toISOString(),
      lastSeenAt: v.lastSeenAt.toISOString(),
      deviceCategory: v.deviceCategory || "desktop",
      sessionsCount: v.sessions.length,
      productsViewedCount: pViews,
      cartEventsCount: addToCart,
      cartValue: cartVal,
      intentScore: intent.score,
      intentTier: intent.tier,
      primaryEmail,
      customer: customer
        ? {
            id: customer.shopifyCustomerId,
            firstName: customer.firstName,
            lastName: customer.lastName,
          }
        : null,
    };
  });

  return json({ visitors: enriched });
};

export default function VisitorsList() {
  const { visitors } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("all");
  const [intentFilter, setIntentFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  let filtered = visitors;
  if (statusFilter !== "all") {
    filtered = filtered.filter((v: any) => v.status === statusFilter);
  }
  if (intentFilter !== "all") {
    filtered = filtered.filter((v: any) => v.intentTier === intentFilter);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (v: any) =>
        v.visitorId.toLowerCase().includes(q) ||
        (v.customer?.firstName && v.customer.firstName.toLowerCase().includes(q)) ||
        (v.primaryEmail && v.primaryEmail.toLowerCase().includes(q))
    );
  }

  const rows = filtered.map((v: any) => {
    const isIdentified = v.status === "identified";
    const displayName = v.customer?.firstName
      ? `${v.customer.firstName} ${v.customer.lastName || ""}`
      : isIdentified && v.primaryEmail
      ? v.primaryEmail
      : `Anonymous #${v.visitorId.substring(0, 8)}`;

    let intentBadgeTone: "success" | "attention" | "info" | undefined = undefined;
    if (v.intentTier === "very_high") intentBadgeTone = "success";
    else if (v.intentTier === "high") intentBadgeTone = "attention";
    else if (v.intentTier === "medium") intentBadgeTone = "info";

    return [
      <InlineStack gap="200" align="center" key={`id_${v.id}`}>
        <Button variant="plain" onClick={() => navigate(`/app/visitors/${v.visitorId}`)}>
          {displayName}
        </Button>
        <Text variant="bodySm" tone="subdued" as="span">
          {`(${v.visitorId.substring(0, 8)}...)`}
        </Text>
      </InlineStack>,
      <Badge tone={isIdentified ? "success" : undefined} key={`status_${v.id}`}>
        {v.status.toUpperCase()}
      </Badge>,
      <InlineStack gap="100" align="center" key={`intent_${v.id}`}>
        <Badge tone={intentBadgeTone}>{`${v.intentScore}/100`}</Badge>
        <Text variant="bodySm" tone="subdued" as="span">{`(${v.intentTier})`}</Text>
      </InlineStack>,
      `${v.sessionsCount} sessions`,
      `${v.productsViewedCount} viewed`,
      v.cartEventsCount > 0 ? `${v.cartEventsCount} in cart` : "—",
      new Date(v.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      <Button size="slim" onClick={() => navigate(`/app/visitors/${v.visitorId}`)} key={`action_${v.id}`}>
        View Journey
      </Button>,
    ];
  });

  return (
    <Page
      title="Storefront Visitors"
      subtitle="Track both anonymous visitors and legitimately identified customer journeys"
      primaryAction={{
        content: "Simulate Traffic",
        onAction: () => navigate("/app/simulator"),
      }}
    >
      <BlockStack gap="400">
        <LegacyCard sectioned>
          <InlineStack gap="300" align="space-between">
            <InlineStack gap="200">
              <ButtonGroup>
                <Button pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
                  {`All (${visitors.length})`}
                </Button>
                <Button pressed={statusFilter === "anonymous"} onClick={() => setStatusFilter("anonymous")}>
                  Anonymous Only
                </Button>
                <Button pressed={statusFilter === "identified"} onClick={() => setStatusFilter("identified")}>
                  Identified Only
                </Button>
              </ButtonGroup>

              <Select
                label=""
                labelHidden
                options={[
                  { label: "All Intent Levels", value: "all" },
                  { label: "Very High Intent (81-100)", value: "very_high" },
                  { label: "High Intent (61-80)", value: "high" },
                  { label: "Medium Intent (31-60)", value: "medium" },
                  { label: "Low Intent (0-30)", value: "low" },
                ]}
                value={intentFilter}
                onChange={(val) => setIntentFilter(val)}
              />
            </InlineStack>

            <TextField
              label=""
              labelHidden
              placeholder="Search visitor ID or name..."
              value={searchQuery}
              onChange={(val) => setSearchQuery(val)}
              autoComplete="off"
            />
          </InlineStack>
        </LegacyCard>

        <LegacyCard>
          {filtered.length === 0 ? (
            <EmptyState
              heading="No visitors found"
              action={{
                content: "Open Live Simulator",
                onAction: () => navigate("/app/simulator"),
              }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Simulate storefront visitor traffic to see anonymous visitor tracking and identity resolution in action.</p>
            </EmptyState>
          ) : (
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
              headings={["Visitor", "Status", "Intent Score", "Sessions", "Products", "Cart Activity", "Last Seen", "Actions"]}
              rows={rows as any}
            />
          )}
        </LegacyCard>
      </BlockStack>
    </Page>
  );
}
