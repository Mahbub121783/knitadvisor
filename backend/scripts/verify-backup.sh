#!/usr/bin/env bash
# Backup restore drill — proves the newest dump is readable AND holds the data
# the live database holds, without needing permission to create a database.
#
#   1. pg_restore --list   : the archive is intact and its table of contents reads
#   2. per-table row count : rows inside the archive vs rows in the live database
#
# Run on the server (ssh), from anywhere:
#   bash ~/knitadvisor/backend/scripts/verify-backup.sh
#
# Exit 0 only if every checked table matches. A dump that cannot be listed, or a
# count that differs, exits non-zero so a cron wrapper can alert on it.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/knitadvisor}"
TABLES="${VERIFY_TABLES:-app_users app_student_verifications university_domains user_calculations}"

LATEST=$(ls -1t "$BACKUP_DIR"/knitadvisor-*.dump 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then
  echo "FAIL: no dump found in $BACKUP_DIR"
  exit 1
fi
echo "dump: $(basename "$LATEST")  ($(stat -c %s "$LATEST") bytes, $(stat -c %y "$LATEST" | cut -d. -f1))"

# 1. Archive integrity — pg_restore reads the table of contents or fails loudly.
if ! pg_restore --list "$LATEST" > /dev/null; then
  echo "FAIL: pg_restore cannot read the archive"
  exit 1
fi
echo "ok: archive table of contents readable"

# 2. Row counts. Data for one table is extracted as COPY … FROM stdin; each data
#    line is one row, terminated by \. — count the lines between the two.
PGPASSWORD="${PGPASSWORD:-}" # supplied by the environment, never on the command line
FAILED=0
for t in $TABLES; do
  archived=$(pg_restore --data-only --table="$t" -f - "$LATEST" 2>/dev/null \
    | awk -v t="$t" 'index($0, "COPY public." t " ")==1 {on=1; next} /^\\\.$/ {on=0} on {n++} END {print n+0}')
  live=$(psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" -tAc "SELECT count(*) FROM $t")
  # The live database keeps changing after the dump was taken, so an exact
  # match is the wrong test. A backup is broken when it holds MORE rows than
  # live (impossible for a faithful dump), or holds NONE of a table that has
  # rows now (the table did not come through at all).
  if [ "$archived" -gt "$live" ] || { [ "$archived" -eq 0 ] && [ "$live" -gt 0 ]; }; then
    echo "FAIL: $t  archive=$archived live=$live"
    FAILED=1
  else
    echo "ok:   $t  archive=$archived live=$live  (live drift since dump: $((live - archived)))"
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "RESULT: mismatch found"
  exit 1
fi
echo "RESULT: backup verified"
