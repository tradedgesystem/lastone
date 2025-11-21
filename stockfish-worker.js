const libUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
  ? chrome.runtime.getURL('lib/stockfish.js')
  : 'lib/stockfish.js';
self.importScripts(libUrl);
const engine = self.Stockfish();

engine.addMessageListener((line) => {
  postMessage(line);
});

self.onmessage = (e) => {
  engine.postMessage(e.data);
};
