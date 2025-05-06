#!/bin/bash
set -e

# Directory information
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PUBLIC_DIR="$ROOT_DIR/public"
SERVER_PKG_DIR="$SCRIPT_DIR/pkg/server"
SERVER_PUBLIC_DIR="$SERVER_PKG_DIR/public"

# Output filename (use environment variable if set, otherwise default to "next")
OUTPUT_FILENAME=${OUTPUT_FILENAME:-next}

# Create server/public directory if it doesn't exist
echo "Creating public directory in server package..."
mkdir -p "$SERVER_PUBLIC_DIR"

# Copy public files to server package
echo "Copying public files to server package..."
cp -r "$PUBLIC_DIR"/* "$SERVER_PUBLIC_DIR"

# Build the Go binary
echo "Building Go binary..."
cd "$SCRIPT_DIR"
go build -o "$OUTPUT_FILENAME" ./cmd

echo "Build successful! Binary is at $SCRIPT_DIR/$OUTPUT_FILENAME" 