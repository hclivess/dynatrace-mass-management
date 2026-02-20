"""
Dynatrace Management Portal - Tornado web application.

Refactored:
- Async handlers using the async DynatraceClient
- POST for all state-changing operations (add/delete users, tags, etc.)
- Handler factory (make_list_handler) eliminates repeated boilerplate
- No global mutable state races
- Environment selection stored per-session (cookie-based)
"""

import asyncio
import json
import logging
import webbrowser
from datetime import datetime
from pathlib import Path

import tornado.web

from dt_client import DynatraceClient, DtEnvironment, DtAccountManagement, extract_emails
from dt_secrets import load_secrets  # renamed from 'secrets' to avoid stdlib shadow

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application state (replaces global Environment class)
# ---------------------------------------------------------------------------

class AppState:
    """Holds loaded secrets and per-environment client cache."""

    def __init__(self, secrets: dict):
        self.secrets = secrets
        self.environments: dict[str, dict] = {
            env["account"]: env for env in secrets.get("environments", [])
        }
        self.account_mgmt = DtAccountManagement(
            account_uuid=secrets["account_management"]["account"],
            client_id=secrets["account_management"]["client_id"],
            client_secret=secrets["account_management"]["secret"],
        )
        self._clients: dict[str, DynatraceClient] = {}

    def get_client(self, account_id: str) -> DynatraceClient | None:
        """Get or create a DynatraceClient for the given environment."""
        if account_id not in self.environments:
            return None
        if account_id not in self._clients:
            env_cfg = self.environments[account_id]
            env = DtEnvironment(
                name=env_cfg["name"],
                account=env_cfg["account"],
                api_token=env_cfg["secret"],
            )
            self._clients[account_id] = DynatraceClient(env, self.account_mgmt)
        return self._clients[account_id]


# ---------------------------------------------------------------------------
# Base handler with environment resolution
# ---------------------------------------------------------------------------

class BaseHandler(tornado.web.RequestHandler):

    @property
    def app_state(self) -> AppState:
        return self.application.app_state

    def get_current_env_id(self) -> str | None:
        return self.get_cookie("dt_env")

    def get_client(self) -> DynatraceClient | None:
        env_id = self.get_current_env_id()
        if not env_id:
            return None
        return self.app_state.get_client(env_id)

    def require_env(self) -> DynatraceClient:
        """Return client or redirect to home. Use in handlers."""
        client = self.get_client()
        if not client:
            self.redirect("/")
            return None
        return client

    def env_display_name(self) -> str:
        env_id = self.get_current_env_id()
        if env_id and env_id in self.app_state.environments:
            env = self.app_state.environments[env_id]
            return f'{env["name"]} - {env["account"]}'
        return ""


# ---------------------------------------------------------------------------
# Handler factory — eliminates ~15 identical handler classes
# ---------------------------------------------------------------------------

def make_list_handler(template: str, fetcher: str, **extra_render_kwargs):
    """
    Factory for the repeated pattern:
        get client → call one async method → render template with result.

    fetcher uses dot notation to resolve the callable on the client:
        "dashboards.list"        → client.dashboards.list()
        "list_activegates"       → client.list_activegates()
        "get_security_problems"  → client.get_security_problems()

    Extra render kwargs are passed through to self.render() (e.g. convert_ts=...).
    """

    class _ListHandler(BaseHandler):
        async def get(self):
            client = self.require_env()
            if not client:
                return

            # Resolve "dashboards.list" → client.dashboards.list
            obj = client
            for attr in fetcher.split("."):
                obj = getattr(obj, attr)
            data = await obj()

            self.render(template, data=data, name=self.env_display_name(),
                        **extra_render_kwargs)

    _ListHandler.__name__ = _ListHandler.__qualname__ = f"{fetcher}_handler"
    return _ListHandler


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def convert_ts(ts):
    """Convert millisecond timestamp to datetime."""
    try:
        return datetime.fromtimestamp(ts / 1000)
    except (TypeError, ValueError, OSError):
        return ts


def json_encode(obj):
    """JSON-encode for template use."""
    return json.dumps(obj, indent=2, default=str)


# ---------------------------------------------------------------------------
# Generated handlers — one line each instead of 8-line classes
# ---------------------------------------------------------------------------

DashboardsHandler = make_list_handler("dashboards.html", "dashboards.list")
TokensHandler = make_list_handler("tokens.html", "api_tokens.list")
SecurityHandler = make_list_handler("security.html", "get_security_problems")
SLOHandler = make_list_handler("slos.html", "list_slos")
ActiveGatesHandler = make_list_handler("activegates.html", "list_activegates")


