import React from 'react'
import { NavigationButton } from '../NavigationButton.tsx'
import { HelmChart } from '@kubernetes-models/flux-cd/source.toolkit.fluxcd.io/v1beta2'

export type HelmChartWidgetProps = {
  source: HelmChart
  handleNavigationSelect: (kind, namespace, name, type) => void
}

export function HelmChartWidget(props: HelmChartWidgetProps) {

  const { source, handleNavigationSelect } = props
  const sourceRef = source.spec?.sourceRef
  const artifact = source.status?.artifact
  const revision = artifact?.revision

  const navigationHandler = () => handleNavigationSelect("Sources", source.metadata?.namespace, sourceRef?.name, sourceRef?.kind)

  return (
    <>
      <NavigationButton handleNavigation={navigationHandler}>
        <div className='text-left'>{source.spec?.chart}@{revision} ({`${source.metadata?.namespace}/${sourceRef?.name}`})</div>
      </NavigationButton>
    </>
  )
}
