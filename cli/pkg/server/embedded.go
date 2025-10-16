// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package server

import (
	"embed"
	"io/fs"
)

// To build with embedded files:
// 1. Run the build.sh script which will:
//    - Copy the public directory to cli/pkg/server/public/
//    - Build the binary with embedded files

//go:embed public
var embeddedFiles embed.FS

// NewWithEmbeddedFiles creates a server with embedded static files
func NewWithEmbeddedFiles(server *Server) *Server {
	// Set the embedded file system
	server.embedFS = embeddedFiles
	return server
}

// GetEmbeddedFS returns the embedded file system
func GetEmbeddedFS() fs.FS {
	return embeddedFiles
}
