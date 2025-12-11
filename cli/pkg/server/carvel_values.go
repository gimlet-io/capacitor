// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// CarvelValueSource represents a source of values (Secret or ConfigMap)
type CarvelValueSource struct {
	Type      string            `json:"type"`      // "secret" or "configmap" or "inline"
	Name      string            `json:"name"`      // name of the secret/configmap, or "inline" for inline paths
	Namespace string            `json:"namespace"` // namespace of the resource
	Data      map[string]string `json:"data"`      // actual data from the secret/configmap
	Order     int               `json:"order"`     // application order
}

// CarvelOverlaySource represents a source of overlays (from annotations)
type CarvelOverlaySource struct {
	Type      string            `json:"type"`      // "secret" (overlays are always from secrets)
	Name      string            `json:"name"`      // name of the secret
	Namespace string            `json:"namespace"` // namespace of the resource
	Data      map[string]string `json:"data"`      // actual data from the secret
	Order     int               `json:"order"`     // application order (from annotation number)
}

// CarvelFetchSource represents a fetch source for Carvel App
type CarvelFetchSource struct {
	Type   string                 `json:"type"`             // "inline", "image", "imgpkgBundle", "http", "git", "helmChart"
	Config map[string]interface{} `json:"config,omitempty"` // configuration for the fetch source
	Path   string                 `json:"path,omitempty"`   // optional path for fetched artifacts
}

// CarvelPackageRef represents packageRef information for PackageInstall
type CarvelPackageRef struct {
	RefName     string `json:"refName"`               // package reference name
	Constraints string `json:"constraints,omitempty"` // version constraints
}

// CarvelValuesResponse represents the complete values and overlays response
type CarvelValuesResponse struct {
	Kind       string                `json:"kind"`                 // "App" or "PackageInstall"
	Name       string                `json:"name"`                 // resource name
	Namespace  string                `json:"namespace"`            // resource namespace
	Fetch      []CarvelFetchSource   `json:"fetch,omitempty"`      // fetch sources (App only)
	PackageRef *CarvelPackageRef     `json:"packageRef,omitempty"` // package reference (PackageInstall only)
	Values     []CarvelValueSource   `json:"values"`               // list of value sources in order
	Overlays   []CarvelOverlaySource `json:"overlays"`             // list of overlay sources in order
}

// handleCarvelAppValues handles the Carvel App values API endpoint
func handleCarvelAppValues(c echo.Context, proxy *KubernetesProxy) error {
	ctx := c.Request().Context()
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Fetching Carvel App values: namespace=%s, name=%s", namespace, name)

	// Get the App resource
	appGVR := schema.GroupVersionResource{
		Group:    "kappctrl.k14s.io",
		Version:  "v1alpha1",
		Resource: "apps",
	}

	appUnstructured, err := proxy.dynamicClient.Resource(appGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("App not found: %v", err)})
	}

	app := appUnstructured.Object

	// Extract fetch sources from App
	fetchSources := extractAppFetchSources(app)

	// Extract values from App
	values, err := extractAppValues(ctx, app, proxy, namespace)
	if err != nil {
		log.Printf("[Debug] Error extracting App values: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Failed to extract values: %v", err)})
	}

	// Apps don't have overlays
	response := &CarvelValuesResponse{
		Kind:      "App",
		Name:      name,
		Namespace: namespace,
		Fetch:     fetchSources,
		Values:    values,
		Overlays:  []CarvelOverlaySource{},
	}

	return c.JSON(http.StatusOK, response)
}

