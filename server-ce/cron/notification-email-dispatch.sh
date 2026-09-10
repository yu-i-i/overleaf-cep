#!/usr/bin/env bash

set -eu

echo "-----------------------------------------------"
echo "Dispatching scheduled notification emails"
echo "(emailNotifications -> send mail)"
echo "-----------------------------------------------"
date

source /etc/container_environment.sh
source /etc/overleaf/env.sh

cd /overleaf/services/web && /sbin/setuser www-data node scripts/process_notifications.mjs

echo "Done."
