import { NavigationButton } from './NavigationButton'

function FluxEvents(props) {
  const { events, handleNavigationSelect } = props

  return (
    <div className="flow-root bg-white p-4 rounded-lg">
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full py-2 align-middle">
          <table className="min-w-full divide-y divide-gray-300">
            <thead>
              <tr>
                <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0">
                  Last Seen
                </th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Object
                </th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Type
                </th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Reason
                </th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Message
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {events.map((e) => (
                <tr key={e.lastSeen} className={e.type === "Warning" ? "bg-orange-400" : ""}>
                  <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">
                    {e.lastSeen}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    <NavigationButton handleNavigation={() => handleNavigationSelect(e.involvedObjectKind === "Kustomization" ? "Kustomizations" : "Sources", e.involvedObjectNamespace, e.involvedObject, e.involvedObjectKind)}>
                      {e.involvedObjectKind}: {e.involvedObjectNamespace}/{e.involvedObject}
                    </NavigationButton>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{e.type}</td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{e.reason}</td>
                  <td className="px-3 py-4 text-sm text-gray-500">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default FluxEvents;
