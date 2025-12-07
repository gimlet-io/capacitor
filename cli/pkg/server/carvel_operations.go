// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

// handleCarvelAppPause pauses a Carvel App by setting spec.paused=true
func handleCarvelAppPause(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Pausing Carvel App: %s/%s", namespace, name)

	ctx := context.Background()
	patchData := `{"spec":{"paused":true}}`

	appGVR := schema.GroupVersionResource{
		Group:    "kappctrl.k14s.io",
		Version:  "v1alpha1",
		Resource: "apps",
	}

	_, err := proxy.dynamicClient.Resource(appGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(patchData),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error pausing App: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to pause App: %v", err),
			"kind":      "App",
			"name":      name,
			"namespace": namespace,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Successfully paused App %s/%s", namespace, name),
		"action":  "paused",
	})
}

// handleCarvelAppUnpause unpauses a Carvel App by setting spec.paused=false
func handleCarvelAppUnpause(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Unpausing Carvel App: %s/%s", namespace, name)

	ctx := context.Background()
	patchData := `{"spec":{"paused":false}}`

	appGVR := schema.GroupVersionResource{
		Group:    "kappctrl.k14s.io",
		Version:  "v1alpha1",
		Resource: "apps",
	}

	_, err := proxy.dynamicClient.Resource(appGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(patchData),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error unpausing App: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to unpause App: %v", err),
			"kind":      "App",
			"name":      name,
			"namespace": namespace,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Successfully unpaused App %s/%s", namespace, name),
		"action":  "unpaused",
	})
}

// handleCarvelAppCancel cancels a Carvel App by setting spec.canceled=true
func handleCarvelAppCancel(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Canceling Carvel App: %s/%s", namespace, name)

	ctx := context.Background()
	patchData := `{"spec":{"canceled":true}}`

	appGVR := schema.GroupVersionResource{
		Group:    "kappctrl.k14s.io",
		Version:  "v1alpha1",
		Resource: "apps",
	}

	_, err := proxy.dynamicClient.Resource(appGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(patchData),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error canceling App: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to cancel App: %v", err),
			"kind":      "App",
			"name":      name,
			"namespace": namespace,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Successfully canceled App %s/%s", namespace, name),
		"action":  "canceled",
	})
}

// handleCarvelAppUncancel uncancels a Carvel App by setting spec.canceled=false
func handleCarvelAppUncancel(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Uncanceling Carvel App: %s/%s", namespace, name)

	ctx := context.Background()
	patchData := `{"spec":{"canceled":false}}`

	appGVR := schema.GroupVersionResource{
		Group:    "kappctrl.k14s.io",
		Version:  "v1alpha1",
		Resource: "apps",
	}

	_, err := proxy.dynamicClient.Resource(appGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(patchData),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error uncanceling App: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to uncancel App: %v", err),
			"kind":      "App",
			"name":      name,
			"namespace": namespace,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Successfully uncanceled App %s/%s", namespace, name),
		"action":  "uncanceled",
	})
}

// handleCarvelAppTrigger triggers a Carvel App by setting paused=true then paused=false
func handleCarvelAppTrigger(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Triggering Carvel App: %s/%s", namespace, name)

	ctx := context.Background()

	appGVR := schema.GroupVersionResource{
		Group:    "kappctrl.k14s.io",
		Version:  "v1alpha1",
		Resource: "apps",
	}

	// Step 1: Pause the app
	pausePatch := `{"spec":{"paused":true}}`
	_, err := proxy.dynamicClient.Resource(appGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(pausePatch),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error pausing App during trigger: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to trigger App (pause step): %v", err),
			"kind":      "App",
			"name":      name,
			"namespace": namespace,
		})
	}

	// Wait briefly to ensure the pause is processed
	time.Sleep(500 * time.Millisecond)

	// Step 2: Unpause the app to trigger reconciliation
	unpausePatch := `{"spec":{"paused":false}}`
	_, err = proxy.dynamicClient.Resource(appGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(unpausePatch),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error unpausing App during trigger: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to trigger App (unpause step): %v", err),
			"kind":      "App",
			"name":      name,
			"namespace": namespace,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Successfully triggered App %s/%s", namespace, name),
		"action":  "triggered",
	})
}

