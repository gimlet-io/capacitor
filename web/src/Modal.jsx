import React, { useEffect, useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

export function Modal(props) {
  const { stopHandler, children } = props;
  const logsEndRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = '15px';
    return () => { document.body.style.overflow = 'unset'; document.body.style.paddingRight = '0px' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logsEndRef.current.scrollIntoView();
  }, [children]);

  return (
    <div
      className="fixed flex inset-0 z-10 bg-gray-500 bg-opacity-75"
      onClick={stopHandler}
    >
      <div className="flex self-center items-center justify-center w-full p-8 h-4/5">
        <div className="transform flex flex-col overflow-hidden bg-slate-600 rounded-xl h-4/5 max-h-full w-4/5 pt-8"
          onClick={e => e.stopPropagation()}
        >
          <div className="absolute top-0 right-0 p-1.5">
            <button
              className="rounded-md inline-flex text-gray-200 hover:text-gray-500 focus:outline-none"
              onClick={stopHandler}
            >
              <span className="sr-only">Close</span>
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="h-full relative overflow-y-auto p-4 bg-slate-800 rounded-b-lg font-normal">
            {children}
            <p ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
