{{/*
Pre-sync schema migration job.

ArgoCD maps Helm pre-install/pre-upgrade hooks to PreSync, so the schema is
brought up to date before the Deployment rolls out. `prisma migrate deploy`
is idempotent, so running it on every sync is safe.
*/}}
{{- define "nexuspay-lib.migrationJob" -}}
{{- if .Values.migrations.enabled }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "nexuspay-lib.fullname" . }}-migrate
  labels:
    {{- include "nexuspay-lib.labels" . | nindent 4 }}
  annotations:
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "-10"
    helm.sh/hook-delete-policy: before-hook-creation
---
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "nexuspay-lib.fullname" . }}-migrate
  labels:
    {{- include "nexuspay-lib.labels" . | nindent 4 }}
  annotations:
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "-5"
    helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded
spec:
  backoffLimit: 2
  template:
    metadata:
      labels:
        {{- include "nexuspay-lib.selectorLabels" . | nindent 8 }}
    spec:
      restartPolicy: Never
      serviceAccountName: {{ include "nexuspay-lib.fullname" . }}-migrate
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}{{ if .Values.image.digest }}@{{ .Values.image.digest }}{{ else }}:{{ .Values.image.tag }}{{ end }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          command:
            {{- toYaml .Values.migrations.command | nindent 12 }}
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.migrations.databaseSecret }}
                  key: {{ .Values.migrations.databaseSecretKey | default "url" }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
{{- end }}
{{- end }}
