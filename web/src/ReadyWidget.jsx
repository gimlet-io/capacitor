import React, { useState, useEffect, useRef } from 'react';
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
  const reconciling = reconcilingCondition && reconcilingConditions[0].status === "True"    

  const color = ready ? "bg-teal-400" : (reconciling || dependencyNotReady) && !stalled ? "bg-blue-400 animate-pulse" : "bg-orange-400 animate-pulse"
  const statusLabel = ready ? label ? label : "Ready" : (reconciling || dependencyNotReady) && !stalled ? "Reconciling" : "Error"
  const messageColor = ready ? "text-neutral-600 field" : (reconciling || dependencyNotReady) && !stalled ? "text-neutral-600" : "bg-orange-400"

  return (
    <div className="relative">
      <div className='font-medium text-neutral-700'>
        <span className={`absolute -left-4 top-1 rounded-full h-3 w-3 ${color} inline-block`}></span>
        <span>{statusLabel}</span>
        {readyCondition &&
          <TimeLabel title={exactDate} date={parsed} />
        }
      </div>
      {displayMessage && readyCondition &&
        <div className={`block ${messageColor}`}>
          {reconciling &&
            <p>{reconcilingCondition.message}</p>
          }
          {dependencyNotReady &&
            <p>Dependency not ready</p>
          }
          <p>{readyCondition.message}</p>
        </div>
      }
    </div>

  )
}
