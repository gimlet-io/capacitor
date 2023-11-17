export PATH := $(abspath bin/):${PATH}
export DAGGER_MODULE="ci"

.PHONY: build
build:
	go build -o build/capacitor github.com/gimlet-io/capacitor/cmd/capacitor

.PHONY: dagger-build
dagger-build:
	dagger call build

.PHONY: test
test:
	go test -timeout 60s $(shell go list ./...)

.PHONY: build-ui
build-ui:
	(cd web; npm install; npm run build)
	@rm -rf cmd/capacitor/web/build
	@mkdir -p cmd/capacitor/web/build
	@cp -r web/build/* cmd/capacitor/web/build

.PHONY: dagger-build-ui
dagger-build-ui:
	dagger call buildUi
	@rm -rf cmd/capacitor/web/build
	@mkdir -p cmd/capacitor/web/build
	@cp -r web/build/* cmd/capacitor/web/build

deps: bin/dagger
bin/dagger:
	@mkdir -p bin
	curl -L https://dl.dagger.io/dagger/install.sh | sh
	@echo "🦄 🌈 🦄 🌈 🦄 🌈"
