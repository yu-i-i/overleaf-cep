docker exec wakapi-pg bash -c "pg_dump -U wakapi -d wakapi -F c -f /backup/backup.sql"