// handleCarvelPackageInstallValues handles the Carvel PackageInstall values API endpoint
func handleCarvelPackageInstallValues(c echo.Context, proxy *KubernetesProxy) error {
	ctx := c.Request().Context()
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Fetching Carvel PackageInstall values: namespace=%s, name=%s", namespace, name)

	// Get the PackageInstall resource
	pkgiGVR := schema.GroupVersionResource{
		Group:    "packaging.carvel.dev",
		Version:  "v1alpha1",
		Resource: "packageinstalls",
	}

	pkgiUnstructured, err := proxy.dynamicClient.Resource(pkgiGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("PackageInstall not found: %v", err)})
	}

	pkgi := pkgiUnstructured.Object

	// Extract packageRef from PackageInstall
	packageRef := extractPackageRef(pkgi)

	// Extract values from PackageInstall
	values, err := extractPackageInstallValues(ctx, pkgi, proxy, namespace)
	if err != nil {
		log.Printf("[Debug] Error extracting PackageInstall values: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Failed to extract values: %v", err)})
	}

	// Extract overlays from PackageInstall annotations
	overlays, err := extractPackageInstallOverlays(ctx, pkgi, proxy, namespace)
	if err != nil {
		log.Printf("[Debug] Error extracting PackageInstall overlays: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Failed to extract overlays: %v", err)})
	}

	response := &CarvelValuesResponse{
		Kind:       "PackageInstall",
		Name:       name,
		Namespace:  namespace,
		PackageRef: packageRef,
		Values:     values,
		Overlays:   overlays,
	}

	return c.JSON(http.StatusOK, response)
}

// extractAppValues extracts values from a Carvel App
func extractAppValues(ctx context.Context, app map[string]interface{}, proxy *KubernetesProxy, namespace string) ([]CarvelValueSource, error) {
	values := []CarvelValueSource{}
	order := 1

	// Get spec.template array
	templates := getNestedSlice(app, "spec", "template")
	if templates == nil {
		log.Printf("[Debug] No spec.template found in App")
		return values, nil
	}

	// Iterate through template steps
	for _, templateItem := range templates {
		templateMap, ok := templateItem.(map[string]interface{})
		if !ok {
			continue
		}

		// Check for ytt template
		if yttMap := getNestedMap(templateMap, "ytt"); yttMap != nil {
			// Extract inline paths
			if inlinePaths := getNestedMap(yttMap, "inline", "paths"); inlinePaths != nil {
				inlineData := make(map[string]string)
				for key, value := range inlinePaths {
					if strValue, ok := value.(string); ok {
						inlineData[key] = strValue
					}
				}
				if len(inlineData) > 0 {
					values = append(values, CarvelValueSource{
						Type:      "inline",
						Name:      "inline-paths",
						Namespace: namespace,
						Data:      inlineData,
						Order:     order,
					})
					order++
					log.Printf("[Debug] Found %d inline paths", len(inlineData))
				}
			}

			// Extract inline pathsFrom (secrets and configmaps)
			if pathsFrom := getNestedSlice(yttMap, "inline", "pathsFrom"); pathsFrom != nil {
				extracted, err := extractPathsFrom(ctx, pathsFrom, proxy, namespace, &order)
				if err != nil {
					return nil, err
				}
				values = append(values, extracted...)
			}

			// Extract valuesFrom
			if valuesFrom := getNestedSlice(yttMap, "valuesFrom"); valuesFrom != nil {
				extracted, err := extractValuesFrom(ctx, valuesFrom, proxy, namespace, &order)
				if err != nil {
					return nil, err
				}
				values = append(values, extracted...)
			}
		}

		// Check for helmTemplate
		if helmMap := getNestedMap(templateMap, "helmTemplate"); helmMap != nil {
			if valuesFrom := getNestedSlice(helmMap, "valuesFrom"); valuesFrom != nil {
				extracted, err := extractValuesFrom(ctx, valuesFrom, proxy, namespace, &order)
				if err != nil {
					return nil, err
				}
				values = append(values, extracted...)
			}
		}

		// Check for cue template
		if cueMap := getNestedMap(templateMap, "cue"); cueMap != nil {
			if valuesFrom := getNestedSlice(cueMap, "valuesFrom"); valuesFrom != nil {
				extracted, err := extractValuesFrom(ctx, valuesFrom, proxy, namespace, &order)
				if err != nil {
					return nil, err
				}
				values = append(values, extracted...)
			}
		}
	}

	log.Printf("[Debug] Extracted %d value sources from App", len(values))
	return values, nil
}

