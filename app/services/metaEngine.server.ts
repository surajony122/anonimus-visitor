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
  discoveredAccounts?: string[];
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

  if (!accessToken) {
    return {
      success: false,
      campaigns: [],
      error: "Missing Meta Access Token",
    };
  }

  const cleanToken = accessToken.trim();
  let targetAccountId = (adAccountId || "").trim();
  if (targetAccountId && !targetAccountId.startsWith("act_")) {
    targetAccountId = `act_${targetAccountId}`;
  }

  try {
    // 1. Auto-discover available ad accounts for this token
    let availableAccounts: Array<{ id: string; name: string; account_id: string }> = [];
    try {
      const accountsUrl = `https://graph.facebook.com/v20.0/me/adaccounts?fields=id,name,account_id&limit=25&access_token=${encodeURIComponent(cleanToken)}`;
      const accRes = await fetch(accountsUrl, { method: "GET" });
      const accJson = await accRes.json();
      if (accJson.data && Array.isArray(accJson.data)) {
        availableAccounts = accJson.data;
      }
    } catch {}

    // If no ad account was specified or if specified account not found, use first discovered
    if (!targetAccountId && availableAccounts.length > 0) {
      targetAccountId = availableAccounts[0].id;
    } else if (targetAccountId && availableAccounts.length > 0) {
      const match = availableAccounts.find(
        (a) => a.id === targetAccountId || a.account_id === targetAccountId.replace("act_", "")
      );
      if (match) {
        targetAccountId = match.id;
      }
    }

    if (!targetAccountId) {
      if (availableAccounts.length === 0) {
        return {
          success: false,
          campaigns: [],
          error: "No Ad Accounts accessible by this Access Token. Ensure the System User has been assigned to the Ad Account in Meta Business Settings > Accounts > Ad Accounts > Assign People.",
        };
      }
      targetAccountId = availableAccounts[0].id;
    }

    // 2. Fetch campaigns list
    const campaignsUrl = `https://graph.facebook.com/v20.0/${targetAccountId}/campaigns?fields=id,name,status,objective&limit=50&access_token=${encodeURIComponent(cleanToken)}`;
    const campRes = await fetch(campaignsUrl, { method: "GET" });
    const campJson = await campRes.json();

    if (campJson.error) {
      const errCode = campJson.error.code;
      const errMsg = campJson.error.message || `Meta API Error (${errCode})`;
      
      let hint = "";
      if (availableAccounts.length > 0) {
        hint = ` (Available Ad Accounts for this token: ${availableAccounts.map(a => `${a.name} [${a.id}]`).join(", ")})`;
      }
      
      return {
        success: false,
        campaigns: [],
        error: `${errMsg}${hint}`,
        discoveredAccounts: availableAccounts.map(a => a.id),
      };
    }

    const rawCampaigns = campJson.data || [];

    // 3. Fetch insights for these campaigns
    const insightsMap = new Map<string, { spend: number; impressions: number; clicks: number; cpc: number; ctr: number }>();
    try {
      const insightsUrl = `https://graph.facebook.com/v20.0/${targetAccountId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,cpc,ctr&date_preset=${datePreset}&limit=100&access_token=${encodeURIComponent(cleanToken)}`;
      const insRes = await fetch(insightsUrl, { method: "GET" });
      const insJson = await insRes.json();
      if (insJson.data && Array.isArray(insJson.data)) {
        insJson.data.forEach((ins: any) => {
          if (ins.campaign_id) {
            insightsMap.set(ins.campaign_id, {
              spend: parseFloat(ins.spend || "0"),
              impressions: parseInt(ins.impressions || "0", 10),
              clicks: parseInt(ins.clicks || "0", 10),
              cpc: parseFloat(ins.cpc || "0"),
              ctr: parseFloat(ins.ctr || "0"),
            });
          }
        });
      }
    } catch {}

    // 4. Combine campaigns with their insights
    const campaigns: MetaCampaignInsights[] = rawCampaigns.map((c: any) => {
      const ins = insightsMap.get(c.id) || { spend: 0, impressions: 0, clicks: 0, cpc: 0, ctr: 0 };
      return {
        id: c.id,
        name: c.name || `Campaign #${c.id}`,
        status: c.status || "ACTIVE",
        objective: c.objective || "",
        spend: ins.spend,
        impressions: ins.impressions,
        clicks: ins.clicks,
        cpc: ins.cpc,
        ctr: ins.ctr,
      };
    });

    return {
      success: true,
      campaigns,
      rawCount: campaigns.length,
      discoveredAccounts: availableAccounts.map(a => `${a.name} (${a.id})`),
    };
  } catch (err: any) {
    console.error("Meta API Fetch Exception:", err);
    return {
      success: false,
      campaigns: [],
      error: err.message || "Network error connecting to Meta Graph API",
    };
  }
}

