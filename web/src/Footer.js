import { XMarkIcon } from '@heroicons/react/24/outline'
import React, { useState } from 'react';
import { GitRepositories, Kustomizations } from './FluxState';

function Footer(props) {
  const { store } = props

  const [expanded, setExpanded] = useState(true);
  const [fluxState, setFluxState] = useState(store.getState().fluxState);
  store.subscribe(() => setFluxState(store.getState().fluxState))

  return (
    <>
    { expanded ?
      <ExpandedFooter fluxState={fluxState} setExpanded={setExpanded} /> :
      <CollapsedFooter fluxState={fluxState} setExpanded={setExpanded} />
    }
    </>
  )
}

function ExpandedFooter(props) {
  const { fluxState, setExpanded } = props;

  // https://blog.stackademic.com/building-a-resizable-sidebar-component-with-persisting-width-using-react-tailwindcss-bdec28a594f
  const navigationDefault = [
    { name: 'Kustomizations', href: '#', count: 10, current: true },
    { name: 'Sources', href: '#', count: '5', current: false },
    { name: 'Runtime', href: '#', current: false },
    { name: 'Logs', href: '#', current: false },
  ]
  
  const [navigation, setNavigation] = useState(navigationDefault);
  
  const navigate = (selected) => {
    const nextNavigation = navigation.map((n) => {
      if (n.name === selected) {
        return {...n, current: true};
      } else {
        return {...n, current: false};
      }
    });
    setNavigation(nextNavigation)
  }
  
  return (
    <div aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
      <div className="fixed inset-x-0 bottom-0 h-2/5 z-40 bg-neutral-200 border-t border-neutral-300">
        <div className="absolute top-0 right-0 px-4 py-2">
          <button
            onClick={() => setExpanded(false)}
            type="button" className="ml-1 rounded-md hover:bg-white hover:text-black text-neutral-700 p-1">
            <span className="sr-only">Close panel</span>
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex pt-10">
          <div>
            <div className="w-48 px-4 border-r border-neutral-300">
              <SideBar navigation={navigation} navigate={navigate} />
            </div>
          </div>
          <div className="w-full px-4 h-[calc(60vh)] overflow-x-hidden overflow-y-scroll">
            <div className="w-full max-w-6xl mx-auto">
            { navigation.find((n) => n.name === "Kustomizations").current &&
              <Kustomizations kustomizations={fluxState.kustomizations} />
            }
            { navigation.find((n) => n.name === "Sources").current &&
              <GitRepositories gitRepositories={fluxState.gitRepositories} />
            }
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CollapsedFooter(props) {
  const { fluxState, setExpanded } = props;

  return (
    <div
      className="fixed inset-x-0 bottom-0 h-16 z-40 bg-neutral-200 border-t border-neutral-300 cursor-pointer"
      onClick={() => setExpanded(true)}
      >
    </div>
  )
}

function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

function SideBar(props) {
  return (
    <nav className="flex flex-1 flex-col" aria-label="Sidebar">
      <ul className="space-y-1">
        {props.navigation.map((item) => (
          <li key={item.name}>
            <a
              href={item.href}
              className={classNames(
                item.current ? 'bg-white text-black' : 'text-neutral-700 hover:bg-white hover:text-black',
                'group flex gap-x-3 p-2 pl-3 text-sm leading-6 rounded-md'
              )}
              onClick={() => props.navigate(item.name)}
            >
              {item.name}
              {item.count ? (
                <span
                  className="ml-auto w-9 min-w-max whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-center text-xs font-medium leading-5 text-neutral-700 ring-1 ring-inset ring-neutral-200"
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
  )
}

export default Footer;
