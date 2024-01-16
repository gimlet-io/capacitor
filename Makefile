GOFILES = $(shell find . -type f -name '*.go' -not -path "./.git/*")
LDFLAGS = '-s -w -extldflags "-static" -X github.com/gimlet-io/gimlet-cli/pkg/version.Version='${VERSION}

format:
	@gofmt -w ${GOFILES}

.PHONY: test
test:
	go test -timeout 60s $(shell go list ./...)

.PHONY: build
build:
	CGO_ENABLED=0 go build -ldflags $(LDFLAGS) -o build/capacitor github.com/gimlet-io/capacitor/cmd/capacitor

.PHONY: dist
dist:
	mkdir -p bin
	GOOS=linux GOARCH=amd64 go build -ldflags $(LDFLAGS) -a -installsuffix cgo -o bin/linux/amd64/capacitor github.com/gimlet-io/capacitor/cmd/capacitor
	GOOS=linux GOARCH=arm64 go build -ldflags $(LDFLAGS) -a -installsuffix cgo -o bin/linux/arm64/capacitor github.com/gimlet-io/capacitor/cmd/capacitor

.PHONY: build-ui
build-ui:
	(cd web; npm install; npm run build)
	rm -rf cmd/capacitor/web/build
	mkdir -p cmd/capacitor/web/build
	@cp -r web/build/* cmd/capacitor/web/build
