import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/24/outline';
import React, { memo, useMemo, useState } from 'react';
import { Summary } from './Summary.tsx';
import { ExpandedFooter } from "./ExpandedFooter.tsx"
import { Store } from 'redux';
import { TargetReference } from './types/targetReference.ts';
import { Source } from './types/source.ts';

interface FooterProps {
  store: Store
  expanded: boolean
  selected: string
  targetReference: TargetReference | null,
  handleToggle: () => void
  handleNavigationSelect: (selectedNav, objectNs, objectName, objectKind) => void
}

const Footer = memo(function Footer(props: FooterProps) {
  const { store, expanded, selected, targetReference, handleToggle, handleNavigationSelect } = props;


  const [fluxState, setFluxState] = useState(store.getState().fluxState);
  store.subscribe(() => setFluxState(store.getState().fluxState))

  const sources = useMemo(() => {
    const sources: Source[] = [];

    if (fluxState.ociRepositories) {
      sources.push(...fluxState.ociRepositories)
      sources.push(...fluxState.gitRepositories)
      sources.push(...fluxState.buckets)
      sources.push(...fluxState.helmRepositories)
      sources.push(...fluxState.helmCharts)
    }
    return [...sources].sort((a, b) => (a.metadata?.name || '').localeCompare(b.metadata?.name || ''));
  }, [fluxState]);

  return (
    <div aria-labelledby="slide-over-title" role="dialog" aria-modal="true" className={`fixed inset-x-0 bottom-0 bg-neutral-200 border-t border-neutral-300 ${expanded ? 'h-4/5' : 'h-16'}`}>
      <div className={`flex justify-between w-full ${expanded ? '' : 'h-full'}`}>
        <div
          className='h-auto w-full cursor-pointer px-16 py-4 flex gap-x-12'
          onClick={handleToggle} >
          {!expanded &&
            <>
              <div>
                <Summary resources={sources} label="SOURCES" />
              </div>
              <div>
                <Summary resources={fluxState.kustomizations} label="KUSTOMIZATIONS" />
              </div>
              <div className="col-span-4">
                <Summary resources={fluxState.helmReleases} label="HELM-RELEASES" />
              </div>
            </>
          }
        </div>
        <div className='px-4 py-2'>
          <button
            onClick={handleToggle}
            type="button" className="ml-1 rounded-md hover:bg-white hover:text-black text-neutral-700 p-1">
            <span className="sr-only">{expanded ? 'Close panel' : 'Open panel'}</span>
            {expanded ? <ArrowDownIcon className="h-5 w-5" aria-hidden="true" /> : <ArrowUpIcon className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>
      {expanded &&
        <ExpandedFooter
          handleNavigationSelect={handleNavigationSelect}
          targetReference={targetReference}
          fluxState={fluxState}
          sources={sources}
          selected={selected}
          store={store}
        />
      }
    </div>
  )
})

export default Footer;
