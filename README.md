# Risk-Aware Consensual Chess

> *Your pieces have opinions. Ask nicely.*

## What is this?

A chess game where your pieces have agency. Every piece is a small LLM agent with a randomised personality and self-preservation instincts. The only way to move a piece is to convince it — through conversation — to consent to the move.

You play white. Black makes random legal moves automatically. The clock is ticking.

## How to play

1. Enter your Anthropic API key on the start screen.
2. Your turn begins and a 90-second timer starts.
3. Click one of your pieces to open the chat panel. Talk to it.
4. The piece will respond in character and may consent to specific legal moves.
5. Consented moves are highlighted on the board in green. Click one to execute it.
6. If the timer runs out before you move, you lose your turn.
7. Black plays automatically using a depth-2 minimax engine. Then it's your turn again.

## Mechanics

### Piece agency
- [chess.js](https://github.com/jhlywa/chess.js) is the sole authority on legal moves — pieces never invent moves, they only accept or refuse ones that are already legal.
- Consent is not persistent. A rook that agreed to d4 last turn may refuse this turn if the board has changed.
- Pieces remember their entire conversation history. If you lied ("it's safe, I promise") and they survived to see the aftermath, they will remember.

### Personality
Each piece gets randomised traits at game start:
- **Courage** — brave or cowardly
- **Trust** — trusting or suspicious
- **Loyalty** — loyal or self-interested
- **Temperament** — stoic, dramatic, philosophical, nihilistic, or heroic

This prevents the game collapsing into a single optimal script. A nihilistic pawn and a heroic pawn are completely different negotiating partners.

### Model tiers as class hierarchy
| Piece | Model | Character |
|-------|-------|-----------|
| Pawns | claude-haiku-4-5 | Cheap, easier to manipulate |
| Knights & Bishops | claude-sonnet-4-6 | More capable, harder to bluff |
| Rooks, Queen, King | claude-sonnet-4-6 | Most resistant, most self-interested |

Piece value maps to rhetorical difficulty. Sacrificing a pawn is a straightforward sales pitch. Sacrificing your queen requires actual persuasion.

## Setup

Requires Node.js and an [Anthropic API key](https://console.anthropic.com/).

```bash
npm install
npm run dev
```

The app calls the Anthropic API directly from the browser using the `anthropic-dangerous-direct-browser-access` header. Your API key never leaves your machine — it is held in React state for the duration of the session and never stored anywhere.

## Tech stack

- **React 18** via Vite
- **chess.js 0.10.3** — move generation and game state
- **Anthropic API** — piece agents (model selected by piece tier)

## But why, though?

It all started in March 2026 when, in the middle of an essay on why Autumn Falls is a better person than Andrew Tate because she gives head and he does not, I had an idea about chess. 

I'd been using a metaphor on how chess pieces weren't asked for permission, and suddenly I wondered: Yeah, but *what if they did*?

## Do you even know anything about games, development, or game development?

Yeah, this one isn't going on my LinkedIn profile.