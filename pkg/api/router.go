package api

import (
	"net/http"
	"strings"

	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"k8s.io/client-go/dynamic"
)

func SetupRouter(
	dynamicClient *dynamic.DynamicClient,
	clientHub *streaming.ClientHub,
) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.WithValue("dynamicClient", dynamicClient))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Get("/api/fluxState", fluxStateHandler)
	r.Get("/api/services", servicesHandler)
	r.Get("/ws/", func(w http.ResponseWriter, r *http.Request) {
		streaming.ServeWs(clientHub, w, r)
	})

	filesDir := http.Dir("./web/build")
	fileServer(r, "/", filesDir)

	return r
}

// static files from a http.FileSystem
func fileServer(r chi.Router, path string, root http.FileSystem) {
	if strings.ContainsAny(path, "{}*") {
		//TODO: serve all React routes https://github.com/go-chi/chi/issues/403
		panic("FileServer does not permit any URL parameters.")
	}

	if path != "/" && path[len(path)-1] != '/' {
		r.Get(path, http.RedirectHandler(path+"/", http.StatusMovedPermanently).ServeHTTP)
		path += "/"
	}
	path += "*"

	r.Get(path, func(w http.ResponseWriter, r *http.Request) {
		ctx := chi.RouteContext(r.Context())
		pathPrefix := strings.TrimSuffix(ctx.RoutePattern(), "/*")
		fs := http.StripPrefix(pathPrefix, http.FileServer(root))
		fs.ServeHTTP(w, r)
	})
}
