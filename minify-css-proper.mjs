import { readFileSync, writeFileSync } from 'fs';

const srcPath = 'src/client.ts';
const content = readFileSync(srcPath, 'utf8');

// Find CSS const declaration
const cssStart = content.indexOf('const CSS = `');
const cssEnd = content.indexOf('`;', cssStart);

if (cssStart === -1 || cssEnd === -1) {
  console.error('CSS block not found');
  process.exit(1);
}

// Extract parts
const before = content.substring(0, cssStart);
const cssBlock = content.substring(cssStart + 13, cssEnd); // Skip 'const CSS = `'
const after = content.substring(cssEnd);

const originalSize = cssBlock.length;

// Minify CSS
let minified = cssBlock
  // Remove CSS comments
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove newlines
  .replace(/\n/g, '')
  // Collapse spaces
  .replace(/\s+/g, ' ')
  // Remove spaces around syntax chars
  .replace(/\s*([{}:;,>~+()])\s*/g, '$1')
  // Remove trailing semicolons
  .replace(/;}/g, '}')
  // Remove quotes from single-word font names  
  .replace(/"([a-zA-Z-]+)"/g, '$1')
  // Compress zeros
  .replace(/:0(px|em|%|rem|vh|vw)/g, ':0')
  // Trim
  .trim();

const minifiedSize = minified.length;
const savings = originalSize - minifiedSize;

console.log(`Original CSS: ${originalSize} bytes (${(originalSize/1024).toFixed(2)} KB)`);
console.log(`Minified CSS: ${minifiedSize} bytes (${(minifiedSize/1024).toFixed(2)} KB)`);
console.log(`Savings: ${savings} bytes (${(savings/1024).toFixed(2)} KB, ${(savings/originalSize*100).toFixed(1)}%)`);

// Reconstruct file
const newContent = before + 'const CSS = `' + minified + after;
writeFileSync(srcPath, newContent, 'utf8');

console.log('\nCSS minified successfully!');
