const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '../../backend');
const PAYLOAD_DIR = path.resolve(__dirname, '../payload');

// Basename exclusions (file or directory names)
const EXCLUDED_BASENAMES = new Set([
  '.venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'superbrain.db',
  'superbrain.db-shm',
  'superbrain.db-wal',
  'token.txt',
  '.api_keys',
  'localtunnel.log',
  'localtunnel_enabled.txt',
  'error_log_utf8.txt',
  'failures.txt',
  'final_test.txt',
  'test_results.txt',
  'yt_error.txt',
  'err.json',
  'temp',
  'logs',
  '.setup_done',
  '.env'
]);

// Relative path exclusions from backend root
const EXCLUDED_PATHS = new Set([
  'config/test_credentials.txt',
  'config/ngrok_token.txt',
  'config/localtunnel.log',
  'static/uploads',
  'tests',
  'test_backend.py',
]);

function toRelative(src) {
  const rel = path.relative(BACKEND_DIR, src).replace(/\\/g, '/');
  return rel === '' ? '' : rel;
}

function isExcluded(src) {
  const rel = toRelative(src);
  if (!rel) return false;

  const baseName = path.basename(rel);
  if (EXCLUDED_BASENAMES.has(baseName)) {
    return true;
  }

  for (const excluded of EXCLUDED_PATHS) {
    if (rel === excluded || rel.startsWith(`${excluded}/`)) {
      return true;
    }
  }

  return false;
}

console.log('📦 Building SuperBrain Server Payload...');

if (fs.existsSync(PAYLOAD_DIR)) {
  fs.rmSync(PAYLOAD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(PAYLOAD_DIR, { recursive: true });

fs.cpSync(BACKEND_DIR, PAYLOAD_DIR, {
  recursive: true,
  filter: (src) => {
    if (isExcluded(src)) {
      console.log(`  Skipping: ${toRelative(src) || path.basename(src)}`);
      return false;
    }
    return true;
  }
});

console.log('✅ Payload built successfully!');
