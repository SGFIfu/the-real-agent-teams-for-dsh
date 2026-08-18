import { readFileSync } from 'fs';

const clientPath = 'lib/client.js';
const content = readFileSync(clientPath, 'utf8');

// Extract CSS classes defined
const cssMatch = content.match(/const CSS = `([^`]+)`;/);
if (!cssMatch) {
  console.error('CSS not found');
  process.exit(1);
}

const css = cssMatch[1];

// Extract class names from CSS (very simple regex)
const cssClasses = new Set();
const classMatches = css.matchAll(/\.([a-z-]+)/g);
for (const match of classMatches) {
  cssClasses.add(match[1]);
}

// Extract class names used in code
const codeClasses = new Set();
const codeMatches = content.matchAll(/className:\s*['"]([\w\s-]+)['"]/g);
for (const match of codeMatches) {
  const classes = match[1].split(' ');
  for (const cls of classes) {
    if (cls) codeClasses.add(cls);
  }
}

// Find unused classes
const unusedClasses = [];
for (const cls of cssClasses) {
  if (!codeClasses.has(cls) && !cls.startsWith('st-')) { // st- are status classes
    unusedClasses.push(cls);
  }
}

console.log(`Total CSS classes defined: ${cssClasses.size}`);
console.log(`CSS classes used in code: ${codeClasses.size}`);
console.log(`Potentially unused classes: ${unusedClasses.length}`);

if (unusedClasses.length > 0) {
  console.log('\nUnused classes:');
  unusedClasses.forEach(cls => console.log(`  .${cls}`));
}
