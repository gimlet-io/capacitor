{{/*
Expand the name of the chart.
*/}}
{{- define "capacitor-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "capacitor-agent.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "capacitor-agent.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "capacitor-agent.labels" -}}
helm.sh/chart: {{ include "capacitor-agent.chart" . }}
{{ include "capacitor-agent.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "capacitor-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "capacitor-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app: capacitor-next-agent
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "capacitor-agent.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "capacitor-agent.fullname" . ) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

