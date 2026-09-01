{{- define "nexuspay-lib.service" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "nexuspay-lib.fullname" . }}
  labels:
    {{- include "nexuspay-lib.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - name: http
      port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
  selector:
    {{- include "nexuspay-lib.selectorLabels" . | nindent 4 }}
{{- end }}

{{- define "nexuspay-lib.hpa" -}}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "nexuspay-lib.fullname" . }}
  labels:
    {{- include "nexuspay-lib.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "nexuspay-lib.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
    {{- if .Values.autoscaling.targetMemoryUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetMemoryUtilizationPercentage }}
    {{- end }}
{{- end }}

{{- define "nexuspay-lib.pdb" -}}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "nexuspay-lib.fullname" . }}
  labels:
    {{- include "nexuspay-lib.labels" . | nindent 4 }}
spec:
  maxUnavailable: {{ .Values.podDisruptionBudget.maxUnavailable }}
  selector:
    matchLabels:
      {{- include "nexuspay-lib.selectorLabels" . | nindent 6 }}
{{- end }}

{{/*
NetworkPolicy. Mode "gateway-only": ingress allowed only from pods labeled
app.kubernetes.io/name: api-gateway plus same-namespace health checks.
Mode "open": all ingress allowed (used for the gateway itself).
Egress is unrestricted by default; tighten via .Values.networkPolicy.egressRules.
*/}}
{{- define "nexuspay-lib.networkpolicy" -}}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "nexuspay-lib.fullname" . }}
  labels:
    {{- include "nexuspay-lib.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      {{- include "nexuspay-lib.selectorLabels" . | nindent 6 }}
  policyTypes:
    - Ingress
  ingress:
    {{- if eq .Values.networkPolicy.mode "gateway-only" }}
    - from:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              app.kubernetes.io/name: api-gateway
      ports:
        - protocol: TCP
          port: {{ .Values.service.port }}
    {{- else }}
    - ports:
        - protocol: TCP
          port: {{ .Values.service.port }}
    {{- end }}
{{- end }}

{{- define "nexuspay-lib.servicemonitor" -}}
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "nexuspay-lib.fullname" . }}
  labels:
    {{- include "nexuspay-lib.labels" . | nindent 4 }}
    release: kube-prometheus-stack
spec:
  selector:
    matchLabels:
      {{- include "nexuspay-lib.selectorLabels" . | nindent 6 }}
  endpoints:
    - port: http
      path: /metrics
      interval: {{ .Values.serviceMonitor.interval }}
{{- end }}
