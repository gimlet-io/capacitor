package flux

import (
	"context"
	"fmt"

	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"sigs.k8s.io/cli-utils/pkg/object"
)

var (
	kustomizationGVR = schema.GroupVersionResource{
		Group:    "kustomize.toolkit.fluxcd.io",
		Version:  "v1",
		Resource: "kustomizations",
	}

	gitRepositoryGVR = schema.GroupVersionResource{
		Group:    "source.toolkit.fluxcd.io",
		Version:  "v1",
		Resource: "gitrepositories",
	}
)

type FluxState struct {
	GitRepositories []sourcev1.GitRepository        `json:"gitRepositories"`
	Kustomizations  []kustomizationv1.Kustomization `json:"kustomizations"`
}

func GetFluxInventory(dc *dynamic.DynamicClient) ([]string, error) {
	inventory := []string{}

	kustomizations, err := dc.Resource(kustomizationGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, k := range kustomizations.Items {
		unstructured := k.UnstructuredContent()
		var kustomization kustomizationv1.Kustomization
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &kustomization)
		if err != nil {
			return nil, err
		}

		for _, entry := range kustomization.Status.Inventory.Entries {
			fmt.Println(entry)
			objMeta, err := object.ParseObjMetadata(entry.ID)
			if err != nil {
				return nil, err
			}
			fmt.Println(objMeta)

			// inventory = append(inventory, objMeta)
		}
	}

	return inventory, nil
}

func GetFluxState(dc *dynamic.DynamicClient) (*FluxState, error) {
	fluxState := &FluxState{
		GitRepositories: []sourcev1.GitRepository{},
		Kustomizations:  []kustomizationv1.Kustomization{},
	}

	gitRepositories, err := dc.Resource(gitRepositoryGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	for _, repo := range gitRepositories.Items {
		unstructured := repo.UnstructuredContent()
		var gitRepository sourcev1.GitRepository
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &gitRepository)
		if err != nil {
			return nil, err
		}
		fluxState.GitRepositories = append(fluxState.GitRepositories, gitRepository)
	}

	kustomizations, err := dc.Resource(kustomizationGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, k := range kustomizations.Items {
		unstructured := k.UnstructuredContent()
		var kustomization kustomizationv1.Kustomization
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &kustomization)
		if err != nil {
			return nil, err
		}
		fluxState.Kustomizations = append(fluxState.Kustomizations, kustomization)
	}

	return fluxState, nil
}
