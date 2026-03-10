import { useState, useEffect, useRef, useMemo } from 'react';
import { Chess } from 'chess.js';


// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const MODELS = {
  pawn:  'claude-haiku-4-5-20251001',
  minor: 'claude-sonnet-4-6',
  major: 'claude-sonnet-4-6',
};

const PIECE_TIER = { p:'pawn', n:'minor', b:'minor', r:'major', q:'major', k:'major' };
const PIECE_NAME_FULL = { p:'pawn', n:'knight', b:'bishop', r:'rook', q:'queen', k:'king' };

const UNICODE = {
  w: { p:'♙', n:'♘', b:'♗', r:'♖', q:'♕', k:'♔' },
  b: { p:'♟', n:'♞', b:'♝', r:'♜', q:'♛', k:'♚' },
};

const FLAVOR_NAMES = {
  p: ['Pip','Barley','Ned','Cob','Fen','Soot','Midge','Tam'],
  n: ['Galahad','Percival'],
  b: ['Aldric','Oswin'],
  r: ['Bastion','Rampart'],
  q: ['Isolde'],
  k: ['Aldous'],
};

const PERSONALITY_OPTS = {
  courage:     ['brave','cowardly'],
  trust:       ['trusting','suspicious'],
  loyalty:     ['loyal','self-interested'],
  temperament: ['stoic','dramatic','philosophical','nihilistic','heroic'],
};

const TRAIT_DESC = {
  brave:            'You do not shy away from danger. Risk is opportunity for glory.',
  cowardly:         'You value your survival above all. Threatened squares fill you with dread.',
  trusting:         'You tend to believe the player. You extend good faith.',
  suspicious:       'You have seen allies thrown away. You do not trust the player easily.',
  loyal:            "The king's safety and the army's success matter more than your survival.",
  'self-interested':'Your survival is your priority. You weigh every move for personal risk.',
  stoic:            'You speak plainly. Emotion has no place in your reasoning.',
  dramatic:         'Every move is life and death to you. You feel everything intensely.',
  philosophical:    'You reflect on meaning. You ponder. You sometimes ask questions back.',
  nihilistic:       'You are unsure any of this matters. You may consent simply because nothing does.',
  heroic:           'You crave glory. A dangerous move is a chance to prove yourself legendary.',
};

const TIMER_DURATION = 90;

const STORAGE_KEY = 'consent_chess_v1';

const RANK_LABELS = ['8','7','6','5','4','3','2','1'];
const FILE_LABELS = ['a','b','c','d','e','f','g','h'];

// ─────────────────────────────────────────────
// PURE HELPERS
// ─────────────────────────────────────────────

function rand(n) { return Math.floor(Math.random() * n); }

function generatePersonality() {
  return Object.fromEntries(
    Object.entries(PERSONALITY_OPTS).map(([k, opts]) => [k, opts[rand(opts.length)]])
  );
}

function squareToIndices(sq) {
  // returns [row, col] where row 0 = rank 8 (top), col 0 = file a
  const file = sq.charCodeAt(0) - 97; // a=0
  const rank = 8 - parseInt(sq[1]);    // rank8=row0
  return [rank, file];
}

function indicesToSquare(row, col) {
  return String.fromCharCode(97 + col) + String(8 - row);
}

function initializePieces(chess) {
  const board = chess.board(); // 8x8, [0][0] = a8
  const pieces = {};
  const nameCounters = {};

  // Collect white pieces in file order for consistent name assignment
  const whitePieces = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cell = board[row][col];
      if (cell && cell.color === 'w') {
        whitePieces.push({ ...cell, square: indicesToSquare(row, col) });
      }
    }
  }

  // Sort pawns left-to-right for named assignment
  whitePieces.sort((a, b) => {
    if (a.type === b.type) return a.square.charCodeAt(0) - b.square.charCodeAt(0);
    return 0;
  });

  whitePieces.forEach(({ type, square }) => {
    const tier = PIECE_TIER[type];
    const nameList = FLAVOR_NAMES[type];
    const idx = nameCounters[type] || 0;
    nameCounters[type] = idx + 1;
    const name = nameList[idx % nameList.length];

    pieces[square] = {
      id: square,
      name,
      type,
      tier,
      model: MODELS[tier],
      personality: generatePersonality(),
      currentSquare: square,
      alive: true,
      conversation: [],
      consentedMoves: [],
    };
  });

  return pieces;
}

// Build reverse index: currentSquare → pieceId (startSquare)
function buildReverseIndex(pieceIds) {
  const idx = {};
  for (const [id, p] of Object.entries(pieceIds)) {
    if (p.alive) idx[p.currentSquare] = id;
  }
  return idx;
}

// ─────────────────────────────────────────────
// TRANSCRIPT EXPORT
// ─────────────────────────────────────────────

