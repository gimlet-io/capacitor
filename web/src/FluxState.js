import React, { useState } from 'react';
import jp from 'jsonpath'

function FluxState(props) {
  const { store } = props

  const [fluxState, setFluxState] = useState(store.getState().fluxState);
  store.subscribe(() => setFluxState(store.getState().fluxState))

  console.log(fluxState)

  return (
    <div>
      <h2 className='text-xl text-red-500'>GitRepositories</h2>
      <table>
        <thead>
        <tr>
          <th>NAMESPACE</th>
          <th>NAME</th>
          <th>URL</th>
          <th>READY</th>
          <th>STATUS</th>
        </tr>
        </thead>
          <tbody>
          {
            fluxState.gitRepositories?.map(gitRepository => {
              const ready = jp.query(gitRepository.status, '$..conditions[?(@.type=="Ready")].status');
              const message = jp.query(gitRepository.status, '$..conditions[?(@.type=="Ready")].message');

              return (
                <tr key={gitRepository.metadata.namespace/gitRepository.metadata.name}>
                  <td>{gitRepository.metadata.namespace}</td>
                  <td>{gitRepository.metadata.name}</td>
                  <td>{gitRepository.spec.url}</td>
                  <td>{ready}</td>
                  <td>{message}</td>
                </tr>
              )
            })
          }
        </tbody>
      </table> 
      <h2>Kustomizations</h2>
      <table>
        <thead>
          <tr>
            <th>NAMESPACE</th>
            <th>NAME</th>
            <th>URL</th>
            <th>READY</th>
            <th>STATUS</th>
          </tr>
        </thead>
        <tbody>
        {
        fluxState.kustomizations?.map(kustomization => {
          const ready = jp.query(kustomization.status, '$..conditions[?(@.type=="Ready")].status');
          const message = jp.query(kustomization.status, '$..conditions[?(@.type=="Ready")].message');

          return (
            <tr key={kustomization.metadata.namespace/kustomization.metadata.name}>
              <td>{kustomization.metadata.namespace}</td>
              <td>{kustomization.metadata.name}</td>
              <td>{kustomization.status.lastAppliedRevision}</td>
              <td>{ready}</td>
              <td>{message}</td>
            </tr>
          )
        })
        }
        </tbody>
      </table>
    </div>
  )
}

export default FluxState;