// extractPackageInstallValues extracts values from a PackageInstall
func extractPackageInstallValues(ctx context.Context, pkgi map[string]interface{}, proxy *KubernetesProxy, namespace string) ([]CarvelValueSource, error) {
	values := []CarvelValueSource{}
	order := 1

	// Get spec.values array
	specValues := getNestedSlice(pkgi, "spec", "values")
	if specValues == nil {
		log.Printf("[Debug] No spec.values found in PackageInstall")
		return values, nil
	}

	// Iterate through values
	for _, valueItem := range specValues {
		valueMap, ok := valueItem.(map[string]interface{})
		if !ok {
			continue
		}

		// Check for secretRef
		if secretRef := getNestedMap(valueMap, "secretRef"); secretRef != nil {
			secretName := getNestedString(secretRef, "name")
			if secretName != "" {
				data, err := getSecretData(ctx, proxy, namespace, secretName)
				if err != nil {
					log.Printf("[Debug] Error getting secret %s: %v", secretName, err)
					continue
				}
				values = append(values, CarvelValueSource{
					Type:      "secret",
					Name:      secretName,
					Namespace: namespace,
					Data:      data,
					Order:     order,
				})
				order++
				log.Printf("[Debug] Extracted secret values: %s", secretName)
			}
		}

		// Check for configMapRef
		if configMapRef := getNestedMap(valueMap, "configMapRef"); configMapRef != nil {
			configMapName := getNestedString(configMapRef, "name")
			if configMapName != "" {
				data, err := getConfigMapData(ctx, proxy, namespace, configMapName)
				if err != nil {
					log.Printf("[Debug] Error getting configmap %s: %v", configMapName, err)
					continue
				}
				values = append(values, CarvelValueSource{
					Type:      "configmap",
					Name:      configMapName,
					Namespace: namespace,
					Data:      data,
					Order:     order,
				})
				order++
				log.Printf("[Debug] Extracted configmap values: %s", configMapName)
			}
		}
	}

	log.Printf("[Debug] Extracted %d value sources from PackageInstall", len(values))
	return values, nil
}

// extractPackageInstallOverlays extracts overlay secrets from PackageInstall annotations
func extractPackageInstallOverlays(ctx context.Context, pkgi map[string]interface{}, proxy *KubernetesProxy, namespace string) ([]CarvelOverlaySource, error) {
	overlays := []CarvelOverlaySource{}

	// Get annotations
	annotations := getNestedMap(pkgi, "metadata", "annotations")
	if annotations == nil {
		log.Printf("[Debug] No annotations found in PackageInstall")
		return overlays, nil
	}

	// Find all ext.packaging.carvel.dev/ytt-paths-from-secret-name.* annotations
	overlayMap := make(map[int]string) // order -> secret name
	for key, value := range annotations {
		if strings.HasPrefix(key, "ext.packaging.carvel.dev/ytt-paths-from-secret-name.") {
			strValue, ok := value.(string)
			if !ok {
				continue
			}
			
			// Extract the number from the annotation key
			parts := strings.Split(key, ".")
			if len(parts) > 0 {
				numStr := parts[len(parts)-1]
				if num, err := strconv.Atoi(numStr); err == nil {
					overlayMap[num] = strValue
					log.Printf("[Debug] Found overlay annotation: %s=%s (order: %d)", key, strValue, num)
				}
			}
		}
	}

	// Sort by order and fetch secret data
	orders := make([]int, 0, len(overlayMap))
	for order := range overlayMap {
		orders = append(orders, order)
	}
	sort.Ints(orders)

	for _, order := range orders {
		secretName := overlayMap[order]
		data, err := getSecretData(ctx, proxy, namespace, secretName)
		if err != nil {
			log.Printf("[Debug] Error getting overlay secret %s: %v", secretName, err)
			continue
		}
		overlays = append(overlays, CarvelOverlaySource{
			Type:      "secret",
			Name:      secretName,
			Namespace: namespace,
			Data:      data,
			Order:     order,
		})
		log.Printf("[Debug] Extracted overlay secret: %s (order: %d)", secretName, order)
	}

	log.Printf("[Debug] Extracted %d overlay sources from PackageInstall", len(overlays))
	return overlays, nil
}

