// One image, separate API and queue-worker services. Apply only checked-in migrations.
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const mode = process.env.APP_PROCESS || 'api';
if (!['api', 'worker'].includes(mode)) throw new Error('APP_PROCESS must be api or worker');
const migration = spawnSync(process.execPath, [path.join(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { stdio: 'inherit' });
if (migration.error || migration.status !== 0) {
  console.error('Database migration failed; refusing to start.');
  process.exit(migration.status || 1);
}
const child = spawn(process.execPath, [path.join(__dirname, mode === 'worker' ? '../dist/worker.js' : '../dist/main.js')], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(error.message); process.exit(1); });
child.on('exit', (code, signal) => process.exit(code === null ? (signal ? 1 : 0) : code));
