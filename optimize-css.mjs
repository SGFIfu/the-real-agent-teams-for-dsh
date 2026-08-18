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
const originalSize = originalCSS.length;

// Minify CSS:
// 1. Remove comments
// 2. Remove unnecessary whitespace
// 3. Compress color values
// 4. Remove trailing semicolons in rules
let minified = originalCSS
  // Remove CSS comments
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove newlines and extra spaces
  .replace(/\s*\n\s*/g, '')
  .replace(/\s{2,}/g, ' ')
  // Remove spaces around CSS syntax characters
  .replace(/\s*([{}:;,>~+])\s*/g, '$1')
  // Remove trailing semicolons before }
  .replace(/;}/g, '}')
  // Compress zero values
  .replace(/:\s*0px/g, ':0')
  .replace(/:\s*0em/g, ':0')
  .replace(/:\s*0%/g, ':0')
  // Trim
  .trim();

const minifiedSize = minified.length;
const savings = originalSize - minifiedSize;
const savingsPercent = (savings / originalSize * 100).toFixed(1);

console.log(`Original CSS: ${originalSize} bytes`);
console.log(`Minified CSS: ${minifiedSize} bytes`);
console.log(`Savings: ${savings} bytes (${savingsPercent}%)`);

// Replace in source
content = content.replace(cssMatch[0], `${cssMatch[1]}${minified}${cssMatch[3]}`);
writeFileSync(srcPath, content, 'utf8');

console.log('CSS minified in src/client.ts');
