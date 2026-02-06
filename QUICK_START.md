# VISP/Tasker — Quick Start Guide

## What You Got

```
visp-tasker-orchestration/
├── CLAUDE.md           → Drop into your project root. Claude Code reads this automatically.
├── MASTER_PROMPT.md    → The full orchestration prompt. Paste into Claude Code to build everything.
├── QUICK_START.md      → This file.
└── AGENT_DISPATCH.md   → Individual agent commands for manual/selective building.
```

## How to Use

### Option A: Full Automated Build (Recommended)
1. Create your project directory:
   ```bash
   mkdir visp-tasker && cd visp-tasker
   ```
2. Copy `CLAUDE.md` into the project root:
   ```bash
   cp CLAUDE.md visp-tasker/CLAUDE.md
   ```
3. Open Claude Code in the project:
   ```bash
   claude
   ```
4. Paste the entire contents of `MASTER_PROMPT.md` and hit enter.
5. Claude Code will:
   - Read CLAUDE.md automatically
   - Create the directory scaffold
   - Spawn sub-agents phase by phase using your installed agents
   - Build the entire platform systematically

### Option B: Phase-by-Phase (More Control)
1. Same setup as above (steps 1-3)
2. Open `AGENT_DISPATCH.md`
3. Copy/paste individual agent dispatch commands one at a time
4. Review output after each agent before proceeding

### Option C: Single Module
If you only need one piece (e.g., just the database schema):
1. Same setup
2. Copy just that one task block from `AGENT_DISPATCH.md`
3. Paste into Claude Code

## Your Installed Agents

These are the custom agents in `~/.claude/agents/` that the orchestrator will use:

| Agent | Used For |
|-------|----------|
| `backend-architect` | All backend APIs, services, business logic |
| `database-admin` | Schema, migrations, seed data |
| `database-optimization` | Query performance, indexing |
| `database-optimizer` | Schema refinement |
| `ios-developer` | iOS-specific features, emergency flow |
| `mobile-developer` | React Native screens, navigation |
| `frontend-developer` | Web admin dashboard |
| `ui-ux-designer` | Design review, UX audits |
| `performance-engineer` | Load testing, optimization |
| `cloud-architect` | AWS infrastructure, Docker |
| `command-expert` | Build scripts, CLI tools |

## Your Installed Skills

| Skill | Used For |
|-------|----------|
| `frontend-design-pro` | Premium UI aesthetics for customer-facing screens |
| `skill-creator` | Creating new skills if needed |
| `mcp-builder` | Building MCP integrations if needed |

## Tips

- **Context management**: Each spawned agent gets its own context window. The orchestrator stays lean.
- **Background tasks**: For Phase 3 integrations, tell Claude Code to run them in parallel with `run_in_background: true`.
- **If an agent fails**: Re-run just that task block. Each task is self-contained.
- **Customization**: Edit the task descriptions in MASTER_PROMPT.md before pasting to adjust scope.
- **Progress**: Claude Code will report after each phase. Review before continuing.

## Build Order Reference

```
Week 1-2: Foundation
  └─ DB Schema → Seed Data → Taxonomy API → Legal Consents

Week 2-3: Core Backend  
  └─ Verification → Jobs → Matching → Scoring → Pricing → Escalation

Week 3-4: Integrations (parallel)
  └─ Maps | Payments | Notifications | WebSockets

Week 4-6: Mobile Frontend
  └─ Auth → Home → Task Selection → Emergency (11 screens) → Provider → Profiles

Week 6-7: Testing & Infra
  └─ Unit Tests → E2E Tests → AWS Setup
```
