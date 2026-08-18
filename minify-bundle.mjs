import { readFileSync, writeFileSync } from 'fs';
import { minify } from 'terser';

const clientPath = 'lib/client.js';
const content = readFileSync(clientPath, 'utf8');
const originalSize = content.length;

console.log(`Original size: ${originalSize} bytes (${(originalSize/1024).toFixed(2)} KB)`);
console.log('Minifying...');

const result = await minify(content, {
  compress: {
    dead_code: true,
    drop_console: false, // Keep console for debugging
    drop_debugger: true,
    pure_funcs: [], // Don't remove any functions
    passes: 2,
  },
  mangle: {
    toplevel: false, // Don't mangle window.__ModuleLoader__
    reserved: ['React', 'require', 'module', 'exports', 'apply', 'inject'], // Preserve API
  },
  format: {
    comments: false,
  },
});

if (result.code) {
  const minifiedSize = result.code.length;
  const savings = originalSize - minifiedSize;
  const savingsPercent = (savings / originalSize * 100).toFixed(1);
  
  console.log(`Minified size: ${minifiedSize} bytes (${(minifiedSize/1024).toFixed(2)} KB)`);
  console.log(`Savings: ${savings} bytes (${(savings/1024).toFixed(2)} KB, ${savingsPercent}%)`);
  
  writeFileSync(clientPath, result.code, 'utf8');
  console.log('\nBundle minified successfully!');
} else {
  console.error('Minification failed');
  process.exit(1);
}
