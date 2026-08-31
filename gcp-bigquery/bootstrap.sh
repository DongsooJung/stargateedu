#!/usr/bin/env bash
set -euo pipefail

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${BQ_DATASET_ID:=stargate_core}"
: "${BQ_LOCATION:=asia-northeast3}"

command -v gcloud >/dev/null || { echo "gcloud CLI is required"; exit 1; }
command -v bq >/dev/null || { echo "bq CLI is required"; exit 1; }

gcloud config set project "$GCP_PROJECT_ID" >/dev/null

gcloud services enable \
  bigquery.googleapis.com \
  bigquerystorage.googleapis.com \
  cloudresourcemanager.googleapis.com

bq --location="$BQ_LOCATION" mk --dataset \
  --description "STARGATE shared analytical data lake" \
  "$GCP_PROJECT_ID:$BQ_DATASET_ID" 2>/dev/null || true

TMP_SQL="$(mktemp)"
trap 'rm -f "$TMP_SQL"' EXIT
sed \
  -e "s/\${PROJECT_ID}/$GCP_PROJECT_ID/g" \
  -e "s/\${DATASET_ID}/$BQ_DATASET_ID/g" \
  "$(dirname "$0")/schema.sql" > "$TMP_SQL"

bq --location="$BQ_LOCATION" query --use_legacy_sql=false < "$TMP_SQL"

echo "BigQuery bootstrap complete: ${GCP_PROJECT_ID}.${BQ_DATASET_ID} (${BQ_LOCATION})"
