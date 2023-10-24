import { XMarkIcon } from '@heroicons/react/24/outline'
import { ArrowUpRightIcon } from '@heroicons/react/24/outline'

// https://blog.stackademic.com/building-a-resizable-sidebar-component-with-persisting-width-using-react-tailwindcss-bdec28a594f

const navigation = [
  { name: 'Sources', href: '#', count: '5', current: true },
  { name: 'Kustomizations', href: '#', count: 10, current: false },
  { name: 'Runtime', href: '#', current: false },
  { name: 'Logs', href: '#', current: false },
]

function Footer() {
  return (
    <div aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
      <div className="fixed inset-x-0 bottom-0 h-2/5 z-40 bg-zinc-900 text-gray-300 shadow-xl">
        <div className="absolute top-0 right-0 p-4">
          <button
            onClick={() => console.log("close")}
            type="button" className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
            <span className="sr-only">Close panel</span>
            <ArrowUpRightIcon className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            onClick={() => console.log("close")}
            type="button" className="ml-2 rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
            <span className="sr-only">Close panel</span>
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className='w-48 px-4 mt-4 border-r-2 border-red-600'>
          <SideBar navigation={navigation} />
        </div>
      </div>
    </div>
  )
}

function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

function SideBar(props) {
  return (
    <nav className="flex flex-1 flex-col" aria-label="Sidebar">
      <ul role="list" className="-mx-2 space-y-1">
        {props.navigation.map((item) => (
          <li key={item.name}>
            <a
              href={item.href}
              className={classNames(
                item.current ? 'bg-gray-50 text-indigo-600' : 'text-gray-700 hover:text-indigo-600 hover:bg-gray-50',
                'group flex gap-x-3 p-2 pl-3 text-sm leading-6 font-semibold'
              )}
            >
              {item.name}
              {item.count ? (
                <span
                  className="ml-auto w-9 min-w-max whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-center text-xs font-medium leading-5 text-gray-600 ring-1 ring-inset ring-gray-200"
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
