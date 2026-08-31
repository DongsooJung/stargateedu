# STARGATE GCP / BigQuery Bootstrap

Purpose: initialize the shared analytical layer for the STARGATE master roadmap without coupling it to the existing static-site runtime.

## Defaults

- Region: `asia-northeast3` (Seoul)
- Dataset: `stargate_core`
- Initial tables:
  - `project_events`: normalized project/runtime events
  - `api_usage`: API usage and estimated cost telemetry
  - `roadmap_snapshot`: weekly roadmap score/readiness snapshots

## Required local variables

```bash
export GCP_PROJECT_ID="your-gcp-project-id"
export BQ_DATASET_ID="stargate_core"
export BQ_LOCATION="asia-northeast3"
```

Authenticate and run:

```bash
gcloud auth login
gcloud auth application-default login
bash gcp-bigquery/bootstrap.sh
```

## Runtime variables

Server-side runtimes should use:

```text
GCP_PROJECT_ID
BQ_DATASET_ID
BQ_LOCATION
GOOGLE_APPLICATION_CREDENTIALS
```

Do not commit service-account JSON keys. Prefer Workload Identity Federation / platform-managed credentials for production. If a JSON key is temporarily required, keep it only in the deployment provider's encrypted secret store.

## Validation

```bash
bq ls --project_id="$GCP_PROJECT_ID"
bq ls "$GCP_PROJECT_ID:$BQ_DATASET_ID"
bq query --use_legacy_sql=false \
  "SELECT table_name FROM \`$GCP_PROJECT_ID.$BQ_DATASET_ID.INFORMATION_SCHEMA.TABLES\` ORDER BY table_name"
```

Expected tables: `api_usage`, `project_events`, `roadmap_snapshot`.

## Next integration

1. Send GitHub/PMO events to `project_events`.
2. Aggregate API calls and estimated spend into `api_usage`.
3. Write the six-project weekly score/readiness snapshot to `roadmap_snapshot`.
4. Expose read-only summaries to the research dashboard through a server-side API; never expose BigQuery credentials to browser JavaScript.