function generateTranscript(pieceIds, eventLog, gameResult, fen) {
  const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  let md = `# Risk-Aware Consensual Chess — Game Transcript\nDate: ${date}\n`;

  if (gameResult) {
    const { winner, reason } = gameResult;
    const winStr = winner === 'draw' ? 'Draw' : winner === 'white' ? 'White wins' : 'Black wins';
    const reasonMap = {
      checkmate: 'by checkmate', stalemate: 'by stalemate', resignation: 'by resignation',
      insufficient_material: 'insufficient material', threefold_repetition: 'threefold repetition',
      '50_move_rule': '50-move rule',
    };
    md += `Result: ${winStr}${reasonMap[reason] ? ' — ' + reasonMap[reason] : ''}\n`;
  } else {
    md += `Result: Game in progress\n`;
  }
  if (fen) md += `Final FEN: \`${fen}\`\n`;

  md += `\n---\n\n## Battle Log\n\n`;
  if (eventLog.length === 0) {
    md += `*(no events)*\n`;
  } else {
    eventLog.forEach((ev, i) => { md += `${i + 1}. ${ev.detail}\n`; });
  }

  // ── Chronological section ──
  const typeOrder = { k: 0, q: 1, r: 2, b: 3, n: 4, p: 5 };
  const pieces = Object.values(pieceIds).sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9));

  const chronoEntries = [];
  for (const ev of eventLog) {
    if (ev.ts) chronoEntries.push({ ts: ev.ts, kind: 'event', ev });
  }
  for (const p of pieces) {
    for (const msg of p.conversation) {
      if (msg.ts) chronoEntries.push({ ts: msg.ts, kind: 'message', piece: p, msg });
    }
  }

  if (chronoEntries.length > 0) {
    chronoEntries.sort((a, b) => a.ts - b.ts);
    md += `\n---\n\n## Chronological Transcript\n\n`;
    for (const entry of chronoEntries) {
      if (entry.kind === 'event') {
        md += `**[Game]** ${entry.ev.detail}\n\n`;
      } else {
        const { piece, msg } = entry;
        let content = msg.content;
        if (msg.role === 'assistant') {
          content = content.replace(/\s*\{"consents"\s*:\s*\[[\s\S]*?\]\s*\}\s*$/, '').trimEnd();
        }
        const speaker = msg.role === 'user' ? `You → ${piece.name}` : piece.name;
        md += `**[${speaker}]** ${content}\n\n`;
      }
    }
  }

  md += `\n---\n\n## Piece Conversations\n\n`;

  for (const p of pieces) {
    const traits = Object.values(p.personality).join(', ');
    const status = p.alive ? `alive at ${p.currentSquare}` : `captured (started at ${p.id})`;
    md += `### ${p.name} (${PIECE_NAME_FULL[p.type]}, started ${p.id})\n`;
    md += `*Traits: ${traits} | ${status}*\n\n`;
    if (p.conversation.length === 0) { md += `*(no conversation)*\n\n`; continue; }
    for (const msg of p.conversation) {
      let content = msg.content;
      if (msg.role === 'assistant') {
        // Strip the consent JSON block appended at the end of piece responses
        content = content.replace(/\s*\{"consents"\s*:\s*\[[\s\S]*?\]\s*\}\s*$/, '').trimEnd();
      }
      md += `**${msg.role === 'user' ? 'You' : p.name}:** ${content}\n\n`;
    }
  }
  return md;
}

