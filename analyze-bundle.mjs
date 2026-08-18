import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientPath = join(__dirname, 'lib', 'client.js');
const content = readFileSync(clientPath, 'utf8');

// Extract CSS
const cssMatch = content.match(/const CSS = `([\s\S]*?)`;/);
const cssSize = cssMatch ? cssMatch[1].length : 0;

// Extract locale data
const zhMatch = content.match(/const ZH_CN = \{[\s\S]*?\};/);
const enMatch = content.match(/const EN_US = \{[\s\S]*?\};/);
const localeSize = (zhMatch ? zhMatch[0].length : 0) + (enMatch ? enMatch[0].length : 0);

// Total size
const totalSize = content.length;
const codeSize = totalSize - cssSize - localeSize;

console.log('Bundle Analysis:');
console.log('==============');
console.log(`Total size: ${totalSize} bytes (${(totalSize/1024).toFixed(2)} KB)`);
console.log(`CSS: ${cssSize} bytes (${(cssSize/1024).toFixed(2)} KB) - ${(cssSize/totalSize*100).toFixed(1)}%`);
console.log(`Locale data: ${localeSize} bytes (${(localeSize/1024).toFixed(2)} KB) - ${(localeSize/totalSize*100).toFixed(1)}%`);
console.log(`Code: ${codeSize} bytes (${(codeSize/1024).toFixed(2)} KB) - ${(codeSize/totalSize*100).toFixed(1)}%`);

// Count lines
const lines = content.split('\n').length;
console.log(`\nTotal lines: ${lines}`);

// Check for repeated patterns
const functions = content.match(/function \w+/g);
console.log(`\nFunctions: ${functions ? functions.length : 0}`);

const reactCalls = content.match(/React\.\w+/g);
console.log(`React calls: ${reactCalls ? reactCalls.length : 0}`);