# ---------------------------------------------------------------------------
# Explicit handlers — these have custom logic beyond simple list+render
# ---------------------------------------------------------------------------

class MainHandler(BaseHandler):
    def get(self):
        self.render("home.html",
                    environments=list(self.app_state.environments.values()))


class EnvironmentHandler(BaseHandler):
    def get(self):
        account = self.get_argument("account", "")
        if account in self.app_state.environments:
            self.set_cookie("dt_env", account)
        self.redirect("/portal")


class PortalHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return
        groups = await client.list_groups()
        self.render("portal.html",
                    groups=groups,
                    name=self.env_display_name())


class AccountsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return
        groups = await client.list_groups()
        self.render("accounts.html", groups=groups)


# -- User management (POST for mutations) -----------------------------------

class AddUsersHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return

        emails_raw = self.get_argument("emails", "")
        group_uuids = self.get_arguments("group")
        emails = extract_emails(emails_raw)

        added_users = []
        assigned_groups = []

        for email in emails:
            resp = await client.add_user(email)
            if resp.success:
                added_users.append(email)

            if group_uuids:
                grp_resp = await client.assign_groups(email, group_uuids)
                if grp_resp.success and group_uuids not in assigned_groups:
                    assigned_groups.extend(group_uuids)

        self.render("result.html",
                    data={"added_users": added_users, "assigned_groups": assigned_groups})


class DeleteUsersHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return

        emails_raw = self.get_argument("emails", "")
        emails = extract_emails(emails_raw)

        deleted_users = []
        for email in emails:
            resp = await client.delete_user(email)
            if resp.success:
                deleted_users.append(email)

        self.render("result.html", data={"deleted_users": deleted_users})


# -- Host management ---------------------------------------------------------

class HostsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        resp = await client.get_hosts_since(months=7)
        hosts = []
        host_groups = []

        if resp.success and isinstance(resp.data, dict):
            hosts = resp.data.get("hosts", [])
            seen_groups = set()
            for host in hosts:
                hg = host.get("hostInfo", {}).get("hostGroup")
                if hg and hg.get("meId") not in seen_groups:
                    host_groups.append(hg)
                    seen_groups.add(hg["meId"])

        self.render("hosts.html",
                    data=hosts,
                    name=self.env_display_name(),
                    host_groups=host_groups)


class _HostToggleHandler(BaseHandler):
    """Base for enable/disable host monitoring — DRYs the shared logic."""
    _enable: bool = True

    async def post(self):
        client = self.require_env()
        if not client:
            return

        host_group = self.get_argument("host_group", "")
        resp = await client.get_hosts_since(months=7)
        results = {}

        toggle = client.enable_host_monitoring if self._enable else client.disable_host_monitoring
        action = "enabled" if self._enable else "disabled"

        if resp.success and isinstance(resp.data, dict):
            for host in resp.data.get("hosts", []):
                try:
                    info = host.get("hostInfo", {})
                    if info.get("hostGroup", {}).get("meId") == host_group:
                        toggle_resp = await toggle(info["entityId"])
                        results[info.get("displayName", info["entityId"])] = {
                            "status": toggle_resp.status_code,
                            "success": toggle_resp.success,
                        }
                except Exception as e:
                    logger.exception("Error toggling host monitoring")

        self.render("result.html", data={f"{action}_hosts": results})


class EnableHostsHandler(_HostToggleHandler):
    _enable = True


class DisableHostsHandler(_HostToggleHandler):
    _enable = False


# -- Tenant details ----------------------------------------------------------

class TenantDetailsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        resp = await client.get_connection_info()
        self.render("tenant_details.html",
                    data=resp.data if resp.success else {"error": resp.error},
                    name=self.env_display_name())


# -- Tags --------------------------------------------------------------------

class TagsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        resp = await client.get_tags('type("HOST")')
        self.render("tags.html",
                    custom_host_tags=resp.data if resp.success else {},
                    name=self.env_display_name())


class AddTagsHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return

        try:
            tags = json.loads(self.get_argument("tags", "{}"))
            hosts = [h.strip() for h in self.get_argument("hosts", "").split(",") if h.strip()]
        except json.JSONDecodeError:
            self.render("result.html", data={"error": "Invalid JSON in tags"})
            return

        results = {}
        for host in hosts:
            tag_list = [{"key": k, "value": v} for k, v in tags.items()]
            selector = f'type("HOST"),entityName.equals("{host}")'
            resp = await client.add_tags(selector, tag_list)
            results[host] = "OK" if resp.success else resp.error

        self.render("result.html", data=results)


class RemoveTagsHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return

        tag_keys = [t.strip() for t in self.get_argument("tags", "").split(",") if t.strip()]
        hosts = [h.strip() for h in self.get_argument("hosts", "").split(",") if h.strip()]

        results = {}
        for host in hosts:
            for tag_key in tag_keys:
                selector = f'type("HOST"),entityName.equals("{host}")'
                resp = await client.delete_tag(selector, tag_key)
                results[f"{host}/{tag_key}"] = "OK" if resp.success else resp.error

        self.render("result.html", data=results)


# -- Request naming ----------------------------------------------------------

class RequestNamesHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        rules = await client.request_naming.list()
        enriched = []
        for rule in rules:
            detail_resp = await client.request_naming.get(rule["id"])
            rule["details"] = detail_resp.data if detail_resp.success else None
            enriched.append(rule)

        self.render("request_names.html",
                    request_names=enriched,
                    name=self.env_display_name())


class DeleteRequestNameHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return

        rule_id = self.get_argument("id", "")
        resp = await client.request_naming.delete(rule_id)
        self.render("result.html",
                    data={rule_id: resp.status_code})


class AddRequestNameHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return

        try:
            data = json.loads(self.get_argument("data", "{}"))
        except json.JSONDecodeError:
            self.render("result.html", data={"error": "Invalid JSON"})
            return

        resp = await client.request_naming.create(data)
        self.render("result.html",
                    data={"result": resp.status_code, "success": resp.success})


# -- Audit log (paginated) ---------------------------------------------------

class AuditHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        time_range = self.get_argument("range", "now-14d")
        filter_str = self.get_argument("filter", "")

        audit_entries = await client.get_audit_log(from_ts=time_range, filter_str=filter_str)
        self.render("audit.html",
                    data={"auditLogs": audit_entries, "totalCount": len(audit_entries)},
                    time_range=time_range,
                    filter_str=filter_str,
                    name=self.env_display_name(),
                    convert_ts=convert_ts)


# -- Entities (paginated) ----------------------------------------------------

class EntitiesHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        selector = self.get_argument("selector", "").strip()

        if selector:
            entities = await client.get_entities(selector, fields="+tags")
            self.render("entities.html",
                        entities=entities, types=None, selector=selector,
                        name=self.env_display_name())
        else:
            entity_types = await client.get_entity_types()
            self.render("entities.html",
                        entities=None, types=entity_types, selector="",
                        name=self.env_display_name())


# -- Problems ----------------------------------------------------------------

class ProblemsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        time_range = self.get_argument("range", "now-2h")
        problems = await client.get_problems(from_ts=time_range)
        self.render("problems.html",
                    data=problems,
                    name=self.env_display_name(),
                    convert_ts=convert_ts)


class CloseProblemHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        problem_id = self.get_argument("problem_id", "")
        resp = await client.close_problem(problem_id, message="Closed via DMM Portal")
        if resp.success:
            self.redirect("/problems")
        else:
            self.render("result.html", data={"error": resp.error})


# -- Metrics -----------------------------------------------------------------

class MetricsHandler(BaseHandler):
    # Map time ranges to sensible chart resolutions
    _auto_resolution = {
        "now-1h": "1m",    # 60 points
        "now-6h": "5m",    # 72 points
        "now-24h": "15m",  # 96 points
        "now-7d": "1h",    # 168 points
        "now-30d": "6h",   # 120 points
    }

    async def get(self):
        client = self.require_env()
        if not client:
            return

        selector = self.get_argument("selector", "")
        time_range = self.get_argument("range", "now-24h")
        resolution = self.get_argument("resolution", "auto")

        if selector:
            # "auto" = pick resolution that gives good chart density
            api_resolution = (
                self._auto_resolution.get(time_range, "1h")
                if resolution == "auto"
                else resolution
            )
            resp = await client.query_metrics(
                selector, from_ts=time_range, resolution=api_resolution,
            )
            data = resp.data if resp.success else {"error": resp.error}
        else:
            metrics = await client.list_metrics()
            data = {"metrics": metrics, "totalCount": len(metrics)}

        self.render("metrics.html",
                    data=data,
                    selector=selector,
                    time_range=time_range,
                    resolution=resolution,
                    name=self.env_display_name(),
                    json_encode=json_encode,
                    convert_ts=convert_ts)


