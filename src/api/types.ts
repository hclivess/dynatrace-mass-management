/** Shapes of the Dynatrace responses DMM reads. Only the fields the UI uses are typed. */

export interface TokenInfo {
  id: string;
  name: string;
  enabled: boolean;
  personalAccessToken?: boolean;
  scopes: string[];
  expirationDate?: string;
  owner?: string;
}

export interface ApiToken extends TokenInfo {
  creationDate?: string;
  lastUsedDate?: string;
  personalAccessToken?: boolean;
}

export interface Tag {
  context: string;
  key: string;
  value?: string;
  stringRepresentation: string;
}

export interface Entity {
  entityId: string;
  displayName: string;
  type?: string;
  firstSeenTms?: number;
  lastSeenTms?: number;
  tags?: Tag[];
  properties?: Record<string, unknown>;
  managementZones?: { id: string; name: string }[];
  fromRelationships?: Record<string, { id: string; type: string }[]>;
  toRelationships?: Record<string, { id: string; type: string }[]>;
}

export interface SchemaStub {
  schemaId: string;
  displayName: string;
  latestSchemaVersion: string;
}

export interface Schema extends SchemaStub {
  description?: string;
  version?: string;
  allowedScopes?: string[];
  multiObject?: boolean;
  ordered?: boolean;
  properties?: Record<string, { displayName?: string; type?: unknown; description?: string }>;
}

export interface SettingsObject {
  objectId: string;
  schemaId: string;
  schemaVersion?: string;
  scope: string;
  summary?: string;
  value: Record<string, unknown>;
  modificationInfo?: { lastModifiedTime?: number; lastModifiedBy?: string; createdTime?: number; createdBy?: string };
}

export interface SettingsWrite {
  schemaId: string;
  scope: string;
  value: unknown;
  schemaVersion?: string;
  /** Present to update an existing object in a batch write. */
  objectId?: string;
  externalId?: string;
}

export interface SettingsWriteResult {
  code: number;
  objectId?: string;
  error?: { code: number; message: string; constraintViolations?: { path?: string; message?: string }[] };
}

export interface Problem {
  problemId: string;
  displayId: string;
  title: string;
  status: "OPEN" | "CLOSED";
  severityLevel: string;
  impactLevel: string;
  startTime: number;
  endTime: number;
  affectedEntities?: { entityId: { id: string }; name: string }[];
  rootCauseEntity?: { name: string } | null;
  managementZones?: { name: string }[];
}

export interface DtEvent {
  eventId: string;
  eventType: string;
  title: string;
  startTime: number;
  endTime?: number;
  status?: string;
  entityId?: { name?: string; entityId?: { id: string } };
  properties?: { key: string; value: string }[];
}

export interface EventIngest {
  eventType: string;
  title: string;
  entitySelector?: string;
  startTime?: number;
  endTime?: number;
  timeout?: number;
  properties?: Record<string, string>;
}

export interface MetricDescriptor {
  metricId: string;
  displayName?: string;
  unit?: string;
  description?: string;
}

export interface MetricSeries {
  dimensions: string[];
  dimensionMap?: Record<string, string>;
  timestamps: number[];
  values: (number | null)[];
}

export interface MetricQueryResult {
  resolution: string;
  totalCount?: number;
  warnings?: string[];
  result: { metricId: string; data: MetricSeries[]; warnings?: string[] }[];
}

export interface Slo {
  id: string;
  name: string;
  enabled: boolean;
  status: "SUCCESS" | "WARNING" | "FAILURE" | string;
  evaluatedPercentage: number;
  errorBudget: number;
  target: number;
  warning: number;
  timeframe: string;
  metricExpression?: string;
  filter?: string;
  description?: string;
  error?: string;
}

export interface SecurityProblem {
  securityProblemId: string;
  displayId: string;
  title: string;
  status: string;
  muted: boolean;
  technology?: string;
  vulnerabilityType?: string;
  cveIds?: string[];
  firstSeenTimestamp?: number;
  riskAssessment?: { riskLevel: string; riskScore: number };
}

export type MuteReason = "CONFIGURATION_NOT_AFFECTED" | "FALSE_POSITIVE" | "IGNORE" | "OTHER" | "VULNERABLE_CODE_NOT_IN_USE";

export interface ActiveGate {
  id: string;
  hostname: string;
  version: string;
  type: string;
  osType: string;
  networkZone?: string;
  group?: string;
  mainEnvironment?: string;
  connectedHosts?: { number: number };
  autoUpdateStatus?: string;
  offlineSince?: number | null;
  modules?: { type: string; enabled: boolean; misconfigured?: boolean }[];
}

export interface NetworkZone {
  id: string;
  description?: string;
  alternativeZones?: string[];
  numOfOneAgentsUsing?: number;
  numOfConfiguredOneAgents?: number;
  numOfOneAgentsFromOtherZones?: number;
  numOfConfiguredActiveGates?: number;
}

export interface Extension {
  extensionName: string;
  version: string;
  author?: { name?: string };
  dataSources?: string[];
  active?: boolean;
}

export interface AuditEntry {
  logId: string;
  eventType: string;
  category: string;
  entityId?: string;
  environmentId?: string;
  user: string;
  userType?: string;
  userOrigin?: string;
  timestamp: number;
  success: boolean;
  message?: string;
}

export interface OneAgentHost {
  hostInfo: { entityId: string; displayName: string; consumedHostUnits?: string | number; osType?: string; monitoringMode?: string };
  active?: boolean;
  monitoringType?: string;
  availabilityState?: string;
  agentVersion?: { major: number; minor: number; revision: number } | null;
  updateStatus?: string;
}

export interface DashboardStub {
  id: string;
  name: string;
  owner?: string;
}

export interface SyntheticMonitor {
  entityId: string;
  name: string;
  type: string;
  enabled: boolean;
}

export interface Release {
  releaseEntityId?: string;
  name: string;
  product?: string;
  version: string;
  stage?: string;
  instances?: { entityId: string }[];
  problemCount?: number;
  securityVulnerabilitiesCount?: number;
  throughput?: number;
}

export interface LogRecord {
  timestamp: number;
  content: string;
  status?: string;
  additionalColumns?: Record<string, string[]>;
}
