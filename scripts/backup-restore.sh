#!/usr/bin/env bash
# ==============================================================================
# DokanOS — MongoDB Atlas M0 Backup & Disaster Recovery Procedure
#
# Context: MongoDB Atlas M0 (Free Tier) does NOT provide automated Cloud Backups.
# This utility provides automated, verified physical snapshot backups using
# mongodump and restore procedures using mongorestore with gzip compression.
#
# Usage:
#   bash scripts/backup-restore.sh backup [output_dir]
#   bash scripts/backup-restore.sh restore <archive_file> [target_uri]
#   bash scripts/backup-restore.sh verify <archive_file>
# ==============================================================================

set -euo pipefail

COMMAND="${1:-help}"
BACKUP_DIR="${2:-backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

case "$COMMAND" in
  backup)
    if [ -z "${MONGODB_URI:-}" ]; then
      echo "[ERROR] MONGODB_URI environment variable is required for backup." >&2
      exit 1
    fi
    mkdir -p "$BACKUP_DIR"
    ARCHIVE_NAME="${BACKUP_DIR}/dokanos_backup_${TIMESTAMP}.gz"
    echo "[INFO] Starting database backup from Atlas cluster..."
    mongodump --uri="$MONGODB_URI" --archive="$ARCHIVE_NAME" --gzip
    echo "[SUCCESS] Backup completed: ${ARCHIVE_NAME} ($(du -h "$ARCHIVE_NAME" | cut -f1))"
    ;;

  restore)
    ARCHIVE_FILE="${2:-}"
    TARGET_URI="${3:-${MONGODB_URI:-}}"
    if [ -z "$ARCHIVE_FILE" ] || [ ! -f "$ARCHIVE_FILE" ]; then
      echo "[ERROR] Valid backup archive file path required." >&2
      echo "Usage: bash scripts/backup-restore.sh restore <archive_file.gz> [target_uri]" >&2
      exit 1
    fi
    if [ -z "$TARGET_URI" ]; then
      echo "[ERROR] TARGET_URI or MONGODB_URI environment variable is required for restore." >&2
      exit 1
    fi
    echo "[WARNING] This will restore archive '$ARCHIVE_FILE' into the target database with --drop."
    echo "[WARNING] Existing collections will be overwritten."
    read -r -p "Are you sure you want to proceed with restore? (y/N) " CONFIRM
    if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
      echo "[INFO] Executing database restore..."
      mongorestore --uri="$TARGET_URI" --archive="$ARCHIVE_FILE" --gzip --drop
      echo "[SUCCESS] Restore finished successfully."
    else
      echo "[INFO] Restore aborted by user."
      exit 0
    fi
    ;;

  verify)
    ARCHIVE_FILE="${2:-}"
    if [ -z "$ARCHIVE_FILE" ] || [ ! -f "$ARCHIVE_FILE" ]; then
      echo "[ERROR] Valid backup archive file path required." >&2
      echo "Usage: bash scripts/backup-restore.sh verify <archive_file.gz>" >&2
      exit 1
    fi
    echo "[INFO] Verifying archive integrity: $ARCHIVE_FILE"
    gzip -t "$ARCHIVE_FILE"
    echo "[SUCCESS] Archive gzip header and data checksums verified OK."
    ;;

  *)
    echo "DokanOS Atlas M0 Backup & Disaster Recovery CLI"
    echo "Usage:"
    echo "  MONGODB_URI=<uri> bash scripts/backup-restore.sh backup [output_dir]"
    echo "  bash scripts/backup-restore.sh restore <archive_file.gz> <target_uri>"
    echo "  bash scripts/backup-restore.sh verify <archive_file.gz>"
    exit 1
    ;;
esac
