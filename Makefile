.PHONY: build dist run

# Build the Go binary with embedded files
build:
	@echo "Building Go binary with embedded files..."
	@./cli/build.sh

run: build
	@echo "Running the Go binary..."
	@./cli/next

# Production build - optimized for deployment
dist: 
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
