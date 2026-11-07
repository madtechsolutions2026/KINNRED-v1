#!/bin/sh
set -eu
mkdir -p /data/.rustfs/events /data/.rustfs/audit /logs
chown 10001:10001 /data /data/.rustfs /data/.rustfs/events /data/.rustfs/audit /logs
exec su-exec 10001:10001 /entrypoint.sh rustfs
