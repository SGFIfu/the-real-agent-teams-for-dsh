import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientPath = join(packageRoot, 'lib', 'client.js');
const logicPath = join(packageRoot, 'lib', 'client', 'logic', 'control.js');
const sessionLogicPath = join(packageRoot, 'lib', 'client', 'logic', 'session.js');
const localeLogicPath = join(packageRoot, 'lib', 'client', 'logic', 'locale.js');

/**
 * Turn a tsc-emitted ESM module into the body of the Harness client factory.
 * The official loader executes classic scripts only to register a factory;
 * module code runs later when the loader materializes that factory.
 */
function stripModuleSyntax(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*import\s/.test(line))
    .filter((line) => !/^\s*export\s*\{/.test(line))
    .map((line) => line.replace(/^\s*export\s+(?=(async\s+function|function|class|const|let|var))/, ''))
    .filter((line) => line.trim() !== 'export default { apply };')
    .join('\n');
}

const logic = stripModuleSyntax(readFileSync(logicPath, 'utf8'));
const sessionLogic = stripModuleSyntax(readFileSync(sessionLogicPath, 'utf8'));
const localeLogic = stripModuleSyntax(readFileSync(localeLogicPath, 'utf8'));
const client = stripModuleSyntax(readFileSync(clientPath, 'utf8'));

const bundle = [
  'window.__ModuleLoader__.load({',
  '  id: "dsh-agent-teams",',
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  // Harness client modules resolve shared browser dependencies through the
  // loader factory. Keep the source's existing React namespace references
  // inside this factory scope instead of relying on a browser global.
  '    var React = require("react");',
  logic,
  sessionLogic,
  localeLogic,
  client,
  '    exports.apply = apply;',
  '    exports.inject = inject;',
  '    return module.exports;',
  '  }',
  '});',
  '',
].join('\n');

const originalSize = bundle.length;
console.log(`Bundle built: ${originalSize} bytes (${(originalSize / 1024).toFixed(2)} KB)`);

// Minify the bundle
console.log('Minifying...');
const result = await minify(bundle, {
  compress: {
    dead_code: true,
    drop_console: false,
    drop_debugger: true,
    passes: 2,
  },
  mangle: {
    toplevel: false,
    reserved: ['React', 'require', 'module', 'exports', 'apply', 'inject'],
  },
  format: {
    comments: false,
  },
});

if (!result.code) {
  console.error('Minification failed');
  process.exit(1);
}

const minifiedSize = result.code.length;
const savings = originalSize - minifiedSize;
const savingsPercent = (savings / originalSize * 100).toFixed(1);

writeFileSync(clientPath, result.code, 'utf8');
console.log(`Minified: ${minifiedSize} bytes (${(minifiedSize / 1024).toFixed(2)} KB)`);
console.log(`Savings: ${savings} bytes (${(savings / 1024).toFixed(2)} KB, ${savingsPercent}%)`);
console.log(`built ${clientPath}`);
