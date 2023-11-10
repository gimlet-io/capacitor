import React, { memo } from 'react';



export const SideBar = memo(function SideBar(props) {

    function classNames(...classes) {
        return classes.filter(Boolean).join(' ')
    }

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
    );
});