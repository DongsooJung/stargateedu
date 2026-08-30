#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-${1:-}}"
REPO="${GITHUB_REPOSITORY:-DongsooJung/stargateedu}"
REGION="${GCP_REGION:-asia-northeast3}"
POOL_ID="${WIF_POOL_ID:-github}"
PROVIDER_ID="${WIF_PROVIDER_ID:-stargateedu}"
DEPLOYER_NAME="${DEPLOYER_SA_NAME:-stargate-github-deployer}"
RUNTIME_NAME="${RUNTIME_SA_NAME:-stargate-cloud-run}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage: PROJECT_ID=your-project-id ./bootstrap-gcp.sh" >&2
  exit 2
fi

command -v gcloud >/dev/null 2>&1 || {
  echo "gcloud CLI is required. Run this in Google Cloud Shell or install Google Cloud CLI." >&2
  exit 2
}

gcloud config set project "${PROJECT_ID}" >/dev/null

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
DEPLOYER_SA="${DEPLOYER_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${RUNTIME_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "[1/8] Enable required APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  bigquery.googleapis.com \
  places.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  serviceusage.googleapis.com \
  --project="${PROJECT_ID}"

echo "[2/8] Create service accounts if missing"
if ! gcloud iam service-accounts describe "${DEPLOYER_SA}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${DEPLOYER_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="STARGATE GitHub Cloud Run Deployer"
fi
if ! gcloud iam service-accounts describe "${RUNTIME_SA}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNTIME_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="STARGATE Cloud Run Runtime"
fi

echo "[3/8] Grant deployer project roles"
for ROLE in \
  roles/run.admin \
  roles/run.sourceDeveloper \
  roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOYER_SA}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null
done

echo "[4/8] Allow deployer to attach runtime service account"
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None \
  --quiet >/dev/null

echo "[5/8] Configure Cloud Build and runtime permissions"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/run.builder" \
  --condition=None \
  --quiet >/dev/null

for ROLE in roles/aiplatform.user roles/bigquery.jobUser; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null
done

echo "[6/8] Create Secret Manager containers if missing"
for SECRET in google-maps-api-key stargate-api-token; do
  if ! gcloud secrets describe "${SECRET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets create "${SECRET}" \
      --project="${PROJECT_ID}" \
      --replication-policy="automatic"
  fi
  gcloud secrets add-iam-policy-binding "${SECRET}" \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None \
    --quiet >/dev/null
done

echo "[7/8] Configure GitHub Workload Identity Federation"
if ! gcloud iam workload-identity-pools describe "${POOL_ID}" \
  --project="${PROJECT_ID}" --location="global" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --display-name="GitHub Actions Pool"
fi

if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --project="${PROJECT_ID}" --location="global" \
  --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --workload-identity-pool="${POOL_ID}" \
    --display-name="STARGATE EDU GitHub Provider" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository == '${REPO}'" \
    --issuer-uri="https://token.actions.githubusercontent.com"
fi

POOL_NAME="$(gcloud iam workload-identity-pools describe "${POOL_ID}" \
  --project="${PROJECT_ID}" --location="global" --format='value(name)')"
PROVIDER_NAME="$(gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --project="${PROJECT_ID}" --location="global" \
  --workload-identity-pool="${POOL_ID}" --format='value(name)')"

gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository/${REPO}" \
  --condition=None \
  --quiet >/dev/null

echo "[8/8] Bootstrap complete"
echo
echo "GitHub repository variables:"
echo "  GCP_PROJECT_ID=${PROJECT_ID}"
echo "  GCP_REGION=${REGION}"
echo "  GCP_RUNTIME_SERVICE_ACCOUNT=${RUNTIME_SA}"
echo "  GCP_DEPLOY_READY=true   # set only after the two secrets below are configured"
echo
echo "GitHub repository secrets:"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER=${PROVIDER_NAME}"
echo "  GCP_DEPLOY_SERVICE_ACCOUNT=${DEPLOYER_SA}"
echo
echo "Secret Manager values still required:"
echo "  google-maps-api-key : add a restricted Places API (New) server key"
echo "  stargate-api-token  : add a random 32+ byte token"
echo
echo "Example API token creation:"
echo "  openssl rand -hex 32 | gcloud secrets versions add stargate-api-token --data-file=- --project=${PROJECT_ID}"
echo
echo "BigQuery note: grant ${RUNTIME_SA} roles/bigquery.dataViewer only on the curated public dataset/view, not the whole project."
