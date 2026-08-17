const fs = require('fs');
let f = fs.readFileSync('src/database/migrationRunner.js', 'utf8');
f = f.replace(/q = q\.replace\(\/\\s\+REFERENCES\\s\+\\w\+\\s\*\\(\\s\*\\w\+\\s\*\\)\/g,\s*''\);/g, 
  "q = q.replace(/\\s+REFERENCES\\s+\\w+\\s*\\(\\s*\\w+\\s*\\)/g, '');\n  q = q.replace(/\\bTEXT\\s+PRIMARY\\s+KEY\\b/gi, 'VARCHAR(255) PRIMARY KEY');"
);
fs.writeFileSync('src/database/migrationRunner.js', f);
