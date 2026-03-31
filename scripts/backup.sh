#!/bin/bash
#
# NanoClaw Backup Script
# Backs up groups, database, config, and custom code to a timestamped archive.
#
# Usage:
#   ./scripts/backup.sh              # backup to default location
#   ./scripts/backup.sh /path/to/dir # backup to custom location
#
# Restore:
#   tar xzf nanoclaw-backup-YYYYMMDD-HHMMSS.tar.gz -C /Volumes/Workspace/nanoclaw

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${1:-$HOME/Backups/nanoclaw}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="nanoclaw-backup-$TIMESTAMP"
STAGING_DIR=$(mktemp -d)

mkdir -p "$BACKUP_DIR"

echo "NanoClaw Backup — $TIMESTAMP"
echo "Project: $PROJECT_DIR"
echo "Destination: $BACKUP_DIR/$BACKUP_NAME.tar.gz"
echo ""

# --- Groups (CLAUDE.md files, conversations, memory) ---
echo "• Backing up groups..."
if [ -d "$PROJECT_DIR/groups" ]; then
  cp -a "$PROJECT_DIR/groups" "$STAGING_DIR/groups"
fi

# --- Database (messages, tasks, registered groups, sessions) ---
echo "• Backing up database..."
if [ -f "$PROJECT_DIR/store/messages.db" ]; then
  mkdir -p "$STAGING_DIR/store"
  # Use sqlite3 backup for consistency (avoids copying mid-write)
  if command -v sqlite3 &>/dev/null; then
    sqlite3 "$PROJECT_DIR/store/messages.db" ".backup '$STAGING_DIR/store/messages.db'"
  else
    cp "$PROJECT_DIR/store/messages.db" "$STAGING_DIR/store/messages.db"
  fi
fi

# --- Data directory (sessions, agent-runner cache) ---
echo "• Backing up session data..."
if [ -d "$PROJECT_DIR/data" ]; then
  cp -a "$PROJECT_DIR/data" "$STAGING_DIR/data"
fi

# --- Environment config ---
echo "• Backing up config..."
mkdir -p "$STAGING_DIR/config"
[ -f "$PROJECT_DIR/.env" ] && cp "$PROJECT_DIR/.env" "$STAGING_DIR/config/.env"
[ -f "$PROJECT_DIR/package.json" ] && cp "$PROJECT_DIR/package.json" "$STAGING_DIR/config/package.json"

# Host-level config (sender allowlist, mount allowlist)
NANOCLAW_CONF="$HOME/.config/nanoclaw"
if [ -d "$NANOCLAW_CONF" ]; then
  cp -a "$NANOCLAW_CONF" "$STAGING_DIR/config/nanoclaw-host"
fi

# --- Custom source files (local modifications not in upstream) ---
echo "• Backing up custom source..."
mkdir -p "$STAGING_DIR/custom-src/channels"
for f in "$PROJECT_DIR/src/channels/telegram.ts" "$PROJECT_DIR/src/transcription.ts"; do
  [ -f "$f" ] && cp "$f" "$STAGING_DIR/custom-src/channels/$(basename "$f")"
done

# --- Container skills (agent-facing) ---
echo "• Backing up container skills..."
if [ -d "$PROJECT_DIR/container/skills" ]; then
  cp -a "$PROJECT_DIR/container/skills" "$STAGING_DIR/container-skills"
fi

# --- LaunchAgent plist ---
PLIST="$HOME/Library/LaunchAgents/com.nanoclaw.plist"
if [ -f "$PLIST" ]; then
  cp "$PLIST" "$STAGING_DIR/config/com.nanoclaw.plist"
fi

# --- Git state (for reference during restore) ---
echo "• Recording git state..."
(cd "$PROJECT_DIR" && git rev-parse HEAD > "$STAGING_DIR/git-commit.txt" 2>/dev/null || true)
(cd "$PROJECT_DIR" && git log --oneline -5 >> "$STAGING_DIR/git-commit.txt" 2>/dev/null || true)
(cd "$PROJECT_DIR" && git remote -v >> "$STAGING_DIR/git-commit.txt" 2>/dev/null || true)

# --- Create archive ---
echo "• Creating archive..."
tar czf "$BACKUP_DIR/$BACKUP_NAME.tar.gz" -C "$STAGING_DIR" .

# --- Cleanup ---
rm -rf "$STAGING_DIR"

# --- Summary ---
SIZE=$(du -sh "$BACKUP_DIR/$BACKUP_NAME.tar.gz" | cut -f1)
echo ""
echo "Backup complete: $BACKUP_DIR/$BACKUP_NAME.tar.gz ($SIZE)"
echo ""

# --- Prune old backups (keep last 10) ---
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/nanoclaw-backup-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
if [ "$BACKUP_COUNT" -gt 10 ]; then
  PRUNE_COUNT=$((BACKUP_COUNT - 10))
  echo "Pruning $PRUNE_COUNT old backup(s) (keeping 10)..."
  ls -1t "$BACKUP_DIR"/nanoclaw-backup-*.tar.gz | tail -n "$PRUNE_COUNT" | xargs rm -f
fi
