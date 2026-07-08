const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Find script tags
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let scriptIndex = 1;
let hasError = false;

while ((match = scriptRegex.exec(html)) !== null) {
  const code = match[1];
  if (!code.trim()) continue;
  
  try {
    new vm.Script(code);
    console.log(`Script block ${scriptIndex} syntax: OK`);
  } catch (err) {
    console.error(`\n❌ Syntax error in script block ${scriptIndex}:`);
    console.error(err.message);
    
    // Find approximate line number in HTML file
    const index = match.index;
    const linesBefore = html.slice(0, index).split('\n').length;
    const errLineInCode = err.stack ? err.stack.split('\n')[0].match(/:(\d+)/) : null;
    const errorLineNo = linesBefore + (errLineInCode ? parseInt(errLineInCode[1]) - 1 : 0);
    
    console.error(`Approximate HTML line number: ${errorLineNo}`);
    hasError = true;
  }
  scriptIndex++;
}

if (hasError) {
  process.exit(1);
} else {
  console.log('\nAll JS scripts in index.html compile successfully!');
}
