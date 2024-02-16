import {Fragment, useEffect, useState} from 'react'
import {Listbox, Transition} from '@headlessui/react'
import {CheckIcon, ChevronUpDownIcon} from '@heroicons/react/24/outline'

export default function Dropdown(props) {
  const {changeHandler} = props;
  const [selected, setSelected] = useState("Show All")
  const items = ["Show All", "Show Errors"];

  useEffect(() => {
    if (selected === "Show All") {
      changeHandler(false)
    } else {
      changeHandler(true)
    }
  });

  return (
    <Listbox value={selected} onChange={setSelected}>
      {({open}) => (
        <>
          <div className="mt-1 relative">
            <Listbox.Button
              className="bg-white relative w-full border border-gray-300 rounded-md shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              <span className="block truncate">{selected}</span>
              <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true"/>
              </span>
            </Listbox.Button>

            <Transition
              show={open}
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Listbox.Options
                static
                className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm"
              >
                {items.map((item) => (
                  <Listbox.Option
                    key={item}
                    className={({active}) =>
                      (active ? 'text-white bg-indigo-600' : 'text-gray-900') +
                        ' cursor-default select-none relative py-2 pl-3 pr-9'
                    }
                    value={item}
                  >
                    {({selected, active}) => (
                      <>
                        <span className={(selected ? 'font-semibold' : 'font-normal') + ' block truncate'}>
                          {item}
                        </span>

                        {selected ? (
                          <span
                            className={(active ? 'text-white' : 'text-indigo-600') +
                              ' absolute inset-y-0 right-0 flex items-center pr-4'
                            }
                          >
                            <CheckIcon className="h-5 w-5" aria-hidden="true"/>
                          </span>
                        ) : null}
                      </>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </Transition>
          </div>
        </>
      )}
    </Listbox>
  )
}
