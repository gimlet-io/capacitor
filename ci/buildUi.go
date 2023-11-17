package main

import (
	"context"
	"os"
	"path/filepath"

	"dagger.io/dagger"
)

func (m *Ci) BuildUi() {
	ctx := context.Background()

	client, err := dagger.Connect(ctx, dagger.WithLogOutput(os.Stdout))
	if err != nil {
		panic(err)
	}
	defer client.Close()

	source := client.Container().
		From("node:16-slim").
		WithDirectory(
			"/src",
			client.Host().Directory(filepath.Join(root(), "web")),
			dagger.ContainerWithDirectoryOpts{
				Exclude: []string{"../web/node_modules/", "../web/build/"},
			},
		)

	runner := source.WithWorkdir("/src")

	runner = exec(runner, "npm install")
	_, err = runner.Stderr(ctx)
	if err != nil {
		panic(err)
	}

	runner = exec(runner, "npm run build")
	_, err = runner.Stderr(ctx)
	if err != nil {
		panic(err)
	}

	buildDir := runner.Directory("./build")
	_, err = buildDir.Export(ctx, filepath.Join(root(), "web", "build"))
	if err != nil {
		panic(err)
	}
}
