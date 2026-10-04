// Runs before `npm test`: brings the separate test database up to the latest migration.
// Loading .env.test first means this can never touch the development database.
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.test'), override: true, quiet: true });

execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
