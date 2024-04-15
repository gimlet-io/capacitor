import { NavigationButton } from './NavigationButton'

export function HelmChartWidget(props) {
  const { source, handleNavigationSelect } = props

  const sourceRef = source.spec.sourceRef
  const artifact = source.status.artifact
  const revision = artifact?.revision || 'unknown'

  const navigationHandler = () => handleNavigationSelect("Sources", source.metadata.namespace, sourceRef.name, sourceRef.kind)

  return (
    <>
      <NavigationButton handleNavigation={navigationHandler}>
        <div className='text-left'>{source.spec.chart}@{revision} ({`${source.metadata.namespace}/${sourceRef.name}`})</div>
      </NavigationButton>
    </>
  )
}
