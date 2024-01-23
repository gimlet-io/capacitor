package logs

import "sync"

type RunningLogStreams struct {
	runningLogStreams map[string]chan int
	lock              sync.Mutex
}

func NewRunningLogStreams() *RunningLogStreams {
	return &RunningLogStreams{
		runningLogStreams: make(map[string]chan int),
	}
}

func (l *RunningLogStreams) register(namespace string, deploymentName string) chan int {
	deployment := namespace + "/" + deploymentName
	stopCh := make(chan int)

	l.lock.Lock()
	l.runningLogStreams[deployment] = stopCh
	l.lock.Unlock()

	return stopCh
}

func (l *RunningLogStreams) Stop(namespace string, deploymentName string) {
	l.lock.Lock()
	for deployment, stopCh := range l.runningLogStreams {
		if deployment == namespace+"/"+deploymentName {
			stopCh <- 0
		}
	}
	l.lock.Unlock()
}

func (l *RunningLogStreams) StopAll() {
	l.lock.Lock()
	for _, stopCh := range l.runningLogStreams {
		stopCh <- 0
	}
	l.lock.Unlock()
}
