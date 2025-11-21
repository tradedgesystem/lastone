export class ChessEngine {
  constructor() {
    this.worker = new Worker(chrome.runtime.getURL('stockfish-worker.js'));
    this.listeners = new Set();
  }

  analyze(fen, depths, callback) {
    const worker = this.worker;
    let targetDepthIndex = 0;

    const handleMessage = (e) => {
      const line = e.data;
      if (typeof line !== 'string') return;
      if (line.startsWith('info')) {
        const depthMatch = line.match(/depth (\d+)/);
        const pvMatch = line.match(/ pv (.+)/);
        const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
        const depth = depthMatch ? parseInt(depthMatch[1], 10) : null;
        let evalScore = null;
        if (scoreMatch) {
          const type = scoreMatch[1];
          const raw = parseInt(scoreMatch[2], 10);
          evalScore = type === 'cp' ? raw / 100 : raw > 0 ? `M${raw}` : `-M${Math.abs(raw)}`;
        }
        callback({ type: 'info', depth, eval: evalScore, pv: pvMatch ? pvMatch[1] : null, targetDepth: depths[targetDepthIndex] });
      } else if (line.startsWith('bestmove')) {
        const move = line.split(' ')[1];
        const depth = depths[targetDepthIndex];
        const score = this.lastScore;
        callback({ type: 'bestmove', bestmove: move, eval: score, depth, targetDepth: depth });
        targetDepthIndex += 1;
        if (targetDepthIndex < depths.length) {
          this.runDepth(fen, depths[targetDepthIndex]);
        } else {
          worker.removeEventListener('message', handleMessage);
        }
      }
    };

    worker.addEventListener('message', handleMessage);
    worker.postMessage('uci');
    worker.postMessage('ucinewgame');
    worker.postMessage(`position fen ${fen}`);
    this.runDepth(fen, depths[0]);
  }

  runDepth(fen, depth) {
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${depth}`);
  }
}
