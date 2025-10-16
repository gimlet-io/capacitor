#!/bin/bash

# Script to add Apache 2.0 header to all files in a directory recursively
# Usage: ./add_apache_header.sh <directory>

set -e

# Function to get the appropriate header based on file extension
get_header() {
    local file="$1"
    local ext="${file##*.}"
    
    case "$ext" in
        ts|tsx|js|jsx|go|java|c|cpp|h|hpp|cc|cxx)
            echo "// Copyright 2025 Laszlo Consulting Kft."
            echo "// SPDX-License-Identifier: Apache-2.0"
            ;;
        py|sh|bash|rb|yaml|yml|toml)
            echo "# Copyright 2025 Laszlo Consulting Kft."
            echo "# SPDX-License-Identifier: Apache-2.0"
            ;;
        html|xml)
            echo "<!-- Copyright 2025 Laszlo Consulting Kft. -->"
            echo "<!-- SPDX-License-Identifier: Apache-2.0 -->"
            ;;
        css|scss|sass)
            echo "/* Copyright 2025 Laszlo Consulting Kft. */"
            echo "/* SPDX-License-Identifier: Apache-2.0 */"
            ;;
        *)
            echo "# Copyright 2025 Laszlo Consulting Kft."
            echo "# SPDX-License-Identifier: Apache-2.0"
            ;;
    esac
}

if [ $# -eq 0 ]; then
    echo "Usage: $0 <directory>"
    echo "Example: $0 ./src"
    exit 1
fi

TARGET_DIR="$1"

if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Directory '$TARGET_DIR' does not exist"
    exit 1
fi

echo "Adding Apache 2.0 header to files in: $TARGET_DIR"

# Counter for modified files
modified=0
skipped=0

# Find only .tsx and .go files recursively, excluding common directories
find "$TARGET_DIR" -type f \
    \( -name "*.tsx" -o -name "*.go" \) \
    ! -path "*/node_modules/*" \
    ! -path "*/.git/*" \
    ! -path "*/dist/*" \
    ! -path "*/build/*" \
    ! -path "*/bundle/*" \
    | while read -r file; do
    
    # Check if file already has the Apache header
    if head -n 3 "$file" 2>/dev/null | grep -q "SPDX-License-Identifier: Apache-2.0"; then
        echo "  [SKIP] $file (already has header)"
        ((skipped++))
    else
        # Get appropriate header for file type
        header=$(get_header "$file")
        
        # Create temporary file with header
        temp_file=$(mktemp)
        echo "$header" > "$temp_file"
        echo "" >> "$temp_file"
        cat "$file" >> "$temp_file"
        
        # Replace original file
        mv "$temp_file" "$file"
        echo "  [ADD]  $file"
        ((modified++))
    fi
done

echo ""
echo "Done! Modified: $modified files, Skipped: $skipped files"

