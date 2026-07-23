#!/usr/bin/env bash
set -e
REPO="/home/valo/valo/valo-site"
DOWNLOADS="/mnt/c/Users/Ziani/Downloads"
COMPONENT="src/components/ValoTerminal.jsx"
cd "$REPO"
PICKED=""
if [ -n "$1" ] && [ -f "$1" ]; then
  PICKED="$1"
elif [ -n "$1" ]; then
  PICKED=$(ls -t "$DOWNLOADS"/*"$1"*.jsx 2>/dev/null | head -1 || true)
else
  PICKED=$(ls -t "$DOWNLOADS"/valo-terminal*.jsx 2>/dev/null | head -1 || true)
fi
if [ -n "$PICKED" ]; then
  echo "📥 Using terminal file: $PICKED"
  cp "$PICKED" "$COMPONENT"
else
  echo "ℹ️  No new file in Downloads — deploying the code already in the repo."
fi
COUNT=$(grep -c "export default" "$COMPONENT" || true)
if [ "$COUNT" -eq 0 ]; then
  echo "🔧 Adding missing export line."
  printf "\nexport default App;\n" >> "$COMPONENT"
elif [ "$COUNT" -gt 1 ]; then
  echo "🔧 Removing duplicate export line."
  sed -i '/^export default App;$/d' "$COMPONENT"
fi
echo "🧪 Test-building before shipping…"
if ! npm run build > /tmp/valo-build.log 2>&1; then
  echo "❌ BUILD FAILED — nothing deployed, live site untouched. Error:"
  tail -20 /tmp/valo-build.log
  echo "Paste those lines to Claude to get it fixed."
  exit 1
fi
echo "✅ Build passed."
git add .
if git diff --cached --quiet; then
  echo "ℹ️  Nothing changed — nothing to push."
  exit 0
fi
git commit -m "Deploy $(date '+%Y-%m-%d %H:%M')"
echo "🔄 Syncing with GitHub…"
git pull --no-rebase --no-edit
git push
echo "🚀 Pushed! Vercel is rebuilding valotrading.app now (1–3 min → Ready)."
echo "   Then hard-refresh the site: Ctrl+Shift+R"
