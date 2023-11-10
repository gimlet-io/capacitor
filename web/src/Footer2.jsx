import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/24/outline';
import React, { memo, useState } from 'react';
import { useCallback } from 'react';
import { GitRepositories, Kustomizations } from './FluxState';
import { SideBar } from './Sidebar';


export const Footer2 = memo(function Footer2(props) {

    const { store } = props

    const [expanded, setExpanded] = useState(false);
    const [fluxState, setFluxState] = useState(store.getState().fluxState);
    store.subscribe(() => setFluxState(store.getState().fluxState))


  // https://blog.stackademic.com/building-a-resizable-sidebar-component-with-persisting-width-using-react-tailwindcss-bdec28a594f
  const navigationDefault = [
    { name: 'Kustomizations', href: '#', count: 10 },
    { name: 'Sources', href: '#', count: '5'},
    { name: 'Runtime', href: '#' },
    { name: 'Logs', href: '#' },
  ]

  const [selected, setSelected] = useState('Kustomizations');

  const handlerSelect = useCallback((selectedNav) => {
    setSelected(selectedNav);
  },
    [setSelected]
  )

    return (
        <div aria-labelledby="slide-over-title" role="dialog" aria-modal="true" className={`fixed inset-x-0 bottom-0 bg-neutral-200 border-t border-neutral-300 ${expanded ? 'h-2/5' : 'h-16'}`}>
            <div className={`flex justify-between w-full ${expanded ? '' : 'h-full'}`}>
                <div className='h-auto w-full cursor-pointer'
                 onClick={() => setExpanded(!expanded)}>

                </div>
                <div className='px-4 py-2'>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        type="button" className="ml-1 rounded-md hover:bg-white hover:text-black text-neutral-700 p-1">
                        <span className="sr-only">{expanded ? 'Close panel' : 'Open panel'}</span>
                        {expanded ? <ArrowDownIcon className="h-5 w-5" aria-hidden="true" /> : <ArrowUpIcon className="h-5 w-5" aria-hidden="true" />}
                    </button>
                </div>
            </div>
            {expanded &&
                <div className="flex w-full h-full">
                    <div className="w-48 px-4 border-r border-neutral-300">
                            <SideBar navigation={navigationDefault} selectedMenu={handlerSelect} selected={selected}/>
                    </div>

                    <div className="w-full px-4 overflow-x-hidden overflow-y-scroll mb-20">
                        <div className="w-full max-w-6xl mx-auto flex-col h-full">
                            { selected === "Kustomizations" &&
                                <Kustomizations fluxState={fluxState} />
                            }
                            { selected === "Sources" &&
                                <GitRepositories gitRepositories={fluxState.gitRepositories} />
                            }
                        </div>
                    </div>
                </div>
            }
        </div>
    )

});
