import React, { useState, useRef, useEffect } from 'react';
import { FunnelIcon, XMarkIcon } from '@heroicons/react/24/outline'

function FilterBar({ filters, addFilter, deleteFilter, resetFilters, filterValueByProperty }) {
  return (
    <div className="w-full">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3">
          <FunnelIcon className="h-5 w-5 text-neutral-400" aria-hidden="true" />
          {filters.map(filter => (
            <Filter key={filter.property + filter.value} filter={filter} deleteFilter={deleteFilter} />
          ))}
          <FilterInput addFilter={addFilter} filterValueByProperty={filterValueByProperty} />
        </div>
        <div className="block w-full rounded-lg border-0 bg-white py-1.5 pl-10 pr-3 text-neutral-900 ring-1 ring-inset ring-neutral-300 placeholder:text-neutral-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6">
          &nbsp;
        </div>
        <div className="absolute inset-y-0 right-0 flex items-center p-1">
          <button onClick={resetFilters} className="py-1 px-2 bg-gray-200 text-gray-400 rounded-full text-sm">reset</button>
        </div>
      </div>
    </div>
  )
}

export default FilterBar;

function Filter(props) {
  const { filter } = props;
  return (
    <span className="ml-1 text-blue-50 bg-blue-600 rounded-full pl-3 pr-1" aria-hidden="true">
      <span>{filter.property}</span>: <span>{filter.value}</span>
      <span className="ml-1 px-1 bg-blue-400 rounded-full ">
        <XMarkIcon className="cursor-pointer text-white inline h-3 w-3" aria-hidden="true" onClick={() => props.deleteFilter(filter)}/>
      </span>
    </span>
  )
}

function FilterInput(props) {
  const [active, setActive] = useState(false)
  const [property, setProperty] = useState("")
  const [value, setValue] = useState("")
  const properties=["Service", "Namespace", "Domain"]
  const { addFilter, filterValueByProperty } = props;
	const inputRef = useRef(null);

  const reset = () => {
    setActive(false)
    setProperty("")
    setValue("")
  }

  useEffect(() => {
    if (property !== "") {
      inputRef.current.focus();
    }  
  });

  return (
    <span className="relative w-48 ml-2">
      <span className="items-center flex">
        {property !== "" &&
          <span>{property}: </span>
        }
        <input
          ref={inputRef}
          key={property}
          className={`${property ? "ml-10" : "" }block border-0 border-t border-b border-neutral-300 pt-1.5 pb-1 px-1 text-neutral-900 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6`}
          placeholder='Enter Filter'
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => {setActive(true)}}
          onBlur={() => {
            setTimeout(() => {
              setActive(false);
              if (value !== "") {
                if (property === "") {
                  addFilter({property: "Service", value: value})
                } else {
                  addFilter({property, value})
                }
                reset()
              } else {
                if (property !== "") {
                  reset()
                }
              }
            }, 200);}
          }
          onKeyUp={(e) => {
            if (e.keyCode === 13){
              setActive(false)
              if (property === "") {
                addFilter({property: "Service", value: value})
              } else {
                addFilter({property, value})
              }
              reset()
            }
            if (e.keyCode === 27){
              reset()
              // inputRef.current.blur();
            }
          }}
          type="search"
        />
      </span>
      {active && property === "" &&
        <div className="z-10 absolute bg-blue-100 w-48 p-2 text-blue-800">
          <ul className="">
            {properties.map(p => {
              if (filterValueByProperty(p) !== "") {
                return null;
              }

              return (<li
                key={p}
                className="cursor-pointer hover:bg-blue-200"
                onClick={() => { setProperty(p); setActive(false); }}>
                {p}
              </li>)
            })}
          </ul>
        </div>
      }
    </span>
  )
}