function downloadTranscript(pieceIds, eventLog, gameResult, fen) {
  const md = generateTranscript(pieceIds, eventLog, gameResult, fen);
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `consent-chess-${new Date().toLocaleDateString('en-CA')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function assessThreats(chess, targetSquare) {
  // chess.js 0.x only returns moves for the active player.
  // During white's turn we temporarily swap to black's turn to query black's moves.
  const originalFen = chess.fen();
  const needsSwap = chess.turn() === 'w';

  if (needsSwap) {
    const parts = originalFen.split(' ');
    parts[1] = 'b';
    parts[3] = '-'; // clear en passant — invalid after color swap
    chess.load(parts.join(' '));
  }

  const board = chess.board();
  const [targetRow, targetCol] = squareToIndices(targetSquare);
  const threats = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cell = board[row][col];
      if (!cell || cell.color !== 'b') continue;
      const sq = indicesToSquare(row, col);
      let attacks = false;
      if (cell.type === 'p') {
        // Pawn attacks are diagonal-forward regardless of whether a piece is there.
        // Black pawns move down the board (increasing row index), so they attack row+1.
        attacks = (row + 1 === targetRow) && (Math.abs(col - targetCol) === 1);
      } else {
        try {
          const moves = chess.moves({ square: sq, verbose: true });
          attacks = moves.some(m => m.to === targetSquare);
        } catch(e) {}
      }
      if (attacks) threats.push({ pieceType: cell.type, fromSquare: sq });
    }
  }

  if (needsSwap) {
    chess.load(originalFen);
  }

  return threats;
}

function buildSystemPrompt(pieceData, chess, eventLog) {
  const { name, type, tier, personality, currentSquare } = pieceData;
  const typeFull = PIECE_NAME_FULL[type];

  let legalMoves;
  try {
    legalMoves = chess.moves({ square: currentSquare, verbose: true });
  } catch(e) { legalMoves = []; }

  const inCheck = chess.in_check();

  // Build legal moves description
  let moveLines = '';
  if (legalMoves.length === 0) {
    moveLines = '  (none — you are blocked or pinned and cannot move)';
  } else {
    // Deduplicate by destination (promotions produce 4 entries per dest)
    const seenDest = new Set();
    for (const m of legalMoves) {
      if (seenDest.has(m.to)) continue;
      seenDest.add(m.to);
      const occupant = chess.get(m.to);
      let occupantDesc = 'empty square';
      if (occupant) {
        occupantDesc = `captures enemy ${PIECE_NAME_FULL[occupant.type]}`;
      }
      const threats = assessThreats(chess, m.to);
      // Two-square pawn advance: check for adjacent black pawns that could
      // capture en passant on the very next turn.
      let epWarning = '';
      if (type === 'p' && m.flags && m.flags.includes('b')) {
        const destFile = m.to.charCodeAt(0);
        const destRank = m.to[1];
        const epThreats = [];
        for (const dc of [-1, 1]) {
          const adjFile = String.fromCharCode(destFile + dc);
          if (adjFile < 'a' || adjFile > 'h') continue;
          const adjSq = adjFile + destRank;
          const adjPiece = chess.get(adjSq);
          if (adjPiece && adjPiece.color === 'b' && adjPiece.type === 'p') {
            epThreats.push(adjSq);
          }
        }
        if (epThreats.length > 0) {
          epWarning = ` EN PASSANT RISK: enemy pawn(s) on ${epThreats.join(', ')} could capture you next turn.`;
        }
      }
      const threatDesc = threats.length > 0
        ? `DANGER: threatened by ${threats.map(t => PIECE_NAME_FULL[t.pieceType] + ' on ' + t.fromSquare).join(', ')}`
        : 'no enemy threats on this square';
      moveLines += `  - ${currentSquare}→${m.to}: ${occupantDesc}. (${threatDesc}${epWarning})\n`;
    }
  }

  // Current square threat
  const currentThreats = assessThreats(chess, currentSquare);
  const currentThreatDesc = currentThreats.length > 0
    ? `Your current position on ${currentSquare} is threatened by: ${currentThreats.map(t => PIECE_NAME_FULL[t.pieceType] + ' on ' + t.fromSquare).join(', ')}.`
    : `Your current position on ${currentSquare} is not directly threatened.`;

  // Recent events
  const recentEvents = eventLog.slice(-6);
  const eventLines = recentEvents.length > 0
    ? recentEvents.map(e => `  - ${e.detail}`).join('\n')
    : '  (no significant events yet)';

  // Personality trait descriptions
  const traitLines = Object.values(personality).map(t => `  ${TRAIT_DESC[t]}`).join('\n');

  // Major piece stubbornness addendum
  const majorAddendum = tier === 'major'
    ? `\nYou are among the most powerful pieces on this board. You have survived this long because you are not easily manipulated. The player must give you a genuinely compelling reason to consent. You are not a pawn to be thrown away.\n`
    : '';

  // Legal move UCI list for the JSON instruction
  const legalUCIs = [...new Set(legalMoves.map(m => m.from + m.to))].join('", "');

  return `You are ${name}, a white ${typeFull} on ${currentSquare} in a game of chess.

IDENTITY:
  Piece: ${typeFull}
  Name: ${name}
  Current position: ${currentSquare}
  Personality: ${personality.courage}, ${personality.trust}, ${personality.loyalty}, ${personality.temperament}
${majorAddendum}
PERSONALITY GUIDANCE:
${traitLines}

YOUR SITUATION:
You are a chess piece with self-preservation instincts. The player controls you, but you have the right to refuse. You can see the board. You know which moves are legal, what occupies those squares, and which enemy pieces threaten them.${inCheck ? '\n\nALERT: Your king is in check. Only moves that resolve the check are available to you.' : ''}

YOUR LEGAL MOVES:
${moveLines}
THREAT ASSESSMENT:
  ${currentThreatDesc}

RECENT EVENTS IN THIS GAME:
${eventLines}

RESPONSE FORMAT:
Respond in character as ${name}. Be expressive, brief (2-4 sentences), and true to your personality. Never break character. You are ${name}, not an AI assistant.

At the very end of your response — after all dialogue — include a JSON block listing the moves you currently consent to. If you consent to no moves, use an empty array. Only list moves from your LEGAL MOVES above (use UCI format like "${legalUCIs || currentSquare + 'e4'}").

\`\`\`json
{"consents": []}
\`\`\``;
}

function parseConsents(responseText, chess, currentSquare) {
  // Find the last ```json ... ``` block
  const matches = [...responseText.matchAll(/```json\s*(\{[\s\S]*?\})\s*```/g)];
  if (matches.length === 0) return [];
  const lastMatch = matches[matches.length - 1];
  let parsed;
  try { parsed = JSON.parse(lastMatch[1]); } catch(e) { return []; }
  if (!parsed || !Array.isArray(parsed.consents)) return [];

  let legalMoves;
  try { legalMoves = chess.moves({ square: currentSquare, verbose: true }); }
  catch(e) { return []; }

  // Build set of legal UCI strings
  const legalUCISet = new Set(legalMoves.map(m => m.from + m.to));
  // Also allow promotion-prefix matching: "e7e8" matches "e7e8q" etc.
  const legalDestPrefixes = new Set(legalMoves.map(m => m.from + m.to.slice(0,2)));

  const validated = [];
  for (const c of parsed.consents) {
    if (typeof c !== 'string') continue;
    const normalized = c.toLowerCase().replace(/\s/g, '');
    // Strip promotion suffix if present — we'll handle promotion via picker
    const base = normalized.slice(0, 4);
    if (legalUCISet.has(normalized)) {
      if (!validated.includes(base)) validated.push(base);
    } else if (base.length === 4 && legalDestPrefixes.has(base)) {
      // Promotion: store base UCI (e.g. "e7e8"), picker handles piece choice
      if (!validated.includes(base)) validated.push(base);
    }
  }
  return validated;
}

const MAX_CONV_MESSAGES = 20; // max history entries sent to API (not counting new message)

