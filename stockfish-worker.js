self.importScripts('lib/stockfish.js');
const engine = self.Stockfish();

engine.addMessageListener((line) => {
  postMessage(line);
});

self.onmessage = (e) => {
  engine.postMessage(e.data);
};
