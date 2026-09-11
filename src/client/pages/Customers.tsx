import React, { useEffect, useState } from 'react';
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
} from '@shopify/polaris';
import { apiClient } from '../api/client';

export const Customers: React.FC<{
  onSelectVisitor: (visitorId: string) => void;
  onNavigate: (tab: string) => void;
}> = ({ onSelectVisitor, onNavigate }) => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/customers');
      if (res.success) {
        setCustomers(res.customers);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const rows = customers.map((c) => {
    const linkedVisitor = c.visitorLinks?.[0]?.visitor;
    const matchMethod = c.visitorLinks?.[0]?.matchMethod || 'manual';

    return [
      <BlockStack key={`cust_${c.id}`} gap="100">
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {`${c.firstName || ''} ${c.lastName || ''}`}
        </Text>
        <Text variant="bodySm" tone="subdued" as="span">
          {`ID: ${c.shopifyCustomerId}`}
        </Text>
      </BlockStack>,
      c.emailReference || '—',
      c.phoneReference || '—',
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
        <Button size="slim" onClick={() => onSelectVisitor(linkedVisitor.visitorId)}>
          View Journey
        </Button>
      ) : (
        '—'
      ),
    ];
  });

  return (
    <Page
      title="Shopify Customer Intelligence"
      subtitle="Shopify customer profiles mapped to real storefront browsing behavior & historical journeys"
      secondaryActions={[{ content: 'Refresh', onAction: fetchCustomers }]}
    >
      <BlockStack gap="400">
        <LegacyCard>
          {customers.length === 0 ? (
            <EmptyState
              heading="No synced Shopify customers yet"
              action={{
                content: 'Simulate Customer Sync',
                onAction: () => onNavigate('simulator'),
              }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>When customers register, login, or complete orders, their Shopify customer profiles link to their historical storefront visitor journeys.</p>
            </EmptyState>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
              headings={['Customer', 'Email', 'Phone', 'Orders & Spent', 'Visitor Graph Link', 'Action']}
              rows={rows as any}
            />
          )}
        </LegacyCard>
      </BlockStack>
    </Page>
  );
};
