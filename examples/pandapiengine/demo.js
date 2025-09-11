// Demonstration script to load pandaPIengine WebAssembly module and print its help text.
// Node's fetch is disabled so the Emscripten loader falls back to fs.
globalThis.fetch = undefined;
// Stub callMain so the module's startup doesn't fail if it's missing
globalThis.callMain = () => {};

// pandaPIengine is built with MODULARIZE, so require returns a factory
const createModule = require('./pandaPIengine.js');

(async () => {
  const mod = await createModule();
  // Print first few available keys to show module loaded
  console.log('exports', Object.keys(mod).slice(0, 5));
  if (typeof mod.callMain === 'function') {
    // Ask the planner for its CLI help output
    mod.callMain(['-h']);
  } else if (typeof mod._main === 'function') {
    // Fallback: invoke the main function directly with no arguments
    const argv = mod._malloc(4);
    const arg0 = mod._malloc(1); mod.HEAP8[arg0] = 0; mod.HEAP32[argv >> 2] = arg0;
    mod._main(1, argv);
  } else {
    console.error('main not available');
  }
})();
