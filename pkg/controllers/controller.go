package controllers

import (
	"fmt"
	"time"

	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	log "github.com/sirupsen/logrus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	converterRuntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/runtime"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/workqueue"
)

var serverStartTime time.Time

// Controller demonstrates how to implement a controller with client-go.
type Controller struct {
	name         string
	indexer      cache.Indexer
	queue        workqueue.RateLimitingInterface
	informer     cache.Controller
	eventHandler func(informerEvent Event, objectMeta metav1.ObjectMeta, obj interface{}) error
}

func NewDynamicController(
	name string,
	dynamicClient dynamic.Interface,
	resource schema.GroupVersionResource,
	eventHandler func(informerEvent Event, objectMeta metav1.ObjectMeta, obj interface{}) error,
) *Controller {
	queue := workqueue.NewRateLimitingQueue(workqueue.DefaultControllerRateLimiter())
	var informerEvent Event
	var err error

	dynInformer := dynamicinformer.NewDynamicSharedInformerFactory(dynamicClient, 0)
	informer := dynInformer.ForResource(resource).Informer()
	informer.AddIndexers(cache.Indexers{})
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			informerEvent.Key, err = cache.MetaNamespaceKeyFunc(obj)
			informerEvent.EventType = "create"
			if err == nil {
				queue.Add(informerEvent)
			}
		},
		UpdateFunc: func(old interface{}, new interface{}) {
			informerEvent.Key, err = cache.MetaNamespaceKeyFunc(old)
			informerEvent.EventType = "update"
			if err == nil {
				queue.Add(informerEvent)
			}
		},
		DeleteFunc: func(obj interface{}) {
			informerEvent.Key, err = cache.DeletionHandlingMetaNamespaceKeyFunc(obj)
			informerEvent.EventType = "delete"
			if err == nil {
				queue.Add(informerEvent)
			}
		},
	})

	return &Controller{
		name:         name,
		informer:     informer,
		indexer:      informer.GetIndexer(),
		queue:        queue,
		eventHandler: eventHandler,
	}
}

// Event indicate the informerEvent
type Event struct {
	Key       string
	EventType string
}

func (c *Controller) processNextItem() bool {
	// Wait until there is a new item in the working queue
	informerEvent, quit := c.queue.Get()
	if quit {
		return false
	}
	// Tell the queue that we are done with processing this key. This unblocks the key for other workers
	// This allows safe parallel processing because two pods with the same key are never processed in
	// parallel.
	defer c.queue.Done(informerEvent)

	obj, _, err := c.indexer.GetByKey(informerEvent.(Event).Key)
	if err != nil {
		log.Errorf("Fetching object with key %s from store failed with %v", informerEvent.(Event).Key, err)
		return true
	}

	objectMeta := getObjectMetaData(obj)

	// don't process events from before agent start
	// startup sends the complete cluster state upstream
	if informerEvent.(Event).EventType == "create" &&
		objectMeta.CreationTimestamp.Sub(serverStartTime).Seconds() < 0 {
		return true
	}

	// Invoke the method containing the business logic
	err = c.eventHandler(informerEvent.(Event), objectMeta, obj)
	// Handle the error if something went wrong during the execution of the business logic
	c.handleErr(err, informerEvent)
	return true
}

// handleErr checks if an error happened and makes sure we will retry later.
func (c *Controller) handleErr(err error, key interface{}) {
	if err == nil {
		// Forget about the #AddRateLimited history of the key on every successful synchronization.
		// This ensures that future processing of updates for this key is not delayed because of
		// an outdated error history.
		c.queue.Forget(key)
		return
	}

	// This controller retries 5 times if something goes wrong. After that, it stops trying.
	if c.queue.NumRequeues(key) < 5 {
		log.Infof("Error syncing pod %v: %v", key, err)

		// Re-enqueue the key rate limited. Based on the rate limiter on the
		// queue and the re-enqueue history, the key will be processed later again.
		c.queue.AddRateLimited(key)
		return
	}

	c.queue.Forget(key)
	// Report to an external entity that, even after several retries, we could not successfully process this key
	runtime.HandleError(err)
	log.Infof("Dropping pod %q out of the queue: %v", key, err)
}

// Run begins watching and syncing.
func (c *Controller) Run(threadiness int, stopCh chan struct{}) {
	defer runtime.HandleCrash()

	// Let the workers stop when we are done
	defer c.queue.ShutDown()
	log.Infof("Starting %s controller", c.name)
	serverStartTime = time.Now().Local()

	go c.informer.Run(stopCh)

	// Wait for all involved caches to be synced, before processing items from the queue is started
	if !cache.WaitForCacheSync(stopCh, c.informer.HasSynced) {
		runtime.HandleError(fmt.Errorf("Timed out waiting for caches to sync"))
		return
	}

	for i := 0; i < threadiness; i++ {
		go wait.Until(c.runWorker, time.Second, stopCh)
	}

	<-stopCh
	log.Infof("Stopping %s controller", c.name)
}

func (c *Controller) runWorker() {
	for c.processNextItem() {
	}
}

func getObjectMetaData(obj interface{}) metav1.ObjectMeta {
	var objectMeta metav1.ObjectMeta

	unstructuredObj, ok := obj.(*unstructured.Unstructured)
	if !ok {
		return objectMeta
	}
	unstructured := unstructuredObj.UnstructuredContent()

	var gitRepository sourcev1.GitRepository
	err := converterRuntime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &gitRepository)
	if err != nil {
		return objectMeta
	} else {
		return gitRepository.ObjectMeta
	}
}
