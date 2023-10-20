.PHONY: build

build:
	go build -o build/capacitor github.com/gimlet-io/capacitor/cmd/capacitor

test:
	go test -timeout 60s $(shell go list ./...)

build-ui:
	(cd web; npm install; npm run build)
	rm -rf cmd/capacitor/web/build
	mkdir -p cmd/capacitor/web/build
	@cp -r web/build/* cmd/capacitor/web/build
