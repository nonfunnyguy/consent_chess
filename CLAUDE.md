# CLAUDE.md — Risk-Aware Consensual Chess

## Project overview

A single-player chess game where you negotiate with your own pieces via chat. Each piece is an LLM agent with a randomised personality; it can refuse to move. You play white, black moves randomly, there is a 90-second turn timer.

## File structure

```
consent_chess/
├── index.html              — Vite entry point (minimal)
├── package.json
├── vite.config.js
├── src/
│   ├── main.jsx            — React root render
│   ├── App.jsx             — All components and game logic (~1200 lines)
│   └── index.css           — All styles
├── README.md               — Public-facing readme (keep updated when features change)
├── future-improvements.md  — Backlog of ideas
```

Everything lives in `src/App.jsx`. It is intentionally monolithic for now — components have not been split into separate files.

## Dev commands

Node.js must be on PATH. On this machine it is at `C:\Program Files\nodejs\` and may not be on the shell PATH automatically — prefix commands with `export PATH="/c/Program Files/nodejs:$PATH" &&` if needed.

```bash
npm run dev      # start dev server (hot reload)
npm run build    # production build → dist/
npm run preview  # serve the dist/ build locally
```

## Architecture notes

### Piece data structure
Each piece is an entry in the `pieceIds` state map, keyed by starting square (e.g. `"e2"`). Fields include: `name`, `type`, `color`, `personality`, `conversation` (full message history), `consents` (current legal moves consented to), `currentSquare`, `alive`, `model`.

### API calls
- Direct browser→Anthropic fetch using `anthropic-dangerous-direct-browser-access` header
- Messages sent to API must only contain `role` and `content` — strip any local-only fields (e.g. `ts`) before sending
- Model is selected per piece tier: pawns → Haiku, everything else → Sonnet

### chess.js version
Using **0.10.3** (old API). Key methods: `chess.moves({ square, verbose: true })`, `chess.move()`, `chess.in_check()`, `chess.in_checkmate()`, `chess.game_over()`. Do not upgrade to v1.x — the API changed significantly.

### Consent parsing
Piece responses include a JSON block at the end that the frontend parses to extract consented move squares. See `parseConsents()` in `App.jsx`.

## Maintenance rules

- **Update README.md** whenever a feature is added, removed, or meaningfully changed.
- Check off completed items in the next steps list below.
- Keep this file current as the project grows.

## Next steps

- [x] Migrate to Vite — drop Babel Standalone for a real build step
- [x] Streaming responses — stream LLM reply token by token (reduces perceived latency)
- [ ] Local storage persistence — survive a page refresh mid-game
- [ ] Conversation summary pruning — trim old history for long games to stay within context limits
- [ ] Piece status panel — sidebar listing all living pieces and their consent state
- [ ] Timer warning — visual/audio pulse when under 20 seconds
- [ ] Expand personality trait pool — make temperament affect tone more distinctly
- [ ] Trust mechanics — pieces track broken promises explicitly
- [ ] Check pressure — king becomes increasingly panicked approaching checkmate
- [ ] Morale events — major captures trigger a morale note before the next turn
- [ ] Two-player mode — both sides negotiate with their own pieces
- [ ] Mobile layout — current layout assumes wide screen
