import React, { useEffect, useState } from 'react';
import {
  Page,
  Layout,
  LegacyCard,
  Grid,
  Text,
  Badge,
  ProgressBar,
  BlockStack,
  InlineStack,
  Divider,
  List,
  DataTable,
  Button,
} from '@shopify/polaris';
import { apiClient } from '../api/client';
import { Flame, TrendingUp, ShoppingCart, Eye, Award } from 'lucide-react';

export const IntentAnalytics: React.FC<{
  onSelectVisitor: (visitorId: string) => void;
}> = ({ onSelectVisitor }) => {
  const [highIntentVisitors, setHighIntentVisitors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHighIntent = async () => {
      setLoading(true);
      try {
        const res = await apiClient.get('/visitors', { intent: 'high' });
        const resVeryHigh = await apiClient.get('/visitors', { intent: 'very_high' });
        const combined = [...(resVeryHigh.visitors || []), ...(res.visitors || [])];
        setHighIntentVisitors(combined);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchHighIntent();
  }, []);

  const rows = highIntentVisitors.map((v) => {
    return [
      <BlockStack key={`hiv_${v.id}`} gap="100">
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {v.status === 'identified' ? v.shopifyCustomer?.firstName || v.primaryEmail || 'Identified Customer' : `Anonymous #${v.visitorId.substring(0, 8)}`}
        </Text>
        <Text variant="bodySm" tone="subdued" as="span">
          Status: {v.status}
        </Text>
      </BlockStack>,
      <Badge tone="success">{`${v.intentScore}/100`}</Badge>,
      `${v.productsViewedCount} products (${v.uniqueProductsCount} unique)`,
      v.cartEventsCount > 0 ? `${v.cartEventsCount} items ($${v.cartValue})` : '0 items',
      `${v.sessionsCount} sessions`,
      <Button size="slim" onClick={() => onSelectVisitor(v.visitorId)}>
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
          {/* Intent Scoring Algorithm Card */}
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

          {/* Intent Tiers */}
          <Layout.Section variant="oneThird">
            <LegacyCard title="Intent Tiers" sectioned>
              <BlockStack gap="200">
                <div>
                  <InlineStack align="space-between">
                    <Badge tone="success">Very High Intent (81-100)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Ready to buy, checkout initiated or high cart value</Text>
                </div>
                <Divider />
                <div>
                  <InlineStack align="space-between">
                    <Badge tone="attention">High Intent (61-80)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Multiple repeat product views or active cart</Text>
                </div>
                <Divider />
                <div>
                  <InlineStack align="space-between">
                    <Badge tone="info">Medium Intent (31-60)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Browsing several categories and products</Text>
                </div>
                <Divider />
                <div>
                  <InlineStack align="space-between">
                    <Badge>Low Intent (0-30)</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">Casual single-page or bouncing visitors</Text>
                </div>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>
        </Layout>

        {/* High intent visitor table */}
        <LegacyCard title={`High & Very High Intent Visitors (${highIntentVisitors.length})`} sectioned>
          <BlockStack gap="300">
            <Text variant="bodySm" tone="subdued" as="p">
              Prioritized list of anonymous and identified shoppers showing strong conversion intent.
            </Text>
            {highIntentVisitors.length === 0 ? (
              <Text variant="bodyMd" tone="subdued" as="p">No high-intent visitors detected yet.</Text>
            ) : (
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
                headings={['Visitor / Customer', 'Score', 'Product Engagement', 'Cart Status', 'Sessions', 'Action']}
                rows={rows}
              />
            )}
          </BlockStack>
        </LegacyCard>
      </BlockStack>
    </Page>
  );
};
