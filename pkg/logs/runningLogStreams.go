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

func (l *RunningLogStreams) register(namespace string, serviceName string) chan int {
	svc := namespace + "/" + serviceName
	stopCh := make(chan int)

	l.lock.Lock()
	l.runningLogStreams[svc] = stopCh
	l.lock.Unlock()

	return stopCh
}

func (l *RunningLogStreams) Stop(namespace string, serviceName string) {
	l.lock.Lock()
	for svc, stopCh := range l.runningLogStreams {
		if svc == namespace+"/"+serviceName {
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
