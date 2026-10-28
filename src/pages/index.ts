import type { FunctionComponent } from "preact";
import { Dashboards, RequestNaming } from "./Configuration";
import { Entities } from "./Entities";
import { Events } from "./Events";
import { Hosts } from "./Hosts";
import { ActiveGates, Extensions, NetworkZones, Synthetic } from "./Infrastructure";
import { Metrics } from "./Metrics";
import { Audit, Logs, Releases, Tokens } from "./Operations";
import { Overview } from "./Overview";
import { Problems } from "./Problems";
import { Slos, Vulnerabilities } from "./Reliability";
import { Settings } from "./Settings";

export interface PageDef {
  path: string;
  label: string;
  group: string;
  icon: string;
  component: FunctionComponent;
  /** Works across all environments rather than the selected one. */
  global?: boolean;
  /** Classic-token scopes, any one of which lets the page read its data. */
  scopes?: string[];
}

export const PAGES: PageDef[] = [
  { path: "/", icon: "overview", label: "All environments", group: "Overview", component: Overview, global: true },
  { path: "/hosts", icon: "hosts", label: "Hosts", group: "Infrastructure", component: Hosts, scopes: ["entities.read"] },
  { path: "/activegates", icon: "activegates", label: "ActiveGates", group: "Infrastructure", component: ActiveGates, scopes: ["activeGates.read"] },
  { path: "/network-zones", icon: "network", label: "Network zones", group: "Infrastructure", component: NetworkZones, scopes: ["networkZones.read"] },
  { path: "/synthetic", icon: "synthetic", label: "Synthetic monitors", group: "Infrastructure", component: Synthetic, scopes: ["ReadSyntheticData", "ExternalSyntheticIntegration"] },
  { path: "/problems", icon: "problems", label: "Problems", group: "Observe", component: Problems, scopes: ["problems.read"] },
  { path: "/events", icon: "events", label: "Events", group: "Observe", component: Events, scopes: ["events.read"] },
  { path: "/metrics", icon: "metrics", label: "Metric explorer", group: "Observe", component: Metrics, scopes: ["metrics.read"] },
  { path: "/logs", icon: "logs", label: "Log search", group: "Observe", component: Logs, scopes: ["logs.read"] },
  { path: "/slos", icon: "slos", label: "SLOs", group: "Observe", component: Slos, scopes: ["slo.read"] },
  { path: "/releases", icon: "releases", label: "Releases", group: "Observe", component: Releases, scopes: ["releases.read"] },
  { path: "/settings", icon: "settings", label: "Settings 2.0", group: "Configuration", component: Settings, scopes: ["settings.read"] },
  { path: "/entities", icon: "entities", label: "Entities & tags", group: "Configuration", component: Entities, scopes: ["entities.read"] },
  { path: "/dashboards", icon: "dashboards", label: "Dashboards", group: "Configuration", component: Dashboards, scopes: ["ReadConfig"] },
  { path: "/request-naming", icon: "naming", label: "Request naming", group: "Configuration", component: RequestNaming, scopes: ["ReadConfig"] },
  { path: "/extensions", icon: "extensions", label: "Extensions", group: "Configuration", component: Extensions, scopes: ["extensions.read"] },
  { path: "/vulnerabilities", icon: "vulnerabilities", label: "Vulnerabilities", group: "Security", component: Vulnerabilities, scopes: ["securityProblems.read"] },
  { path: "/tokens", icon: "tokens", label: "API tokens", group: "Security", component: Tokens, scopes: ["apiTokens.read"] },
  { path: "/audit", icon: "audit", label: "Audit log", group: "Security", component: Audit, scopes: ["auditLogs.read"] },
];
