-- STARGATE BigQuery bootstrap schema
-- Replace ${PROJECT_ID} and ${DATASET_ID} before running with bq query.

CREATE SCHEMA IF NOT EXISTS `${PROJECT_ID}.${DATASET_ID}`
OPTIONS(location="asia-northeast3");

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET_ID}.project_events` (
  event_id STRING NOT NULL,
  project_key STRING NOT NULL,
  event_type STRING NOT NULL,
  source STRING,
  status STRING,
  payload JSON,
  occurred_at TIMESTAMP NOT NULL,
  ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(occurred_at)
CLUSTER BY project_key, event_type, status;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET_ID}.api_usage` (
  usage_id STRING NOT NULL,
  service STRING NOT NULL,
  endpoint STRING,
  project_key STRING,
  request_count INT64,
  input_tokens INT64,
  output_tokens INT64,
  estimated_cost_usd NUMERIC,
  status_code INT64,
  occurred_at TIMESTAMP NOT NULL,
  ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(occurred_at)
CLUSTER BY service, project_key;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET_ID}.roadmap_snapshot` (
  snapshot_date DATE NOT NULL,
  project_key STRING NOT NULL,
  score INT64,
  readiness_pct INT64,
  status STRING,
  bottleneck STRING,
  next_action STRING,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY snapshot_date
CLUSTER BY project_key, status;
