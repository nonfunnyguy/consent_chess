# Consent Chess: Design Brief

## Concept

A chess game where your pieces have agency. Every piece is a tiny LLM agent with a personality and self-preservation instincts. The only way to move a piece is to convince it to consent to the move through conversation. Originated from the question: "What if you had to ask the chess piece whether it consented to being moved?"

## Proof of Concept Scope

Single-player. You play white, negotiating with your pieces. Black makes random legal moves automatically. The goal is to validate whether the core loop — negotiate, select, execute — is fun.

## Core Mechanics

### Turn Flow
1. Your turn begins, a 90-second timer starts.
2. You click on your pieces and talk to them via a chat panel. They respond and either consent to specific legal moves or refuse.
3. Consented moves are visually indicated on the board.
4. You click a consented move to execute it, or the timer expires (null move — you lose your turn).
5. Black instantly makes a random legal move.
6. Repeat until checkmate, stalemate, or resignation.

### Piece Agency
- The chess engine (chess.js) is the sole authority on legal moves. Pieces never generate moves — they only accept or refuse moves you propose.
- Each piece evaluates the current board state, its legal moves, its conversation history, and recent events to make a judgment call about consent.
- Consent is contextual, not persistent. A rook that agreed to move to d4 last turn may refuse this turn if the board has changed unfavorably. There is no stored consent flag — the piece re-evaluates each time based on its conversation history and current situation.

### Personality
- Each piece gets randomized personality traits at game start (brave/cowardly, trusting/suspicious, loyal/self-interested, etc.). This prevents the game from reducing to a single optimal persuasion script.
- Pieces remember their full conversation history across the game. If you lied to a piece ("it's safe, trust me") and it survived, or if an ally was sacrificed after similar promises, the piece will factor that in. Trust is a real resource that emerges from conversation context.

### Model Tiers as Class Hierarchy
- **Pawns → Haiku** — cheap to call, easier to manipulate, limited reasoning about board state.
- **Knights, Bishops → Sonnet** — more capable, can evaluate danger, harder to bullshit.
- **Rooks, Queen, King → Sonnet with more resistant/stubborn system prompts** — hardest to convince, most protective of self-interest.

This maps piece value to rhetorical difficulty: sacrificing a pawn is easy to talk your way into, sacrificing a queen requires serious persuasion.

## Architecture

### Tech Stack
- **Frontend:** React (single-file component)
- **Chess engine:** chess.js (legal move generation, board state, game-over detection)
- **Piece agents:** Anthropic API calls (model selected by piece tier)
- **State:** All in React state — board, conversation histories, personality traits, event log

### Components

**Chessboard** — Renders the board. Clicking a white piece opens the chat panel for that piece. Consented moves are highlighted. Clicking a highlighted square executes the move.

**Chat Panel** — Shows conversation history with the currently selected piece. Text input for the player. Displays the piece's responses and current consent status.

**Turn Timer** — 90-second countdown. Expires → null move.

**Event Log** — Tracks captures, broken promises, sacrificed pieces. Fed into piece system prompts as context so pieces react to what's happened in the game.

### Piece Agent Design

Each API call to a piece agent includes:

**System prompt:**
- Piece type and name (e.g., "You are a white pawn on e2")
- Personality traits (generated at game start)
- Core instruction: you are a chess piece with self-preservation instincts. You can see the board. You decide whether to consent to moves. You may refuse. You should respond in character.
- The piece's legal moves and what occupies the destination squares
- Which enemy pieces threaten which squares (so the piece knows what's dangerous)
- Event log summary (recent captures, allies lost, any broken promises)

**Conversation history:** The full history of messages between the player and this specific piece across the game.

**User message:** Whatever the player typed.

**Expected response:** In-character dialogue, plus a structured indication of which moves (if any) the piece now consents to. Use a simple format the frontend can parse — e.g., a JSON block at the end of the response, or a specific tag.

### What's Explicitly Out of Scope
- Cross-army communication (talking to opponent's pieces)
- Two-player mode
- Global morale system (let it emerge from conversation history)
- Broadcast messages to all pieces
- Any AI opponent (black is random moves only)
- Move suggestion or chess AI for the player

## Design Notes

- Keep the UI simple. Board on the left, chat on the right, timer visible. This is a PoC — function over polish.
- The comedy is the point. Piece dialogue should be entertaining. Personality traits should produce variety — a nihilistic pawn vs. a heroic pawn should feel completely different to negotiate with.
- The player should be able to talk to multiple pieces per turn (switch between them freely) to build up a set of consented moves before choosing.
- A piece that refuses is not locked out — the player can keep arguing within the time limit.
