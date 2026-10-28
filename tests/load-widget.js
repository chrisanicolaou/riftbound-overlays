// Runs widgets/<name>/js.js in a sandbox and returns its top-level functions, for unit tests.
// Function declarations at the top of a script become properties of the vm context. Their results are
// structured-cloned back into this realm, because objects made inside the sandbox have its own prototypes
// and strict deep-equality would reject them even when the values match.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = function loadWidget(name) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'widgets', name, 'js.js'), 'utf8');
  const listeners = {};
  const sandbox = { window: { addEventListener: (type, fn) => { listeners[type] = fn; } }, console, setTimeout, clearTimeout, setInterval, clearInterval };
  const own = new Set(Object.keys(sandbox));
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: `widgets/${name}/js.js` });
  const api = { listeners };
  for (const key of Object.keys(sandbox)) {
    if (!own.has(key) && typeof sandbox[key] === 'function') api[key] = (...args) => structuredClone(sandbox[key](...args));
  }
  return api;
};
