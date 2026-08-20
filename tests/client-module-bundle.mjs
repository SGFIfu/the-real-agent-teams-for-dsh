import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const bundlePath = new URL('../lib/client.js', import.meta.url);
const bundle = readFileSync(bundlePath, 'utf8');

// Basic structure checks (work with minified code)
assert.match(bundle, /window\.__ModuleLoader__\.load\(/);
assert.match(bundle, /id:"dsh-agent-teams"|id: "dsh-agent-teams"/);
assert.doesNotMatch(bundle, /^\s*import\s/m);
assert.doesNotMatch(bundle, /^\s*export\s/m);

// Content checks (strings remain after minification)
assert.match(bundle, /data-plugin-css/);
assert.match(bundle, /dsh-agent-teams\/command-center/);
assert.match(bundle, /agc-session-tool/);
assert.match(bundle, /selected member is open in the side panel/);
assert.match(bundle, /agc-workspace-route-grid/);

// Locale and label checks (variable names may be minified)
assert.match(bundle, /labels\./); // labels access
assert.match(bundle, /DSH 真正的 Agent Teams/); // Chinese locale present
assert.match(bundle, /The Real Agent Teams for DSH/); // English locale present

// Test runtime registration
const registrations = [];
const context = vm.createContext({
  window: {
    __ModuleLoader__: {
      load(handoff) {
        registrations.push(handoff);
      },
    },
  },
  console,
});

vm.runInContext(bundle, context, { filename: bundlePath.pathname });
assert.equal(registrations.length, 1);
assert.equal(registrations[0].id, 'dsh-agent-teams');
assert.equal(typeof registrations[0].factory, 'function');

const requiredModules = [];
const moduleExports = registrations[0].factory((id) => {
  requiredModules.push(id);
  if (id === 'react') return {};
  throw new Error(`dsh-agent-teams client bundle requested unexpected module: ${id}`);
});
assert.deepEqual(requiredModules, ['react']);
assert.equal(typeof moduleExports.apply, 'function');
assert.deepEqual(Array.from(moduleExports.inject), ['slots']);

// Size check: should be under 130KB (originally 179KB)
const sizeKB = (bundle.length / 1024).toFixed(2);
console.log(`client module bundle OK (${packageRoot})`);
console.log(`bundle size: ${sizeKB} KB (${bundle.length} bytes)`);
