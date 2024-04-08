export function HelmRepositoryWidget(props) {
  const { source } = props

  return (
    <>
      {source.spec.url}
    </>
  )
}
