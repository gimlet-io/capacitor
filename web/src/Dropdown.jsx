import { Fragment, useState, useEffect } from 'react'
import { Transition, Listbox } from '@headlessui/react'
import { ChevronUpDownIcon } from '@heroicons/react/24/outline'

export default function Dropdown(props) {
  const { changeHandler } = props;
  const [filters, setFilters] = useState([
    { name: "Show all", value: true },
    { name: "Show errors", value: false },
  ]);

  useEffect(() => {
    changeHandler(filters[1].value)
  });

  const filterHandler = (filter) => {
    setFilters(filters.map(f => {
      if (f.name === filter) {
        return { ...f, value: true }
      } else {
        return { ...f, value: false }
      }
    }))
  }

  const selected = filters.find(f => f.value)

  return (
    <Listbox value={selected.name} onChange={filterHandler}>
      {({ open }) => (
        <>
          <div className="mt-1 relative">
            <Listbox.Button
              className="bg-white relative w-full border border-gray-300 rounded-md shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none sm:text-sm">
              <span className="block truncate">{selected.name}</span>
              <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
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
                {filters.map((item) => (
                  <Listbox.Option
                    key={item.name}
                    className={({ active }) =>
                      (active ? 'cursor-pointer text-white bg-indigo-600' : 'text-gray-900') +
                      ' cursor-default select-none relative py-2 pl-3 pr-9'
                    }
                    value={item.name}
                  >
                    {({ selected, active }) => (
                      <>
                        <span className={(selected ? 'font-semibold' : 'font-normal') + ' block truncate'}>
                          {item.name}
                        </span>

                        {selected ? (
                          <span
                            className={(active ? 'text-white' : 'text-indigo-600') +
                              ' absolute inset-y-0 right-0 flex items-center pr-4'
                            }
                          >
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