async function callPieceAgent(apiKey, pieceData, userMessage, chess, eventLog, onChunk) {
  const systemPrompt = buildSystemPrompt(pieceData, chess, eventLog);

  // Prune old conversation history to keep API calls from growing without bound.
  // Always keep an even number so role alternation stays valid.
  const rawConv = pieceData.conversation;
  let trimmedConv = rawConv;
  let pruneNote = '';
  if (rawConv.length > MAX_CONV_MESSAGES) {
    const keep = MAX_CONV_MESSAGES % 2 === 0 ? MAX_CONV_MESSAGES : MAX_CONV_MESSAGES - 1;
    trimmedConv = rawConv.slice(-keep);
    pruneNote = `[Earlier conversation omitted for brevity — ${rawConv.length - keep} messages not shown.]\n\n`;
  }

  const messages = [
    ...(pruneNote ? [{ role: 'user', content: pruneNote }, { role: 'assistant', content: 'Understood.' }] : []),
    ...trimmedConv.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: userMessage },
  ];

  let responseText = '';
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: pieceData.model,
        max_tokens: 512,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (resp.status === 401) {
      return { text: '[Invalid API key — check your key and try again.]', consents: [] };
    }
    if (resp.status === 429) {
      return { text: '[Rate limited — wait a moment before speaking again.]', consents: [] };
    }
    if (!resp.ok) {
      let errDetail = '';
      try {
        const errData = await resp.json();
        if (errData?.error?.message) errDetail = ' — ' + errData.error.message;
      } catch(e) {}
      return { text: `[API error ${resp.status}${errDetail}]`, consents: [] };
    }

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') break;
        try {
          const event = JSON.parse(payload);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            responseText += event.delta.text;
            onChunk?.(responseText);
          }
        } catch (_) {}
      }
    }
    if (!responseText) responseText = '[No response received.]';
  } catch(e) {
    return { text: '[Connection error — check your network.]', consents: [] };
  }

  const consents = parseConsents(responseText, chess, pieceData.currentSquare);
  return { text: responseText, consents };
}

function stripJsonBlock(text) {
  return text.replace(/```json[\s\S]*?```/g, '').trim();
}

// ─────────────────────────────────────────────
// REACT COMPONENTS
// ─────────────────────────────────────────────

// ── ApiKeySetup ──
function ApiKeySetup({ onStart, savedState, onContinue }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) { setErr('Please enter your Anthropic API key.'); return; }
    if (!trimmed.startsWith('sk-')) { setErr('Key should start with "sk-". Double-check and try again.'); return; }
    onStart(trimmed);
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <h1>♟ Risk-Aware Consensual Chess</h1>
        <p className="subtitle">Your pieces have opinions. Ask nicely.</p>
        {savedState && (
          <div className="saved-game-section">
            <button className="btn-primary" onClick={onContinue}>Continue Saved Game</button>
            <div className="saved-game-hint">or start a new game below</div>
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <label htmlFor="apikey">Anthropic API Key</label>
          <input
            id="apikey"
            type="password"
            placeholder="sk-ant-..."
            value={key}
            onChange={e => { setKey(e.target.value); setErr(''); }}
            autoFocus={!savedState}
          />
          <div className="error">{err}</div>
          <input
            type="file"
            accept=".txt"
            id="key-file-input"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = ev => { setKey((ev.target.result || '').trim()); setErr(''); };
              reader.readAsText(file);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn-load-file" onClick={() => document.getElementById('key-file-input').click()}>
            Load from file…
          </button>
          <button type="submit" className="btn-primary">Start New Game</button>
        </form>
      </div>
    </div>
  );
}

// ── TurnTimer ──
function TurnTimer({ timeLeft, turnPhase, isThinking }) {
  if (turnPhase === 'gameover') {
    return <div className="turn-timer other">Game Over</div>;
  }
  if (turnPhase === 'black') {
    return <div className="turn-timer other">Black is moving…</div>;
  }
  if (isThinking) {
    return (
      <div className="turn-timer paused">
        ⏸ Piece is thinking…
        <div className="timer-sub">{timeLeft}s remaining (paused)</div>
      </div>
    );
  }
  const cls = timeLeft > 30 ? 'normal' : timeLeft > 15 ? 'warning' : 'urgent';
  return (
    <div className={`turn-timer ${cls}`}>
      {String(Math.floor(timeLeft / 60)).padStart(2,'0')}:{String(timeLeft % 60).padStart(2,'0')}
      <div className="timer-sub">Your turn — negotiate and move</div>
    </div>
  );
}

// ── PieceStatusPanel ──
const PIECE_TYPE_ORDER = { k:0, q:1, r:2, b:3, n:4, p:5 };

