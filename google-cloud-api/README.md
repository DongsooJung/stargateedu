# STARGATE Google Cloud API v1

`www.stargateedu.co.kr`의 정적 GitHub Pages와 Google Cloud를 분리하는 서버 측 API 계층입니다. 비밀키는 브라우저/저장소에 노출하지 않고 Cloud Run 서비스에만 주입합니다.

## v1 엔드포인트

- `GET /health` / `GET /v1/status` — 구성 상태 확인. 비밀값은 반환하지 않음.
- `POST /v1/ai/analyze` — Vertex AI의 Google Gen AI SDK를 통한 Gemini 연구자료 분석.
- `POST /v1/places/search` — Places API (New) Text Search. 필요한 필드만 FieldMask로 요청.
- `POST /v1/data/view` — `BIGQUERY_PUBLIC_VIEWS`에 허용된 BigQuery 공개 뷰만 조회.

## 설계 원칙

1. GitHub Pages에는 API 키/서비스계정 키를 두지 않습니다.
2. Cloud Run은 Application Default Credentials와 서비스 계정을 사용합니다.
3. Places 키는 Secret Manager에서 환경변수로 주입합니다.
4. BigQuery는 임의 SQL 실행을 허용하지 않습니다. 공개용 View를 만들고 allowlist로만 노출합니다.
5. 기본 CORS는 `www.stargateedu.co.kr` 및 apex 도메인만 허용합니다.
6. BigQuery 요청별 `maximumBytesBilled` 기본값은 100 MB입니다.
7. 인스턴스별 간단한 요청 제한을 적용합니다. 운영 트래픽이 커지면 API Gateway/Load Balancer 계층의 quota로 교체합니다.

## 필요한 Google Cloud API

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  bigquery.googleapis.com \
  places.googleapis.com \
  secretmanager.googleapis.com
```

## 서비스 계정 권한

Cloud Run 실행 서비스 계정에는 최소 권한만 부여합니다.

- Vertex AI User: `roles/aiplatform.user`
- BigQuery Job User: `roles/bigquery.jobUser`
- 공개용 데이터셋/View에 BigQuery Data Viewer: `roles/bigquery.dataViewer`
- Secret Manager Secret Accessor: `roles/secretmanager.secretAccessor` (Places 키를 Secret Manager로 주입할 때)

BigQuery 권한은 전체 프로젝트보다 `stargate_public` 같은 공개 전용 데이터셋에 좁혀 부여하는 것을 권장합니다.

## Places API 키

Maps Platform에서 Places API (New)를 활성화한 서버용 API 키를 생성하고 API 제한을 `Places API (New)`로 좁힙니다. 키는 GitHub Pages JavaScript에 넣지 않습니다.

예시:

```bash
printf '%s' 'YOUR_SERVER_SIDE_PLACES_KEY' | \
  gcloud secrets create google-maps-api-key --data-file=-
```

이미 secret이 있으면 새 버전을 추가합니다.

```bash
printf '%s' 'YOUR_SERVER_SIDE_PLACES_KEY' | \
  gcloud secrets versions add google-maps-api-key --data-file=-
```

## BigQuery 공개 View 예시

원본 테이블을 바로 공개하지 말고 필요한 컬럼만 View로 만듭니다.

```sql
CREATE OR REPLACE VIEW `YOUR_PROJECT.stargate_public.realtors_view` AS
SELECT
  office_name,
  district,
  address,
  latitude,
  longitude
FROM `YOUR_PROJECT.research_private.seoul_realtors`
WHERE status = '영업';
```

Cloud Run 환경변수에는 정확한 View 이름만 allowlist로 등록합니다.

```text
BIGQUERY_PUBLIC_VIEWS=YOUR_PROJECT.stargate_public.realtors_view
```

## Cloud Run 배포

서울 리전 예시:

```bash
cd google-cloud-api

gcloud run deploy stargate-google-cloud-api \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=gemini-2.5-flash,CORS_ORIGINS=https://www.stargateedu.co.kr\,https://stargateedu.co.kr,BIGQUERY_PUBLIC_VIEWS=YOUR_PROJECT.stargate_public.realtors_view \
  --set-secrets GOOGLE_MAPS_API_KEY=google-maps-api-key:latest
```

별도 실행 서비스 계정을 쓸 경우 `--service-account`로 지정하고 위 최소 IAM 역할을 부여합니다.

## 요청 예시

### Gemini

```bash
curl -X POST "$API/v1/ai/analyze" \
  -H 'Content-Type: application/json' \
  -d '{"text":"강남구 숙박시설 데이터 요약..."}'
```

### Places

```bash
curl -X POST "$API/v1/places/search" \
  -H 'Content-Type: application/json' \
  -d '{"query":"강남구 공인중개사","pageSize":10,"latitude":37.5172,"longitude":127.0473,"radius":5000}'
```

### BigQuery 공개 View

```bash
curl -X POST "$API/v1/data/view" \
  -H 'Content-Type: application/json' \
  -d '{"view":"YOUR_PROJECT.stargate_public.realtors_view","limit":100}'
```

## 다음 단계

1. GCP 프로젝트/결제 연결
2. Cloud Run 실행 서비스 계정 생성 및 최소 IAM 설정
3. Secret Manager에 Places 키 저장
4. `stargate_public` BigQuery 데이터셋과 공개용 View 생성
5. Cloud Run 배포 후 `/health` 확인
6. `research/google-cloud/` 대시보드에서 API URL 설정
7. 안정화 후 `api.stargateedu.co.kr` 커스텀 도메인 연결
