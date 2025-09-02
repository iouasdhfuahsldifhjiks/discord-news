#!/usr/bin/env bash

# Папка проекта
ROOT="."
OUTFILE="js_dump.txt"

# очищаем файл перед записью
> "$OUTFILE"

# ищем js-файлы
FILES=$(find "$ROOT" -type f -name "*.js" \
  -not -path "*/node_modules/*" \
  -not -path "*/dist/*" \
  -not -path "*/build/*" \
  -not -path "*/.git/*")

for file in $FILES; do
  echo "=== FILE: $file ===" >> "$OUTFILE"
  cat "$file" >> "$OUTFILE"
  echo -e "\n\n" >> "$OUTFILE"
done

echo "Готово! Все js-файлы собраны в $OUTFILE"
