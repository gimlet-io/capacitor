import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/24/outline';
import React, { memo, useState } from 'react';
import { GitRepositories, Kustomizations, HelmReleases, Summary } from './FluxState';

const Footer = memo(function Footer(props) {
  
  const { store, expanded, selected, targetReference, handleToggle, handleNavigationSelect } = props;

  const [fluxState, setFluxState] = useState(store.getState().fluxState);
  store.subscribe(() => setFluxState(store.getState().fluxState))

  return (
    <div aria-labelledby="slide-over-title" role="dialog" aria-modal="true" className={`fixed inset-x-0 bottom-0 bg-neutral-200 border-t border-neutral-300 ${expanded ? 'h-4/5' : 'h-16'}`}>
      <div className={`flex justify-between w-full ${expanded ? '' : 'h-full'}`}>
        <div
          className='h-auto w-full cursor-pointer px-16 py-4 flex gap-x-12'
          onClick={handleToggle} >
          { !expanded &&
          <>
          <div>
            <Summary resources={fluxState.gitRepositories} label="SOURCES" />
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
        <div className="flex w-full h-full">
          <div>
            <div className="w-56 px-4 border-r border-neutral-300">
              <SideBar
                navigation={[
                  { name: 'Sources', href: '#', count: fluxState.gitRepositories.length },
                  { name: 'Kustomizations', href: '#', count: fluxState.kustomizations.length },
                  { name: 'Helm Releases', href: '#', count: fluxState.helmReleases.length },
                  { name: 'Flux Runtime', href: '#' },
                ]}
                selectedMenu={handleNavigationSelect}
                selected={selected}
              />
            </div>
          </div>

          <div className="w-full px-4 overflow-x-hidden overflow-y-scroll">
            <div className="w-full max-w-6xl mx-auto flex-col h-full">
              <div className="pb-24">
              { selected === "Kustomizations" &&
                <Kustomizations fluxState={fluxState} targetReference={targetReference} handleNavigationSelect={handleNavigationSelect} />
              }
              { selected === "Helm Releases" &&
                <HelmReleases helmReleases={fluxState.helmReleases} targetReference={targetReference} handleNavigationSelect={handleNavigationSelect} />
              }
              { selected === "Sources" &&
                <GitRepositories gitRepositories={fluxState.gitRepositories} targetReference={targetReference} handleNavigationSelect={handleNavigationSelect} />
              }
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  )
})

function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

function SideBar(props) {
  const { navigation, selectedMenu, selected } = props;

  return (
    <nav className="flex flex-1 flex-col" aria-label="Sidebar">
      <ul className="space-y-1">
        {navigation.map((item) => (
          <li key={item.name}>
            <a
              href={item.href}
              className={classNames(item.name === selected ? 'bg-white text-black' : 'text-neutral-700 hover:bg-white hover:text-black',
                  'group flex gap-x-3 p-2 pl-3 text-sm leading-6 rounded-md')}
              onClick={() => selectedMenu(item.name)}
            >
              {item.name}
              {item.count ? (
                <span
                  className="ml-auto w-6 min-w-max whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-center text-xs font-medium leading-5 text-neutral-700 ring-1 ring-inset ring-neutral-200"
                  aria-hidden="true"
                >
                  {item.count}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default Footer;
