#!/bin/sh
# Export every term for analytics and upload it to Cloud Storage.
# Usage: deploy/export-terms.sh gs://BUCKET/archive   (backup.sh runs it nightly)
#
# Each term gets <prefix>/<term>/:
#   term.csv.gz            the term row, including when tracking started
#   openings.csv.gz        every opening, with its detection window
#   sections.csv.gz        index -> course, title, section, instructors, campus
#   catalog-<campus>.json.gz  the normalized catalog the website serves
# DuckDB, pandas and BigQuery read these directly. Re-running replaces a term's
# files, so a term that is no longer polled keeps its last export. The poll log
# is not exported: the service keeps only 14 days of it.
set -eu

dest=${1:?usage: export-terms.sh gs://BUCKET/archive}
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-rusnipez-backup}"

cd /opt/rusnipez
compose="docker compose -f compose.yaml -f compose.prod.yaml"
psql() { $compose exec -T db psql -U rusnipez -d rusnipez -v ON_ERROR_STOP=1 "$@"; }
value() { psql -tAc "$1"; }
# Written to a file before gzip: sh has no pipefail, so a failed query in a
# pipeline would otherwise upload an empty export.
csv() { psql -c "\\copy ($1) to stdout with (format csv, header)" > "$2"; gzip "$2"; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for term in $(value "select code from terms order by code"); do
  out="$work/$term"
  mkdir "$out"
  csv "select * from terms where code = '$term'" "$out/term.csv"
  csv "select * from openings where term = '$term' order by opened_at, \"index\"" "$out/openings.csv"
  csv "select * from sections where term = '$term' order by \"index\"" "$out/sections.csv"
  for campus in $(value "select campus from catalogs where term = '$term' order by campus"); do
    value "select encode(payload_gzip, 'base64') from catalogs where term = '$term' and campus = '$campus'" \
      > "$out/catalog-$campus.b64"
    base64 -d "$out/catalog-$campus.b64" > "$out/catalog-$campus.json.gz"
    rm "$out/catalog-$campus.b64"
  done
  # One object name per file: copying into a "folder" makes gcloud read the
  # destination first, which the server's write-only credentials cannot.
  for f in "$out"/*; do
    gcloud storage cp --quiet "$f" "$dest/$term/${f##*/}"
  done
done
