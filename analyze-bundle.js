const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, 'lib', 'client.js');
const content = fs.readFileSync(clientPath, 'utf8');

// Extract CSS
const cssMatch = content.match(/const CSS = `([\s\S]*?)`;/);
const cssSize = cssMatch ? cssMatch[1].length : 0;

// Extract locale data
const localeMatch = content.match(/const (ZH_CN|EN_US) = \{[\s\S]*?\};/g);
const localeSize = localeMatch ? localeMatch.join('').length : 0;

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
