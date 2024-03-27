package api

import (
	"net/http"
	"strings"

	"github.com/gimlet-io/capacitor/pkg/logs"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func SetupRouter(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	config *rest.Config,
	clientHub *streaming.ClientHub,
	runningLogStreams *logs.RunningLogStreams,
) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.WithValue("dynamicClient", dynamicClient))
	r.Use(middleware.WithValue("client", client))
	r.Use(middleware.WithValue("config", config))
	r.Use(middleware.WithValue("runningLogStreams", runningLogStreams))
	r.Use(middleware.WithValue("clientHub", clientHub))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Get("/api/fluxState", fluxStateHandler)
	r.Get("/api/fluxEvents", fluxEvents)
	r.Get("/api/services", servicesHandler)
	r.Get("/api/describeConfigmap", describeConfigmap)
	r.Get("/api/describeSecret", describeSecret)
	r.Get("/api/describeDeployment", describeDeployment)
	r.Get("/api/describePod", describePod)
	r.Get("/api/logs", streamLogs)
	r.Get("/api/stopLogs", stopLogs)
	r.Post("/api/suspend", suspend)
	r.Post("/api/resume", resume)
	r.Post("/api/reconcile", reconcile)
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
