export type FluxEvent = {
    type: string
    message: 'Normal' | 'Warning'
    reason: string
    involvedObjectKind: string
    involvedObjectNamespace: string
    involvedObject: string
    eventTime: string
}
