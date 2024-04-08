import jp from 'jsonpath'
import { format } from "date-fns";
import { TimeLabel } from './TimeLabel'

export function ReadyWidget(props) {
  const { resource, displayMessage, label } = props

  const readyConditions = jp.query(resource.status, '$..conditions[?(@.type=="Ready")]');
  const readyCondition = readyConditions.length === 1 ? readyConditions[0] : undefined
  const ready = readyCondition && readyConditions[0].status === "True"

  const dependencyNotReady = readyCondition && readyCondition.reason === "DependencyNotReady"

  const readyTransitionTime = readyCondition ? readyCondition.lastTransitionTime : undefined
  const parsed = Date.parse(readyTransitionTime, "yyyy-MM-dd'T'HH:mm:ss");
  const exactDate = format(parsed, 'MMMM do yyyy, h:mm:ss a O')
  const fiveMinutesAgo = new Date();
  fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
  const stalled = fiveMinutesAgo > parsed

  const reconcilingConditions = jp.query(resource.status, '$..conditions[?(@.type=="Reconciling")]');
  const reconcilingCondition = reconcilingConditions.length === 1 ? reconcilingConditions[0] : undefined
  const reconciling = reconcilingCondition && reconcilingCondition.status === "True"    

  const fetchFailedConditions = jp.query(resource.status, '$..conditions[?(@.type=="FetchFailed")]');
  const fetchFailedCondition = fetchFailedConditions.length === 1 ? fetchFailedConditions[0] : undefined
  const fetchFailed = fetchFailedCondition && fetchFailedCondition.status === "True"  


  var [color,statusLabel,messageColor] = ['','','']
  const readyLabel = label ? label : "Ready"
  if (resource.kind === 'GitRepository' || resource.kind === "OCIRepository" || resource.kind === "Bucket" || resource.kind === "HelmRepository" || resource.kind === "HelmChart") {
    color = fetchFailed ? "bg-orange-400 animate-pulse" : reconciling ? "bg-blue-400 animate-pulse" : ready ? "bg-teal-400" : "bg-orange-400 animate-pulse"
    statusLabel = fetchFailed ? "Error" : reconciling ?  "Reconciling" : ready ? readyLabel : "Error"
    messageColor = fetchFailed ? "bg-orange-400" : reconciling ?  "text-neutral-600" : ready ? "text-neutral-600 field" : "bg-orange-400"
  } else {
    color = ready ? "bg-teal-400" : (reconciling || dependencyNotReady) && !stalled ? "bg-blue-400 animate-pulse" : "bg-orange-400 animate-pulse"
    statusLabel = ready ? readyLabel : (reconciling || dependencyNotReady) && !stalled ? "Reconciling" : "Error"
    messageColor = ready ? "text-neutral-600 field" : (reconciling || dependencyNotReady) && !stalled ? "text-neutral-600" : "bg-orange-400"
  }

  return (
    <div className="relative">
      <div className='font-medium text-neutral-700'>
        <span className={`absolute -left-4 top-1 rounded-full h-3 w-3 ${color} inline-block`}></span>
        <span>{statusLabel}</span>
        {readyCondition &&
          <span className='ml-1'><TimeLabel title={exactDate} date={parsed} /> ago</span>
        }
      </div>
      {displayMessage && readyCondition &&
        <div className={`${messageColor}`}>
          {reconciling &&
            <span title={reconcilingCondition.message}>{reconcilingCondition.message}</span>
          }
          {dependencyNotReady &&
            <span>Dependency not ready</span>
          }
          <span title={readyCondition.message}>{readyCondition.message}</span>
        </div>
      }
    </div>

  )
}
