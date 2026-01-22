#!/usr/bin/env bash
set -euo pipefail

ZSHRC="$HOME/.zshrc"

echo "Checking for Java 17..."
if /usr/libexec/java_home -v17 >/dev/null 2>&1; then
  JAVA_HOME=$(/usr/libexec/java_home -v17)
  echo "Java 17 found at $JAVA_HOME"
else
  cat <<'MSG'
Java 17 not found on this machine.
You can install Temurin (recommended) via Homebrew:

  brew install --cask temurin

After installation run this script again.
MSG
  exit 1
fi

if [ ! -f "$ZSHRC" ]; then
  echo "No $ZSHRC found - creating one"
  touch "$ZSHRC"
fi

BACKUP="$ZSHRC.bak.$(date +%s)"
cp "$ZSHRC" "$BACKUP"

# Remove existing JAVA_HOME / java_home lines safely
sed -i '' '/export JAVA_HOME/d' "$ZSHRC" || true
sed -i '' '/java_home -v/d' "$ZSHRC" || true
sed -i '' '/export PATH=.*JAVA_HOME/d' "$ZSHRC" || true

cat >> "$ZSHRC" <<'EOF'
# Java 17 (Temurin/OpenJDK)
export JAVA_HOME="$(/usr/libexec/java_home -v17)"
export PATH="$JAVA_HOME/bin:$PATH"
EOF

echo "Backed up original $ZSHRC -> $BACKUP"
echo "Appended JAVA_HOME to $ZSHRC"

echo "To apply changes in the current shell run:"
echo "  source ~/.zshrc"

echo "Verify with:"
echo "  java -version && javac -version"
