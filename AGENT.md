# AGENT.md - Development Guide for Capacitor Next

## Commands
- **Build**: `make build` (frontend + Go backend), `deno task build` (frontend only)
- **Dev**: `make dev` (watch frontend) + `make run` (run backend) in separate terminals
- **Test**: `cd cli && go test ./...` for Go tests, `go test -run TestName ./pkg/path` for single test
- **Lint**: `cd cli && go fmt ./...` for Go formatting

## Architecture
- **Frontend**: SolidJS app in `src/` bundled with esbuild via Deno
- **Backend**: Go CLI in `cli/` that embeds frontend and provides Kubernetes client
- **Structure**: Multi-cluster Kubernetes dashboard with FluxCD integration
- **Key dirs**: `src/views/` (pages), `src/components/` (UI), `src/store/` (state), `cli/pkg/` (Go backend)

## Code Style
- **TypeScript**: Use SolidJS patterns, JSX with solid-js/web imports
- **Go**: Standard Go conventions, no embedded comments unless complex
- **Imports**: Use JSR imports for Deno (`jsr:@std/`), npm: prefix for Node packages
- **Types**: Defined in `src/types/k8s.ts`, use TypeScript strictly
- **State**: SolidJS stores and signals, providers for global state
- **Error handling**: Use `ErrorProvider` wrapper, Go standard error patterns
