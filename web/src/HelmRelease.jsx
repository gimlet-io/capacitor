import React, { useState, useRef, useEffect } from 'react';
import { ReadyWidget } from './ReadyWidget'
import { HelmRevisionWidget } from './HelmRevisionWidget';

export function HelmRelease(props) {
  const { capacitorClient, item, targetReference, handleNavigationSelect } = props;
  const ref = useRef(null);
  const [highlight, setHighlight] = useState(false)

  useEffect(() => {
    const matching = targetReference.objectNs === item.metadata.namespace && targetReference.objectName === item.metadata.name
    setHighlight(matching);
    if (matching) {
      ref.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [item.metadata, targetReference]);

  return (
    <div
      ref={ref}
      className={`${highlight ? "ring-2 ring-indigo-600 ring-offset-2" : ""} ${item.spec.suspend ? "bg-neutral-400" : ""} rounded-md border border-neutral-300 p-4 grid grid-cols-12 gap-x-4 bg-white shadow`}
      key={`hr-${item.metadata.namespace}/${item.metadata.name}`}
    >
      <div className="col-span-2">
        <span className="block font-medium text-black">
          {item.metadata.name}
        </span>
        <span className="block text-neutral-600">
          {item.metadata.namespace}
        </span>
      </div>
      <div className="col-span-4">
        <span className="block"><ReadyWidget resource={item} displayMessage={true} label="Reconciled" /></span>
      </div>
      <div className="col-span-5">
        <div className="font-medium text-neutral-700"><HelmRevisionWidget helmRelease={item} withHistory={true} handleNavigationSelect={handleNavigationSelect} /></div>
      </div>
      <div className="grid grid-cols-1 text-right space-y-1">
        <button className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-2 border border-neutral-300 rounded"
          onClick={() => {
            if (item.spec.suspend) {
              // eslint-disable-next-line no-restricted-globals
              confirm(`Are you sure you want to resume ${item.metadata.name}?`) && capacitorClient.resume("helmrelease", item.metadata.namespace, item.metadata.name);
            } else {
              // eslint-disable-next-line no-restricted-globals
              confirm(`Are you sure you want to suspend ${item.metadata.name}?`) && capacitorClient.suspend("helmrelease", item.metadata.namespace, item.metadata.name);
            }
          }}
        >
          {item.spec.suspend ? "Resume" : "Suspend"}
        </button>
        <button className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-2 border border-neutral-300 rounded"
          onClick={() => capacitorClient.reconcile("helmrelease", item.metadata.namespace, item.metadata.name)}
        >
          Reconcile
        </button>
      </div>
    </div>)
}
