import React from 'react'
import CapacitorClient from './client'


export type ContextType = {
    client?: CapacitorClient
}

export const Context = React.createContext<ContextType>({});

export const ContextProvider = ({ children, client }) => {
    return (
        <Context.Provider value={{ client }}>
            {children}
        </Context.Provider>
    )
}
export const useClient = (): CapacitorClient => {
    const { client } = React.useContext(Context)
    return client!
}