# -- Settings ----------------------------------------------------------------

class SettingsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        schema_id = self.get_argument("schema_id", "").strip()

        if schema_id:
            objects = await client.get_settings_objects(schema_id)
            self.render("settings.html",
                        schemas=None, objects=objects, schema_id=schema_id,
                        name=self.env_display_name(),
                        json_encode=json_encode)
        else:
            schemas = await client.list_settings_schemas()
            self.render("settings.html",
                        schemas=schemas, objects=None, schema_id="",
                        name=self.env_display_name(),
                        json_encode=json_encode)


# -- Network zones (create/delete) -------------------------------------------

class NetworkZonesHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        resp = await client.list_network_zones()
        self.render("network_zones.html",
                    data=resp.data if resp.success else {},
                    name=self.env_display_name())


class CreateNetworkZoneHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        zone_id = self.get_argument("zone_id", "").strip()
        description = self.get_argument("description", "").strip()
        alt_raw = self.get_argument("alt_zones", "").strip()
        alt_zones = [z.strip() for z in alt_raw.split(",") if z.strip()] if alt_raw else None

        if not zone_id:
            self.render("result.html", data={"error": "Zone ID is required"})
            return

        resp = await client.create_network_zone(zone_id, description=description,
                                                 alternative_zones=alt_zones)
        if resp.success:
            self.redirect("/network_zones")
        else:
            self.render("result.html", data={"error": resp.error})


class DeleteNetworkZoneHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        zone_id = self.get_argument("zone_id", "")
        resp = await client.delete_network_zone(zone_id)
        if resp.success:
            self.redirect("/network_zones")
        else:
            self.render("result.html", data={"error": resp.error})


# -- Auto-tags (enriched, delete, export, import) ----------------------------

class AutoTagsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        tags = await client.auto_tags.list()
        enriched = []
        for tag in tags:
            detail = await client.auto_tags.get(tag["id"])
            tag["details"] = detail.data if detail.success else None
            enriched.append(tag)

        self.render("auto_tags.html",
                    data=enriched,
                    name=self.env_display_name())


class DeleteAutoTagHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        tag_id = self.get_argument("id", "")
        resp = await client.auto_tags.delete(tag_id)
        if resp.success:
            self.redirect("/auto_tags")
        else:
            self.render("result.html", data={"error": resp.error})


class AutoTagExportHandler(BaseHandler):
    """Export a single auto-tag rule as JSON download."""
    async def get(self):
        client = self.require_env()
        if not client:
            return
        tag_id = self.get_argument("id", "")
        resp = await client.auto_tags.get(tag_id)
        if resp.success:
            name = resp.data.get("name", tag_id) if isinstance(resp.data, dict) else tag_id
            self.set_header("Content-Type", "application/json")
            self.set_header("Content-Disposition", f'attachment; filename="autotag-{name}.json"')
            self.write(json.dumps(resp.data, indent=2))
        else:
            self.render("result.html", data={"error": resp.error})


class AutoTagExportAllHandler(BaseHandler):
    """Export all auto-tag rules as a single JSON array download."""
    async def get(self):
        client = self.require_env()
        if not client:
            return
        tags = await client.auto_tags.list()
        all_details = []
        for tag in tags:
            detail = await client.auto_tags.get(tag["id"])
            if detail.success:
                all_details.append(detail.data)
        self.set_header("Content-Type", "application/json")
        self.set_header("Content-Disposition", 'attachment; filename="autotags-all.json"')
        self.write(json.dumps(all_details, indent=2))


class ImportAutoTagHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        try:
            config = json.loads(self.get_argument("config", "{}"))
        except json.JSONDecodeError:
            self.render("result.html", data={"error": "Invalid JSON"})
            return

        resp = await client.auto_tags.create(config)
        if resp.success:
            self.redirect("/auto_tags")
        else:
            self.render("result.html", data={"error": resp.error})


# -- Maintenance windows (enriched, create/delete/export) --------------------

class MaintenanceWindowsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        windows = await client.maintenance_windows.list()
        enriched = []
        for w in windows:
            detail = await client.maintenance_windows.get(w["id"])
            w["details"] = detail.data if detail.success else None
            enriched.append(w)

        self.render("maintenance.html",
                    data=enriched,
                    name=self.env_display_name())


class DeleteMaintenanceHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        mw_id = self.get_argument("id", "")
        resp = await client.maintenance_windows.delete(mw_id)
        if resp.success:
            self.redirect("/maintenance")
        else:
            self.render("result.html", data={"error": resp.error})


class CreateMaintenanceHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        try:
            config = json.loads(self.get_argument("config", "{}"))
        except json.JSONDecodeError:
            self.render("result.html", data={"error": "Invalid JSON"})
            return
        resp = await client.maintenance_windows.create(config)
        if resp.success:
            self.redirect("/maintenance")
        else:
            self.render("result.html", data={"error": resp.error})


class MWExportHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return
        mw_id = self.get_argument("id", "")
        resp = await client.maintenance_windows.get(mw_id)
        if resp.success:
            self.set_header("Content-Type", "application/json")
            self.set_header("Content-Disposition", f'attachment; filename="mw-{mw_id}.json"')
            self.write(json.dumps(resp.data, indent=2))
        else:
            self.render("result.html", data={"error": resp.error})


# -- SLOs (create/delete) ---------------------------------------------------

class CreateSLOHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        try:
            config = json.loads(self.get_argument("config", "{}"))
        except json.JSONDecodeError:
            self.render("result.html", data={"error": "Invalid JSON"})
            return
        resp = await client.create_slo(config)
        if resp.success:
            self.redirect("/slos")
        else:
            self.render("result.html", data={"error": resp.error})


class DeleteSLOHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        slo_id = self.get_argument("slo_id", "")
        resp = await client.delete_slo(slo_id)
        if resp.success:
            self.redirect("/slos")
        else:
            self.render("result.html", data={"error": resp.error})


# -- Extensions (configs, schema, delete) ------------------------------------

class ExtensionsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        extensions = await client.list_extensions()
        self.render("extensions.html",
                    data=extensions, configs=None, schema=None,
                    ext_name="", ext_version="",
                    name=self.env_display_name(),
                    json_encode=json_encode)


class ExtensionConfigsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return
        ext_name = self.get_argument("name", "")
        configs = await client.list_extension_instances(ext_name)
        extensions = await client.list_extensions()
        self.render("extensions.html",
                    data=extensions, configs=configs, schema=None,
                    ext_name=ext_name, ext_version="",
                    name=self.env_display_name(),
                    json_encode=json_encode)


class ExtensionSchemaHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return
        ext_name = self.get_argument("name", "")
        ext_version = self.get_argument("version", "")
        resp = await client._get(
            f"{client.env.env_v2}/extensions/{ext_name}/{ext_version}/schema")
        schema = resp.data if resp.success else {"error": resp.error}
        extensions = await client.list_extensions()
        self.render("extensions.html",
                    data=extensions, configs=None, schema=schema,
                    ext_name=ext_name, ext_version=ext_version,
                    name=self.env_display_name(),
                    json_encode=json_encode)


class DeleteExtensionHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        ext_name = self.get_argument("name", "")
        ext_version = self.get_argument("version", "")
        resp = await client._delete(
            f"{client.env.env_v2}/extensions/{ext_name}/{ext_version}")
        if resp.success:
            self.redirect("/extensions")
        else:
            self.render("result.html", data={"error": resp.error})


# -- Releases (with time range) ---------------------------------------------

class ReleasesHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return
        time_range = self.get_argument("range", "now-30d")
        releases = await client.get_releases(from_ts=time_range)
        self.render("releases.html",
                    data=releases,
                    time_range=time_range,
                    name=self.env_display_name())


# -- Events ------------------------------------------------------------------

class EventsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        time_range = self.get_argument("range", "now-2h")
        events = await client.get_events(from_ts=time_range)
        self.render("events.html",
                    data=events,
                    name=self.env_display_name(),
                    convert_ts=convert_ts)


class IngestEventHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return

        try:
            event_type = self.get_argument("event_type", "CUSTOM_INFO")
            title = self.get_argument("title", "")
            entity_selector = self.get_argument("entity_selector", "")
            properties = json.loads(self.get_argument("properties", "{}"))
        except json.JSONDecodeError:
            self.render("result.html", data={"error": "Invalid JSON in properties"})
            return

        resp = await client.ingest_event(event_type, title, entity_selector, properties)
        self.render("result.html",
                    data={"success": resp.success, "status": resp.status_code})


# -- Synthetic monitors (toggle) --------------------------------------------

class SyntheticHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        resp = await client.list_synthetic_monitors()
        monitors = resp.data.get("monitors", []) if resp.success and isinstance(resp.data, dict) else []
        self.render("synthetic.html",
                    data=monitors,
                    name=self.env_display_name())


class ToggleSyntheticHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        monitor_id = self.get_argument("monitor_id", "")
        enabled = self.get_argument("enabled", "true") == "true"
        resp = await client.toggle_synthetic_monitor(monitor_id, enabled)
        if resp.success:
            self.redirect("/synthetic")
        else:
            self.render("result.html", data={"error": resp.error})


# -- Logs --------------------------------------------------------------------

class LogsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        query = self.get_argument("query", "")
        time_range = self.get_argument("range", "now-2h")

        if query:
            logs = await client.search_logs(query=query, from_ts=time_range)
        else:
            logs = []

        self.render("logs.html",
                    data=logs,
                    name=self.env_display_name(),
                    convert_ts=convert_ts)


# -- Dashboard export/delete -------------------------------------------------

class DashboardExportHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return
        dash_id = self.get_argument("id", "")
        resp = await client.dashboards.get(dash_id)
        if resp.success:
            self.set_header("Content-Type", "application/json")
            self.set_header("Content-Disposition", f'attachment; filename="dashboard-{dash_id}.json"')
            self.write(json.dumps(resp.data, indent=2))
        else:
            self.render("result.html", data={"error": resp.error})


class DashboardDeleteHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        dash_id = self.get_argument("id", "")
        resp = await client.dashboards.delete(dash_id)
        if resp.success:
            self.redirect("/dashboards")
        else:
            self.render("result.html", data={"error": resp.error})


# -- Security mute -----------------------------------------------------------

class MuteSecurityHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        problem_id = self.get_argument("problem_id", "")
        resp = await client.mute_security_problem(
            problem_id, reason="CONFIGURATION_NOT_AFFECTED",
            comment="Muted via DMM Portal",
        )
        if resp.success:
            self.redirect("/security")
        else:
            self.render("result.html", data={"error": resp.error})


# -- Create API token --------------------------------------------------------

class CreateTokenHandler(BaseHandler):
    async def post(self):
        client = self.require_env()
        if not client:
            return
        name = self.get_argument("token_name", "")
        scopes = self.get_arguments("scopes")
        expiration = self.get_argument("expiration", "").strip() or None

        if not name or not scopes:
            self.render("result.html", data={"error": "Token name and at least one scope are required."})
            return

        resp = await client.create_api_token(name, scopes, expiration_date=expiration)
        if resp.success and isinstance(resp.data, dict):
            token_secret = resp.data.get("token", "")
            self.render("result.html", data={
                "success": True,
                "token_name": name,
                "token_secret": token_secret,
                "warning": "Copy the token now — it will not be shown again!",
            })
        else:
            self.render("result.html", data={"error": resp.error})


# -- About -------------------------------------------------------------------

class AboutHandler(BaseHandler):
    def get(self):
        self.render("about.html")


# ===========================================================================
# ANALYTICS OVERVIEW — aggregates data from multiple API endpoints
# ===========================================================================

class OverviewHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            return

        # Fire all API calls concurrently for speed
        (
            hosts_resp,
            problems_list,
            slos_list,
            security_list,
            synthetic_resp,
            activegates_list,
            extensions_list,
            tokens_list,
            dashboards_list,
        ) = await asyncio.gather(
            client.get_hosts_since(months=7),
            client.get_problems(from_ts="now-24h"),
            client.list_slos(),
            client.get_security_problems(),
            client.list_synthetic_monitors(),
            client.list_activegates(),
            client.list_extensions(),
            client.api_tokens.list(),
            client.dashboards.list(),
            return_exceptions=True,
        )

        # --- Hosts stats ---
        host_stats = {"total": 0, "monitored": 0, "unmonitored": 0, "groups": 0, "by_mode": {}}
        if isinstance(hosts_resp, object) and hasattr(hosts_resp, 'success') and hosts_resp.success:
            hosts = hosts_resp.data.get("hosts", []) if isinstance(hosts_resp.data, dict) else []
            host_stats["total"] = len(hosts)
            seen_groups = set()
            for h in hosts:
                info = h.get("hostInfo", {})
                mon = info.get("monitoringMode", "UNKNOWN")
                enabled = h.get("monitoringEnabled", True)
                if enabled:
                    host_stats["monitored"] += 1
                else:
                    host_stats["unmonitored"] += 1
                host_stats["by_mode"][mon] = host_stats["by_mode"].get(mon, 0) + 1
                hg = info.get("hostGroup")
                if hg:
                    seen_groups.add(hg.get("meId"))
            host_stats["groups"] = len(seen_groups)

        # --- Problems stats ---
        problem_stats = {"total": 0, "open": 0, "closed": 0, "by_severity": {}}
        if isinstance(problems_list, list):
            problem_stats["total"] = len(problems_list)
            for p in problems_list:
                if p.get("status") == "OPEN":
                    problem_stats["open"] += 1
                else:
                    problem_stats["closed"] += 1
                sev = p.get("severityLevel", "UNKNOWN")
                problem_stats["by_severity"][sev] = problem_stats["by_severity"].get(sev, 0) + 1

        # --- SLO stats ---
        slo_stats = {"total": 0, "success": 0, "warning": 0, "failure": 0}
        if isinstance(slos_list, list):
            slo_stats["total"] = len(slos_list)
            for s in slos_list:
                st = s.get("status", "")
                if st == "SUCCESS":
                    slo_stats["success"] += 1
                elif st == "WARNING":
                    slo_stats["warning"] += 1
                else:
                    slo_stats["failure"] += 1

        # --- Security stats ---
        security_stats = {"total": 0, "open": 0, "muted": 0}
        if isinstance(security_list, list):
            security_stats["total"] = len(security_list)
            for sp in security_list:
                sev = sp.get("severity", "UNKNOWN")
                security_stats[sev] = security_stats.get(sev, 0) + 1
                if sp.get("status") == "MUTED":
                    security_stats["muted"] += 1
                else:
                    security_stats["open"] += 1

        # --- Synthetic stats ---
        synthetic_stats = {"total": 0, "enabled": 0, "disabled": 0, "by_type": {}}
        monitors = []
        if isinstance(synthetic_resp, object) and hasattr(synthetic_resp, 'success') and synthetic_resp.success:
            monitors = synthetic_resp.data.get("monitors", []) if isinstance(synthetic_resp.data, dict) else []
        elif isinstance(synthetic_resp, list):
            monitors = synthetic_resp
        synthetic_stats["total"] = len(monitors)
        for m in monitors:
            if m.get("enabled"):
                synthetic_stats["enabled"] += 1
            else:
                synthetic_stats["disabled"] += 1
            mtype = m.get("type", "UNKNOWN")
            synthetic_stats["by_type"][mtype] = synthetic_stats["by_type"].get(mtype, 0) + 1

        # --- ActiveGate stats ---
        ag_stats = {"total": 0, "connected": 0, "disconnected": 0, "versions": {}}
        if isinstance(activegates_list, list):
            ag_stats["total"] = len(activegates_list)
            for ag in activegates_list:
                if ag.get("connected"):
                    ag_stats["connected"] += 1
                else:
                    ag_stats["disconnected"] += 1
                ver = ag.get("version", "unknown")
                ag_stats["versions"][ver] = ag_stats["versions"].get(ver, 0) + 1

        # --- KPI cards ---
        ext_count = len(extensions_list) if isinstance(extensions_list, list) else 0
        token_count = len(tokens_list) if isinstance(tokens_list, list) else 0
        dash_count = len(dashboards_list) if isinstance(dashboards_list, list) else 0

        kpis = [
            {"value": host_stats["total"], "label": "Hosts", "color": "primary",
             "sub": f'{host_stats["monitored"]} monitored'},
            {"value": problem_stats["total"], "label": "Problems (24h)",
             "color": "danger" if problem_stats["open"] > 0 else "success",
             "sub": f'{problem_stats["open"]} open'},
            {"value": slo_stats["total"], "label": "SLOs",
             "color": "success" if slo_stats["failure"] == 0 else "warning",
             "sub": f'{slo_stats["failure"]} failing'},
            {"value": security_stats["total"], "label": "Vulnerabilities",
             "color": "danger" if security_stats.get("CRITICAL", 0) > 0 else "warning" if security_stats["total"] > 0 else "success",
             "sub": f'{security_stats.get("CRITICAL", 0)} critical'},
            {"value": ag_stats["total"], "label": "ActiveGates", "color": "primary",
             "sub": f'{ag_stats["connected"]} connected'},
            {"value": synthetic_stats["total"], "label": "Synthetic", "color": "primary",
             "sub": f'{synthetic_stats["enabled"]} active'},
            {"value": token_count, "label": "API Tokens", "color": "secondary"},
            {"value": dash_count, "label": "Dashboards", "color": "secondary"},
        ]

        self.render("overview.html",
                    name=self.env_display_name(),
                    kpis=kpis,
                    problem_stats=problem_stats,
                    slo_stats=slo_stats,
                    security_stats=security_stats,
                    host_stats=host_stats,
                    synthetic_stats=synthetic_stats,
                    ag_stats=ag_stats,
                    json_encode=json_encode)


