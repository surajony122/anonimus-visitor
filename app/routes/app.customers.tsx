import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import React from "react";
import {
  Page,
  LegacyCard,
  DataTable,
  Badge,
  Button,
  Text,
  BlockStack,
  InlineStack,
  EmptyState,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return json({ customers: [] });
  }

  const customers = await prisma.shopifyCustomer.findMany({
    where: { shopId: shop.id },
    include: {
      visitorLinks: {
        include: {
          visitor: {
            include: { events: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return json({
    customers: customers.map((c) => ({
      id: c.id,
      shopifyCustomerId: c.shopifyCustomerId,
      firstName: c.firstName,
      lastName: c.lastName,
      emailReference: c.emailReference,
      phoneReference: c.phoneReference,
      ordersCount: c.ordersCount,
      totalSpent: c.totalSpent,
      visitorLinks: c.visitorLinks.map((l) => ({
        id: l.id,
        matchMethod: l.matchMethod,
        confidenceScore: l.confidenceScore,
        visitor: {
          visitorId: l.visitor.visitorId,
        },
      })),
    })),
  });
};

export default function CustomersRoute() {
  const { customers } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const rows = customers.map((c: any) => {
    const linkedVisitor = c.visitorLinks?.[0]?.visitor;
    const matchMethod = c.visitorLinks?.[0]?.matchMethod || "manual";

    return [
      <BlockStack key={`cust_${c.id}`} gap="100">
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {`${c.firstName || ""} ${c.lastName || ""}`}
        </Text>
        <Text variant="bodySm" tone="subdued" as="span">
          {`ID: ${c.shopifyCustomerId}`}
        </Text>
      </BlockStack>,
      c.emailReference || "—",
      c.phoneReference || "—",
      `${c.ordersCount} orders ($${c.totalSpent})`,
      linkedVisitor ? (
        <InlineStack gap="100" align="center">
          <Badge tone="success">{`Linked to #${linkedVisitor.visitorId.substring(0, 8)}`}</Badge>
          <Text variant="bodySm" tone="subdued" as="span">{`(${matchMethod})`}</Text>
        </InlineStack>
      ) : (
        <Badge tone="warning">No Storefront Activity Linked</Badge>
      ),
      linkedVisitor ? (
        <Button size="slim" onClick={() => navigate(`/app/visitors/${linkedVisitor.visitorId}`)}>
          View Journey
        </Button>
      ) : (
        "—"
      ),
    ];
  });

  return (
    <Page
      title="Shopify Customer Intelligence"
      subtitle="Shopify customer profiles mapped to real storefront browsing behavior & historical journeys"
    >
      <BlockStack gap="400">
        <LegacyCard>
          {customers.length === 0 ? (
            <EmptyState
              heading="No synced Shopify customers yet"
              action={{
                content: "Open Simulator",
                onAction: () => navigate("/app/simulator"),
              }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>When customers register, login, or complete orders, their Shopify customer profiles link to their historical storefront visitor journeys.</p>
            </EmptyState>
          ) : (
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text"]}
              headings={["Customer", "Email", "Phone", "Orders & Spent", "Visitor Graph Link", "Action"]}
              rows={rows as any}
            />
          )}
        </LegacyCard>
      </BlockStack>
    </Page>
  );
}
