#!/bin/sh
# Evidence object store for the compose stack: single-node SeaweedFS with its
# S3 gateway on :8333 (internal network only; Caddy serves reads at /files/).
#
# SeaweedFS does not expand environment variables in its identity file, so
# this writes one from env at boot. Two buckets and two identities, least
# privilege:
#   - S3_BUCKET holds evidence snapshots; S3_PRIVATE_BUCKET holds a group's
#     own uploaded files, which only its members may open (through the web
#     app, never through /files/).
#   - "app" (web + worker): read, write, list — on those two buckets only.
#     No Admin: it cannot create or delete buckets (bucket-scoped Admin can
#     delete a non-empty bucket, which would destroy the audit record).
#   - "anonymous": read objects in the evidence bucket — snapshots are public
#     records shown beside each published claim. No listing, and nothing at
#     all in the private bucket.
# The buckets themselves are created by the storage-init service (weed shell).
set -eu
: "${S3_BUCKET:?set S3_BUCKET}" "${S3_PRIVATE_BUCKET:?set S3_PRIVATE_BUCKET}" "${STORAGE_ACCESS_KEY:?set STORAGE_ACCESS_KEY}" "${STORAGE_SECRET_KEY:?set STORAGE_SECRET_KEY}"

# Values are spliced into JSON below; refuse anything that could break out.
for v in "$S3_BUCKET" "$S3_PRIVATE_BUCKET" "$STORAGE_ACCESS_KEY" "$STORAGE_SECRET_KEY"; do
  case "$v" in
    *[!A-Za-z0-9._-]*)
      echo "storage: S3_BUCKET / S3_PRIVATE_BUCKET / STORAGE_* may contain only letters, digits, '.', '_' and '-' (generate keys with: openssl rand -hex 32)" >&2
      exit 1
      ;;
  esac
done
# One bucket for both would let anonymous callers read the private files.
if [ "$S3_PRIVATE_BUCKET" = "$S3_BUCKET" ]; then
  echo "storage: S3_PRIVATE_BUCKET must name a different bucket from S3_BUCKET" >&2
  exit 1
fi
if [ "${#STORAGE_SECRET_KEY}" -lt 24 ]; then
  echo "storage: STORAGE_SECRET_KEY must be at least 24 characters" >&2
  exit 1
fi

umask 077
config=/tmp/s3.json
cat > "$config" <<EOF
{
  "identities": [
    { "name": "anonymous", "actions": ["Read:${S3_BUCKET}"] },
    {
      "name": "app",
      "credentials": [{ "accessKey": "${STORAGE_ACCESS_KEY}", "secretKey": "${STORAGE_SECRET_KEY}" }],
      "actions": [
        "Read:${S3_BUCKET}", "Write:${S3_BUCKET}", "List:${S3_BUCKET}",
        "Read:${S3_PRIVATE_BUCKET}", "Write:${S3_PRIVATE_BUCKET}", "List:${S3_PRIVATE_BUCKET}"
      ]
    }
  ]
}
EOF
# The image's entrypoint drops to the unprivileged seaweed user.
chown seaweed:seaweed "$config"
exec /entrypoint.sh server -s3 -s3.config="$config"
