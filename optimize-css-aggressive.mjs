import { readFileSync, writeFileSync } from 'fs';

const srcPath = 'src/client.ts';
let content = readFileSync(srcPath, 'utf8');

// Extract CSS
const cssMatch = content.match(/(const CSS = `)([^`]*)(`;)/s);
if (!cssMatch) {
  console.error('CSS not found');
  process.exit(1);
}

const originalCSS = cssMatch[2];

// More aggressive minification:
let minified = originalCSS
  // Remove all comments
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove ALL newlines
  .replace(/\n/g, '')
  // Collapse multiple spaces to single space
  .replace(/\s+/g, ' ')
  // Remove space around {}:;,>~+
  .replace(/\s*([{}:;,>~+()])\s*/g, '$1')
  // Remove quotes from font names when possible
  .replace(/"([a-zA-Z0-9-]+)"/g, '$1')
  // Remove trailing semicolons
  .replace(/;}/g, '}')
  // Remove first/last spaces
  .replace(/^\s+|\s+$/g, '')
  // Compress zeros
  .replace(/:0(px|em|%|rem|vh|vw)/g, ':0')
  .replace(/\s0(px|em|%|rem)/g, ' 0')
  // Compress hex colors #aabbcc -> #abc when possible
  .replace(/#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3/gi, '#$1$2$3')
  // Remove space after : in CSS
  .replace(/:\s+/g, ':');

const minifiedSize = minified.length;
const originalSize = originalCSS.length;
const savings = originalSize - minifiedSize;
const savingsPercent = (savings / originalSize * 100).toFixed(1);

console.log(`Original CSS: ${originalSize} bytes`);
console.log(`Minified CSS: ${minifiedSize} bytes`);
console.log(`Savings: ${savings} bytes (${savingsPercent}%)`);

// Replace in source
content = content.replace(cssMatch[0], `${cssMatch[1]}${minified}${cssMatch[3]}`);
writeFileSync(srcPath, 'utf8');

console.log('CSS aggressively minified in src/client.ts');
