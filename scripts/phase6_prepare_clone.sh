#!/usr/bin/env bash
# Build an isolated Mohim ERP Phase 6 Apps Script QA package.
# This script NEVER runs clasp push, changes a live script, or writes Sheet data.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLONE_SCRIPT_ID="${1:-}"
CLONE_SHEET_ID="${2:-}"
TARGET="${3:-}"

if [[ ! "$CLONE_SCRIPT_ID" =~ ^[A-Za-z0-9_-]{20,160}$ ]] ||
   [[ ! "$CLONE_SHEET_ID" =~ ^[A-Za-z0-9_-]{20,160}$ ]]; then
  echo 'Usage: bash scripts/phase6_prepare_clone.sh CLONE_SCRIPT_ID CLONE_SPREADSHEET_ID [NEW_OUTPUT_DIRECTORY]' >&2
  exit 2
fi

PRODUCTION_SCRIPT_ID="$(node -e 'process.stdout.write(require(process.argv[1]).scriptId)' "$ROOT/.clasp.json")"
# Second existing preview project is NOT an isolated disposable test project.
EXISTING_PREVIEW_SCRIPT_ID='1c1wtUuO0xISTw0JTfAKnqry28UeJaIcW8CWwJVDSo1Y31BbPad4glp4G'
if [[ "$CLONE_SCRIPT_ID" == "$PRODUCTION_SCRIPT_ID" ||
      "$CLONE_SCRIPT_ID" == "$EXISTING_PREVIEW_SCRIPT_ID" ]]; then
  echo 'REFUSED: production and existing preview script IDs are not disposable QA clones.' >&2
  exit 3
fi
if [[ "$CLONE_SCRIPT_ID" == "$CLONE_SHEET_ID" ]]; then
  echo 'REFUSED: script ID cannot equal spreadsheet ID.' >&2
  exit 3
fi

if [[ -n "$TARGET" ]]; then
  if [[ -e "$TARGET" ]]; then
    echo 'REFUSED: output directory already exists; provide a fresh empty path.' >&2
    exit 4
  fi
  mkdir -p "$TARGET"
  TARGET="$(cd "$TARGET" && pwd)"
else
  TARGET="$(mktemp -d "${TMPDIR:-/tmp}/mohim-phase6-clone-XXXXXXXX")"
fi

# Files are copied from the reviewed checkout, never from the production
# Apps Script deployment. We do not preserve the source .clasp.json.
find "$ROOT" -maxdepth 1 -type f \
  \( -name '*.gs' -o -name '*.html' -o -name 'appsscript.json' \) \
  -exec cp '{}' "$TARGET/" \;
cp "$ROOT/.claspignore" "$TARGET/.claspignore"
cp "$ROOT/tests/phase6_clone_audit.gs" "$TARGET/Phase6CloneAudit.gs"

node - "$TARGET" "$CLONE_SCRIPT_ID" "$CLONE_SHEET_ID" <<'NODE'
const fs=require('node:fs'),path=require('node:path');
const [target,scriptId,spreadsheetId]=process.argv.slice(2);
fs.writeFileSync(path.join(target,'.clasp.json'),JSON.stringify({
  scriptId,rootDir:'',scriptExtensions:['.js','.gs'],
  htmlExtensions:['.html'],jsonExtensions:['.json'],
  filePushOrder:[],skipSubdirectories:false
},null,2)+'\n');
const file=path.join(target,'Phase6CloneAudit.gs');
let source=fs.readFileSync(file,'utf8');
const sheetAnchor="spreadsheetId: '', // REQUIRED: isolated CLONE spreadsheet ID";
const scriptAnchor="scriptId: ''       // REQUIRED: isolated CLONE Apps Script project ID";
if(!source.includes(sheetAnchor)||!source.includes(scriptAnchor))throw Error('Clone-only audit template changed: refuse package');
source=source.replace(sheetAnchor,"spreadsheetId: '"+spreadsheetId+"', // REQUIRED: isolated CLONE spreadsheet ID")
  .replace(scriptAnchor,"scriptId: '"+scriptId+"'       // REQUIRED: isolated CLONE Apps Script project ID");
fs.writeFileSync(file,source);
NODE

printf '%s\n' \
  'Clone-only QA package prepared (NO remote writes performed).' \
  "Directory: $TARGET" \
  'Verify both clone IDs, review the diff and authenticate clasp only for this clone.' \
  "Once reviewed: cd '$TARGET' && clasp status" \
  'Only then, on the ISOLATED CLONE, perform the explicit push and run phase6CloneAudit_().' \
  'Never execute clasp push from the GitHub repository root.'
