import(chrome.runtime.getURL('engine.js')).then(({ ChessEngine }) => {
  const state = {
    boardEl: null,
    arrowCanvas: null,
    ctx: null,
    sidebar: null,
    lastFen: '',
    engine: new ChessEngine(),
    analyzeTimer: null,
    boardObserver: null,
    pieceObserver: null,
    bestLine: null,
    lastEval: null,
    blunder: false,
  };

  const depths = [8, 12, 15, 20];

  function createSidebar() {
    if (state.sidebar) return state.sidebar;
    const panel = document.createElement('div');
    panel.id = 'chess-assistant-sidebar';
    panel.innerHTML = `
      <div class="ca-header">Chess Assistant</div>
      <div class="ca-row"><span>Best move:</span><strong id="ca-best-move">--</strong></div>
      <div class="ca-row"><span>Evaluation:</span><strong id="ca-eval">--</strong></div>
      <div class="ca-row"><span>Depth:</span><strong id="ca-depth">--</strong></div>
      <div class="ca-row" id="ca-blunder">No blunder</div>
    `;
    document.body.appendChild(panel);
    state.sidebar = panel;
    return panel;
  }

  function findBoard() {
    const boards = document.querySelectorAll('chess-board, .board-layout-main, [data-board-id]');
    if (boards.length === 0) return null;
    // prefer live chess board with square children
    for (const b of boards) {
      if (b.querySelector('[data-square]')) return b;
    }
    return boards[0];
  }

  function setupArrowCanvas(board) {
    if (state.arrowCanvas && state.arrowCanvas.parentElement === board) return;
    if (state.arrowCanvas) state.arrowCanvas.remove();
    const canvas = document.createElement('canvas');
    canvas.id = 'chess-assistant-arrows';
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.width = board.clientWidth;
    canvas.height = board.clientHeight;
    board.appendChild(canvas);
    state.arrowCanvas = canvas;
    state.ctx = canvas.getContext('2d');
  }

  function clearArrows() {
    if (state.ctx && state.arrowCanvas) {
      state.ctx.clearRect(0, 0, state.arrowCanvas.width, state.arrowCanvas.height);
    }
  }

  function drawArrow(from, to) {
    if (!state.boardEl || !state.arrowCanvas || !state.ctx) return;
    const fromSquare = state.boardEl.querySelector(`[data-square="${from}"]`);
    const toSquare = state.boardEl.querySelector(`[data-square="${to}"]`);
    if (!fromSquare || !toSquare) return;
    const rectFrom = fromSquare.getBoundingClientRect();
    const rectTo = toSquare.getBoundingClientRect();
    const boardRect = state.boardEl.getBoundingClientRect();
    const start = {
      x: rectFrom.left - boardRect.left + rectFrom.width / 2,
      y: rectFrom.top - boardRect.top + rectFrom.height / 2,
    };
    const end = {
      x: rectTo.left - boardRect.left + rectTo.width / 2,
      y: rectTo.top - boardRect.top + rectTo.height / 2,
    };
    const ctx = state.ctx;
    ctx.clearRect(0, 0, state.arrowCanvas.width, state.arrowCanvas.height);
    ctx.strokeStyle = 'rgba(0, 180, 0, 0.8)';
    ctx.fillStyle = 'rgba(0, 180, 0, 0.8)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const headLength = 24;
    const arrowX = end.x - headLength * Math.cos(angle - Math.PI / 6);
    const arrowY = end.y - headLength * Math.sin(angle - Math.PI / 6);
    const arrowX2 = end.x - headLength * Math.cos(angle + Math.PI / 6);
    const arrowY2 = end.y - headLength * Math.sin(angle + Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(arrowX, arrowY);
    ctx.lineTo(arrowX2, arrowY2);
    ctx.closePath();
    ctx.fill();
  }

  function algebraicFromIndex(index) {
    const files = 'abcdefgh';
    const file = files[index % 8];
    const rank = 8 - Math.floor(index / 8);
    return `${file}${rank}`;
  }

  function deriveCastlingRights(board) {
    let rights = '';
    const whiteKing = board.querySelector('[data-square="e1"][data-piece^="wK"], [data-square="e1"][data-piece="wk"], [data-square="e1"] .piece.white.king');
    const blackKing = board.querySelector('[data-square="e8"][data-piece^="bK"], [data-square="e8"][data-piece="bk"], [data-square="e8"] .piece.black.king');
    const rookH1 = board.querySelector('[data-square="h1"][data-piece^="wR"], [data-square="h1"][data-piece="wr"], [data-square="h1"] .piece.white.rook');
    const rookA1 = board.querySelector('[data-square="a1"][data-piece^="wR"], [data-square="a1"][data-piece="wr"], [data-square="a1"] .piece.white.rook');
    const rookH8 = board.querySelector('[data-square="h8"][data-piece^="bR"], [data-square="h8"][data-piece="br"], [data-square="h8"] .piece.black.rook');
    const rookA8 = board.querySelector('[data-square="a8"][data-piece^="bR"], [data-square="a8"][data-piece="br"], [data-square="a8"] .piece.black.rook');
    if (whiteKing && rookH1) rights += 'K';
    if (whiteKing && rookA1) rights += 'Q';
    if (blackKing && rookH8) rights += 'k';
    if (blackKing && rookA8) rights += 'q';
    return rights || '-';
  }

  function detectSideToMove() {
    const plyNodes = Array.from(document.querySelectorAll('[data-ply]'));
    const maxPly = plyNodes.length ? Math.max(...plyNodes.map(n => parseInt(n.getAttribute('data-ply'), 10) || 0)) : 0;
    return maxPly % 2 === 0 ? 'w' : 'b';
  }

  function computeFen(board) {
    const squares = new Array(64).fill('');
    board.querySelectorAll('[data-square]').forEach(sq => {
      const square = sq.getAttribute('data-square');
      const pieceEl = sq.querySelector('[data-piece], .piece');
      if (!pieceEl) return;
      let pieceCode = pieceEl.getAttribute('data-piece');
      if (!pieceCode) {
        const classes = pieceEl.className.split(/\s+/);
        const color = classes.find(c => c.startsWith('w') || c.startsWith('b')) || '';
        const type = classes.find(c => ['king','queen','rook','bishop','knight','pawn','k','q','r','b','n','p'].includes(c)) || '';
        pieceCode = `${color[0] || 'w'}${(type[0] || 'p')}`;
      }
      const color = pieceCode[0] === 'w' || pieceCode[0] === 'W' ? 'w' : 'b';
      const typeMap = {k:'k', q:'q', r:'r', b:'b', n:'n', p:'p'};
      const typeChar = typeMap[pieceCode[pieceCode.length - 1].toLowerCase()] || 'p';
      const file = square[0];
      const rank = parseInt(square[1], 10);
      const idx = (8 - rank) * 8 + ('abcdefgh'.indexOf(file));
      squares[idx] = color === 'w' ? typeChar.toUpperCase() : typeChar;
    });
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      let row = '';
      for (let f = 0; f < 8; f++) {
        const piece = squares[r * 8 + f];
        if (!piece) {
          empty += 1;
        } else {
          if (empty) { row += empty; empty = 0; }
          row += piece;
        }
      }
      if (empty) row += empty;
      rows.push(row || '8');
    }
    const placement = rows.join('/');
    const side = detectSideToMove();
    const castling = deriveCastlingRights(board);
    const enPassant = '-';
    const plyNodes = Array.from(document.querySelectorAll('[data-ply]'));
    const maxPly = plyNodes.length ? Math.max(...plyNodes.map(n => parseInt(n.getAttribute('data-ply'), 10) || 0)) : 0;
    const fullmove = Math.max(1, Math.ceil(maxPly / 2));
    const halfmove = 0;
    return `${placement} ${side} ${castling} ${enPassant} ${halfmove} ${fullmove}`;
  }

  function updateSidebar(data) {
    createSidebar();
    const bestMove = document.getElementById('ca-best-move');
    const evalEl = document.getElementById('ca-eval');
    const depthEl = document.getElementById('ca-depth');
    const blunderEl = document.getElementById('ca-blunder');
    if (bestMove) bestMove.textContent = data.best || '--';
    if (evalEl) evalEl.textContent = data.eval != null ? data.eval : '--';
    if (depthEl) depthEl.textContent = data.depth ? data.depth : '--';
    if (blunderEl) {
      blunderEl.textContent = data.blunder ? 'Blunder detected' : 'No blunder';
      blunderEl.className = data.blunder ? 'ca-blunder' : '';
    }
  }

  function scheduleAnalysis() {
    clearTimeout(state.analyzeTimer);
    state.analyzeTimer = setTimeout(runAnalysis, 600);
  }

  function runAnalysis() {
    if (!state.boardEl) return;
    const fen = computeFen(state.boardEl);
    if (!fen || fen === state.lastFen) return;
    state.lastFen = fen;
    clearArrows();
    updateSidebar({ best: '--', eval: '--', depth: 'Starting', blunder: false });
    let lastEval = null;
    state.engine.analyze(fen, depths, (info) => {
      if (info.type === 'info') {
        updateSidebar({ best: info.pv ? info.pv.split(' ')[0] : '--', eval: info.eval, depth: `${info.depth}/${info.targetDepth}`, blunder: state.blunder });
      } else if (info.type === 'bestmove') {
        const move = info.bestmove;
        if (move && move.length >= 4) {
          const from = move.slice(0,2);
          const to = move.slice(2,4);
          drawArrow(from, to);
          state.bestLine = move;
        }
        const delta = lastEval != null && info.eval != null ? info.eval - lastEval : 0;
        state.blunder = delta < -100;
        lastEval = info.eval;
        updateSidebar({ best: move || '--', eval: info.eval, depth: `${info.depth}/${info.targetDepth}`, blunder: state.blunder });
      }
    });
  }

  function watchBoard(board) {
    if (state.pieceObserver) state.pieceObserver.disconnect();
    state.pieceObserver = new MutationObserver(scheduleAnalysis);
    state.pieceObserver.observe(board, { childList: true, subtree: true, attributes: true });
  }

  function init() {
    createSidebar();
    const observer = new MutationObserver(() => {
      const board = findBoard();
      if (board && board !== state.boardEl) {
        state.boardEl = board;
        setupArrowCanvas(board);
        watchBoard(board);
        scheduleAnalysis();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    state.boardObserver = observer;
  }

  init();
});
