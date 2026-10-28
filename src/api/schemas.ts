/**
 * Settings 2.0 schemas that replaced the Config API v1 endpoints DMM 1.x used, plus the ones most
 * often copied between environments. Each opens the generic Settings page pre-filtered.
 */
export interface SchemaPreset {
  schemaId: string;
  label: string;
  /** Replaces this Config API v1 endpoint, if any. */
  replaces?: string;
}

export const SCHEMA_PRESETS: SchemaPreset[] = [
  { schemaId: "builtin:tags.auto-tagging", label: "Auto-tag rules", replaces: "/api/config/v1/autoTags" },
  { schemaId: "builtin:alerting.maintenance-window", label: "Maintenance windows", replaces: "/api/config/v1/maintenanceWindows" },
  { schemaId: "builtin:management-zones", label: "Management zones", replaces: "/api/config/v1/managementZones" },
  { schemaId: "builtin:alerting.profile", label: "Alerting profiles", replaces: "/api/config/v1/alertingProfiles" },
  { schemaId: "builtin:problem.notifications", label: "Problem notifications", replaces: "/api/config/v1/notifications" },
  { schemaId: "builtin:anomaly-detection.metric-events", label: "Metric events" },
  { schemaId: "builtin:host.monitoring", label: "Host monitoring (per host)", replaces: "/api/config/v1/hosts/{id}/monitoring" },
  { schemaId: "builtin:host.monitoring.mode", label: "Host monitoring mode (per host)" },
];

export const HOST_MONITORING = "builtin:host.monitoring";
export const HOST_MONITORING_MODE = "builtin:host.monitoring.mode";
