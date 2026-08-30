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


def require_env(name, default=None):
    value = os.getenv(name, default)
    return value.strip() if isinstance(value, str) else value


def main():
    service_account_json = require_env('GOOGLE_SERVICE_ACCOUNT_JSON')
    ga4_property_id = require_env('GA4_PROPERTY_ID')
    gsc_site_url = require_env('GSC_SITE_URL', 'sc-domain:stargateedu.co.kr')

    missing = [
        name for name, value in (
            ('GOOGLE_SERVICE_ACCOUNT_JSON', service_account_json),
            ('GA4_PROPERTY_ID', ga4_property_id),
        ) if not value
    ]
    if missing:
        print('Growth metrics skipped; missing:', ', '.join(missing))
        return 0

    try:
        from google.oauth2 import service_account
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest
        from googleapiclient.discovery import build
    except ImportError as exc:
        print(f'Missing Python dependency: {exc}', file=sys.stderr)
        return 2

    try:
        info = json.loads(service_account_json)
    except json.JSONDecodeError as exc:
        print(f'GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON: {exc}', file=sys.stderr)
        return 2

    scopes = [
        'https://www.googleapis.com/auth/analytics.readonly',
        'https://www.googleapis.com/auth/webmasters.readonly',
    ]
    credentials = service_account.Credentials.from_service_account_info(info, scopes=scopes)

    data = load_data()
    today = date.today()
    ga_end = today - timedelta(days=1)
    ga_start = ga_end - timedelta(days=6)
    gsc_end = today - timedelta(days=2)
    gsc_start = gsc_end - timedelta(days=6)

    # GA4: 7-day active users and explicit lead-click conversion events.
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

    # Search Console: 7-day totals and top landing pages.
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

    data['last_updated'] = today.isoformat()
    data['mode'] = 'live'
    data['sources'] = {
        'ga4': 'connected',
        'google_search_console': 'connected',
        'naver_search_advisor': data.get('sources', {}).get('naver_search_advisor', 'pending'),
    }
    data['periods'] = {
        'ga4_7d': {'start': ga_start.isoformat(), 'end': ga_end.isoformat()},
        'gsc_7d': {'start': gsc_start.isoformat(), 'end': gsc_end.isoformat()},
    }
    data['kpis'] = {
        'users_7d': users_7d,
        'organic_clicks_7d': round(clicks, 2),
        'search_impressions_7d': round(impressions, 2),
        'organic_ctr_7d': round(ctr * 100, 2),
        'conversions_7d': conversions_7d,
    }
    data['top_pages'] = top_pages
    save_data(data)
    print(f'Updated growth metrics: users={users_7d}, clicks={clicks}, impressions={impressions}, conversions={conversions_7d}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
