# Documentation Site Design

Date: 2026-03-11

## Goal

Replace the current TypeDoc-only API reference with a full documentation site using VitePress. Add a homepage, getting started guide, concepts page, cookbook, and protocol internals — with TypeDoc API reference integrated as a section.

## Technology

- **VitePress** — static site generator, already shares Vite with the project's test toolchain
- **typedoc-plugin-markdown** — generates TypeDoc output as markdown pages
- **vitepress-plugin-typedoc** — wires TypeDoc markdown into VitePress sidebar

## Site Structure

```
website/
  index.md                    # Homepage (hero layout)
  getting-started.md          # Connect, poll, read, control
  concepts.md                 # Snapshots, generations, modes, power flows
  cookbook.md                  # Force charge/discharge, monitoring patterns
  protocol.md                 # Frame format, registers, heartbeat, push mode
  .vitepress/
    config.ts                 # Nav, sidebar, typedoc plugin config
```

TypeDoc generates API reference into `website/api/` via the plugin. Everything builds as one VitePress site.

## Page Content

### Homepage
- Tagline: "Native Node.js client for GivEnergy inverters"
- Subtitle: local network, no cloud, TypeScript-first
- Install command block
- 3 feature bullets: real-time monitoring, inverter control, auto-discovery
- Action buttons: Getting Started, API Reference

### Getting Started
- Prerequisites (Node 20+, local network, single client on port 8899)
- Install
- Discover inverters
- Connect and read a snapshot
- Listen for updates
- Control the inverter
- Stop/cleanup

### Concepts
- What's a snapshot (stateless polling, discriminated union by generation)
- Inverter generations (gen2/gen3/three-phase — slot counts, pause mode, register differences)
- Operating modes (eco, timed_demand, timed_export)
- Power flows (sign conventions, PowerFlows breakdown)
- Batteries and meters (HV vs LV)
- Library scope (stateless — consumer owns orchestration)

### Cookbook
- Force charge from grid
- Force discharge to grid
- Monitor solar production
- Track daily energy totals
- Gen3 battery pause mode

### Protocol Internals
- Frame format (non-standard MBAP, serial number field, padding bytes)
- Register layout (IR vs HR, base alignment, 60-register chunks)
- Heartbeat and push mode mechanics
- Data adapter quirks (single client, response routing)
- Device type detection (HR(0) + HR(21), serial prefix fallback)
- Scaling conventions (toDeci, toCenti, toInt16, etc.)

## Build Changes

### New dev dependencies
- `vitepress`
- `typedoc-plugin-markdown`
- `vitepress-plugin-typedoc`

### Package.json scripts
- `docs`: `typedoc` → `vitepress build website`
- `docs:dev`: `vitepress dev website` (new — local preview)

### CI workflow (docs.yml)
- Same trigger (push to main)
- Build command changes to VitePress
- Upload artifact from `website/.vitepress/dist`

### Gitignore
- Add `docs/` (no longer committed — generated on CI)
- Add `website/.vitepress/dist`, `website/.vitepress/cache`

## Decisions

- Source markdown lives in `website/`, not `docs/` or `docs-src/`
- Built output is gitignored, generated on CI only
- Homepage is developer-focused minimal (no illustrations or animations)
- Two architecture pages: high-level concepts for users, protocol internals for contributors
