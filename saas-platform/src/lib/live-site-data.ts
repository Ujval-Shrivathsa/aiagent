export type LiveLayoutData = {
  name: string;
  pricePerSqFt: string;
  pageUrl: string;
  plotSizes: string[];
  totalPlots?: string;
};

export type LiveSiteData = {
  fetchedAt: string;
  totalLayouts: string;
  totalHappyCustomers: string;
  yearsOfExcellence: string;
  featuredLayouts: LiveLayoutData[];
  companyTagline: string;
  rawHtmlSnippet: string;
};

let cachedData: LiveSiteData | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 60 * 1000;

const ALLOWED_PROJECT_NAMES = [
  "UK Square",
  "Sridevi Lake View",
  "CNM Apex City",
  "Alliance Serene Phase 2",
  "Adhya Enclave",
] as const;

function isAllowedProject(name: string): boolean {
  const n = name.toLowerCase();
  return ALLOWED_PROJECT_NAMES.some((allowed) => n.includes(allowed.toLowerCase()) || allowed.toLowerCase().includes(n));
}

function filterAllowedLayouts(layouts: LiveLayoutData[]): LiveLayoutData[] {
  return layouts.filter((l) => isAllowedProject(l.name));
}

const FALLBACK_DATA: LiveSiteData = {
  fetchedAt: new Date().toISOString(),
  totalLayouts: "Premium residential plot layouts across Mysuru",
  totalHappyCustomers: "4000+ happy customers",
  yearsOfExcellence: "25+ years of excellence",
  companyTagline: "Mysuru's trusted real estate partner",
  featuredLayouts: [
    {
      name: "UK Square",
      pricePerSqFt: "₹3,300–₹3,400 per sqft",
      pageUrl: "https://www.alliancesquare.com/layouts/uk-square",
      plotSizes: [],
      totalPlots: "20-acre gated community, upcoming Mysuru–Kushalnagara National Highway"
    },
    {
      name: "Sridevi Lake View",
      pricePerSqFt: "₹2,500 per sqft onwards",
      pageUrl: "https://www.alliancesquare.com/layouts/sridevi-lake-view",
      plotSizes: ["30x40", "30x50", "Odd Dimensions"],
      totalPlots: "DTCP approved layout, T. Narasipura Road"
    },
    {
      name: "CNM Apex City",
      pricePerSqFt: "₹5,450 per sqft (South-facing only)",
      pageUrl: "https://www.alliancesquare.com/layouts/cnm-apex-city",
      plotSizes: ["30x40", "Odd Dimensions"],
      totalPlots: "Ready for construction, Srirampura Ring Road — South facing only"
    },
    {
      name: "Alliance Serene Phase 2",
      pricePerSqFt: "₹3,350–₹3,450 per sqft (N/S facing only)",
      pageUrl: "https://www.alliancesquare.com/layouts/alliance-serene-phase-2",
      plotSizes: ["30x40", "40x60"],
      totalPlots: "Ready for construction, Off Bannur Road, 2 mins from Ring Road"
    },
    {
      name: "Adhya Enclave",
      pricePerSqFt: "₹3,500 per sqft",
      pageUrl: "https://www.alliancesquare.com/layouts/adhya-enclave",
      plotSizes: ["30x40", "30x50", "30x odd"],
      totalPlots: "Chamalapura Main Road, Nanjangud, ~20 mins from Mysuru"
    },
  ],
  rawHtmlSnippet: ""
};

