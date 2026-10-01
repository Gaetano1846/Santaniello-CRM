import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { after } from 'node:test';

// Database demo (JSON) isolato per i test
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.DATA_DRIVER = 'memory';
process.env.MEMORY_DB_FILE = path.join(dir, 'db.json');
process.env.UPLOADS_DIR = path.join(dir, 'uploads');

const { defineSuite } = await import('./suite.js');
await defineSuite();
after(() => fs.rmSync(dir, { recursive: true, force: true }));
