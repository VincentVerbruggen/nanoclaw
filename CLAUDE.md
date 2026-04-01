# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/` | Skills loaded inside agent containers (browser, status, formatting) |

## Secrets / Credentials / Proxy (OneCLI)

API keys, secret keys, OAuth tokens, and auth credentials are managed by the OneCLI gateway — which handles secret injection into containers at request time, so no keys or tokens are ever passed to containers directly. Run `onecli --help`.

## Skills

Four types of skills exist in NanoClaw. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full taxonomy and guidelines.

- **Feature skills** — merge a `skill/*` branch to add capabilities (e.g. `/add-telegram`, `/add-slack`)
- **Utility skills** — ship code files alongside SKILL.md (e.g. `/claw`)
- **Operational skills** — instruction-only workflows, always on `main` (e.g. `/setup`, `/debug`)
- **Container skills** — loaded inside agent containers at runtime (`container/skills/`)

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/init-onecli` | Install OneCLI Agent Vault and migrate `.env` credentials to it |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Contributing

Before creating a PR, adding a skill, or preparing any contribution, you MUST read [CONTRIBUTING.md](CONTRIBUTING.md). It covers accepted change types, the four skill types and their guidelines, SKILL.md format rules, PR requirements, and the pre-submission checklist (searching for existing PRs/issues, testing, description format).

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Adding a Dedicated Telegram Bot + Group

Step-by-step guide for adding a new dedicated bot that handles a specific Telegram group.

### 1. Create the bot in @BotFather

- `/newbot` → choose name and username
- Copy the bot token
- **CRITICAL:** Go to **Bot Settings → Group Privacy → Turn off**. Without this, the bot can only see commands and replies to its own messages — not regular chat messages.

### 2. Get the chat ID

- Create a Telegram group and add the bot
- Send `/start` in the group
- Fetch updates: `curl "https://api.telegram.org/bot<TOKEN>/getUpdates?offset=-1&limit=1"` — if empty (another process polling), check `getWebhookInfo` for `pending_update_count` and retry with negative offset
- Note the chat ID (negative number for groups, e.g. `-5138473688`)
- The JID format is `tg:<chat_id>` (e.g. `tg:-5138473688`)

### 3. Add to `.env`

Append the bot to `TELEGRAM_DEDICATED_BOTS` (semicolon-separated entries, format: `token:jid1,jid2`):

```
TELEGRAM_DEDICATED_BOTS=existing_entry;NEW_TOKEN:tg:CHAT_ID
```

### 4. Create the group folder and CLAUDE.md

```bash
mkdir -p groups/<folder_name>
# Write a CLAUDE.md with the bot's persona/instructions
```

### 5. Register the group in the DB

```bash
sqlite3 store/messages.db "INSERT OR REPLACE INTO registered_groups \
  (jid, name, folder, trigger_pattern, added_at, requires_trigger, is_main) \
  VALUES ('tg:CHAT_ID', 'Group Name', 'folder_name', '@Andy', datetime('now'), 0, 0);"
```

Set `requires_trigger = 0` if the bot should respond to every message (no @mention needed).

### 6. Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### 7. Verify

- Check logs: `grep "Telegram bot connected" logs/nanoclaw.log | tail -5` — count should match (1 main + N dedicated)
- Send a message in the group and check: `grep "message stored" logs/nanoclaw.log | tail -5`

### Common pitfalls

- **Bot privacy mode ON (default):** The #1 issue. Bot won't see regular messages, only `/commands` and replies. Must disable via @BotFather and then remove+re-add the bot to existing groups.
- **Supergroup migration:** Telegram may change the group chat ID when it migrates to a supergroup. If messages stop arriving, check the actual chat ID via `/chatid` command or `getUpdates` and update both `.env` and `registered_groups` DB.
- **Multiple dedicated bots:** The code in `src/channels/telegram.ts` registers each bot from `TELEGRAM_DEDICATED_BOTS` as a separate channel (`telegram-dedicated`, `telegram-dedicated-1`, etc.).
- **DB location:** The database is at `store/messages.db` (not `data/nanoclaw.db`).

## Current Dedicated Bot Setup

| Group | JID | Folder | Bot |
|-------|-----|--------|-----|
| Vincent (private) | `tg:8308007259` | `telegram_main` | Main bot |
| Vincent & Career Coach | `tg:-5138473688` | `telegram_career_coach` | @PoekysCareerCoachBot |
| Vincent & Coworker | `tg:-5217564880` | `telegram_coworker` | @PoekysCoworkerBot |
| Diet Coach | `tg:-5153086066` | `telegram_diet` | @PoekysDietCoachBot |
| Swarm | `tg:-5224268853` | `telegram_swarm` | Main bot |

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate skill, not bundled in core. Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`) to install it. Existing auth credentials and groups are preserved.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
