{{/* Naming helpers — evaluated against the CALLING (application) chart's context */}}

{{- define "nexuspay-lib.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "nexuspay-lib.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "nexuspay-lib.labels" -}}
app.kubernetes.io/name: {{ include "nexuspay-lib.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/part-of: nexuspay
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "nexuspay-lib.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nexuspay-lib.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account for the workload
*/}}
{{- define "nexuspay-lib.serviceAccountName" -}}
{{- default (include "nexuspay-lib.fullname" .) .Values.serviceAccount.name }}
{{- end }}
