const API_BASE = '/api';

export const apiClient = {
  getShopDomain() {
    const params = new URLSearchParams(window.location.search);
    return params.get('shop') || 'ravistore-shop.myshopify.com';
  },

  async get(endpoint: string, params?: Record<string, string>) {
    const url = new URL(`${API_BASE}${endpoint}`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null) url.searchParams.append(key, val);
      });
    }
    const res = await fetch(url.toString(), {
      headers: {
        'x-shopify-shop-domain': this.getShopDomain(),
      },
    });
    return res.json();
  },

  async post(endpoint: string, body: any) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shopify-shop-domain': this.getShopDomain(),
      },
      body: JSON.stringify(body),
    });
    return res.json();
  },

  async delete(endpoint: string) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'DELETE',
      headers: {
        'x-shopify-shop-domain': this.getShopDomain(),
      },
    });
    return res.json();
  },
};
