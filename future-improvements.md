# Consent Chess — Future Improvements

## Gameplay

- **Personality variety** — expand the trait pool and make personality affect tone more distinctly (a nihilistic pawn should feel nothing like a heroic one)
- **Trust mechanics** — pieces explicitly track broken promises; if you said "it's safe" and they died, surviving pieces reference it
- **Piece reactions to captures** — when an ally is captured, other pieces nearby should show awareness in their next response (already partially handled via event log, but could be more pointed)
- **Check pressure** — king should become increasingly panicked/erratic as it approaches checkmate; other pieces should react to the king being in check
- **Morale events** — major captures (queen, rooks) trigger a morale note visible in chat before the next turn

## UX / Interface

- **Piece status panel** — small sidebar listing all living pieces and their current consent state at a glance
- **Timer warning** — visual/audio pulse when under 20 seconds
- **Undo last message** — let the player delete the last exchange if they sent something accidentally
- **Piece portraits** — simple icon or color badge per piece to make the chat panel feel more alive
- **Mobile layout** — current layout assumes wide screen

## Technical

- **Migrate to Vite** — drop Babel Standalone for a real build step; enables proper modules, hot reload, and easier debugging
- **Streaming responses** — stream the LLM reply token by token instead of waiting for the full response (reduces perceived latency)
- **Local storage persistence** — survive a page refresh mid-game
- **Conversation summary pruning** — trim old conversation history for long games to stay within model context limits
- **Two-player mode** — both sides negotiate with their own pieces

## Content / Polish

- **Endgame dialogue** — special responses when a piece is the last defender, or when the position is clearly lost
- **Opening book reactions** — pieces reference classic opening lines if they recognise the position
- **Narrative export polish** — post-process the transcript into cleaner prose for sharing
