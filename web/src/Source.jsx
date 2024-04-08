import React, { useState, useEffect, useRef } from 'react';
import { ReadyWidget } from './ReadyWidget'
import { ArtifactWidget } from './ArtifactWidget';
import { OCIArtifactWidget } from './OCIArtifactWidget';
import { HelmChartWidget } from './HelmChartWidget';
import { HelmRepositoryWidget } from './HelmRepositoryWidget';

export function Source(props) {
  const { capacitorClient, source, targetReference, handleNavigationSelect } = props;
  const ref = useRef(null);
  const [highlight, setHighlight] = useState(false)

  useEffect(() => {
    const matching = targetReference.objectNs === source.metadata.namespace &&
      targetReference.objectName === source.metadata.name &&
      targetReference.objectKind === source.kind
    setHighlight(matching);
    if (matching) {
      ref.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [source.metadata, source.kind, targetReference]);

  return (
    <div
      ref={ref}
      className={`${highlight ? "ring-2 ring-indigo-600 ring-offset-2" : ""} rounded-md border border-neutral-300 p-4 grid grid-cols-12 gap-x-4 bg-white shadow`}
      key={`${source.kind}/${source.metadata.namespace}/${source.metadata.name}`}
    >
      <div className="col-span-2">
        <span className="block font-medium text-black">
          {source.metadata.name}
        </span>
        <span className="block text-neutral-600">
          {source.metadata.namespace}
        </span>
      </div>
      <div className="col-span-4">
        <ReadyWidget resource={source} displayMessage={true} />
      </div>
      <div className="col-span-5">
        {source.kind === 'GitRepository' &&
          <ArtifactWidget gitRepository={source} displayMessage={true} />
        }
        {source.kind === 'OCIRepository' &&
          <OCIArtifactWidget source={source} displayMessage={true} />
        }
        {source.kind === 'Bucket' &&
          <span>Bucket (TODO)</span>
        }
        {source.kind === 'HelmRepository' &&
          <HelmRepositoryWidget source={source} displayMessage={true} />
        }
        {source.kind === 'HelmChart' &&
          <HelmChartWidget source={source} displayMessage={true} handleNavigationSelect={handleNavigationSelect} />
        }
      </div>
      <div className="grid grid-cols-1 text-right space-y-1">
        <button className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-2 border border-neutral-300 rounded"
          onClick={() => {
            if (source.spec.suspend) {
              // eslint-disable-next-line no-restricted-globals
              confirm(`Are you sure you want to resume ${source.metadata.name}?`) && capacitorClient.resume(source.kind, source.metadata.namespace, source.metadata.name);
            } else {
              // eslint-disable-next-line no-restricted-globals
              confirm(`Are you sure you want to suspend ${source.metadata.name}?`) && capacitorClient.suspend(source.kind, source.metadata.namespace, source.metadata.name);
            }
          }}
        >
          {source.spec.suspend ? "Resume" : "Suspend"}
        </button>
        <button className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-2 border border-neutral-300 rounded"
          onClick={() => capacitorClient.reconcile(source.kind, source.metadata.namespace, source.metadata.name)}
        >
          Reconcile
        </button>
      </div>
    </div>
  )
}