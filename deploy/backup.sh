#!/bin/sh
# Nightly PostgreSQL backup, kept on the server for 14 days.
# Cron (deploy user): 15 4 * * * /opt/rusnipez/deploy/backup.sh
set -eu

cd /opt/rusnipez
dir=/var/backups/rusnipez
file="$dir/rusnipez-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Write to a temporary name first so a failed dump never looks like a backup.
docker compose -f compose.yaml -f compose.prod.yaml exec -T db \
  pg_dump -U rusnipez --format=custom rusnipez > "$file.partial"
mv "$file.partial" "$file"

find "$dir" -name 'rusnipez-*.dump' -mtime +14 -delete
