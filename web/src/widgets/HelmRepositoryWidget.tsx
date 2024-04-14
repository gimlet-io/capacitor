import { HelmRepository } from '@kubernetes-models/flux-cd/source.toolkit.fluxcd.io/v1beta2'
import React from 'react'

export type HelmRepositoryWidgetProps = {
  source: HelmRepository
}
export function HelmRepositoryWidget(props: HelmRepositoryWidgetProps) {
  const { source } = props

  return (
    <>
      {source.spec?.url}
    </>
  )
}