# -- API endpoints (JSON) for AJAX / future SPA usage -----------------------

class ApiGroupsHandler(BaseHandler):
    async def get(self):
        client = self.require_env()
        if not client:
            self.set_status(400)
            self.write({"error": "No environment selected"})
            return

        groups = await client.list_groups()
        self.set_header("Content-Type", "application/json")
        self.write(json.dumps(groups))


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

def make_app(app_state: AppState) -> tornado.web.Application:
    app = tornado.web.Application(
        [
            # Core
            (r"/", MainHandler),
            (r"/environment", EnvironmentHandler),
            (r"/portal", PortalHandler),
            (r"/overview", OverviewHandler),
            (r"/about", AboutHandler),

            # User management
            (r"/accounts", AccountsHandler),
            (r"/add_users", AddUsersHandler),
            (r"/delete_users", DeleteUsersHandler),

            # Environment info
            (r"/tenant_details", TenantDetailsHandler),
            (r"/hosts", HostsHandler),
            (r"/enable_hosts", EnableHostsHandler),
            (r"/disable_hosts", DisableHostsHandler),

            # Tags
            (r"/tags", TagsHandler),
            (r"/add_tags", AddTagsHandler),
            (r"/remove_tags", RemoveTagsHandler),

            # Request naming
            (r"/request_names", RequestNamesHandler),
            (r"/delete_request_name", DeleteRequestNameHandler),
            (r"/add_request_name", AddRequestNameHandler),

            # Monitoring data
            (r"/audit_log", AuditHandler),
            (r"/entities", EntitiesHandler),
            (r"/problems", ProblemsHandler),
            (r"/close_problem", CloseProblemHandler),
            (r"/events", EventsHandler),
            (r"/ingest_event", IngestEventHandler),

            # Configuration
            (r"/metrics", MetricsHandler),
            (r"/settings", SettingsHandler),
            (r"/auto_tags", AutoTagsHandler),
            (r"/delete_auto_tag", DeleteAutoTagHandler),
            (r"/auto_tag_export", AutoTagExportHandler),
            (r"/auto_tags_export", AutoTagExportAllHandler),
            (r"/import_auto_tag", ImportAutoTagHandler),
            (r"/dashboards", DashboardsHandler),
            (r"/dashboard_export", DashboardExportHandler),
            (r"/dashboard_delete", DashboardDeleteHandler),
            (r"/maintenance", MaintenanceWindowsHandler),
            (r"/delete_maintenance", DeleteMaintenanceHandler),
            (r"/create_maintenance", CreateMaintenanceHandler),
            (r"/mw_export", MWExportHandler),

            # Infrastructure
            (r"/network_zones", NetworkZonesHandler),
            (r"/create_network_zone", CreateNetworkZoneHandler),
            (r"/delete_network_zone", DeleteNetworkZoneHandler),
            (r"/activegates", ActiveGatesHandler),
            (r"/extensions", ExtensionsHandler),
            (r"/extension_configs", ExtensionConfigsHandler),
            (r"/extension_schema", ExtensionSchemaHandler),
            (r"/delete_extension", DeleteExtensionHandler),
            (r"/synthetic", SyntheticHandler),
            (r"/toggle_synthetic", ToggleSyntheticHandler),

            # Security & compliance
            (r"/tokens", TokensHandler),
            (r"/create_token", CreateTokenHandler),
            (r"/security", SecurityHandler),
            (r"/mute_security", MuteSecurityHandler),
            (r"/slos", SLOHandler),
            (r"/create_slo", CreateSLOHandler),
            (r"/delete_slo", DeleteSLOHandler),

            # Operations
            (r"/releases", ReleasesHandler),
            (r"/logs", LogsHandler),

            # JSON API
            (r"/api/groups", ApiGroupsHandler),

            # Static
            (r"/(favicon.ico)", tornado.web.StaticFileHandler, {"path": "static"}),
        ],
        template_path="templates",
        cookie_secret="CHANGE_THIS_TO_A_RANDOM_SECRET",  # TODO: move to secrets.json
        xsrf_cookies=False,  # enable when you add XSRF tokens to forms
    )
    app.app_state = app_state
    return app


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    secrets = load_secrets("secrets.json")
    app_state = AppState(secrets)
    app = make_app(app_state)

    port = 8888
    app.listen(port)
    logger.info("Dynatrace Management Portal running on http://127.0.0.1:%d", port)
    webbrowser.open(f"http://127.0.0.1:{port}")
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
