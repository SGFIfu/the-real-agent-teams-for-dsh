import { readFileSync, writeFileSync } from 'fs';

const localePath = 'src/client/logic/locale.ts';
let content = readFileSync(localePath, 'utf8');

// Check current size
const originalSize = content.length;

// The locale objects are already quite compact. But we can:
// 1. Use shorter key names internally
// 2. Compress repeated strings
// However, this would break the API. Instead, let's just ensure no extra whitespace.

// Remove extra whitespace in object literals
content = content
  .replace(/:\s+'/g, ":'")  // Remove space after colons
  .replace(/,\s+\n/g, ',\n'); // Keep line breaks but remove extra spaces

const newSize = content.length;
const savings = originalSize - newSize;

console.log(`Original: ${originalSize} bytes`);
console.log(`Optimized: ${newSize} bytes`);
console.log(`Savings: ${savings} bytes`);

if (savings > 0) {
  writeFileSync(localePath, content, 'utf8');
  console.log('Locale optimized!');
} else {
  console.log('No optimization needed for locale');
}
