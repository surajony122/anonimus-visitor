import React, { useEffect, useState } from 'react';
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
} from '@shopify/polaris';
import { apiClient } from '../api/client';

interface VisitorItem {
  id: string;
  visitorId: string;
  status: 'anonymous' | 'identified' | 'merged';
  firstSeenAt: string;
  lastSeenAt: string;
  deviceCategory: string;
  firstSource: string;
  sessionsCount: number;
  eventsCount: number;
  productsViewedCount: number;
  cartEventsCount: number;
  cartValue: number;
  intentScore: number;
  intentTier: 'low' | 'medium' | 'high' | 'very_high';
  primaryEmail?: string;
  shopifyCustomer?: {
    id: string;
    firstName?: string;
    lastName?: string;
  };
}

export const Visitors: React.FC<{ onSelectVisitor: (visitorId: string) => void; onNavigate: (tab: string) => void }> = ({
  onSelectVisitor,
  onNavigate,
}) => {
  const [visitors, setVisitors] = useState<VisitorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [intentFilter, setIntentFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchVisitors = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/visitors', {
        status: statusFilter,
        intent: intentFilter,
        search: searchQuery,
      });
      if (res.success) {
        setVisitors(res.visitors);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVisitors();
  }, [statusFilter, intentFilter]);

  const handleSearch = () => {
    fetchVisitors();
  };

  const rows = visitors.map((v) => {
    const isIdentified = v.status === 'identified';
    const displayName = v.shopifyCustomer?.firstName
      ? `${v.shopifyCustomer.firstName} ${v.shopifyCustomer.lastName || ''}`
      : isIdentified && v.primaryEmail
      ? v.primaryEmail
      : `Anonymous #${v.visitorId.substring(0, 8)}`;

    let intentBadgeTone: 'success' | 'attention' | 'info' | undefined = undefined;
    if (v.intentTier === 'very_high') intentBadgeTone = 'success';
    else if (v.intentTier === 'high') intentBadgeTone = 'attention';
    else if (v.intentTier === 'medium') intentBadgeTone = 'info';

    return [
      <InlineStack gap="200" align="center" key={`id_${v.id}`}>
        <Button variant="plain" onClick={() => onSelectVisitor(v.visitorId)}>
          {displayName}
        </Button>
        <Text variant="bodySm" tone="subdued" as="span">
          {`(${v.visitorId.substring(0, 8)}...)`}
        </Text>
      </InlineStack>,
      <Badge tone={isIdentified ? 'success' : undefined} key={`status_${v.id}`}>
        {v.status.toUpperCase()}
      </Badge>,
      <InlineStack gap="100" align="center" key={`intent_${v.id}`}>
        <Badge tone={intentBadgeTone}>{`${v.intentScore}/100`}</Badge>
        <Text variant="bodySm" tone="subdued" as="span">{`(${v.intentTier})`}</Text>
      </InlineStack>,
      `${v.sessionsCount} sessions`,
      `${v.productsViewedCount} viewed`,
      v.cartEventsCount > 0 ? `${v.cartEventsCount} in cart` : '—',
      new Date(v.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      <Button size="slim" onClick={() => onSelectVisitor(v.visitorId)} key={`action_${v.id}`}>
        View Journey
      </Button>,
    ];
  });

  return (
    <Page
      title="Storefront Visitors"
      subtitle="Track both anonymous visitors and legitimately identified customer journeys"
      primaryAction={{
        content: 'Simulate Traffic',
        onAction: () => onNavigate('simulator'),
      }}
      secondaryActions={[
        {
          content: 'Refresh',
          onAction: fetchVisitors,
        },
      ]}
    >
      <BlockStack gap="400">
        <LegacyCard sectioned>
          <BlockStack gap="300">
            <InlineStack gap="300" align="space-between">
              <InlineStack gap="200">
                <ButtonGroup>
                  <Button pressed={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
                    {`All (${visitors.length})`}
                  </Button>
                  <Button pressed={statusFilter === 'anonymous'} onClick={() => setStatusFilter('anonymous')}>
                    Anonymous Only
                  </Button>
                  <Button pressed={statusFilter === 'identified'} onClick={() => setStatusFilter('identified')}>
                    Identified Only
                  </Button>
                </ButtonGroup>

                <Select
                  label=""
                  labelHidden
                  options={[
                    { label: 'All Intent Levels', value: 'all' },
                    { label: 'Very High Intent (81-100)', value: 'very_high' },
                    { label: 'High Intent (61-80)', value: 'high' },
                    { label: 'Medium Intent (31-60)', value: 'medium' },
                    { label: 'Low Intent (0-30)', value: 'low' },
                  ]}
                  value={intentFilter}
                  onChange={(val) => setIntentFilter(val)}
                />
              </InlineStack>

              <InlineStack gap="200">
                <TextField
                  label=""
                  labelHidden
                  placeholder="Search visitor ID or name..."
                  value={searchQuery}
                  onChange={(val) => setSearchQuery(val)}
                  autoComplete="off"
                />
                <Button onClick={handleSearch}>Filter</Button>
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </LegacyCard>

        <LegacyCard>
          {visitors.length === 0 ? (
            <EmptyState
              heading="No visitors found"
              action={{
                content: 'Open Live Simulator',
                onAction: () => onNavigate('simulator'),
              }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Simulate storefront visitor traffic to see anonymous visitor tracking and identity resolution in action.</p>
            </EmptyState>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text']}
              headings={['Visitor', 'Status', 'Intent Score', 'Sessions', 'Products', 'Cart Activity', 'Last Seen', 'Actions']}
              rows={rows as any}
            />
          )}
        </LegacyCard>
      </BlockStack>
    </Page>
  );
};
