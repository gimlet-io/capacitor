# Makefile for k8s-dashboard project

.PHONY: all build watch serve clean go-build run dev prod run-binary build-native

# Get system information for binary selection
SYSTEM_OS := $(shell uname)
SYSTEM_ARCH := $(shell uname -m)
BINARY_NAME := next-$(SYSTEM_OS)-$(SYSTEM_ARCH)

# Default target
all: build

# Build the Go binary with embedded files
go-build:
	@echo "Building Go binary with embedded files..."
	@./cli/build.sh

# Build a binary for the current system
build-native:
	@echo "Building native binary for $(SYSTEM_OS)/$(SYSTEM_ARCH)..."
	@echo "Building frontend..."
	@deno task build
	@echo "Building Go binary for current system..."
	@GOOS=$(shell echo $(SYSTEM_OS) | tr '[:upper:]' '[:lower:]') GOARCH=$(SYSTEM_ARCH) OUTPUT_FILENAME=$(BINARY_NAME) ./cli/build.sh
	@echo "Native build complete. Binary is at cli/$(BINARY_NAME)"

# Build the project (frontend + backend)
build:
	@echo "Building frontend..."
	@deno task build
	@echo "Building Go binary with embedded files..."
	@make go-build

# Production build - optimized for deployment
prod: 
	@echo "Building for production..."
	@echo "Building frontend with production settings..."
	@deno task build
	
	@echo "Building Go binary for Linux/AMD64..."
	@GOOS=linux GOARCH=amd64 OUTPUT_FILENAME=next-Linux-x86_64 ./cli/build.sh
	
	@echo "Building Go binary for Darwin/ARM64..."
	@GOOS=darwin GOARCH=arm64 OUTPUT_FILENAME=next-Darwin-arm64 ./cli/build.sh
	
	@echo "Production builds complete."
	@echo "Linux binary: cli/next-Linux-x86_64"
	@echo "macOS binary: cli/next-Darwin-arm64"

# Watch for changes in the frontend
watch:
	@echo "Watching for changes in frontend..."
	@deno task watch

# Run the development server
serve:
	@echo "Starting development server..."
	@deno task serve

# Development workflow - watches for changes in the frontend files
# Note: This requires running in a separate terminal than the 'make run' command
dev:
	@echo "Starting development mode..."
	@echo "Run 'make run' in another terminal to start the Go backend."
	@make watch

# Run the compiled Go binary (auto-detects system)
run:
	@echo "Running the k8s-dashboard..."
	@echo "Detected system: $(SYSTEM_OS) $(SYSTEM_ARCH)"
	@if [ -f "./cli/$(BINARY_NAME)" ]; then \
		echo "Using binary: $(BINARY_NAME)"; \
		./cli/$(BINARY_NAME); \
	elif [ -f "./cli/next" ]; then \
		echo "System-specific binary not found, using default binary"; \
		./cli/next; \
	else \
		echo "No binary found. Building first..."; \
		make go-build; \
		./cli/next; \
	fi

# Run a specific binary
run-binary:
	@if [ -z "$(BINARY)" ]; then \
		echo "Error: BINARY parameter not specified"; \
		echo "Usage: make run-binary BINARY=next-Darwin-arm64"; \
		exit 1; \
	fi
	@echo "Running specified binary: $(BINARY)"
	@./cli/$(BINARY)

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf cli/pkg/server/public
	@rm -f cli/next cli/next-*
	@echo "Cleaned build artifacts"

# Help command
help:
	@echo "Available commands:"
	@echo "  make              - Build the project (same as 'make build')"
	@echo "  make build        - Build the frontend and Go backend"
	@echo "  make build-native - Build for current system ($(SYSTEM_OS)/$(SYSTEM_ARCH))"
	@echo "  make prod         - Build for production (Linux/AMD64 and Darwin/ARM64)"
	@echo "  make go-build     - Build only the Go backend with embedded files"
	@echo "  make watch        - Watch for changes in the frontend"
	@echo "  make serve        - Run the development server"
	@echo "  make run          - Build and run the Go binary"
	@echo "  make run-binary BINARY=<filename> - Run a specific binary"
	@echo "  make dev          - Start development mode (watch for frontend changes)"
	@echo "  make clean        - Clean build artifacts"
	@echo "  make help         - Show this help message"
