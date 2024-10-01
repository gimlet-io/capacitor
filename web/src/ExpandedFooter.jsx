import React, { useState } from "react";
import { Kustomizations } from "./Kustomizations";
import { HelmReleases } from "./HelmReleases";
import { TerraformResources } from "./TerraformResources";
import FluxEvents from "./FluxEvents";
import { Sources } from "./Sources";
import { CompactServices } from "./CompactServices";

export function ExpandedFooter(props) {
  const {
    client,
    fluxState,
    sources,
    handleNavigationSelect,
    targetReference,
    selected,
    store,
  } = props;

  const [fluxEvents, setFluxEvents] = useState(store.getState().fluxEvents);
  store.subscribe(() => setFluxEvents(store.getState().fluxEvents));

  return (
    <div className="flex w-full h-full overscroll-contain">
      <div>
        <div className="w-56 px-4 border-r border-neutral-300">
          <SideBar
            navigation={[
              { name: "Sources", href: "#", count: sources.length },
              {
                name: "Kustomizations",
                href: "#",
                count: fluxState.kustomizations.length,
              },
              {
                name: "Helm Releases",
                href: "#",
                count: fluxState.helmReleases.length,
              },
              {
                name: "Terraform",
                href: "#",
                count: fluxState.tfResources.length,
              },
              { name: "Flux Runtime", href: "#", count: undefined },
              { name: "Flux Events", href: "#", count: undefined },
            ]}
            selectedMenu={handleNavigationSelect}
            selected={selected}
          />
        </div>
      </div>

      <div className="w-full px-4 overflow-x-hidden overflow-y-scroll">
        <div className="w-full max-w-7xl mx-auto flex-col h-full">
          <div className="pb-24 pt-2">
            {selected === "Kustomizations" && (
              <Kustomizations
                capacitorClient={client}
                fluxState={fluxState}
                targetReference={targetReference}
                handleNavigationSelect={handleNavigationSelect}
              />
            )}
            {selected === "Helm Releases" && (
              <HelmReleases
                capacitorClient={client}
                helmReleases={fluxState.helmReleases}
                targetReference={targetReference}
                handleNavigationSelect={handleNavigationSelect}
              />
            )}
            {selected === "Terraform" && (
              <TerraformResources
                capacitorClient={client}
                tfResources={fluxState.tfResources}
                targetReference={targetReference}
                handleNavigationSelect={handleNavigationSelect}
              />
            )}
            {selected === "Sources" && (
              <Sources
                capacitorClient={client}
                fluxState={fluxState}
                targetReference={targetReference}
                handleNavigationSelect={handleNavigationSelect}
              />
            )}
            {selected === "Flux Runtime" && (
              <CompactServices
                capacitorClient={client}
                store={store}
                services={fluxState.fluxServices}
              />
            )}
            {selected === "Flux Events" && (
              <FluxEvents
                events={fluxEvents}
                handleNavigationSelect={handleNavigationSelect}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SideBar(props) {
  const { navigation, selectedMenu, selected } = props;

  return (
    <nav className="flex flex-1 flex-col" aria-label="Sidebar">
      <ul className="space-y-1">
        {navigation.map((item) => (
          <li key={item.name}>
            <a
              href={item.href}
              className={classNames(
                item.name === selected
                  ? "bg-white text-black"
                  : "text-neutral-700 hover:bg-white hover:text-black",
                "group flex gap-x-3 p-2 pl-3 text-sm leading-6 rounded-md",
              )}
              onClick={() => selectedMenu(item.name)}
            >
              {item.name}
              {item.count ? (
                <span
                  className="ml-auto w-6 min-w-max whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-center text-xs font-medium leading-5 text-neutral-700 ring-1 ring-inset ring-neutral-200"
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
}

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}
