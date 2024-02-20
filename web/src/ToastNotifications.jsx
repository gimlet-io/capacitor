import { useState } from 'react';
import { ACTION_DISMISS_FLUX_EVENT } from './redux';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Transition } from '@headlessui/react'
import { NavigationButton } from './NavigationButton';

function ToastNotifications(props) {
  const { store, handleNavigationSelect } = props;

  let reduxState = store.getState();
  const [fluxEvents, setFluxEvents] = useState(reduxState.fluxEvents);
  const [dismissedFluxEvents, setDismissedFluxEvents] = useState(reduxState.dismissedFluxEvents);
  store.subscribe(() => setFluxEvents(reduxState.fluxEvents));
  store.subscribe(() => setDismissedFluxEvents(reduxState.dismissedFluxEvents));

  const warningEvents = fluxEvents.filter(e => e.type === "Warning" && !dismissedFluxEvents.some(de => isSameEvent(e, de))).slice(0, 3);

  const dismiss = (event) => {
    store.dispatch({
      type: ACTION_DISMISS_FLUX_EVENT, payload: event
    });
  }

  return (
    <div className="fixed top-0 inset-x-0 z-50 text-center text-gray-700 text-sm space-y-2 max-w-7xl mx-auto py-2">
      {warningEvents.map((e, index) => {
        return (
          <ToastElement event={e} index={index} dismiss={dismiss} handleNavigationSelect={handleNavigationSelect} />
        )
      })}
    </div>
  )
}

function ToastElement(props) {
  const { event, index, dismiss, handleNavigationSelect } = props;
  console.log(event)
  return (
    <Transition
      as="div"
      appear={true}
      show={true}>
      <Transition.Child
        as="div"
        enter="transition ease duration-500 transform"
        enterFrom="opacity-0 -translate-y-12"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease duration-300 transform"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 -translate-y-12"
      >
        <div key={index} className="rounded-md shadow-lg bg-orange-400" role="alert">
          <div className="flex p-4">
            <NavigationButton handleNavigation={() => handleNavigationSelect(event.involvedObjectKind === "Kustomization" ? "Kustomizations" : "Sources", event.involvedObjectNamespace, event.involvedObject, event.involvedObjectKind)}>
              <span className='font-bold'>{event.involvedObjectKind} {event.involvedObjectNamespace}/{event.involvedObject}</span>: {event.message}
            </NavigationButton>
            <div className="ml-auto">
              <button
                className="rounded-md inline-flex focus:outline-none flex-shrink-0 justify-center items-center text-white/[.5] hover:text-white transition-all"
                onClick={() => dismiss(event)}
              >
                <span className="sr-only">Close</span>
                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </Transition.Child>
    </Transition>
  )
}

const isSameEvent = (a, b) => {
  return a.involvedObjectKind === b.involvedObjectKind &&
    a.involvedObjectNamespace === b.involvedObjectNamespace &&
    a.involvedObject === b.involvedObject &&
    a.reason === b.reason &&
    a.message === b.message;
}

export default ToastNotifications;
