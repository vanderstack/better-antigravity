const path = require('path');
const fs = require('fs');

/**
 * Automates the installation (symlinking) of the Better Antigravity extension
 * into the Antigravity user profile.
 */
function setup() {
    console.log('  Better Antigravity — Automated Installation');
    console.log('');

    const repoPath = path.resolve(__dirname, '..', '..');
    
    // Detect Antigravity Profile Path
    let profileBaseDir;
    if (process.platform === 'win32') {
        profileBaseDir = path.join(process.env.APPDATA || '', 'Antigravity');
    } else if (process.platform === 'darwin') {
        profileBaseDir = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Antigravity');
    } else {
        profileBaseDir = path.join(process.env.HOME || '', '.antigravity');
    }

    const extensionsDir = path.join(profileBaseDir, 'extensions');
    const targetPath = path.join(extensionsDir, 'better-antigravity');

    console.log(`  Source:    ${repoPath}`);
    console.log(`  Target:    ${targetPath}`);
    console.log('');

    try {
        // 1. Ensure extensions dir exists
        if (!fs.existsSync(extensionsDir)) {
            console.log(`  [setup] Creating extensions directory: ${extensionsDir}`);
            fs.mkdirSync(extensionsDir, { recursive: true });
        }

        // 2. Handle existing target
        if (fs.existsSync(targetPath)) {
            const stats = fs.lstatSync(targetPath);
            if (stats.isSymbolicLink()) {
                const linkTarget = fs.readlinkSync(targetPath);
                if (path.resolve(linkTarget) === repoPath) {
                    console.log('  [setup] ✅ Extension is already symlinked correctly.');
                } else {
                    console.log(`  [setup] ⚠️ Extension symlink exists but points elsewhere: ${linkTarget}`);
                    console.log('  [setup] Removing old symlink...');
                    fs.unlinkSync(targetPath);
                    createSymlink(repoPath, targetPath);
                }
            } else {
                console.log('  [setup] ❌ Target exists and is NOT a symlink. Please remove it manually.');
                process.exit(1);
            }
        } else {
            createSymlink(repoPath, targetPath);
        }

        // 3. SDK Check (Peer Directory)
        const sdkPath = path.resolve(repoPath, '..', 'antigravity-sdk');
        if (fs.existsSync(sdkPath)) {
            console.log('  [setup] ✅ Found peer antigravity-sdk directory.');
        } else {
            console.log('  [setup] ℹ️ Peer antigravity-sdk not found. This is fine if you only need the extension.');
        }

        console.log('');
        console.log('  Done! Please reload Antigravity (Developer: Reload Window) to activate.');
        console.log('');

    } catch (err) {
        console.error(`  [setup] ❌ FAILED: ${err.message}`);
        process.exit(1);
    }
}

function createSymlink(src, dest) {
    console.log(`  [setup] Creating symlink: ${dest} -> ${src}`);
    // On Windows, symlinks require special privileges, 'junction' is more portable for dirs
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(src, dest, type);
    console.log('  [setup] ✅ Symlink created.');
}

setup();