// extractPathsFrom extracts secrets and configmaps from pathsFrom array
func extractPathsFrom(ctx context.Context, pathsFrom []interface{}, proxy *KubernetesProxy, namespace string, order *int) ([]CarvelValueSource, error) {
	values := []CarvelValueSource{}

	for _, item := range pathsFrom {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		// Check for secretRef
		if secretRef := getNestedMap(itemMap, "secretRef"); secretRef != nil {
			secretName := getNestedString(secretRef, "name")
			if secretName != "" {
				data, err := getSecretData(ctx, proxy, namespace, secretName)
				if err != nil {
					log.Printf("[Debug] Error getting secret %s: %v", secretName, err)
					continue
				}
				values = append(values, CarvelValueSource{
					Type:      "secret",
					Name:      secretName,
					Namespace: namespace,
					Data:      data,
					Order:     *order,
				})
				*order++
				log.Printf("[Debug] Extracted pathsFrom secret: %s", secretName)
			}
		}

		// Check for configMapRef
		if configMapRef := getNestedMap(itemMap, "configMapRef"); configMapRef != nil {
			configMapName := getNestedString(configMapRef, "name")
			if configMapName != "" {
				data, err := getConfigMapData(ctx, proxy, namespace, configMapName)
				if err != nil {
					log.Printf("[Debug] Error getting configmap %s: %v", configMapName, err)
					continue
				}
				values = append(values, CarvelValueSource{
					Type:      "configmap",
					Name:      configMapName,
					Namespace: namespace,
					Data:      data,
					Order:     *order,
				})
				*order++
				log.Printf("[Debug] Extracted pathsFrom configmap: %s", configMapName)
			}
		}
	}

	return values, nil
}

// extractValuesFrom extracts secrets and configmaps from valuesFrom array
func extractValuesFrom(ctx context.Context, valuesFrom []interface{}, proxy *KubernetesProxy, namespace string, order *int) ([]CarvelValueSource, error) {
	values := []CarvelValueSource{}

	for _, item := range valuesFrom {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		// Check for secretRef
		if secretRef := getNestedMap(itemMap, "secretRef"); secretRef != nil {
			secretName := getNestedString(secretRef, "name")
			if secretName != "" {
				data, err := getSecretData(ctx, proxy, namespace, secretName)
				if err != nil {
					log.Printf("[Debug] Error getting secret %s: %v", secretName, err)
					continue
				}
				values = append(values, CarvelValueSource{
					Type:      "secret",
					Name:      secretName,
					Namespace: namespace,
					Data:      data,
					Order:     *order,
				})
				*order++
				log.Printf("[Debug] Extracted valuesFrom secret: %s", secretName)
			}
		}

		// Check for configMapRef
		if configMapRef := getNestedMap(itemMap, "configMapRef"); configMapRef != nil {
			configMapName := getNestedString(configMapRef, "name")
			if configMapName != "" {
				data, err := getConfigMapData(ctx, proxy, namespace, configMapName)
				if err != nil {
					log.Printf("[Debug] Error getting configmap %s: %v", configMapName, err)
					continue
				}
				values = append(values, CarvelValueSource{
					Type:      "configmap",
					Name:      configMapName,
					Namespace: namespace,
					Data:      data,
					Order:     *order,
				})
				*order++
				log.Printf("[Debug] Extracted valuesFrom configmap: %s", configMapName)
			}
		}

		// Skip path and downwardAPI items (they don't reference external resources)
	}

	return values, nil
}

// getSecretData fetches data from a Kubernetes Secret
func getSecretData(ctx context.Context, proxy *KubernetesProxy, namespace, name string) (map[string]string, error) {
	secret, err := proxy.k8sClient.Clientset.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get secret %s/%s: %w", namespace, name, err)
	}

	data := make(map[string]string)
	for key, value := range secret.Data {
		data[key] = string(value)
	}

	return data, nil
}

// getConfigMapData fetches data from a Kubernetes ConfigMap
func getConfigMapData(ctx context.Context, proxy *KubernetesProxy, namespace, name string) (map[string]string, error) {
	configMap, err := proxy.k8sClient.Clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get configmap %s/%s: %w", namespace, name, err)
	}

	data := make(map[string]string)
	for key, value := range configMap.Data {
		data[key] = value
	}

	return data, nil
}

