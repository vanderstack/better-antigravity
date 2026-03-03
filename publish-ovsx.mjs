#!/usr/bin/env node

/**
 * Publish to Open VSX using token from .env
 *
 * Usage:
 *   node publish-ovsx.mjs                  — publish VSIX
 *   node publish-ovsx.mjs create-namespace — create publisher namespace (first time only)
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const cmd = process.argv[2] || 'publish';

// Read token from .env
let pat;
try {
    const env = readFileSync('.env', 'utf8');
    const match = env.match(/OVSX_PAT=(.+)/);
    if (!match) throw new Error('OVSX_PAT not found in .env');
    pat = match[1].trim();
} catch (err) {
    console.error('ERROR: Could not read .env file. Create .env with OVSX_PAT=<token>');
    process.exit(1);
}

try {
    if (cmd === 'create-namespace') {
        console.log(`Creating namespace "${pkg.publisher}" on Open VSX...`);
        execSync(`npx ovsx create-namespace ${pkg.publisher} --pat ${pat}`, { stdio: 'inherit' });
        console.log('Namespace created!');
    } else {
        const vsixFile = `out/better-antigravity.vsix`;
        console.log(`Publishing ${vsixFile} to Open VSX...`);
        execSync(`npx ovsx publish ${vsixFile} --pat ${pat}`, { stdio: 'inherit' });
        console.log('Done!');
    }
} catch {
    process.exit(1);
}
