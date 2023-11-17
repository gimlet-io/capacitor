package main

import (
	"context"
	"os"

	"dagger.io/dagger"
)

func (m *Ci) Build() {
	ctx := context.Background()

	client, err := dagger.Connect(ctx, dagger.WithLogOutput(os.Stdout))
	if err != nil {
		panic(err)
	}
	defer client.Close()

	source := client.Container().
		From("golang:1.21").
		WithDirectory(
			"/src",
			client.Host().Directory(root()),
			dagger.ContainerWithDirectoryOpts{
				Exclude: []string{"web"},
			},
		)

	runner := source.WithWorkdir("/src")

	runner = exec(runner, "go test -timeout 60s ./...")
	_, err = runner.Stderr(ctx)
	if err != nil {
		panic(err)
	}

	runner = exec(runner, "go build -o build/capacitor github.com/gimlet-io/capacitor/cmd/capacitor")
	_, err = runner.Stderr(ctx)
	if err != nil {
		panic(err)
	}
}
