#!/bin/bash
set -e

mkdir -p /var/lib/overleaf/data
chown www-data:www-data /var/lib/overleaf
chown www-data:www-data /var/lib/overleaf/data

mkdir -p /var/lib/overleaf/data/compiles
chown www-data:www-data /var/lib/overleaf/data/compiles

mkdir -p /var/lib/overleaf/data/output
chown www-data:www-data /var/lib/overleaf/data/output

mkdir -p /var/lib/overleaf/data/cache
chown www-data:www-data /var/lib/overleaf/data/cache

mkdir -p /var/lib/overleaf/data/template_files
chown www-data:www-data /var/lib/overleaf/data/template_files

mkdir -p /var/lib/overleaf/data/history
chown www-data:www-data /var/lib/overleaf/data/history

mkdir -p /var/lib/overleaf/tmp/projectHistories
chown www-data:www-data /var/lib/overleaf/tmp/projectHistories

mkdir -p /var/lib/overleaf/tmp/dumpFolder
chown www-data:www-data /var/lib/overleaf/tmp/dumpFolder

# DataManipulator stores temporary project trees here. The service runs as
# www-data, so this directory must be writable in every container start.
mkdir -p /projects
chown www-data:www-data /projects
chmod 700 /projects

mkdir -p /var/lib/overleaf/tmp
chown www-data:www-data /var/lib/overleaf/tmp

mkdir -p /var/lib/overleaf/tmp/uploads
chown www-data:www-data /var/lib/overleaf/tmp/uploads

mkdir -p /var/lib/overleaf/tmp/dumpFolder
chown www-data:www-data /var/lib/overleaf/tmp/dumpFolder