// extractAppFetchSources extracts fetch sources from a Carvel App
func extractAppFetchSources(app map[string]interface{}) []CarvelFetchSource {
	fetchSources := []CarvelFetchSource{}

	// Get spec.fetch array
	fetches := getNestedSlice(app, "spec", "fetch")
	if fetches == nil {
		log.Printf("[Debug] No spec.fetch found in App")
		return fetchSources
	}

	// Iterate through fetch items
	for _, fetchItem := range fetches {
		fetchMap, ok := fetchItem.(map[string]interface{})
		if !ok {
			continue
		}

		// Check for each fetch type and extract configuration
		if inlineConfig := getNestedMap(fetchMap, "inline"); inlineConfig != nil {
			config := make(map[string]interface{})
			
			// Extract paths
			if paths := getNestedMap(inlineConfig, "paths"); paths != nil {
				config["paths"] = paths
			}
			
			// Extract pathsFrom
			if pathsFrom := getNestedSlice(inlineConfig, "pathsFrom"); pathsFrom != nil {
				// Simplify pathsFrom to just names
				simplified := []map[string]string{}
				for _, pf := range pathsFrom {
					pfMap, ok := pf.(map[string]interface{})
					if !ok {
						continue
					}
					item := make(map[string]string)
					if secretRef := getNestedMap(pfMap, "secretRef"); secretRef != nil {
						item["type"] = "secret"
						item["name"] = getNestedString(secretRef, "name")
						if directoryPath := getNestedString(pfMap, "directoryPath"); directoryPath != "" {
							item["directoryPath"] = directoryPath
						}
					}
					if configMapRef := getNestedMap(pfMap, "configMapRef"); configMapRef != nil {
						item["type"] = "configmap"
						item["name"] = getNestedString(configMapRef, "name")
						if directoryPath := getNestedString(pfMap, "directoryPath"); directoryPath != "" {
							item["directoryPath"] = directoryPath
						}
					}
					if len(item) > 0 {
						simplified = append(simplified, item)
					}
				}
				if len(simplified) > 0 {
					config["pathsFrom"] = simplified
				}
			}
			
			fetchSources = append(fetchSources, CarvelFetchSource{
				Type:   "inline",
				Config: config,
				Path:   getNestedString(fetchMap, "path"),
			})
			log.Printf("[Debug] Found inline fetch source")
		}

		if imageConfig := getNestedMap(fetchMap, "image"); imageConfig != nil {
			config := make(map[string]interface{})
			if url := getNestedString(imageConfig, "url"); url != "" {
				config["url"] = url
			}
			if secretRef := getNestedMap(imageConfig, "secretRef"); secretRef != nil {
				config["secretRef"] = map[string]string{"name": getNestedString(secretRef, "name")}
			}
			if subPath := getNestedString(imageConfig, "subPath"); subPath != "" {
				config["subPath"] = subPath
			}
			if tagSelection := getNestedMap(imageConfig, "tagSelection"); tagSelection != nil {
				config["tagSelection"] = tagSelection
			}
			
			fetchSources = append(fetchSources, CarvelFetchSource{
				Type:   "image",
				Config: config,
				Path:   getNestedString(fetchMap, "path"),
			})
			log.Printf("[Debug] Found image fetch source")
		}

		if imgpkgConfig := getNestedMap(fetchMap, "imgpkgBundle"); imgpkgConfig != nil {
			config := make(map[string]interface{})
			if image := getNestedString(imgpkgConfig, "image"); image != "" {
				config["image"] = image
			}
			if secretRef := getNestedMap(imgpkgConfig, "secretRef"); secretRef != nil {
				config["secretRef"] = map[string]string{"name": getNestedString(secretRef, "name")}
			}
			if tagSelection := getNestedMap(imgpkgConfig, "tagSelection"); tagSelection != nil {
				config["tagSelection"] = tagSelection
			}
			
			fetchSources = append(fetchSources, CarvelFetchSource{
				Type:   "imgpkgBundle",
				Config: config,
				Path:   getNestedString(fetchMap, "path"),
			})
			log.Printf("[Debug] Found imgpkgBundle fetch source")
		}

		if httpConfig := getNestedMap(fetchMap, "http"); httpConfig != nil {
			config := make(map[string]interface{})
			if url := getNestedString(httpConfig, "url"); url != "" {
				config["url"] = url
			}
			if sha256 := getNestedString(httpConfig, "sha256"); sha256 != "" {
				config["sha256"] = sha256
			}
			if secretRef := getNestedMap(httpConfig, "secretRef"); secretRef != nil {
				config["secretRef"] = map[string]string{"name": getNestedString(secretRef, "name")}
			}
			if subPath := getNestedString(httpConfig, "subPath"); subPath != "" {
				config["subPath"] = subPath
			}
			
			fetchSources = append(fetchSources, CarvelFetchSource{
				Type:   "http",
				Config: config,
				Path:   getNestedString(fetchMap, "path"),
			})
			log.Printf("[Debug] Found http fetch source")
		}

		if gitConfig := getNestedMap(fetchMap, "git"); gitConfig != nil {
			config := make(map[string]interface{})
			if url := getNestedString(gitConfig, "url"); url != "" {
				config["url"] = url
			}
			if ref := getNestedString(gitConfig, "ref"); ref != "" {
				config["ref"] = ref
			}
			if secretRef := getNestedMap(gitConfig, "secretRef"); secretRef != nil {
				config["secretRef"] = map[string]string{"name": getNestedString(secretRef, "name")}
			}
			if subPath := getNestedString(gitConfig, "subPath"); subPath != "" {
				config["subPath"] = subPath
			}
			if lfsSkipSmudge, ok := getNestedBool(gitConfig, "lfsSkipSmudge"); ok {
				config["lfsSkipSmudge"] = lfsSkipSmudge
			}
			if forceHTTPBasicAuth, ok := getNestedBool(gitConfig, "forceHTTPBasicAuth"); ok {
				config["forceHTTPBasicAuth"] = forceHTTPBasicAuth
			}
			if refSelection := getNestedMap(gitConfig, "refSelection"); refSelection != nil {
				config["refSelection"] = refSelection
			}
			
			fetchSources = append(fetchSources, CarvelFetchSource{
				Type:   "git",
				Config: config,
				Path:   getNestedString(fetchMap, "path"),
			})
			log.Printf("[Debug] Found git fetch source")
		}

		if helmChartConfig := getNestedMap(fetchMap, "helmChart"); helmChartConfig != nil {
			config := make(map[string]interface{})
			if name := getNestedString(helmChartConfig, "name"); name != "" {
				config["name"] = name
			}
			if version := getNestedString(helmChartConfig, "version"); version != "" {
				config["version"] = version
			}
			if repository := getNestedMap(helmChartConfig, "repository"); repository != nil {
				repoConfig := make(map[string]interface{})
				if url := getNestedString(repository, "url"); url != "" {
					repoConfig["url"] = url
				}
				if secretRef := getNestedMap(repository, "secretRef"); secretRef != nil {
					repoConfig["secretRef"] = map[string]string{"name": getNestedString(secretRef, "name")}
				}
				if len(repoConfig) > 0 {
					config["repository"] = repoConfig
				}
			}
			
			fetchSources = append(fetchSources, CarvelFetchSource{
				Type:   "helmChart",
				Config: config,
				Path:   getNestedString(fetchMap, "path"),
			})
			log.Printf("[Debug] Found helmChart fetch source")
		}
	}

	log.Printf("[Debug] Extracted %d fetch sources from App", len(fetchSources))
	return fetchSources
}

// extractPackageRef extracts packageRef from a PackageInstall
func extractPackageRef(pkgi map[string]interface{}) *CarvelPackageRef {
	packageRef := getNestedMap(pkgi, "spec", "packageRef")
	if packageRef == nil {
		log.Printf("[Debug] No spec.packageRef found in PackageInstall")
		return nil
	}

	refName := getNestedString(packageRef, "refName")
	if refName == "" {
		return nil
	}

	result := &CarvelPackageRef{
		RefName: refName,
	}

	// Extract version constraints
	if versionSelection := getNestedMap(packageRef, "versionSelection"); versionSelection != nil {
		if constraints := getNestedString(versionSelection, "constraints"); constraints != "" {
			result.Constraints = constraints
		}
	}

	log.Printf("[Debug] Extracted packageRef: %s (constraints: %s)", result.RefName, result.Constraints)
	return result
}
