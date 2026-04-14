#!/bin/bash
# emergency-enable-local-login.sh
#
# Emergency script to re-enable local (email/password) login on the Overleaf
# admin web interface if it was accidentally disabled via /admin/sso.
#
# Run this from the Docker host where the Overleaf containers are running:
#
#   bash /root/sso/overleaf-cep/server-ce/bin/emergency-enable-local-login.sh
#
# After running this, reload the /admin/sso page in your browser.

set -euo pipefail

CONTAINER="${OVERLEAF_CONTAINER:-overleafserver}"
MONGO_URL="${OVERLEAF_MONGO_URL:-}"

echo "=== Overleaf Emergency: Re-enable Local Login ==="
echo ""

# Make sure the container is running
if ! docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  echo "ERROR: Container '$CONTAINER' is not running."
  echo "       Set OVERLEAF_CONTAINER=<name> if your container has a different name."
  exit 1
fi

# Resolve Mongo URL from the container's environment if not overridden
if [[ -z "$MONGO_URL" ]]; then
  MONGO_URL=$(docker exec "$CONTAINER" sh -c 'echo $OVERLEAF_MONGO_URL' 2>/dev/null || true)
fi

if [[ -z "$MONGO_URL" ]]; then
  MONGO_URL="mongodb://overleafmongo/sharelatex"
  echo "WARNING: Could not detect MONGO_URL, defaulting to $MONGO_URL"
fi

echo "Container : $CONTAINER"
echo "Mongo URL : $MONGO_URL"
echo ""

# Run the fix inside the container using mongosh (or mongo as fallback)
SCRIPT=$(cat <<'MONGOEOF'
const result = db.getSiblingDB("sharelatex").ssoConfigs.updateOne(
  { _id: "sso-settings" },
  { $set: { "loginPage.localLoginEnabled": true } }
);
if (result.matchedCount === 0) {
  print("WARNING: No sso-settings document found in ssoConfigs.");
  print("         Local login is enabled by default when no config exists.");
  print("         No changes were needed.");
} else {
  print("SUCCESS: localLoginEnabled set to true (" + result.modifiedCount + " document(s) modified).");
}
MONGOEOF
)

echo "Applying fix to MongoDB..."
echo ""

# Try mongosh first, fall back to mongo
if docker exec "$CONTAINER" sh -c "command -v mongosh >/dev/null 2>&1"; then
  docker exec "$CONTAINER" sh -c "mongosh --quiet '$MONGO_URL' --eval '$SCRIPT'"
elif docker exec "$CONTAINER" sh -c "command -v mongo >/dev/null 2>&1"; then
  docker exec "$CONTAINER" sh -c "mongo --quiet '$MONGO_URL' --eval '$SCRIPT'"
else
  # Try directly on the mongo container
  MONGO_CONTAINER="${OVERLEAF_MONGO_CONTAINER:-overleafmongo}"
  echo "mongosh/mongo not in $CONTAINER, trying container $MONGO_CONTAINER..."
  if docker inspect --format '{{.State.Running}}' "$MONGO_CONTAINER" 2>/dev/null | grep -q true; then
    docker exec "$MONGO_CONTAINER" sh -c "mongosh --quiet '$MONGO_URL' --eval '$SCRIPT' 2>/dev/null || mongo --quiet '$MONGO_URL' --eval '$SCRIPT'"
  else
    echo "ERROR: Neither mongosh nor mongo client found."
    echo "       Manually run in a mongo shell:"
    echo ""
    echo "  db.getSiblingDB(\"sharelatex\").ssoConfigs.updateOne("
    echo "    { _id: \"sso-settings\" },"
    echo "    { \$set: { \"loginPage.localLoginEnabled\": true } }"
    echo "  )"
    exit 1
  fi
fi

echo ""
echo "Done. The in-memory cache will be cleared on the next request."
echo "If you want immediate effect without waiting, restart the container:"
echo ""
echo "  docker restart $CONTAINER"
