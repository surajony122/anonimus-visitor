import React, { useState } from 'react';
import { AppProvider, Frame, TopBar, Navigation } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';

import { Dashboard } from './pages/Dashboard';
import { Visitors } from './pages/Visitors';
import { VisitorDetail } from './pages/VisitorDetail';
import { Customers } from './pages/Customers';
import { IntentAnalytics } from './pages/IntentAnalytics';
import { PrivacyCenter } from './pages/PrivacyCenter';
import { Simulator } from './pages/Simulator';

import {
  LayoutDashboard,
  Users,
  UserCheck,
  Flame,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null);

  const handleNavigate = (tab: string, visitorId?: string) => {
    if (visitorId) {
      setSelectedVisitorId(visitorId);
      setActiveTab('visitor-detail');
    } else {
      setActiveTab(tab);
    }
  };

  const handleSelectVisitor = (visitorId: string) => {
    setSelectedVisitorId(visitorId);
    setActiveTab('visitor-detail');
  };

  const navigationMarkup = (
    <Navigation location={activeTab}>
      <Navigation.Section
        items={[
          {
            label: 'Overview Dashboard',
            icon: () => <LayoutDashboard size={18} />,
            selected: activeTab === 'dashboard',
            onClick: () => handleNavigate('dashboard'),
          },
          {
            label: 'Storefront Visitors',
            icon: () => <Users size={18} />,
            selected: activeTab === 'visitors' || activeTab === 'visitor-detail',
            onClick: () => handleNavigate('visitors'),
          },
          {
            label: 'Shopify Customers',
            icon: () => <UserCheck size={18} />,
            selected: activeTab === 'customers',
            onClick: () => handleNavigate('customers'),
          },
          {
            label: 'Intent Intelligence',
            icon: () => <Flame size={18} />,
            selected: activeTab === 'intent',
            onClick: () => handleNavigate('intent'),
          },
          {
            label: 'Privacy & Retention',
            icon: () => <ShieldCheck size={18} />,
            selected: activeTab === 'privacy',
            onClick: () => handleNavigate('privacy'),
          },
          {
            label: 'Interactive Simulator',
            icon: () => <Sparkles size={18} />,
            selected: activeTab === 'simulator',
            onClick: () => handleNavigate('simulator'),
          },
        ]}
      />
    </Navigation>
  );

  const currentShopDomain = new URLSearchParams(window.location.search).get('shop') || 'ravistore-shop.myshopify.com';

  const topBarMarkup = (
    <TopBar
      showNavigationToggle
      userMenu={
        <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500 }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#008060' }}></span>
          {currentShopDomain}
        </div>
      }
    />
  );

  return (
    <AppProvider i18n={enTranslations}>
      <Frame topBar={topBarMarkup} navigation={navigationMarkup}>
        <div style={{ paddingBottom: '60px' }}>
          {activeTab === 'dashboard' && <Dashboard onNavigate={handleNavigate} />}
          {activeTab === 'visitors' && (
            <Visitors onSelectVisitor={handleSelectVisitor} onNavigate={handleNavigate} />
          )}
          {activeTab === 'visitor-detail' && selectedVisitorId && (
            <VisitorDetail
              visitorId={selectedVisitorId}
              onBack={() => handleNavigate('visitors')}
            />
          )}
          {activeTab === 'customers' && (
            <Customers onSelectVisitor={handleSelectVisitor} onNavigate={handleNavigate} />
          )}
          {activeTab === 'intent' && <IntentAnalytics onSelectVisitor={handleSelectVisitor} />}
          {activeTab === 'privacy' && <PrivacyCenter />}
          {activeTab === 'simulator' && <Simulator onInspectVisitor={handleSelectVisitor} />}
        </div>
      </Frame>
    </AppProvider>
  );
}
