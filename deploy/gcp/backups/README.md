# Off-server backups

`deploy/backup.sh` runs nightly on the server. Besides the 14 days it keeps on local disk, it
uploads to a private Cloud Storage bucket once `RUSNIPEZ_BACKUP_BUCKET` is set in
`/opt/rusnipez/.env`:

| Prefix | Contents | Kept |
|---|---|---|
| `daily/` | every nightly `pg_dump` (custom format) | 30 days, by `lifecycle.json` |
| `monthly/` | the first dump of each month | indefinitely |
| `archive/<term>/` | that term's openings, sections, term row (CSV) and catalogs (JSON), gzipped | indefinitely; refreshed nightly, so a term no longer polled keeps its last export |

The bucket is in `us-east1`, where the Always Free tier covers 5 GB of Standard storage. A dump
is a few MB, so this stays well inside it. Do not switch it to Archive or Coldline: those are
outside the free tier and charge for reads.

## Permissions

The server writes as the `rusnipez-backup` service account, which has rights on this bucket
only:

- create and read objects anywhere in the bucket (`gcloud storage cp` reads the destination
  before writing);
- replace objects under `archive/` only, which is what refreshing an export needs.

It cannot delete or replace a dump, so a compromised server cannot destroy its backups.
Expired dailies are removed by the lifecycle rule, not by the server. The account's key lives
only in `~/.config/gcloud-rusnipez-backup` for the `deploy` user on the server.

## One-time setup

From your PC, with `gcloud` signed in as the project owner:

```bash
PROJECT=rusnipez-dp26
BUCKET=rusnipez-dp26-backups
SA=rusnipez-backup@$PROJECT.iam.gserviceaccount.com

gcloud storage buckets create gs://$BUCKET --project=$PROJECT --location=us-east1 \
  --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://$BUCKET --lifecycle-file=deploy/gcp/backups/lifecycle.json

gcloud iam service-accounts create rusnipez-backup --project=$PROJECT \
  --display-name="RU SnipeZ backups"
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$SA --role=roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$SA --role=roles/storage.objectViewer
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$SA --role=roles/storage.objectUser \
  --condition="expression=resource.name.startsWith(\"projects/_/buckets/$BUCKET/objects/archive/\"),title=archive-only"
```

The conditional binding returned HTTP 503 on every try when this was set up (9 Nov 2026). If it
does, write the policy instead: save `gcloud storage buckets get-iam-policy gs://$BUCKET
--format=json` to `policy.json`, add `"version": 3` and this binding, then apply it with
`gcloud storage buckets set-iam-policy gs://$BUCKET policy.json`.

```json
{
  "role": "roles/storage.objectUser",
  "members": ["serviceAccount:rusnipez-backup@rusnipez-dp26.iam.gserviceaccount.com"],
  "condition": {
    "title": "archive-only",
    "expression": "resource.name.startsWith(\"projects/_/buckets/rusnipez-dp26-backups/objects/archive/\")"
  }
}
```

Then create a key and copy it to the server:

```bash
gcloud iam service-accounts keys create backup-key.json --iam-account=$SA
scp -i ~/.ssh/rusnipez_oracle backup-key.json deploy@34.74.230.121:
rm backup-key.json
```

On the server, as `deploy` (`gcloud` ships with Google's Debian and Ubuntu images):

```bash
CLOUDSDK_CONFIG=~/.config/gcloud-rusnipez-backup gcloud auth activate-service-account --key-file=backup-key.json
shred -u backup-key.json
echo RUSNIPEZ_BACKUP_BUCKET=rusnipez-dp26-backups >> /opt/rusnipez/.env
/opt/rusnipez/deploy/backup.sh && /opt/rusnipez/deploy/status.sh | grep -A3 '== Backups'
```

`activate-service-account` copies the key into that config directory, so the downloaded file
is no longer needed.

Checked with the key when this was set up: the account can create objects anywhere and replace
them under `archive/`, but overwriting or deleting under `daily/` is denied.

## Restore

From your PC, download a dump and copy it to the server:

```bash
gcloud storage ls gs://rusnipez-dp26-backups/daily/
gcloud storage cp gs://rusnipez-dp26-backups/daily/rusnipez-YYYYMMDDTHHMMSSZ.dump .
scp -i ~/.ssh/rusnipez_oracle rusnipez-*.dump deploy@34.74.230.121:/var/backups/rusnipez/
```

On the server, stop the service so nothing writes during the restore, then:

```bash
cd /opt/rusnipez
C="docker compose -f compose.yaml -f compose.prod.yaml"
$C stop service
$C exec -T db pg_restore -U rusnipez -d rusnipez --clean --if-exists < /var/backups/rusnipez/rusnipez-YYYYMMDDTHHMMSSZ.dump
$C up -d service
```

## Analytics

The `archive/` exports need no database. For example, with DuckDB:

```sql
select s.course_code, count(*) as openings
from 'archive/12027/openings.csv.gz' o
join 'archive/12027/sections.csv.gz' s using ("index")
where o.open_detected_after is not null
group by 1 order by 2 desc limit 20;
```

Rows with `open_detected_after` empty were already open when tracking began, so they are not
real openings.
