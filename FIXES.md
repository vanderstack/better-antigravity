# Fixes — Technical Details

Detailed root cause analysis and patch descriptions for each fix in Better Antigravity.

---

## Auto-Run Fix

**Status:** Working  
**Affected versions:** 1.107.0+  
**Files patched:** `workbench.desktop.main.js`, `jetskiAgent.js`

### The Problem

You set **Settings -> Agent -> Terminal Execution -> "Always Proceed"**, but Antigravity **still asks you to click "Run"** on every single terminal command. Every. Single. Time.

The setting saves correctly, Strict Mode is off -- it just doesn't work.

### Root Cause

Found in the source code: the `run_command` step renderer component has an `onChange` handler that auto-confirms commands when you switch the dropdown to "Always run" **on a specific step**. But there's **no `useEffect` hook** that checks the saved policy at mount time and auto-confirms **new steps**.

In other words: the UI reads your setting, displays the correct dropdown value, but never actually acts on it automatically.

```javascript
// What exists (only fires on dropdown CHANGE):
y = Mt(_ => {
    setTerminalAutoExecutionPolicy(_),
    _ === EAGER && confirm(true) // <- only when you manually switch
}, [])

// What's MISSING (should fire on component mount):
useEffect(() => {
    if (policy === EAGER && !secureMode) confirm(true) // <- auto-confirm new steps
}, [])
```

### How the Patch Works

The patcher uses **structural regex matching** to find the `onChange` handler in the minified source. It matches the code by shape, not by variable names -- so it works even when Antigravity re-minifies on update.

**Step 1: Find the onChange handler**

Pattern: `<callback>=<useCallback>((<arg>)=>{<setFn>(<arg>),<arg>===<ENUM>.EAGER&&<confirm>(!0)},[...])`

This matches the handler structurally:
- An assignment to a variable
- A `useCallback` call
- Arrow function with one argument
- Two expressions: set state + check EAGER and confirm

**Step 2: Extract variable names from context**

From the surrounding 3000 characters, extract:
- `policyVar`: `<var>=<something>?.terminalAutoExecutionPolicy??<ENUM>.OFF`
- `secureVar`: `<var>=<something>?.secureModeEnabled??!1`
- `useEffectFn`: the most frequently used short-named function matching the `fn(()=>{...})` pattern (frequency analysis)

**Step 3: Generate and inject the patch**

```javascript
/*BA:autorun*/<useEffect>(()=>{<policyVar>===<ENUM>.EAGER&&!<secureVar>&&<confirm>(!0)},[])
```

The patch is injected immediately after the `onChange` handler's closing bracket.

### Example Output

```
 Antigravity "Always Proceed" Auto-Run Fix

 C:\Users\user\AppData\Local\Programs\Antigravity
 Version: 1.107.0 (IDE 1.19.5)

  [workbench] Found onChange at offset 12362782
     callback=Mt, enum=Dhe, confirm=b
     policyVar=u
     secureVar=d
     useEffect=mn (confidence: 30 hits)
  [workbench] Patched (+43 bytes)
  [jetskiAgent] Found onChange at offset 8388797
     callback=ve, enum=rx, confirm=F
     policyVar=d
     secureVar=f
     useEffect=At (confidence: 55 hits)
  [jetskiAgent] Patched (+42 bytes)

Done! Restart Antigravity.
```

### Safety

- Original files are saved as `.ba-backup` before patching
- The patch marker `/*BA:autorun*/` prevents double-patching
- Only **adds** code, never removes existing logic
- `--revert` restores the original file from backup
- Async I/O in the extension prevents blocking the Extension Host

### Why two files?

The `run_command` step renderer exists in **two** bundles:
1. `workbench.desktop.main.js` -- the main workbench bundle (~15MB)
2. `jetskiAgent.js` -- the Cascade chat panel webview (~10MB)

Both contain the same bug with slightly different minified variable names. The structural matcher handles both transparently.
