# Node.js to Bun Migration

This branch migrates NanoClaw from Node.js to Bun for faster startup, native TypeScript support, and built-in SQLite.

## Benefits

| Aspect | Node.js | Bun |
|--------|---------|-----|
| Container cold start | ~1-2s | ~0.3-0.5s |
| TypeScript | Requires tsc build step | Native, no build |
| SQLite | better-sqlite3 (native addon) | Built-in bun:sqlite |
| Package install | npm ~10s | bun ~1s |
| Image size | ~200MB (node:22-slim) | ~150MB (oven/bun:1-debian) |

## What Changed

### Host Project
- `src/db.ts` - SQLite import changed from `better-sqlite3` to `bun:sqlite`
- `package.json` - Removed better-sqlite3, tsx; updated scripts to use bun
- `tsconfig.json` - Updated for Bun's module resolution

### Container
- `container/Dockerfile` - Base image changed to `oven/bun:1-debian`, removed build step
- `container/agent-runner/` - Simplified for Bun, uses `Bun.stdin.text()`

### Other
- `.mcp.json` - Changed npx to bunx
- `.gitignore` - Added bun.lockb
- `.claude/skills/setup/SKILL.md` - Updated setup instructions for Bun

## Migration Steps

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Then restart your terminal or run:
```bash
source ~/.bashrc  # or ~/.zshrc
```

Verify installation:
```bash
bun --version
```

### 2. Install Dependencies

```bash
cd /path/to/nanoclaw
bun install
```

### 3. Test Host Application

```bash
bun src/index.ts
```

Verify:
- WhatsApp connection works
- Database operations succeed (messages stored/retrieved)

### 4. Rebuild Container Image

```bash
./container/build.sh
```

### 5. Test Container

Send a WhatsApp message to trigger the containerized agent. Verify:
- Container starts and responds
- agent-browser works in container
- Gmail MCP loads with bunx

### 6. Update launchd Service (if using)

If you have the launchd service configured, update the plist:

```bash
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
```

Edit `~/Library/LaunchAgents/com.nanoclaw.plist`:
- Change ProgramArguments from `node dist/index.js` to `bun run src/index.ts`
- Update PATH to include `~/.bun/bin`

Then reload:
```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

## Rollback

If issues arise, revert to the main branch:

```bash
git checkout main
npm install
npm run dev
```

## Verification Checklist

- [ ] `bun install` completes without errors
- [ ] `bun src/index.ts` starts WhatsApp connection
- [ ] Database operations work (messages stored/retrieved)
- [ ] `./container/build.sh` builds successfully
- [ ] Container agent responds to WhatsApp message
- [ ] agent-browser works in container
- [ ] Scheduled tasks execute correctly
- [ ] Gmail MCP loads with bunx