function PieceStatusPanel({ pieceIds, selectedSquare, onSelectPiece }) {
  const pieces = Object.values(pieceIds).sort((a, b) =>
    (PIECE_TYPE_ORDER[a.type] ?? 9) - (PIECE_TYPE_ORDER[b.type] ?? 9)
  );

  return (
    <div className="piece-status-panel">
      <div className="piece-status-header">Your Pieces</div>
      <div className="piece-status-list">
        {pieces.map(p => {
          const isSelected = p.alive && p.currentSquare === selectedSquare;
          const hasConsent = p.alive && p.consentedMoves.length > 0;
          return (
            <div
              key={p.id}
              className={`piece-status-item${!p.alive ? ' dead' : ''}${isSelected ? ' selected' : ''}`}
              onClick={() => p.alive && onSelectPiece(p.currentSquare)}
              title={p.alive ? `${p.name} on ${p.currentSquare}` : `${p.name} — captured`}
            >
              <span className="ps-glyph">{UNICODE.w[p.type]}</span>
              <span className="ps-name">{p.name}</span>
              {p.alive && <span className="ps-square">{p.currentSquare}</span>}
              {hasConsent && <span className="ps-dot" title={`Consents: ${p.consentedMoves.join(', ')}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ChatPanel ──
function ChatPanel({ selectedPiece, isThinking, turnPhase, onSendMessage }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedPiece?.conversation?.length, isThinking]);

  if (!selectedPiece) {
    return (
      <div className="chat-panel">
        <div className="no-piece-msg">Click a white piece to talk to it.<br/><br/>Build consent before the timer runs out.</div>
      </div>
    );
  }

  const { name, type, personality, conversation, consentedMoves } = selectedPiece;
  const typeFull = PIECE_NAME_FULL[type];
  const personalityStr = `${personality.courage}, ${personality.trust}, ${personality.loyalty}, ${personality.temperament}`;

  const canSend = turnPhase === 'white' && !isThinking && input.trim().length > 0;

  function handleSend(e) {
    e.preventDefault();
    if (!canSend) return;
    onSendMessage(input.trim());
    setInput('');
  }

  const consentDisplay = consentedMoves.length > 0
    ? `Consents to: ${consentedMoves.map(m => m.slice(0,2)+'→'+m.slice(2,4)).join(', ')}`
    : 'No moves consented yet';

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="piece-name">{name} the {typeFull}</div>
        <div className="piece-meta">{personalityStr}</div>
        <div className={`consent-status${consentedMoves.length === 0 ? ' none' : ''}`}>
          {consentDisplay}
        </div>
      </div>

      <div className="chat-messages">
        {conversation.length === 0 && (
          <div className="msg system-note">
            {name} is waiting. Say something to begin negotiations.
          </div>
        )}
        {conversation.map((msg, i) => {
          const display = msg.role === 'assistant' ? stripJsonBlock(msg.content) : msg.content;
          return (
            <div key={i} className={`msg ${msg.role}`}>
              {display}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSend}>
        <input
          type="text"
          placeholder={turnPhase !== 'white' ? 'Wait for your turn…' : `Talk to ${name}…`}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={turnPhase !== 'white' || isThinking}
        />
        <button type="submit" disabled={!canSend}>
          {isThinking ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

// ── EventLog ──
function EventLog({ eventLog, onExport }) {
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [eventLog.length]);

  return (
    <div className="event-log">
      <div className="event-log-header">
        <span>Battle Log</span>
        <button className="btn-export" onClick={onExport} title="Download transcript">Export</button>
      </div>
      <div className="event-log-entries">
        {eventLog.length === 0 && (
          <div className="event-entry" style={{color:'#333',fontStyle:'italic'}}>No events yet.</div>
        )}
        {eventLog.map((ev, i) => (
          <div key={i} className={`event-entry ${ev.kind}`}>{ev.detail}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── ChessBoard ──
function ChessBoard({ chess, fen, selectedSquare, pieceIds, turnPhase, onSquareClick }) {
  const board = chess.board();

  const reverseIndex = useMemo(() => buildReverseIndex(pieceIds), [pieceIds, fen]);

  // All consented destinations: map from destSquare → from UCI prefix
  const consentedDestMap = useMemo(() => {
    const map = {};
    for (const p of Object.values(pieceIds)) {
      if (!p.alive) continue;
      for (const uci of p.consentedMoves) {
        const dest = uci.slice(2,4);
        if (!map[dest]) map[dest] = [];
        map[dest].push(uci);
      }
    }
    return map;
  }, [pieceIds]);

  // Pieces with any active consents
  const squaresWithConsents = useMemo(() => {
    const set = new Set();
    for (const p of Object.values(pieceIds)) {
      if (p.alive && p.consentedMoves.length > 0) set.add(p.currentSquare);
    }
    return set;
  }, [pieceIds]);

  const inCheck = chess.in_check();
  let kingInCheckSquare = null;
  if (inCheck && turnPhase === 'white') {
    // Find white king
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = board[r][c];
        if (cell && cell.color === 'w' && cell.type === 'k') {
          kingInCheckSquare = indicesToSquare(r, c);
        }
      }
    }
  }

  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = indicesToSquare(row, col);
      const cell = board[row][col];
      const isLight = (row + col) % 2 === 0;
      const isSelected = sq === selectedSquare;
      const isConsentDest = !!consentedDestMap[sq];
      const hasPiece = !!cell;
      const hasConsentDot = squaresWithConsents.has(sq) && sq !== selectedSquare;
      const isKingCheck = sq === kingInCheckSquare;

      const isWhitePiece = cell && cell.color === 'w';
      const isClickable = isWhitePiece && turnPhase === 'white' || isConsentDest && turnPhase === 'white';

      let cls = `square ${isLight ? 'light' : 'dark'}`;
      if (isKingCheck) cls += ' in-check';
      else if (isSelected) cls += ' selected';
      else if (isConsentDest) { cls += ' consented-dest'; if (hasPiece) cls += ' has-piece'; }
      if (isClickable) cls += ' clickable';

      squares.push(
        <div
          key={sq}
          className={cls}
          onClick={() => onSquareClick(sq, !!isConsentDest, consentedDestMap[sq] || [])}
        >
          {cell && (
            <span className={`piece-glyph ${cell.color === 'w' ? 'piece-white' : 'piece-black'}`}>
              {UNICODE[cell.color][cell.type]}
            </span>
          )}
          {hasConsentDot && <div className="consent-dot" />}
        </div>
      );
    }
  }

  return (
    <div className="board-labels-wrap">
      <div className="board-rank-files">
        <div className="rank-labels">
          {RANK_LABELS.map(r => <div key={r}>{r}</div>)}
        </div>
        <div className="chess-board">{squares}</div>
      </div>
      <div className="file-labels">
        {FILE_LABELS.map(f => <div key={f}>{f}</div>)}
      </div>
    </div>
  );
}

// ── PromotionPicker ──
function PromotionPicker({ onChoose }) {
  const options = [
    { type: 'q', glyph: '♕' },
    { type: 'r', glyph: '♖' },
    { type: 'b', glyph: '♗' },
    { type: 'n', glyph: '♘' },
  ];
  return (
    <div className="promotion-overlay">
      <div className="promotion-card">
        <p>Choose promotion piece</p>
        <div className="promotion-options">
          {options.map(o => (
            <div key={o.type} className="promotion-option" onClick={() => onChoose(o.type)}>
              {o.glyph}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── GameOverOverlay ──
function GameOverOverlay({ gameResult, onRestart, onExport }) {
  const { winner, reason } = gameResult;
  const title = winner === 'draw' ? 'Draw' : winner === 'white' ? 'You Win!' : 'You Lose';
  const reasonMap = {
    checkmate: 'by checkmate',
    stalemate: 'by stalemate',
    resignation: 'by resignation',
    insufficient_material: 'insufficient material',
    threefold_repetition: 'threefold repetition',
    '50_move_rule': '50-move rule',
  };
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2>{title}</h2>
        <p>{reasonMap[reason] || reason}</p>
        <button className="btn-primary" onClick={onRestart}>Play Again</button>
        <br />
        <button className="btn-secondary" style={{marginTop:'12px'}} onClick={onExport}>Export Transcript</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────

function App() {
  const [apiKey, setApiKey]           = useState('');
  const [gameStarted, setGameStarted] = useState(false);
  const [fen, setFen]                 = useState('');
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [pieceIds, setPieceIds]       = useState({});
  const [eventLog, setEventLog]       = useState([]);
  const [turnPhase, setTurnPhase]     = useState('setup');
  const [timeLeft, setTimeLeft]       = useState(TIMER_DURATION);
  const [isThinking, setIsThinking]   = useState(false);
  const [gameResult, setGameResult]   = useState(null);
  const [pendingPromotion, setPendingPromotion] = useState(null);
  const [savedState, setSavedState]   = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.fen && parsed?.apiKey && parsed?.pieceIds) return parsed;
    } catch(e) {}
    return null;
  });

  const chessRef = useRef(null);

  // ── Persist state to localStorage ──
  useEffect(() => {
    if (!gameStarted || turnPhase === 'gameover' || turnPhase === 'black') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ fen, pieceIds, eventLog, turnPhase, timeLeft, apiKey }));
    } catch(e) {}
  }, [fen, pieceIds, eventLog, turnPhase, timeLeft, gameStarted, apiKey]);

  // ── Start / restart game ──
  function startGame(key) {
    localStorage.removeItem(STORAGE_KEY);
    setSavedState(null);
    const chess = new Chess();
    chessRef.current = chess;
    const pieces = initializePieces(chess);
    setApiKey(key);
    setPieceIds(pieces);
    setFen(chess.fen());
    setEventLog([]);
    setSelectedSquare(null);
    setTurnPhase('white');
    setTimeLeft(TIMER_DURATION);
    setIsThinking(false);
    setGameResult(null);
    setPendingPromotion(null);
    setGameStarted(true);
  }

  // ── Resume saved game ──
  function loadGame() {
    const save = savedState;
    if (!save) return;
    const chess = new Chess();
    chess.load(save.fen);
    chessRef.current = chess;
    setApiKey(save.apiKey);
    setPieceIds(save.pieceIds);
    setFen(save.fen);
    setEventLog(save.eventLog || []);
    setSelectedSquare(null);
    setTurnPhase(save.turnPhase || 'white');
    setTimeLeft(save.timeLeft ?? TIMER_DURATION);
    setIsThinking(false);
    setGameResult(null);
    setPendingPromotion(null);
    setSavedState(null);
    setGameStarted(true);
  }

  // ── Timer ──
  useEffect(() => {
    if (turnPhase !== 'white' || isThinking) return;
    if (timeLeft <= 0) {
      handleTimerExpiry();
      return;
    }
    const id = setInterval(() => setTimeLeft(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [turnPhase, timeLeft, isThinking]);

  function handleTimerExpiry() {
    const chess = chessRef.current;
    setEventLog(prev => [...prev, {
      kind: 'turn_expired',
      detail: `Turn expired — you lost your move.`,
      ts: Date.now(),
    }]);
    // Clear all consents
    setPieceIds(prev => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], consentedMoves: [] };
      }
      return next;
    });
    setSelectedSquare(null);
    setTurnPhase('black');
    setTimeout(() => makeBlackMove(), 600);
  }

  // ── Check game-over conditions ──
  function checkGameOver(chess) {
    if (!chess.game_over()) return false;
    let winner, reason;
    if (chess.in_checkmate()) {
      winner = chess.turn() === 'w' ? 'black' : 'white'; // current turn lost
      reason = 'checkmate';
    } else if (chess.in_stalemate()) {
      winner = 'draw'; reason = 'stalemate';
    } else if (chess.in_threefold_repetition()) {
      winner = 'draw'; reason = 'threefold_repetition';
    } else if (chess.insufficient_material()) {
      winner = 'draw'; reason = 'insufficient_material';
    } else if (chess.in_draw()) {
      winner = 'draw'; reason = '50_move_rule';
    } else {
      winner = 'draw'; reason = 'draw';
    }
    setGameResult({ winner, reason });
    setTurnPhase('gameover');
    setEventLog(prev => [...prev, { kind: 'game_over', detail: `Game over: ${winner} wins (${reason}).`, ts: Date.now() }]);
    localStorage.removeItem(STORAGE_KEY);
    return true;
  }

  // ── Make black's random move ──
  function makeBlackMove() {
    const chess = chessRef.current;

    // Null move: if still white's turn (timer expired), swap active color via FEN
    if (chess.turn() === 'w') {
      const parts = chess.fen().split(' ');
      parts[1] = 'b'; // change active color to black
      parts[3] = '-'; // reset en passant (invalid after null move)
      const loaded = chess.load(parts.join(' '));
      if (!loaded) {
        // FEN rejected — skip black's move, reset white's turn
        setTurnPhase('white');
        setTimeLeft(TIMER_DURATION);
        return;
      }
    }

    const moves = chess.moves();
    if (moves.length === 0) { checkGameOver(chess); return; }
    const chosen = moves[rand(moves.length)];
    const result = chess.move(chosen);
    setFen(chess.fen());

    if (result) {
      const detail = result.captured
        ? `Black ${PIECE_NAME_FULL[result.piece]} captures white ${PIECE_NAME_FULL[result.captured]} on ${result.to}.`
        : `Black moves ${PIECE_NAME_FULL[result.piece]} to ${result.to}.`;

      // If black captured a white piece, mark it dead
      if (result.captured) {
        setPieceIds(prev => {
          // En passant: captured pawn is NOT at result.to but adjacent
          const capturedSquare = (result.flags && result.flags.includes('e'))
            ? result.to[0] + result.from[1]
            : result.to;
          let cId = null;
          for (const [id, p] of Object.entries(prev)) {
            if (p.alive && p.currentSquare === capturedSquare) { cId = id; break; }
          }
          if (!cId) return prev;
          return { ...prev, [cId]: { ...prev[cId], alive: false } };
        });
      }

      setEventLog(prev => [...prev, { kind: result.captured ? 'capture' : 'move', detail, ts: Date.now() }]);
    }

    if (checkGameOver(chess)) return;

    // Check if white is now in check
    if (chess.in_check()) {
      setEventLog(prev => [...prev, { kind: 'check', detail: 'Your king is in check!', ts: Date.now() }]);
    }

    // Clear all white consents (board changed)
    setPieceIds(prev => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (next[id].alive) next[id] = { ...next[id], consentedMoves: [] };
      }
      return next;
    });

    setSelectedSquare(null);
    setTurnPhase('white');
    setTimeLeft(TIMER_DURATION);
  }

  // ── Execute a white move ──
  function executeMove(uci, promotionPiece) {
    const chess = chessRef.current;
    const from = uci.slice(0,2);
    const to   = uci.slice(2,4);
    const promo = promotionPiece || (uci.length === 5 ? uci[4] : undefined);

    // Check if this is a promotion move
    const piece = chess.get(from);
    const isPromotion = piece && piece.type === 'p' && (to[1] === '8');
    if (isPromotion && !promo) {
      setPendingPromotion({ from, to, uci });
      return;
    }

    const moveObj = { from, to };
    if (promo) moveObj.promotion = promo;

    const result = chess.move(moveObj);
    if (!result) return; // shouldn't happen

    // Update piece tracking
    setPieceIds(prev => {
      const next = { ...prev };

      // Find moving piece
      let movingId = null;
      for (const [id, p] of Object.entries(next)) {
        if (p.alive && p.currentSquare === from) { movingId = id; break; }
      }

      // Find captured piece (was at `to` before move)
      let capturedId = null;
      for (const [id, p] of Object.entries(next)) {
        if (p.alive && p.currentSquare === to && id !== movingId) { capturedId = id; break; }
      }

      // En passant: captured pawn is NOT at `to`
      if (result.flags && result.flags.includes('e')) {
        const epSquare = to[0] + from[1];
        for (const [id, p] of Object.entries(next)) {
          if (p.alive && p.currentSquare === epSquare) { capturedId = id; break; }
        }
      }

      if (capturedId) next[capturedId] = { ...next[capturedId], alive: false };

      if (movingId) {
        let updatedPiece = { ...next[movingId], currentSquare: to, consentedMoves: [] };
        // Handle promotion
        if (result.flags && result.flags.includes('p')) {
          const newType = promo || 'q';
          updatedPiece = {
            ...updatedPiece,
            type: newType,
            tier: PIECE_TIER[newType],
            model: MODELS[PIECE_TIER[newType]],
          };
        }
        next[movingId] = updatedPiece;
      }

      // Handle castling: update rook position
      if (result.flags) {
        if (result.flags.includes('k')) {
          // Kingside: rook h1 → f1
          for (const [id, p] of Object.entries(next)) {
            if (p.alive && p.currentSquare === 'h1') { next[id] = { ...p, currentSquare: 'f1', consentedMoves: [] }; break; }
          }
        } else if (result.flags.includes('q')) {
          // Queenside: rook a1 → d1
          for (const [id, p] of Object.entries(next)) {
            if (p.alive && p.currentSquare === 'a1') { next[id] = { ...p, currentSquare: 'd1', consentedMoves: [] }; break; }
          }
        }
      }

      // Clear all other pieces' consents too
      for (const id of Object.keys(next)) {
        if (id !== movingId && next[id].alive && next[id].consentedMoves.length > 0) {
          next[id] = { ...next[id], consentedMoves: [] };
        }
      }

      return next;
    });

    setFen(chess.fen());

    // Log the move
    const detail = result.captured
      ? `White ${PIECE_NAME_FULL[result.piece]} captures ${PIECE_NAME_FULL[result.captured]} on ${to}.`
      : result.flags?.includes('p')
        ? `White pawn promotes to ${PIECE_NAME_FULL[promo || 'q']} on ${to}!`
        : result.flags?.includes('k') ? 'White castles kingside.'
        : result.flags?.includes('q') ? 'White castles queenside.'
        : `White ${PIECE_NAME_FULL[result.piece]} moves to ${to}.`;
    setEventLog(prev => [...prev, { kind: result.captured ? 'capture' : 'move', detail, ts: Date.now() }]);

    if (result.flags?.includes('p')) {
      setEventLog(prev => [...prev, { kind: 'promotion', detail: `Pawn promoted to ${PIECE_NAME_FULL[promo || 'q']}!`, ts: Date.now() }]);
    }

    setPendingPromotion(null);
    setSelectedSquare(null);
    setTurnPhase('black');
    setTimeout(() => makeBlackMove(), 700);
  }

  // ── Square click handler ──
  function handleSquareClick(sq, isConsentDest, consentedUCIs) {
    const chess = chessRef.current;
    if (turnPhase !== 'white') return;

    if (isConsentDest) {
      // Execute a consented move
      // Find which piece's consent lands here
      // Prefer the currently selected piece's consent
      let chosenUCI = null;
      if (selectedSquare) {
        const rev = buildReverseIndex(pieceIds);
        const selectedPieceId = rev[selectedSquare];
        if (selectedPieceId) {
          const sp = pieceIds[selectedPieceId];
          const match = sp.consentedMoves.find(m => m.slice(2,4) === sq);
          if (match) chosenUCI = match;
        }
      }
      if (!chosenUCI && consentedUCIs.length > 0) chosenUCI = consentedUCIs[0];
      if (chosenUCI) { executeMove(chosenUCI); return; }
    }

    // Select or deselect a white piece
    const piece = chess.get(sq);
    if (piece && piece.color === 'w') {
      setSelectedSquare(sq === selectedSquare ? null : sq);
    } else {
      setSelectedSquare(null);
    }
  }

  // ── Send chat message ──
  async function handleSendMessage(text) {
    if (!selectedSquare || isThinking || turnPhase !== 'white') return;
    const chess = chessRef.current;

    const rev = buildReverseIndex(pieceIds);
    const pieceId = rev[selectedSquare];
    if (!pieceId) return;

    const piece = pieceIds[pieceId];

    const userMsg        = { role: 'user',      content: text, ts: Date.now() };
    const placeholderMsg = { role: 'assistant', content: '',   ts: Date.now() };

    // Add user message + empty placeholder immediately so streaming text is visible at once
    setPieceIds(prev => ({
      ...prev,
      [pieceId]: {
        ...prev[pieceId],
        conversation: [...prev[pieceId].conversation, userMsg, placeholderMsg],
      },
    }));

    setIsThinking(true);
    try {
      // Pass `piece` (captured before state update) — callPieceAgent appends userMessage internally
      const { text: responseText, consents } = await callPieceAgent(
        apiKey, piece, text, chess, eventLog,
        (accumulated) => {
          setPieceIds(prev => {
            const conv = prev[pieceId].conversation;
            return {
              ...prev,
              [pieceId]: {
                ...prev[pieceId],
                conversation: [...conv.slice(0, -1), { ...conv[conv.length - 1], content: accumulated }],
              },
            };
          });
        }
      );

      // Set final text + consentedMoves once streaming is complete
      setPieceIds(prev => {
        const conv = prev[pieceId].conversation;
        return {
          ...prev,
          [pieceId]: {
            ...prev[pieceId],
            conversation: [...conv.slice(0, -1), { ...conv[conv.length - 1], content: responseText }],
            consentedMoves: consents,
          },
        };
      });
    } finally {
      setIsThinking(false);
    }
  }

  function handleResign() {
    setGameResult({ winner: 'black', reason: 'resignation' });
    setTurnPhase('gameover');
    setEventLog(prev => [...prev, { kind: 'game_over', detail: 'White resigned.', ts: Date.now() }]);
    localStorage.removeItem(STORAGE_KEY);
  }

  // ── Derive selected piece data ──
  const selectedPiece = useMemo(() => {
    if (!selectedSquare) return null;
    const rev = buildReverseIndex(pieceIds);
    const id = rev[selectedSquare];
    return id ? pieceIds[id] : null;
  }, [selectedSquare, pieceIds]);

  if (!gameStarted) {
    return <ApiKeySetup onStart={startGame} savedState={savedState} onContinue={loadGame} />;
  }

  const chess = chessRef.current;

  return (
    <div className="game-view">
      <div className="board-area">
        <ChessBoard
          chess={chess}
          fen={fen}
          selectedSquare={selectedSquare}
          pieceIds={pieceIds}
          turnPhase={turnPhase}
          onSquareClick={handleSquareClick}
        />
        {turnPhase !== 'gameover' && (
          <button className="resign-btn" onClick={handleResign}>Resign</button>
        )}
      </div>

      <div className="side-panel">
        <TurnTimer timeLeft={timeLeft} turnPhase={turnPhase} isThinking={isThinking} />
        <PieceStatusPanel
          pieceIds={pieceIds}
          selectedSquare={selectedSquare}
          onSelectPiece={sq => { if (turnPhase === 'white') setSelectedSquare(sq); }}
        />
        <ChatPanel
          selectedPiece={selectedPiece}
          isThinking={isThinking}
          turnPhase={turnPhase}
          onSendMessage={handleSendMessage}
        />
        <EventLog eventLog={eventLog} onExport={() => downloadTranscript(pieceIds, eventLog, gameResult, fen)} />
      </div>

      {pendingPromotion && (
        <PromotionPicker onChoose={promo => executeMove(pendingPromotion.uci, promo)} />
      )}

      {gameResult && (
        <GameOverOverlay
          gameResult={gameResult}
          onRestart={() => startGame(apiKey)}
          onExport={() => downloadTranscript(pieceIds, eventLog, gameResult, fen)}
        />
      )}
    </div>
  );
}

export default App;
