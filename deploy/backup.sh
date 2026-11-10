#!/bin/sh
# Nightly PostgreSQL backup.
# Cron (deploy user): 15 4 * * * /opt/rusnipez/deploy/backup.sh
#
# Keeps 14 days on the server. When RUSNIPEZ_BACKUP_BUCKET is set in .env, it
# also uploads to that Cloud Storage bucket (setup: deploy/gcp/backups/README.md):
#   daily/          every dump; a lifecycle rule deletes them after 30 days
#   monthly/        the first dump of each month, kept for good
#   archive/<term>/ each term as gzipped CSV, from export-terms.sh
set -eu

cd /opt/rusnipez
dir=/var/backups/rusnipez
name="rusnipez-$(date -u +%Y%m%dT%H%M%SZ).dump"
file="$dir/$name"

# Write to a temporary name first so a failed dump never looks like a backup.
docker compose -f compose.yaml -f compose.prod.yaml exec -T db \
  pg_dump -U rusnipez --format=custom rusnipez > "$file.partial"
mv "$file.partial" "$file"

find "$dir" -name 'rusnipez-*.dump' -mtime +14 -delete

bucket=$(sed -n 's/^RUSNIPEZ_BACKUP_BUCKET=//p' .env | tr -d '"' | tail -1)
[ -n "$bucket" ] || exit 0
# The backup service account's credentials, kept apart from any other gcloud login.
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-rusnipez-backup}"

gcloud storage cp --quiet "$file" "gs://$bucket/daily/$name"

# Tracked locally rather than on the 1st, so a missed night still gets the
# month its copy, and the server never needs permission to list the bucket.
month=$(date -u +%Y%m)
if [ "$(cat "$dir/last-monthly" 2>/dev/null || true)" != "$month" ]; then
  gcloud storage cp --quiet "$file" "gs://$bucket/monthly/$name"
  echo "$month" > "$dir/last-monthly"
fi

deploy/export-terms.sh "gs://$bucket/archive"

date -u +%Y-%m-%dT%H:%M:%SZ > "$dir/last-upload"
