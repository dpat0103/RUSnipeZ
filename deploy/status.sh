#!/bin/sh
# One-screen health and usage report for the RU SnipeZ server.
# From your PC: ssh -i ~/.ssh/rusnipez_oracle deploy@<server> /opt/rusnipez/deploy/status.sh
set -u
cd /opt/rusnipez
compose="docker compose -f compose.yaml -f compose.prod.yaml"
sql() { $compose exec -T db psql -U rusnipez -d rusnipez -tAc "$1"; }

echo "== Server"
echo "up $(uptime -p | sed 's/^up //'), load $(cut -d' ' -f1-3 /proc/loadavg)"
free -m | awk 'NR==2 {printf "memory: %s of %s MB used\n", $3, $2} NR==3 {printf "swap:   %s of %s MB used\n", $3, $2}'
df -h / | awk 'NR==2 {printf "disk:   %s of %s used (%s)\n", $3, $2, $5}'

echo
echo "== Containers"
docker stats --no-stream --format "{{.Name}}: cpu {{.CPUPerc}}, memory {{.MemUsage}}"

echo
echo "== Network (outbound is the only billable resource; 1 GB/month free)"
vnstat -i ens4 --oneline b 2>/dev/null | awk -F';' '{
  printf "today:      sent %.1f MB, received %.1f MB\n", $5/1048576, $4/1048576
  printf "this month: sent %.1f MB, received %.1f MB\n", $10/1048576, $9/1048576 }'

echo
echo "== Data"
echo "database: $(sql "select pg_size_pretty(pg_database_size(current_database()))")"
echo "openings recorded (observed): $(sql "select count(*) from openings where open_detected_after is not null")"
echo "polls in the last 24 h by status:"
sql "select '  ' || status || ': ' || count(*) from polls where finished_at > now() - interval '1 day' group by status order by status"
echo "last poll: $(sql "select to_char(max(finished_at) at time zone 'America/New_York', 'Mon DD HH12:MI:SS AM') from polls where status = 'ok'") Eastern"

echo
echo "== Backups"
ls -1t /var/backups/rusnipez/*.dump 2>/dev/null | head -1 | xargs -r ls -lh | awk '{print "latest: " $NF " (" $5 ")"}'
echo "kept: $(ls /var/backups/rusnipez/*.dump 2>/dev/null | wc -l)"

echo
echo "== HTTPS certificate"
host=$(grep '^RUSNIPEZ_HOST=' .env | cut -d= -f2)
echo | openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null \
  | openssl x509 -noout -enddate | sed 's/notAfter=/expires: /'
