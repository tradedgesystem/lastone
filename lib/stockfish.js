// Lightweight loader that runs the bundled Stockfish WASM from stockfish.wasm.
// This loader mirrors the public Stockfish UCI interface inside a Web Worker.
(function(global){
  function loadModule() {
    const wasmUrl = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime.getURL('stockfish.wasm') : 'stockfish.wasm';
    return fetch(wasmUrl)
      .then(r => r.arrayBuffer())
      .then(buffer => WebAssembly.instantiate(buffer, { env: {} }))
      .then(result => result.instance);
  }

  function Stockfish() {
    const listeners = [];
    const queue = [];
    let ready = false;

    function post(line) {
      if (ready) {
        instance.exports.postMessage(line);
      } else {
        queue.push(line);
      }
    }

    const engine = {
      postMessage: post,
      addMessageListener: (fn) => listeners.push(fn),
    };

    let instance = null;

    loadModule().then(mod => {
      instance = mod;
      ready = true;
      queue.forEach(cmd => instance.exports.postMessage(cmd));
      queue.length = 0;
    }).catch(err => {
      console.error('Failed to load Stockfish WASM', err);
      listeners.forEach(l => l('info string unable to load stockfish.wasm'));
    });

    return engine;
  }

  global.Stockfish = Stockfish;
})(self);
