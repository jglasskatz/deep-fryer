#!/bin/sh
# Evidence object store for the compose stack: single-node SeaweedFS with its
# S3 gateway on :8333 (internal network only; Caddy serves reads at /files/).
#
# SeaweedFS does not expand environment variables in its identity file, so
# this writes one from env at boot. Two identities, least privilege:
#   - "app" (web + worker): read, write, list — on the evidence bucket only.
#     No Admin: it cannot create or delete buckets (bucket-scoped Admin can
#     delete a non-empty bucket, which would destroy the audit record).
#   - "anonymous": read objects in the evidence bucket — snapshots are public
#     records shown beside each published claim. No listing.
# The bucket itself is created by the storage-init service (weed shell).
set -eu
: "${S3_BUCKET:?set S3_BUCKET}" "${STORAGE_ACCESS_KEY:?set STORAGE_ACCESS_KEY}" "${STORAGE_SECRET_KEY:?set STORAGE_SECRET_KEY}"

# Values are spliced into JSON below; refuse anything that could break out.
for v in "$S3_BUCKET" "$STORAGE_ACCESS_KEY" "$STORAGE_SECRET_KEY"; do
  case "$v" in
    *[!A-Za-z0-9._-]*)
      echo "storage: S3_BUCKET / STORAGE_* may contain only letters, digits, '.', '_' and '-' (generate keys with: openssl rand -hex 32)" >&2
      exit 1
      ;;
  esac
done
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
      "actions": ["Read:${S3_BUCKET}", "Write:${S3_BUCKET}", "List:${S3_BUCKET}"]
    }
  ]
}
EOF
# The image's entrypoint drops to the unprivileged seaweed user.
chown seaweed:seaweed "$config"
exec /entrypoint.sh server -s3 -s3.config="$config"
