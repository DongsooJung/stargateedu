# GCP production setup

이 문서는 `google-cloud-api/`를 GitHub Actions → Workload Identity Federation → Cloud Run으로 배포하기 위한 1회 설정 절차입니다.

## 1. Google Cloud Shell에서 bootstrap 실행

```bash
git clone https://github.com/DongsooJung/stargateedu.git
cd stargateedu/google-cloud-api
chmod +x bootstrap-gcp.sh
PROJECT_ID="YOUR_GCP_PROJECT_ID" ./bootstrap-gcp.sh
```

스크립트는 다음을 준비합니다.

- Cloud Run / Cloud Build / Artifact Registry / Vertex AI / BigQuery / Places / Secret Manager API 활성화
- `stargate-github-deployer` 배포 서비스 계정
- `stargate-cloud-run` 런타임 서비스 계정
- GitHub Actions용 Workload Identity Pool / Provider
- Cloud Run source deployment 및 런타임 최소 권한
- `google-maps-api-key`, `stargate-api-token` Secret Manager 컨테이너

Billing은 스크립트가 대신 연결할 수 없으므로 프로젝트에 미리 활성화되어 있어야 합니다.

## 2. Secret Manager 값 추가

### STARGATE API token

```bash
openssl rand -hex 32 | \
  gcloud secrets versions add stargate-api-token \
  --data-file=- \
  --project="YOUR_GCP_PROJECT_ID"
```

### Places API key

Google Maps Platform에서 Places API (New) 전용 서버 키를 생성하고 API restriction을 Places API (New)로 제한한 다음:

```bash
printf '%s' 'YOUR_RESTRICTED_PLACES_KEY' | \
  gcloud secrets versions add google-maps-api-key \
  --data-file=- \
  --project="YOUR_GCP_PROJECT_ID"
```

키 자체는 GitHub repository secret에 저장하지 않습니다. Cloud Run이 Secret Manager에서 직접 주입받습니다.

## 3. GitHub repository 설정

`Settings → Secrets and variables → Actions`에서 bootstrap 출력값을 등록합니다.

### Repository variables

- `GCP_PROJECT_ID`
- `GCP_REGION` = `asia-northeast3`
- `GCP_RUNTIME_SERVICE_ACCOUNT`
- `GOOGLE_CLOUD_LOCATION` = `global`
- `GEMINI_MODEL` = `gemini-2.5-flash`
- `GOOGLE_CLOUD_CORS_ORIGINS` = `https://www.stargateedu.co.kr,https://stargateedu.co.kr`
- `GOOGLE_CLOUD_RATE_LIMIT` = `30`
- `BIGQUERY_MAX_BYTES_BILLED` = `100000000`
- `BIGQUERY_PUBLIC_VIEWS` = 공개용 View를 만든 뒤 입력
- 마지막에 `GCP_DEPLOY_READY` = `true`

### Repository secrets

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`

장기 Service Account JSON key는 사용하지 않습니다.

## 4. BigQuery 공개 View 권한

런타임 서비스 계정에 `roles/bigquery.dataViewer`를 프로젝트 전체가 아니라 공개 전용 dataset에만 부여합니다.

예:

```bash
bq --location=asia-northeast3 mk --dataset \
  YOUR_GCP_PROJECT_ID:stargate_public

bq add-iam-policy-binding \
  --member="serviceAccount:stargate-cloud-run@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer" \
  YOUR_GCP_PROJECT_ID:stargate_public
```

그 뒤 `BIGQUERY_PUBLIC_VIEWS`에 `YOUR_GCP_PROJECT_ID.stargate_public.realtors_view`처럼 정확한 View 이름만 넣습니다.

## 5. 첫 배포

`GCP_DEPLOY_READY=true` 설정 후 GitHub Actions에서 **Deploy Google Cloud API**를 `Run workflow`로 실행합니다.

정상 배포 시 workflow가 `/health`를 자동 확인하고 Cloud Run URL을 Job Summary에 기록합니다.

이후 `main`의 `google-cloud-api/**` 변경은 자동으로 재배포됩니다.

## 6. 운영 제한값

현재 workflow 기본값:

- region: `asia-northeast3`
- min instances: `0`
- max instances: `3`
- CPU: `1`
- memory: `512Mi`
- request timeout: `60s`
- BigQuery request guardrail: `100 MB`
- application rate limit: `30 requests/min/IP/instance`

비용형 POST API는 `STARGATE_API_TOKEN` 없이는 실행되지 않습니다.

## 7. 다음 단계

Cloud Run URL 검증 후 `api.stargateedu.co.kr`을 커스텀 도메인 또는 HTTPS Load Balancer/API Gateway 계층으로 연결합니다. 트래픽이 늘면 Cloud Armor/API Gateway quota를 추가하고 애플리케이션 단위 메모리 rate limiter는 보조 장치로만 사용합니다.
