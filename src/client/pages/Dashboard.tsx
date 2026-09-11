import React, { useEffect, useState } from 'react';
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
} from '@shopify/polaris';
import { apiClient } from '../api/client';
import { Users, UserCheck, TrendingUp, Sparkles } from 'lucide-react';

interface AnalyticsData {
  summary: {
    totalVisitors: number;
    anonymousVisitors: number;
    identifiedVisitors: number;
    identificationRate: string;
    totalSessions: number;
    totalEvents: number;
    highIntentVisitors: number;
  };
  funnel: {
    pageViews: number;
    productViews: number;
    addToCarts: number;
    checkoutsStarted: number;
    ordersCompleted: number;
  };
  intentDistribution: {
    low: number;
    medium: number;
    high: number;
    veryHigh: number;
  };
}

export const Dashboard: React.FC<{ onNavigate: (tab: string, visitorId?: string) => void }> = ({ onNavigate }) => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/analytics/overview');
      if (res.success) {
        setData(res.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  if (loading || !data) {
    return (
      <Page title="Storefront Visitor Intelligence">
        <LegacyCard sectioned>
          <Text variant="bodyMd" as="p">Loading intelligence metrics...</Text>
        </LegacyCard>
      </Page>
    );
  }

  const { summary, funnel, intentDistribution } = data;
  const totalIntent = (intentDistribution.low + intentDistribution.medium + intentDistribution.high + intentDistribution.veryHigh) || 1;

  return (
    <Page
      title="Storefront Visitor Intelligence"
      subtitle="Privacy-first anonymous visitor tracking & legitimate identity resolution"
      primaryAction={{
        content: 'Interactive Simulator',
        icon: Sparkles,
        onAction: () => onNavigate('simulator'),
      }}
      secondaryActions={[
        {
          content: 'Refresh',
          onAction: fetchAnalytics,
        },
      ]}
    >
      <BlockStack gap="500">
        <Banner title="Privacy-First Identity Resolution Active" tone="success">
          <p>
            Operating strictly with first-party cookies, Shopify Web Pixel APIs, and consented identity signals. Zero Chrome account snooping, zero weak IP fingerprinting.
          </p>
        </Banner>

        {/* KPI Cards */}
        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <LegacyCard sectioned>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingSm" as="h3">Total Visitors</Text>
                  <Users size={20} color="#5c5f62" />
                </InlineStack>
                <Text variant="headingXl" as="p">{String(summary.totalVisitors)}</Text>
                <Text variant="bodySm" tone="subdued" as="p">Across all storefront sessions</Text>
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
                  {summary.anonymousVisitors} Anonymous remaining
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
                <Text variant="bodySm" tone="subdued" as="p">Score &ge; 61/100 behavioral intent</Text>
              </BlockStack>
            </LegacyCard>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <LegacyCard sectioned>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingSm" as="h3">Recorded Events</Text>
                  <ActivityIcon size={20} color="#2563eb" />
                </InlineStack>
                <Text variant="headingXl" as="p">{String(summary.totalEvents)}</Text>
                <Text variant="bodySm" tone="subdued" as="p">Page, cart & checkout signals</Text>
              </BlockStack>
            </LegacyCard>
          </Grid.Cell>
        </Grid>

        {/* Funnel & Intent Breakdown */}
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
                    <InlineStack gap="200">
                      <Badge tone="success">Very High (81-100)</Badge>
                    </InlineStack>
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
                <Button fullWidth onClick={() => onNavigate('visitors')}>
                  Explore Visitor Directory &rarr;
                </Button>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
};

function ActivityIcon(props: any) {
  return (
    <svg width={props.size || 20} height={props.size || 20} viewBox="0 0 24 24" fill="none" stroke={props.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
    </svg>
  );
}
