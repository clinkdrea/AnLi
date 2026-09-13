#!/bin/bash
# 案理平台数据库定时备份脚本
# 用法：./backup.sh 或加入 crontab：0 2 * * * /path/to/backup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_DIR/data"
BACKUP_DIR="$DATA_DIR/backups"

mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y%m%d_%H%M%S)
DB_FILE="$DATA_DIR/anli.db"
BACKUP_FILE="$BACKUP_DIR/anli_$DATE.db"

if [ ! -f "$DB_FILE" ]; then
  echo "错误：数据库文件不存在 $DB_FILE"
  exit 1
fi

# 使用 SQLite .backup 命令（安全，不锁库）
sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"

# 压缩
gzip -f "$BACKUP_FILE"

# 保留最近 30 天的备份
find "$BACKUP_DIR" -name "anli_*.db.gz" -mtime +30 -delete

echo "备份完成：$BACKUP_FILE.gz"
echo "当前备份数：$(ls -1 "$BACKUP_DIR"/anli_*.db.gz 2>/dev/null | wc -l)"
