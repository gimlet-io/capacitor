package main

import (
	"os"
	"path/filepath"
	"strings"

	"dagger.io/dagger"
)

func root() string {
	wd, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	return filepath.Join(wd, "..")
}

func exec(runner *dagger.Container, cmd string) *dagger.Container {
	return runner.WithExec(strings.Split(cmd, " "))
}
