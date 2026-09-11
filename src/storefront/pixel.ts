/**
 * Shopify Web Pixel Extension
 * 
 * Subscribes to official standard Shopify Storefront events in Shopify's secure Web Pixel sandbox.
 * Compliant with Shopify Customer Privacy API and Web Pixel security requirements.
 */

declare const analytics: {
  subscribe: (eventName: string, callback: (event: any) => void) => void;
};
declare const browser: {
  localStorage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
  };
  cookie: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
  };
  sendBeacon: (url: string, data: string) => void;
};
declare const init: {
  data: {
    accountConfig?: {
      appEndpoint?: string;
      shopDomain?: string;
    };
  };
};

(function () {
  const DEFAULT_ENDPOINT = 'https://nitro-app.example.com/api/events';
  const STORAGE_KEY = '_nitro_wp_vid';

  function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function getVisitorId(): Promise<string> {
    try {
      let vid = await browser.localStorage.getItem(STORAGE_KEY);
      if (!vid) {
        vid = generateUUID();
        await browser.localStorage.setItem(STORAGE_KEY, vid);
      }
      return vid;
    } catch {
      return generateUUID();
    }
  }

  async function postEvent(eventType: string, eventData: any, initData: any) {
    try {
      const visitorId = await getVisitorId();
      const endpoint = initData?.data?.accountConfig?.appEndpoint || DEFAULT_ENDPOINT;
      const shopDomain = initData?.data?.accountConfig?.shopDomain || eventData?.context?.document?.location?.host;

      const payload = {
        visitor_id: visitorId,
        event_type: eventType,
        timestamp: eventData.timestamp || new Date().toISOString(),
        page_url: eventData.context?.document?.location?.href,
        product_id: eventData.data?.productVariant?.product?.id || eventData.data?.checkout?.lineItems?.[0]?.variant?.product?.id,
        variant_id: eventData.data?.productVariant?.id,
        collection_id: eventData.data?.collection?.id,
        cart_id: eventData.data?.cart?.id || eventData.data?.checkout?.id,
        metadata: {
          clientId: eventData.clientId,
          name: eventData.name,
          ...eventData.data,
        },
      };

      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shopify-shop-domain': shopDomain,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch((e) => {
        // Sandboxed resilience
      });
    } catch (e) {
      // Sandboxed non-blocking catch
    }
  }

  if (typeof analytics !== 'undefined') {
    // 1. Page view
    analytics.subscribe('page_viewed', (event) => postEvent('page_viewed', event, (window as any).init));

    // 2. Product view
    analytics.subscribe('product_viewed', (event) => postEvent('product_viewed', event, (window as any).init));

    // 3. Collection view
    analytics.subscribe('collection_viewed', (event) => postEvent('collection_viewed', event, (window as any).init));

    // 4. Search submitted
    analytics.subscribe('search_submitted', (event) => postEvent('search_submitted', event, (window as any).init));

    // 5. Product added to cart
    analytics.subscribe('product_added_to_cart', (event) => postEvent('product_added_to_cart', event, (window as any).init));

    // 6. Cart viewed
    analytics.subscribe('cart_viewed', (event) => postEvent('cart_viewed', event, (window as any).init));

    // 7. Checkout started
    analytics.subscribe('checkout_started', (event) => postEvent('checkout_started', event, (window as any).init));

    // 8. Checkout completed
    analytics.subscribe('checkout_completed', (event) => postEvent('checkout_completed', event, (window as any).init));
  }
})();

export {};
