import { useState, useEffect } from 'react'
import { FunnelIcon } from '@heroicons/react/24/outline'

export default function ResourceFilter(props) {
  const { changeHandler } = props;
  const [filters, setFilters] = useState([
    { name: "Show all", selected: true },
    { name: "Filter errors", selected: false },
  ]);

  useEffect(() => {
    changeHandler(filters[1].selected)
  });

  const filterHandler = (filter) => {
    setFilters(filters.map(f => {
      if (f.name === filter) {
        return { ...f, selected: true }
      } else {
        return { ...f, selected: false }
      }
    }))
  }

  return (
    <div className="w-full">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3">
          <FunnelIcon className="h-5 w-5 text-neutral-400" aria-hidden="true" />
          {filters.map(filter => (
            <button className={(filter.selected ? "text-blue-50 bg-blue-600" : "bg-gray-200 text-gray-400") + " ml-1 rounded-full px-3"}
              onClick={() => filterHandler(filter.name)}
            >
              {filter.name}
            </button>
          ))}
        </div>
        <div className="block w-full rounded-lg border-0 bg-white py-1.5 pl-10 pr-3 text-neutral-900 ring-1 ring-inset ring-neutral-300 placeholder:text-neutral-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6">
          &nbsp;
        </div>
      </div>
    </div>
  )
}
