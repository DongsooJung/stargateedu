# STARGATE EDU CODEF API proxy

Server-side proxy for the public data widget on `www.stargateedu.co.kr`.
It keeps CODEF credentials out of GitHub Pages, caches OAuth tokens, and only
returns allow-listed exchange-rate fields.

## Required environment variables

- `CODEF_CLIENT_ID`
- `CODEF_CLIENT_SECRET`
- `CODEF_ENVIRONMENT`: `production`, `development`, or `sandbox`
- `CODEF_EXCHANGE_ORGANIZATION`, or a full `CODEF_EXCHANGE_BODY` JSON object

Endpoint: `GET /api/exchange`

Do not commit real credentials or a private `connectedId`.
