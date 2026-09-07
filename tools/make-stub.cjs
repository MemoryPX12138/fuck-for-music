const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const bak = src + '.bak';
if (!fs.existsSync(bak)) fs.copyFileSync(src, bak);
console.log('backup created:', bak);
