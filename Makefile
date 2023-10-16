.PHONY: build

build:
	go build -o build/capacitor github.com/gimlet-io/capacitor/cmd/capacitor

test:
	go test -timeout 60s $(shell go list ./...)