function parseLayoutsFromHtml(html: string): LiveLayoutData[] {
  const layouts: LiveLayoutData[] = [];
  try {
    const priceRegex = /₹\s*([\d,]+)\s*\/\s*Sqft\s+onwards/gi;
    const linkRegex = /href="(https?:\/\/www\.alliancesquare\.com\/layouts\/[^"]+)"[^>]*>([^<]+)</gi;
    const allLinks: { url: string; name: string }[] = [];
    let lm: RegExpExecArray | null;
    while ((lm = linkRegex.exec(html)) !== null) {
      allLinks.push({ url: lm[1], name: lm[2].trim() });
    }
    const seen = new Set<string>();
    const prices: string[] = [];
    let pm: RegExpExecArray | null;
    while ((pm = priceRegex.exec(html)) !== null) {
      prices.push(`₹ ${pm[1]} per sqft onwards`);
    }
    for (let i = 0; i < Math.min(allLinks.length, 9); i++) {
      const link = allLinks[i];
      if (seen.has(link.name.toLowerCase())) continue;
      seen.add(link.name.toLowerCase());
      const sizesMap: Record<string, string[]> = {
        "uk square": [],
        "cnm apex city": ["30x40", "Odd Dimensions"],
        "sridevi lake view": ["30x40", "Odd Dimensions"],
        "jeevan vihar phase 2": ["30x40", "30x50", "40x60"],
        "alliance serene phase 2": ["30x40", "40x60"],
        "adhya enclave": ["30x40", "30x50"],
        "dr. daya nagar": ["30x40", "40x60"],
        "jeevan vihar": ["30x40", "30x50", "40x60"],
        "dhatri square": ["30x40", "40x60", "50x80"]
      };
      layouts.push({
        name: link.name,
        pricePerSqFt: prices[i] || "Contact for price",
        pageUrl: link.url,
        plotSizes: sizesMap[link.name.toLowerCase()] || (link.name.toLowerCase().includes("uk square") ? [] : ["30x40"])
      });
    }
  } catch (e) {
    console.warn("[LiveData] parse error:", e);
  }
  return layouts.length > 0 ? layouts : FALLBACK_DATA.featuredLayouts;
}

export async function fetchLiveSiteData(forceRefresh = false): Promise<LiveSiteData> {
  const now = Date.now();
  if (!forceRefresh && cachedData && cacheExpiry > now) {
    return cachedData;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch("https://www.alliancesquare.com/", {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AllianceSquareBot/1.0"
      }
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const parsed = parseLayoutsFromHtml(html);

    const result: LiveSiteData = {
      fetchedAt: new Date().toISOString(),
      totalLayouts: "Premium residential plot layouts across Mysuru",
      totalHappyCustomers: "4000+ happy customers",
      yearsOfExcellence: "Over 25 years of excellence",
      companyTagline: "Mysuru's trusted real estate partner",
      featuredLayouts: filterAllowedLayouts(parsed).length > 0 ? filterAllowedLayouts(parsed) : FALLBACK_DATA.featuredLayouts,
      rawHtmlSnippet: html.slice(0, 2000)
    };
    cachedData = result;
    cacheExpiry = now + CACHE_TTL_MS;
    return result;
  } catch (e) {
    console.warn("[LiveData] fetch failed, using fallback:", (e as Error).message);
    const fb = { ...FALLBACK_DATA, fetchedAt: new Date().toISOString() };
    if (!cachedData) cachedData = fb;
    cacheExpiry = now + 10 * 1000;
    return cachedData;
  }
}

function sanitizeLayoutSizes(layout: LiveLayoutData): LiveLayoutData {
  const name = layout.name.toLowerCase();
  const sizes = (layout.plotSizes || []).filter((s) => !/50\s*[x×*]\s*80/i.test(s));
  if (name.includes("uk square")) {
    return { ...layout, plotSizes: [] };
  }
  return { ...layout, plotSizes: sizes };
}

export function formatLiveDataForPrompt(data: LiveSiteData): string {
  const allowed = filterAllowedLayouts(data.featuredLayouts).map(sanitizeLayoutSizes);
  const layoutLines = (allowed.length > 0 ? allowed : FALLBACK_DATA.featuredLayouts.map(sanitizeLayoutSizes))
    .map((l, i) => {
      const sizeBit = l.plotSizes.length > 0
        ? ` | Site sizes: ${l.plotSizes.join(", ")}`
        : (l.name.toLowerCase().includes("uk square")
          ? " | Site sizes: not listed in spec — do not invent (never 50×80 / 50*80)"
          : "");
      return `${i + 1}. ${l.name} — ${l.pricePerSqFt}${sizeBit}${l.totalPlots ? " | " + l.totalPlots : ""}`;
    })
    .join("\n");
  return `
[LIVE DATA FROM alliancesquare.com — fetched ${data.fetchedAt}]

Company Overview (Live):
- ${data.companyTagline} with ${data.yearsOfExcellence}.
- ${data.totalHappyCustomers}.

Allowed projects only (ignore any other layout names from the website):
${layoutLines}

[END LIVE DATA — Project-Specific Content in the system prompt OVERRIDES any conflicting live numbers for UK Square, Sridevi Lake View, CNM Apex City, Alliance Serene Phase 2, and Adhya Enclave. Do NOT discuss any other projects.]
`.trim();
}
