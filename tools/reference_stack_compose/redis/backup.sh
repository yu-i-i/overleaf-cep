docker exec redis sh -c "redis-cli save && cp -f /data/dump.rdb /backup"
