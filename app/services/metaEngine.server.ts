export interface MetaCampaignInsights {
  id: string;
  name: string;
  status: string;
  objective?: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpc?: number;
  ctr?: number;
}

export interface MetaFetchResult {
  success: boolean;
  campaigns: MetaCampaignInsights[];
  error?: string;
  rawCount?: number;
}

/**
 * STRICTLY READ-ONLY FETCH
 * Only performs HTTP GET to fetch campaign metrics.
 * NEVER modifies, updates, or creates anything in the user's Meta Ad Account.
 */
export async function fetchMetaCampaigns(params: {
  accessToken?: string;
  adAccountId?: string;
  datePreset?: string;
}): Promise<MetaFetchResult> {
  const { accessToken, adAccountId, datePreset = "last_30d" } = params;

  if (!accessToken || !adAccountId) {
    return {
      success: false,
      campaigns: [],
      error: "Missing Meta Access Token or Ad Account ID",
    };
  }

  // Ensure Ad Account ID has act_ prefix
  let cleanAdAccountId = adAccountId.trim();
  if (!cleanAdAccountId.startsWith("act_")) {
    cleanAdAccountId = `act_${cleanAdAccountId}`;
  }

  try {
    const fields = "id,name,status,objective,insights.date_preset(" + datePreset + "){spend,impressions,clicks,cpc,cpm,ctr,actions}";
    const url = `https://graph.facebook.com/v20.0/${cleanAdAccountId}/campaigns?fields=${fields}&limit=50&access_token=${encodeURIComponent(accessToken.trim())}`;

    // STRICT HTTP GET ONLY
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    const json = await res.json();

    if (json.error) {
      console.warn("Meta Graph API error:", json.error);
      return {
        success: false,
        campaigns: [],
        error: json.error.message || `Meta API Error (${json.error.code})`,
      };
    }

    const rawData = json.data || [];
    const campaigns: MetaCampaignInsights[] = rawData.map((c: any) => {
      const insight = c.insights?.data?.[0] || {};
      return {
        id: c.id,
        name: c.name || `Campaign #${c.id}`,
        status: c.status || "ACTIVE",
        objective: c.objective || "",
        spend: parseFloat(insight.spend || "0"),
        impressions: parseInt(insight.impressions || "0", 10),
        clicks: parseInt(insight.clicks || "0", 10),
        cpc: parseFloat(insight.cpc || "0"),
        ctr: parseFloat(insight.ctr || "0"),
      };
    });

    return {
      success: true,
      campaigns,
      rawCount: campaigns.length,
    };
  } catch (err: any) {
    console.error("Meta API Fetch Exception:", err);
    return {
      success: false,
      campaigns: [],
      error: err.message || "Network error while connecting to Meta Graph API",
    };
  }
}
