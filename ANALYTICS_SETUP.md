# STARGATE Analytics Activation

The analytics code and daily growth-metrics pipeline are deployed. To turn live data on, configure the following once in GitHub/Google.

## 1. GA4 web stream

Create or use one GA4 property for `stargateedu.co.kr` and add both hosts as web traffic sources:

- `https://stargateedu.co.kr`
- `https://blog.stargateedu.co.kr`

Repository variables:

- `GA4_MEASUREMENT_ID` = `G-XXXXXXXXXX`
- `GA4_PROPERTY_ID` = numeric GA4 property ID

The GitHub Pages deployment builds `assets/analytics-config.js` from `GA4_MEASUREMENT_ID` and injects `assets/analytics-loader.js` into every HTML page. The blog hub loads the same analytics loader from the main domain.

## 2. Google authentication

The growth workflow first reuses the existing Google Cloud Workload Identity configuration:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`
- `GCP_PROJECT_ID`

Fallback supported secret:

- `GOOGLE_SERVICE_ACCOUNT_JSON`

Grant the authenticated service-account email Viewer/read access to the GA4 property.

## 3. Search Console

Add the same service-account email as a Search Console user for:

- preferred: `sc-domain:stargateedu.co.kr`

The collector defaults to that Domain property. If a URL-prefix property is used instead, set `GSC_SITE_URL` in the workflow environment to the exact Search Console property URL.

Grant Search Console read permission and enable the Search Console API in the Google Cloud project if needed.

## 4. Daily refresh

Workflow: `.github/workflows/update-growth-metrics.yml`

Schedule: every day at 07:20 KST.

It updates:

- GA4 active users (7d)
- `lead_click` conversion-event count (7d)
- Search Console clicks (7d)
- Search Console impressions (7d)
- Search CTR (7d)
- Search landing-page TOP 10

Output: `strategy/growth-control/data.json`

## 5. Tracked navigation events

The shared loader emits:

- `blog_to_main`
- `main_to_blog`
- `lead_click`

`lead_click` is emitted for inquiry/contact/consult/purchase-related links and `mailto:` / `tel:` links.