// handleCarvelPackageInstallPause pauses a PackageInstall by setting spec.paused=true
func handleCarvelPackageInstallPause(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Pausing PackageInstall: %s/%s", namespace, name)

	ctx := context.Background()
	patchData := `{"spec":{"paused":true}}`

	pkgiGVR := schema.GroupVersionResource{
		Group:    "packaging.carvel.dev",
		Version:  "v1alpha1",
		Resource: "packageinstalls",
	}

	_, err := proxy.dynamicClient.Resource(pkgiGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(patchData),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error pausing PackageInstall: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to pause PackageInstall: %v", err),
			"kind":      "PackageInstall",
			"name":      name,
			"namespace": namespace,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Successfully paused PackageInstall %s/%s", namespace, name),
		"action":  "paused",
	})
}

// handleCarvelPackageInstallUnpause unpauses a PackageInstall by setting spec.paused=false
func handleCarvelPackageInstallUnpause(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Unpausing PackageInstall: %s/%s", namespace, name)

	ctx := context.Background()
	patchData := `{"spec":{"paused":false}}`

	pkgiGVR := schema.GroupVersionResource{
		Group:    "packaging.carvel.dev",
		Version:  "v1alpha1",
		Resource: "packageinstalls",
	}

	_, err := proxy.dynamicClient.Resource(pkgiGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(patchData),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error unpausing PackageInstall: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to unpause PackageInstall: %v", err),
			"kind":      "PackageInstall",
			"name":      name,
			"namespace": namespace,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Successfully unpaused PackageInstall %s/%s", namespace, name),
		"action":  "unpaused",
	})
}

// handleCarvelPackageInstallCancel cancels a PackageInstall by setting spec.canceled=true
func handleCarvelPackageInstallCancel(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Canceling PackageInstall: %s/%s", namespace, name)

	ctx := context.Background()
	patchData := `{"spec":{"canceled":true}}`

	pkgiGVR := schema.GroupVersionResource{
		Group:    "packaging.carvel.dev",
		Version:  "v1alpha1",
		Resource: "packageinstalls",
	}

	_, err := proxy.dynamicClient.Resource(pkgiGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(patchData),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error canceling PackageInstall: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to cancel PackageInstall: %v", err),
			"kind":      "PackageInstall",
			"name":      name,
			"namespace": namespace,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Successfully canceled PackageInstall %s/%s", namespace, name),
		"action":  "canceled",
	})
}

// handleCarvelPackageInstallUncancel uncancels a PackageInstall by setting spec.canceled=false
func handleCarvelPackageInstallUncancel(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Uncanceling PackageInstall: %s/%s", namespace, name)

	ctx := context.Background()
	patchData := `{"spec":{"canceled":false}}`

	pkgiGVR := schema.GroupVersionResource{
		Group:    "packaging.carvel.dev",
		Version:  "v1alpha1",
		Resource: "packageinstalls",
	}

	_, err := proxy.dynamicClient.Resource(pkgiGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(patchData),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error uncanceling PackageInstall: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to uncancel PackageInstall: %v", err),
			"kind":      "PackageInstall",
			"name":      name,
			"namespace": namespace,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Successfully uncanceled PackageInstall %s/%s", namespace, name),
		"action":  "uncanceled",
	})
}

// handleCarvelPackageInstallTrigger triggers a PackageInstall by setting paused=true then paused=false
func handleCarvelPackageInstallTrigger(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	name := c.Param("name")

	log.Printf("[Debug] Triggering PackageInstall: %s/%s", namespace, name)

	ctx := context.Background()

	pkgiGVR := schema.GroupVersionResource{
		Group:    "packaging.carvel.dev",
		Version:  "v1alpha1",
		Resource: "packageinstalls",
	}

	// Step 1: Pause the PackageInstall
	pausePatch := `{"spec":{"paused":true}}`
	_, err := proxy.dynamicClient.Resource(pkgiGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(pausePatch),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error pausing PackageInstall during trigger: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to trigger PackageInstall (pause step): %v", err),
			"kind":      "PackageInstall",
			"name":      name,
			"namespace": namespace,
		})
	}

	// Wait briefly to ensure the pause is processed
	time.Sleep(500 * time.Millisecond)

	// Step 2: Unpause the PackageInstall to trigger reconciliation
	unpausePatch := `{"spec":{"paused":false}}`
	_, err = proxy.dynamicClient.Resource(pkgiGVR).Namespace(namespace).Patch(
		ctx,
		name,
		types.MergePatchType,
		[]byte(unpausePatch),
		metav1.PatchOptions{},
	)

	if err != nil {
		log.Printf("Error unpausing PackageInstall during trigger: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error":     fmt.Sprintf("Failed to trigger PackageInstall (unpause step): %v", err),
			"kind":      "PackageInstall",
			"name":      name,
			"namespace": namespace,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Successfully triggered PackageInstall %s/%s", namespace, name),
		"action":  "triggered",
	})
}
