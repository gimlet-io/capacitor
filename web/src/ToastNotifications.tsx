import { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Transition } from '@headlessui/react'
import { NavigationButton } from './NavigationButton.tsx';
import { Store } from 'redux';
import React from 'react';

export type ToastNotificationsProps = {
  store: Store
  handleNavigationSelect: any
}
function ToastNotifications(props: ToastNotificationsProps) {
  const { store, handleNavigationSelect } = props;

  let reduxState = store.getState();
  const [fluxEvents, setFluxEvents] = useState(reduxState.fluxEvents);
  const [dismissed, setDismissed] = useState(JSON.parse(localStorage.getItem("dismissed")?? '[]'))
  store.subscribe(() => setFluxEvents(reduxState.fluxEvents));

  useEffect(() => {
    localStorage.setItem("dismissed", JSON.stringify(dismissed));
  }, [dismissed]);

  useEffect(() => {
    setDismissed(dismissed.filter(d => {
      const parsed = Date.parse(d.firstTimestamp, "yyyy-MM-dd'T'HH:mm:ss");
      const day = 24 * 60 * 60 * 1000;
      return (Date.now() - parsed) < day
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = (event) => {
    setDismissed([...dismissed, event]);
  }

  const warningEvents = fluxEvents.filter(e => e.type === "Warning" && !dismissed.some(d => isSameEvent(e, d))).slice(0, 3);

  return (
    <div className="fixed top-0 inset-x-0 z-50 text-center text-gray-700 text-sm space-y-2 max-w-7xl mx-auto py-2">
      {warningEvents.map((e, index) => {
        return (
          <ToastElement key={index} event={e} dismiss={dismiss} handleNavigationSelect={handleNavigationSelect} />
        )
      })}
    </div>
  )
}

function ToastElement(props) {
  const { event, dismiss, handleNavigationSelect } = props;
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
        <div className="rounded-md shadow-lg bg-orange-400" role="alert">
          <div className="flex p-4">
            <NavigationButton handleNavigation={() => handleNavigationSelect(event.involvedObjectKind === "Kustomization" ? "Kustomizations" : "Sources", event.involvedObjectNamespace, event.involvedObject, event.involvedObjectKind)}>
              <p className="break-all line-clamp-3"><span className='font-bold'>{event.involvedObjectKind} {event.involvedObjectNamespace}/{event.involvedObject}</span>: {event.message}</p>
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
