const fs = require('fs');
const path = require('path');

const srcHtml = path.join(__dirname, '..', 'src', 'overlay', 'index.html');
const destDir = path.join(__dirname, '..', 'dist', 'overlay');
const destHtml = path.join(destDir, 'index.html');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

fs.copyFileSync(srcHtml, destHtml);
console.log('✅ [BUILD] Copied overlay index.html -> dist/overlay/index.html');
