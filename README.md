# Princess Auto plugins for Claude Code

A Claude Code plugin marketplace with one plugin so far.

## princess-auto-theme

Adds a Princess Auto band above the prompt while Claude works:

- **Rolling nut:** a hex nut, styled after the logo, rolls back and forth between two rails under the PRINCESS AUTO wordmark.
- **Store worker:** stands in front of it and reacts to what Claude is doing:
  - **Tool running:** works through his chores (sweeping, mopping, stocking and price-tagging the shelf), carrying gear that matches the tool:

    | Tool | Gear |
    |---|---|
    | Bash, PowerShell | a box |
    | Edit, Write | a price gun |
    | Read, Grep, Glob | a scanner |
    | Web and browser tools | the store phone |

  - **Thinking:** checks his clipboard.
  - **Writing a reply:** waves.
  - **Answer done:** gives a thumbs up.
- **Usage gauges:** context, 5-hour and 7-day usage, shown in the band while Claude works and as a slim row when idle.

The full graphics are drawn for the **Claude desktop app (Code tab)**. The terminal gets a simpler text version.

### Install

Requires a recent Claude Code release; it was built on 2.1.286.

```bash
claude plugin marketplace add pap-serry/princess-auto-claude
claude plugin install princess-auto-theme@princess-auto-claude
```

Start a new session to see it.

### Update

```bash
claude plugin marketplace update princess-auto-claude
claude plugin update princess-auto-theme
```

### Remove

```bash
claude plugin uninstall princess-auto-theme
```

## Layout

```
.claude-plugin/marketplace.json     the marketplace manifest
plugins/princess-auto-theme/        the plugin
  .claude-plugin/plugin.json
  hooks/hooks.json, hooks/register.tsx
  types/index.d.ts                  state contract
```

Check changes with `claude plugin validate .` before pushing, and bump `version` in `plugin.json` so installs pick up the update.
