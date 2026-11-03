{{- define "inio-mcp.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "inio-mcp.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "inio-mcp.labels" -}}
{{ include "inio-mcp.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "inio-mcp.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else if .Values.secret.create -}}
{{- include "inio-mcp.fullname" . -}}
{{- else -}}
{{- fail "Set existingSecret (a Secret with INIO_CLIENT_SECRET and MCP_AUTH_TOKEN), or secret.create=true for tests" -}}
{{- end -}}
{{- end -}}

{{- define "inio-mcp.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) -}}
{{- end -}}
{{- end -}}

{{/* Allowed origins: explicit list, else https:// plus the ingress host and HTTPRoute hostnames. */}}
{{- define "inio-mcp.allowedOrigins" -}}
{{- $origins := .Values.allowedOrigins -}}
{{- if not $origins -}}
{{- if and .Values.ingress.enabled .Values.ingress.host -}}
{{- $origins = append $origins (printf "https://%s" .Values.ingress.host) -}}
{{- end -}}
{{- if .Values.httpRoute.enabled -}}
{{- range .Values.httpRoute.hostnames -}}
{{- $origins = append $origins (printf "https://%s" .) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $origins | uniq | join "," -}}
{{- end -}}

{{/* Public URL of /mcp for OAuth: explicit, else from the ingress host or the first HTTPRoute hostname. */}}
{{- define "inio-mcp.publicUrl" -}}
{{- if .Values.oauth.publicUrl -}}
{{- .Values.oauth.publicUrl -}}
{{- else if and .Values.ingress.enabled .Values.ingress.host -}}
{{- printf "https://%s/mcp" .Values.ingress.host -}}
{{- else if and .Values.httpRoute.enabled .Values.httpRoute.hostnames -}}
{{- printf "https://%s/mcp" (first .Values.httpRoute.hostnames) -}}
{{- else -}}
{{- fail "oauth.issuer needs oauth.publicUrl, ingress.host or an HTTPRoute hostname" -}}
{{- end -}}
{{- end -}}
