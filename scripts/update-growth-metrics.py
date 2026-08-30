import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

DATA_PATH = Path('strategy/growth-control/data.json')


def load_data():
    return json.loads(DATA_PATH.read_text(encoding='utf-8'))


def save_data(data):
    DATA_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def env(name):
    value = os.getenv(name, '')
    return value.strip() if isinstance(value, str) else value


def get_credentials(scopes):
    service_account_json = env('GOOGLE_SERVICE_ACCOUNT_JSON')
    if service_account_json:
        from google.oauth2 import service_account
        try:
            info = json.loads(service_account_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f'GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON: {exc}') from exc
        return service_account.Credentials.from_service_account_info(info, scopes=scopes)

    import google.auth
    credentials, _ = google.auth.default(scopes=scopes)
    return credentials


def main():
    ga4_property_id = env('GA4_PROPERTY_ID')
    gsc_site_url = env('GSC_SITE_URL') or 'sc-domain:stargateedu.co.kr'

    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest
        from googleapiclient.discovery import build
    except ImportError as exc:
        print(f'Missing Python dependency: {exc}', file=sys.stderr)
        return 2

    scopes = [
        'https://www.googleapis.com/auth/analytics.readonly',
        'https://www.googleapis.com/auth/webmasters.readonly',
    ]
    try:
        credentials = get_credentials(scopes)
    except Exception as exc:
        print(f'Growth metrics skipped; Google credentials unavailable: {exc}')
        return 0

    data = load_data()
    kpis = dict(data.get('kpis', {}))
    sources = dict(data.get('sources', {}))
    today = date.today()
    ga_end = today - timedelta(days=1)
    ga_start = ga_end - timedelta(days=6)
    gsc_end = today - timedelta(days=2)
    gsc_start = gsc_end - timedelta(days=6)
    updated = False

    # GA4: 7-day active users and explicit lead-click events.
    if ga4_property_id:
        try:
            analytics = BetaAnalyticsDataClient(credentials=credentials)
            user_report = analytics.run_report(RunReportRequest(
                property=f'properties/{ga4_property_id}',
                date_ranges=[DateRange(start_date=ga_start.isoformat(), end_date=ga_end.isoformat())],
                metrics=[Metric(name='activeUsers')],
            ))
            users_7d = int(user_report.rows[0].metric_values[0].value) if user_report.rows else 0

            event_report = analytics.run_report(RunReportRequest(
                property=f'properties/{ga4_property_id}',
                date_ranges=[DateRange(start_date=ga_start.isoformat(), end_date=ga_end.isoformat())],
                dimensions=[Dimension(name='eventName')],
                metrics=[Metric(name='eventCount')],
                limit=1000,
            ))
            conversions_7d = 0
            for row in event_report.rows:
                if row.dimension_values[0].value == 'lead_click':
                    conversions_7d = int(row.metric_values[0].value)
                    break

            kpis['users_7d'] = users_7d
            kpis['conversions_7d'] = conversions_7d
            sources['ga4'] = 'connected'
            updated = True
            print(f'GA4 updated: users={users_7d}, lead_click={conversions_7d}')
        except Exception as exc:
            print(f'GA4 update pending/failed: {exc}')
    else:
        print('GA4 update pending: GA4_PROPERTY_ID repository variable is not configured.')

    # Search Console: 7-day totals and top landing pages.
    try:
        searchconsole = build('searchconsole', 'v1', credentials=credentials, cache_discovery=False)
        total_body = {
            'startDate': gsc_start.isoformat(),
            'endDate': gsc_end.isoformat(),
            'type': 'web',
            'rowLimit': 1,
        }
        total_result = searchconsole.searchanalytics().query(siteUrl=gsc_site_url, body=total_body).execute()
        total_rows = total_result.get('rows', [])
        if total_rows:
            clicks = float(total_rows[0].get('clicks', 0))
            impressions = float(total_rows[0].get('impressions', 0))
            ctr = float(total_rows[0].get('ctr', 0))
        else:
            clicks = impressions = ctr = 0.0

        pages_body = {
            'startDate': gsc_start.isoformat(),
            'endDate': gsc_end.isoformat(),
            'type': 'web',
            'dimensions': ['page'],
            'rowLimit': 10,
        }
        pages_result = searchconsole.searchanalytics().query(siteUrl=gsc_site_url, body=pages_body).execute()
        top_pages = []
        for row in pages_result.get('rows', []):
            keys = row.get('keys', [])
            top_pages.append({
                'page': keys[0] if keys else '',
                'clicks': round(float(row.get('clicks', 0)), 2),
                'impressions': round(float(row.get('impressions', 0)), 2),
                'ctr': round(float(row.get('ctr', 0)) * 100, 2),
                'position': round(float(row.get('position', 0)), 2),
            })

        kpis['organic_clicks_7d'] = round(clicks, 2)
        kpis['search_impressions_7d'] = round(impressions, 2)
        kpis['organic_ctr_7d'] = round(ctr * 100, 2)
        data['top_pages'] = top_pages
        sources['google_search_console'] = 'connected'
        updated = True
        print(f'GSC updated: clicks={clicks}, impressions={impressions}, pages={len(top_pages)}')
    except Exception as exc:
        print(f'Search Console update pending/failed for {gsc_site_url}: {exc}')

    if not updated:
        print('No live source updated; leaving data.json unchanged.')
        return 0

    data['last_updated'] = today.isoformat()
    data['mode'] = 'live' if sources.get('ga4') == 'connected' and sources.get('google_search_console') == 'connected' else 'partial_live'
    data['sources'] = sources
    data['periods'] = {
        'ga4_7d': {'start': ga_start.isoformat(), 'end': ga_end.isoformat()},
        'gsc_7d': {'start': gsc_start.isoformat(), 'end': gsc_end.isoformat()},
    }
    data['kpis'] = kpis
    save_data(data)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
