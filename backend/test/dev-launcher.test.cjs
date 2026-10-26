const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('Windows launcher saves settings once, respects overrides and returns Go failures', {
  skip: process.platform !== 'win32',
}, () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-launcher-'));
  const backend = path.join(fixture, 'backend');
  const bin = path.join(fixture, 'bin');
  fs.mkdirSync(backend);
  fs.mkdirSync(bin);
  fs.copyFileSync(path.join(__dirname, '../dev.ps1'), path.join(backend, 'dev.ps1'));
  fs.copyFileSync(path.join(__dirname, '../../start-backend.cmd'), path.join(fixture, 'start-backend.cmd'));
  fs.writeFileSync(path.join(fixture, '.env'), [
    'POSTGRES_USER=uptime', 'POSTGRES_PASSWORD="test p@ss$word&"',
    'POSTGRES_DB=uptime', 'POSTGRES_PORT=55432',
  ].join('\n'));
  fs.writeFileSync(path.join(bin, 'go.cmd'), '@echo off\r\nnode "%~dp0probe.cjs" %*\r\nexit /b %errorlevel%\r\n');
  fs.writeFileSync(path.join(bin, 'probe.cjs'), `
    require('node:fs').writeFileSync(process.env.PROBE_OUTPUT, JSON.stringify({
      url: process.env.DATABASE_URL, secret: process.env.JWT_SECRET,
      port: process.env.PORT, cwd: process.cwd(), args: process.argv.slice(2),
    }));
    process.exit(Number(process.env.PROBE_EXIT || 0));
  `);
  const env = { ...process.env, PATH: `${bin};${process.env.PATH}`, PROBE_OUTPUT: path.join(fixture, 'probe.json') };
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'PORT', 'CLIENT_ORIGIN', 'COOKIE_SECURE',
    'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT']) delete env[key];
  function run(overrides = {}) {
    const result = spawnSync('cmd.exe', ['/d', '/c', path.join(fixture, 'start-backend.cmd')], {
      env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000,
    });
    assert.ifError(result.error);
    return result;
  }
  try {
    let result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const first = JSON.parse(fs.readFileSync(env.PROBE_OUTPUT, 'utf8'));
    assert.equal(first.url, 'postgres://uptime:test%20p%40ss%24word%26@localhost:55432/uptime?sslmode=disable');
    assert.ok(first.secret.length >= 32);
    assert.equal(first.port, '8080');
    assert.equal(first.cwd.toLowerCase(), backend.toLowerCase());
    assert.deepEqual(first.args, ['run', './cmd/server']);
    const saved = fs.readFileSync(path.join(backend, '.env'), 'utf8');
    fs.writeFileSync(path.join(fixture, '.env'), 'POSTGRES_PASSWORD=changed');
    result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(env.PROBE_OUTPUT, 'utf8')), first);
    result = run({ PORT: '8181', PROBE_EXIT: '7' });
    assert.equal(result.status, 7);
    assert.equal(JSON.parse(fs.readFileSync(env.PROBE_OUTPUT, 'utf8')).port, '8181');
    assert.equal(fs.readFileSync(path.join(backend, '.env'), 'utf8'), saved);
    assert.ok(!result.stdout.includes(first.secret));
    assert.ok(!result.stdout.includes('test p@ss'));
  } finally {
    // Only delete the unique fixture created by mkdtemp above.
    assert.equal(path.dirname(fixture), os.tmpdir());
    assert.ok(path.basename(fixture).startsWith('uptime-launcher-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
