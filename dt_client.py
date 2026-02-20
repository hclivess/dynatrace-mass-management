"""
Dynatrace API Client - Unified client with pagination, error handling, and async support.

Covers:
- Account Management (IAM): users, groups, permissions
- Environment API v1: hosts, oneagents, request naming, deployment
- Environment API v2: entities, tags, settings, audit logs, metrics, problems,
                       SLOs, network zones, ActiveGates, extensions, log management
- Config API v1: auto-tags, alerting profiles, management zones, dashboards,
                  maintenance windows, notifications, web applications
"""

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib.parse import quote

import aiohttp

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class DtEnvironment:
    """Represents a single Dynatrace environment / tenant."""
    name: str
    account: str  # tenant ID (abc12345)
    api_token: str  # environment API token

    @property
    def base_url(self) -> str:
        return f"https://{self.account}.live.dynatrace.com"

    @property
    def env_v1(self) -> str:
        return f"{self.base_url}/api/v1"

    @property
    def env_v2(self) -> str:
        return f"{self.base_url}/api/v2"

    @property
    def config_v1(self) -> str:
        return f"{self.base_url}/api/config/v1"

    def api_header(self) -> dict:
        return {
            "Authorization": f"Api-Token {self.api_token}",
            "Content-Type": "application/json",
        }


@dataclass
class DtAccountManagement:
    """Credentials for the Dynatrace Account Management API (IAM)."""
    account_uuid: str
    client_id: str
    client_secret: str

    @property
    def iam_base(self) -> str:
        return f"https://api.dynatrace.com/iam/v1/accounts/{self.account_uuid}"


@dataclass
class ApiResponse:
    """Standardized API response wrapper."""
    success: bool
    status_code: int
    data: Any = None
    error: str | None = None
    raw_text: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def extract_emails(text: str) -> list[str]:
    """Extract valid email addresses from free-form text."""
    pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'
    return re.findall(pattern, text)


# ---------------------------------------------------------------------------
# CRUD resource abstractions — eliminates ~250 lines of copy-paste boilerplate
# ---------------------------------------------------------------------------

class CrudV1:
    """
    Reusable CRUD for a Config API v1 resource.

    Every Config v1 resource follows the identical pattern:
        GET    /api/config/v1/{path}           → list
        GET    /api/config/v1/{path}/{id}       → get
        POST   /api/config/v1/{path}           → create
        PUT    /api/config/v1/{path}/{id}       → update
        DELETE /api/config/v1/{path}/{id}       → delete

    Usage::

        # In DynatraceClient.__init__:
        self.auto_tags = CrudV1(self, "autoTags")
        self.dashboards = CrudV1(self, "dashboards", items_key="dashboards")

        # From handlers:
        tags = await client.auto_tags.list()
        detail = await client.auto_tags.get(tag_id)
        await client.auto_tags.create(config)
        await client.auto_tags.update(tag_id, config)
        await client.auto_tags.delete(tag_id)
    """

    def __init__(self, client: 'DynatraceClient', path: str,
                 items_key: str = "values"):
        self._client = client
        self._path = path
        self._items_key = items_key

    @property
    def _url(self) -> str:
        return f"{self._client.env.config_v1}/{self._path}"

    async def list(self) -> list:
        """List all resources."""
        return await self._client._paginate_v1(self._url, items_key=self._items_key)

    async def get(self, resource_id: str) -> ApiResponse:
        """Get a single resource by ID."""
        return await self._client._get(f"{self._url}/{resource_id}")

    async def create(self, config: dict) -> ApiResponse:
        """Create a new resource."""
        return await self._client._post(self._url, json_data=config)

    async def update(self, resource_id: str, config: dict) -> ApiResponse:
        """Update an existing resource."""
        return await self._client._put(f"{self._url}/{resource_id}", json_data=config)

    async def delete(self, resource_id: str) -> ApiResponse:
        """Delete a resource."""
        return await self._client._delete(f"{self._url}/{resource_id}")


class CrudV2:
    """
    Reusable CRUD for Environment API v2 resources with automatic pagination.

    Same interface as CrudV1, but list() uses nextPageKey pagination.

    Usage::

        self.api_tokens = CrudV2(self, "apiTokens", items_key="apiTokens")
        self.credentials = CrudV2(self, "credentials", items_key="credentials")

        tokens = await client.api_tokens.list()
        detail = await client.api_tokens.get(token_id)
    """

    def __init__(self, client: 'DynatraceClient', path: str,
                 items_key: str = "items", page_size: int = 500):
        self._client = client
        self._path = path
        self._items_key = items_key
        self._page_size = page_size

    @property
    def _url(self) -> str:
        return f"{self._client.env.env_v2}/{self._path}"

    async def list(self, extra_params: dict | None = None) -> list:
        """List all resources with automatic pagination."""
        params = {"pageSize": self._page_size}
        if extra_params:
            params.update(extra_params)
        return await self._client._paginate_v2(
            self._url, params=params, items_key=self._items_key,
        )

    async def get(self, resource_id: str) -> ApiResponse:
        """Get a single resource by ID."""
        return await self._client._get(f"{self._url}/{resource_id}")

    async def create(self, config: dict) -> ApiResponse:
        """Create a new resource."""
        return await self._client._post(self._url, json_data=config)

    async def update(self, resource_id: str, config: dict) -> ApiResponse:
        """Update an existing resource."""
        return await self._client._put(f"{self._url}/{resource_id}", json_data=config)

    async def delete(self, resource_id: str) -> ApiResponse:
        """Delete a resource."""
        return await self._client._delete(f"{self._url}/{resource_id}")


# ---------------------------------------------------------------------------
# Dynatrace Client (async, paginated)
# ---------------------------------------------------------------------------

class DynatraceClient:
    """Async Dynatrace API client with automatic pagination and error handling."""

    def __init__(self, environment: DtEnvironment, account_mgmt: DtAccountManagement | None = None):
        self.env = environment
        self.acct = account_mgmt
        self._session: aiohttp.ClientSession | None = None
        self._bearer_token: str | None = None
        self._bearer_expires: float = 0

        # -- Config v1 CRUD resources ----------------------------------------
        # Each replaces 5 hand-written methods (list, get, create, update, delete).
        self.auto_tags = CrudV1(self, "autoTags")
        self.alerting_profiles = CrudV1(self, "alertingProfiles")
        self.management_zones = CrudV1(self, "managementZones")
        self.maintenance_windows = CrudV1(self, "maintenanceWindows")
        self.notifications = CrudV1(self, "notifications")
        self.dashboards = CrudV1(self, "dashboards", items_key="dashboards")
        self.request_naming = CrudV1(self, "service/requestNaming")
        self.calc_metrics_service = CrudV1(self, "calculatedMetrics/service")
        self.web_applications = CrudV1(self, "applications/web")

        # -- Env v2 CRUD resources -------------------------------------------
        self.api_tokens = CrudV2(self, "apiTokens", items_key="apiTokens")
        self.credentials = CrudV2(self, "credentials", items_key="credentials")

    # -- session management --------------------------------------------------

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()

    # -- generic request helpers ---------------------------------------------

    async def _request(
        self, method: str, url: str, headers: dict | None = None,
        json_data: Any = None, data: Any = None, params: dict | None = None,
    ) -> ApiResponse:
        session = await self._get_session()
        hdrs = headers or self.env.api_header()
        try:
            async with session.request(
                method, url, headers=hdrs, json=json_data, data=data, params=params,
            ) as resp:
                raw = await resp.text()
                if 200 <= resp.status < 300:
                    try:
                        parsed = json.loads(raw) if raw.strip() else None
                    except json.JSONDecodeError:
                        parsed = raw
                    return ApiResponse(success=True, status_code=resp.status, data=parsed, raw_text=raw)
                else:
                    logger.warning("API %s %s → %s: %s", method, url, resp.status, raw[:500])
                    return ApiResponse(success=False, status_code=resp.status, error=raw[:500], raw_text=raw)
        except Exception as e:
            logger.exception("Request failed: %s %s", method, url)
            return ApiResponse(success=False, status_code=0, error=str(e))

    async def _get(self, url: str, **kw) -> ApiResponse:
        return await self._request("GET", url, **kw)

    async def _post(self, url: str, **kw) -> ApiResponse:
        return await self._request("POST", url, **kw)

    async def _put(self, url: str, **kw) -> ApiResponse:
        return await self._request("PUT", url, **kw)

    async def _delete(self, url: str, **kw) -> ApiResponse:
        return await self._request("DELETE", url, **kw)

    # -- pagination ----------------------------------------------------------

    async def _paginate_v2(self, url: str, params: dict | None = None,
                           items_key: str = "items", max_pages: int = 100) -> list:
        """
        Handle Dynatrace v2 pagination using nextPageKey.
        Returns the merged list of all items across all pages.
        """
        all_items = []
        params = dict(params) if params else {}
        page = 0

        while page < max_pages:
            resp = await self._get(url, params=params)
            if not resp.success:
                logger.error("Pagination failed at page %d: %s", page, resp.error)
                break

            data = resp.data
            if isinstance(data, dict):
                items = data.get(items_key, [])
                if isinstance(items, list):
                    all_items.extend(items)

                next_key = data.get("nextPageKey")
                if next_key:
                    params["nextPageKey"] = next_key
                    # Dynatrace says: when using nextPageKey, remove other query params
                    for k in list(params.keys()):
                        if k not in ("nextPageKey",):
                            params.pop(k, None)
                    page += 1
                else:
                    break
            else:
                break

        logger.info("Paginated %s → %d items across %d pages", url, len(all_items), page + 1)
        return all_items

    async def _paginate_v1(self, url: str, items_key: str = "values") -> list:
        """V1 APIs don't paginate the same way; most return all results. Simple wrapper."""
        resp = await self._get(url)
        if resp.success and isinstance(resp.data, dict):
            return resp.data.get(items_key, [])
        return []

    # ========================================================================
    # BEARER TOKEN (Account Management / IAM)
    # ========================================================================

    async def get_bearer_token(self) -> str | None:
        """Obtain or refresh OAuth2 bearer token for Account Management API."""
        if not self.acct:
            logger.error("No account management credentials configured")
            return None

        now = time.time()
        if self._bearer_token and now < self._bearer_expires - 60:
            return self._bearer_token

        resp = await self._post(
            "https://sso.dynatrace.com/sso/oauth2/token",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "grant_type": "client_credentials",
                "client_id": self.acct.client_id,
                "client_secret": self.acct.client_secret,
                "scope": "account-idm-read account-idm-write",
                "resource": f"urn:dtaccount:{self.acct.account_uuid}",
            },
        )

        if resp.success and isinstance(resp.data, dict):
            self._bearer_token = resp.data["access_token"]
            self._bearer_expires = now + resp.data.get("expires_in", 300)
            return self._bearer_token
        else:
            logger.error("Bearer token fetch failed: %s", resp.error)
            return None

    def _bearer_header(self) -> dict:
        return {
            "Authorization": f"Bearer {self._bearer_token}",
            "Content-Type": "application/json",
        }

    # ========================================================================
    # IAM - USER MANAGEMENT
    # ========================================================================

    async def list_users(self) -> ApiResponse:
        """List all users in the account."""
        await self.get_bearer_token()
        return await self._get(f"{self.acct.iam_base}/users", headers=self._bearer_header())

    async def add_user(self, email: str) -> ApiResponse:
        """Add a user to the account."""
        await self.get_bearer_token()
        return await self._post(
            f"{self.acct.iam_base}/users",
            headers=self._bearer_header(),
            json_data={"email": email},
        )

    async def delete_user(self, email: str) -> ApiResponse:
        """Remove a user from the account."""
        await self.get_bearer_token()
        return await self._delete(
            f"{self.acct.iam_base}/users/{email}",
            headers=self._bearer_header(),
        )

    async def assign_groups(self, email: str, group_uuids: list[str]) -> ApiResponse:
        """Assign a user to one or more groups."""
        await self.get_bearer_token()
        return await self._post(
            f"{self.acct.iam_base}/users/{email}",
            headers=self._bearer_header(),
            json_data=group_uuids,
        )

    async def remove_user_from_group(self, email: str, group_uuid: str) -> ApiResponse:
        """Remove a user from a specific group."""
        await self.get_bearer_token()
        return await self._delete(
            f"{self.acct.iam_base}/users/{email}/{group_uuid}",
            headers=self._bearer_header(),
        )

    # ========================================================================
    # IAM - GROUP MANAGEMENT
    # ========================================================================

    async def list_groups(self) -> list[dict]:
        """List all groups with uuid and name."""
        await self.get_bearer_token()
        resp = await self._get(f"{self.acct.iam_base}/groups", headers=self._bearer_header())
        if resp.success and isinstance(resp.data, dict):
            return [{"name": g["name"], "uuid": g["uuid"]} for g in resp.data.get("items", [])]
        return []

    async def get_group_details(self, group_uuid: str) -> ApiResponse:
        """Get details for a specific group, including members."""
        await self.get_bearer_token()
        return await self._get(
            f"{self.acct.iam_base}/groups/{group_uuid}",
            headers=self._bearer_header(),
        )

    async def create_group(self, name: str, description: str = "") -> ApiResponse:
        """Create a new user group."""
        await self.get_bearer_token()
        return await self._post(
            f"{self.acct.iam_base}/groups",
            headers=self._bearer_header(),
            json_data={"name": name, "description": description},
        )

    async def delete_group(self, group_uuid: str) -> ApiResponse:
        """Delete a user group."""
        await self.get_bearer_token()
        return await self._delete(
            f"{self.acct.iam_base}/groups/{group_uuid}",
            headers=self._bearer_header(),
        )

    # ========================================================================
    # IAM - PERMISSIONS (not available through GUI)
    # ========================================================================

    async def list_permissions(self) -> ApiResponse:
        """List all available permission definitions."""
        await self.get_bearer_token()
        return await self._get(
            f"{self.acct.iam_base}/permissions",
            headers=self._bearer_header(),
        )

    async def get_group_permissions(self, group_uuid: str) -> ApiResponse:
        """Get permissions assigned to a group."""
        await self.get_bearer_token()
        return await self._get(
            f"{self.acct.iam_base}/groups/{group_uuid}/permissions",
            headers=self._bearer_header(),
        )

    async def set_group_permissions(self, group_uuid: str, permissions: list[dict]) -> ApiResponse:
        """Set permissions for a group. Each permission: {permissionName, scope, scopeType}."""
        await self.get_bearer_token()
        return await self._put(
            f"{self.acct.iam_base}/groups/{group_uuid}/permissions",
            headers=self._bearer_header(),
            json_data=permissions,
        )

    # ========================================================================
    # ENVIRONMENT API v1 - ONEAGENT / HOSTS
    # ========================================================================

    async def get_oneagents(self, start_timestamp: int | None = None) -> ApiResponse:
        """Get all OneAgent host information. Timestamp in ms since epoch."""
        params = {}
        if start_timestamp:
            params["startTimestamp"] = start_timestamp
        return await self._get(f"{self.env.env_v1}/oneagents", params=params)

    async def get_hosts_since(self, months: int = 7) -> ApiResponse:
        """Get hosts seen in the last N months."""
        seconds_per_month = 2_592_000
        ts = (int(time.time()) - months * seconds_per_month) * 1000
        return await self.get_oneagents(start_timestamp=ts)

    async def get_host_config(self, host_id: str) -> ApiResponse:
        """Get monitoring configuration for a specific host."""
        return await self._get(f"{self.env.config_v1}/hosts/{host_id}")

    async def enable_host_monitoring(self, host_id: str) -> ApiResponse:
        """Enable monitoring for a host, preserving its monitoring mode."""
        cfg_resp = await self.get_host_config(host_id)
        if not cfg_resp.success:
            return cfg_resp

        monitoring_mode = cfg_resp.data.get("monitoringConfig", {}).get("monitoringMode", "FULL_STACK")
        return await self._put(
            f"{self.env.config_v1}/hosts/{host_id}/monitoring",
            json_data={"monitoringEnabled": True, "monitoringMode": monitoring_mode},
        )

    async def disable_host_monitoring(self, host_id: str) -> ApiResponse:
        """Disable monitoring for a host if currently enabled."""
        cfg_resp = await self.get_host_config(host_id)
        if not cfg_resp.success:
            return cfg_resp

        mon_cfg = cfg_resp.data.get("monitoringConfig", {})
        if not mon_cfg.get("monitoringEnabled", False):
            return ApiResponse(success=True, status_code=200, data="Already disabled")

        return await self._put(
            f"{self.env.config_v1}/hosts/{host_id}/monitoring",
            json_data={"monitoringEnabled": False, "monitoringMode": mon_cfg["monitoringMode"]},
        )

    # ========================================================================
    # ENVIRONMENT API v1 - DEPLOYMENT
    # ========================================================================

    async def get_connection_info(self) -> ApiResponse:
        """Get OneAgent connection info (tenant token, endpoints)."""
        return await self._get(f"{self.env.env_v1}/deployment/installer/agent/connectioninfo")

    async def get_installer_versions(self, os_type: str = "unix") -> ApiResponse:
        """Get available OneAgent installer versions."""
        return await self._get(f"{self.env.env_v1}/deployment/installer/agent/versions/{os_type}")

    # ========================================================================
    # ENVIRONMENT API v2 - ENTITIES (paginated)
    # ========================================================================

    async def get_entity_types(self) -> list:
        """List all entity types with pagination."""
        return await self._paginate_v2(f"{self.env.env_v2}/entityTypes")

    async def get_entities(self, entity_selector: str, fields: str = "",
                           from_ts: str = "", to_ts: str = "") -> list:
        """
        Query entities with selector and pagination.
        entity_selector examples:
            type("HOST")
            type("SERVICE"),tag("environment:production")
            type("PROCESS_GROUP"),entityName.contains("java")
        """
        params = {"entitySelector": entity_selector, "pageSize": 500}
        if fields:
            params["fields"] = fields
        if from_ts:
            params["from"] = from_ts
        if to_ts:
            params["to"] = to_ts

        return await self._paginate_v2(f"{self.env.env_v2}/entities", params=params, items_key="entities")

    async def get_entity(self, entity_id: str, fields: str = "") -> ApiResponse:
        """Get a single entity by ID."""
        params = {}
        if fields:
            params["fields"] = fields
        return await self._get(f"{self.env.env_v2}/entities/{entity_id}", params=params)

    # ========================================================================
    # ENVIRONMENT API v2 - TAGS
    # ========================================================================

    async def get_tags(self, entity_selector: str) -> ApiResponse:
        """Get tags for entities matching the selector."""
        return await self._get(
            f"{self.env.env_v2}/tags",
            params={"entitySelector": entity_selector},
        )

    async def add_tags(self, entity_selector: str, tags: list[dict]) -> ApiResponse:
        """
        Add custom tags.
        tags: [{"key": "env", "value": "prod"}, {"key": "team", "value": "ops"}]
        """
        return await self._post(
            f"{self.env.env_v2}/tags",
            params={"entitySelector": entity_selector},
            json_data={"tags": tags},
        )

    async def delete_tag(self, entity_selector: str, key: str,
                         value: str | None = None, delete_all: bool = True) -> ApiResponse:
        """Remove a tag from matching entities."""
        params = {
            "entitySelector": entity_selector,
            "key": key,
            "deleteAllWithKey": str(delete_all).lower(),
        }
        if value:
            params["value"] = value
        return await self._delete(f"{self.env.env_v2}/tags", params=params)

    # ========================================================================
    # ENVIRONMENT API v2 - SETTINGS 2.0 (not fully available in GUI)
    # ========================================================================

    async def list_settings_schemas(self) -> list:
        """List all Settings 2.0 schema IDs."""
        return await self._paginate_v2(f"{self.env.env_v2}/settings/schemas")

    async def get_settings_schema(self, schema_id: str) -> ApiResponse:
        """Get full schema definition."""
        return await self._get(f"{self.env.env_v2}/settings/schemas/{schema_id}")

    async def get_settings_objects(self, schema_ids: str | list[str],
                                   scopes: str = "", fields: str = "") -> list:
        """
        Get settings objects for given schema IDs (paginated).
        schema_ids: comma-separated string or list
        """
        if isinstance(schema_ids, list):
            schema_ids = ",".join(schema_ids)
        params = {"schemaIds": schema_ids, "pageSize": 500}
        if scopes:
            params["scopes"] = scopes
        if fields:
            params["fields"] = fields
        return await self._paginate_v2(f"{self.env.env_v2}/settings/objects", params=params)

    async def create_settings_object(self, schema_id: str, value: dict,
                                     scope: str = "environment") -> ApiResponse:
        """Create a new settings object."""
        return await self._post(
            f"{self.env.env_v2}/settings/objects",
            json_data=[{"schemaId": schema_id, "scope": scope, "value": value}],
        )

    async def update_settings_object(self, object_id: str, value: dict) -> ApiResponse:
        """Update an existing settings object."""
        return await self._put(
            f"{self.env.env_v2}/settings/objects/{object_id}",
            json_data={"value": value},
        )

    async def delete_settings_object(self, object_id: str) -> ApiResponse:
        """Delete a settings object."""
        return await self._delete(f"{self.env.env_v2}/settings/objects/{object_id}")

    async def get_effective_settings(self, schema_id: str,
                                     scope: str = "environment") -> ApiResponse:
        """Get effective (resolved) settings values."""
        return await self._get(
            f"{self.env.env_v2}/settings/effectiveValues",
            params={"schemaIds": schema_id, "scope": scope},
        )

    # ========================================================================
    # ENVIRONMENT API v2 - PROBLEMS
    # ========================================================================

    async def get_problems(self, problem_selector: str = "",
                           from_ts: str = "now-2h", to_ts: str = "now") -> list:
        """Get problems with pagination."""
        params = {"from": from_ts, "to": to_ts, "pageSize": 500}
        if problem_selector:
            params["problemSelector"] = problem_selector
        return await self._paginate_v2(f"{self.env.env_v2}/problems", params=params, items_key="problems")

    async def get_problem(self, problem_id: str) -> ApiResponse:
        """Get details for a specific problem."""
        return await self._get(f"{self.env.env_v2}/problems/{problem_id}")

    async def close_problem(self, problem_id: str, message: str = "Closed via API") -> ApiResponse:
        """Close a problem with a comment."""
        return await self._post(
            f"{self.env.env_v2}/problems/{problem_id}/close",
            json_data={"message": message},
        )

    # ========================================================================
    # ENVIRONMENT API v2 - METRICS (not all available in GUI)
    # ========================================================================

    async def list_metrics(self, metric_selector: str = "", fields: str = "") -> list:
        """List available metric descriptors (paginated)."""
        params = {"pageSize": 500}
        if metric_selector:
            params["metricSelector"] = metric_selector
        if fields:
            params["fields"] = fields
        return await self._paginate_v2(f"{self.env.env_v2}/metrics", params=params, items_key="metrics")

    async def query_metrics(self, metric_selector: str,
                            from_ts: str = "now-1h", to_ts: str = "now",
                            resolution: str = "Inf") -> ApiResponse:
        """
        Query metric data points.
        metric_selector examples:
            builtin:host.cpu.usage:avg
            builtin:service.response.time:percentile(95)
            builtin:host.disk.usedPct:max:filter(eq("dt.entity.host","HOST-XXX"))
        """
        return await self._get(
            f"{self.env.env_v2}/metrics/query",
            params={
                "metricSelector": metric_selector,
                "from": from_ts,
                "to": to_ts,
                "resolution": resolution,
            },
        )

    async def ingest_metrics(self, lines: list[str]) -> ApiResponse:
        """
        Ingest custom metrics (not available in GUI).
        Each line follows the MINT (Metrics Ingestion) protocol:
            metric.key,dim1=val1 gauge,42.5
            metric.key,dim1=val1 count,delta=100
        See: https://docs.dynatrace.com/docs/dynatrace-api/environment-api/metric-v2/post-ingest-metrics
        """
        return await self._post(
            f"{self.env.env_v2}/metrics/ingest",
            headers={**self.env.api_header(), "Content-Type": "text/plain; charset=utf-8"},
            data="\n".join(lines),
        )

    # ========================================================================
    # ENVIRONMENT API v2 - SLOs (limited in GUI)
    # ========================================================================

    async def list_slos(self) -> list:
        """List all SLOs (paginated)."""
        return await self._paginate_v2(
            f"{self.env.env_v2}/slo", params={"pageSize": 50}, items_key="slo",
        )

    async def get_slo(self, slo_id: str, from_ts: str = "now-1M", to_ts: str = "now") -> ApiResponse:
        """Get SLO details with evaluated status."""
        return await self._get(
            f"{self.env.env_v2}/slo/{slo_id}",
            params={"from": from_ts, "to": to_ts},
        )

    async def create_slo(self, slo_definition: dict) -> ApiResponse:
        """Create an SLO."""
        return await self._post(f"{self.env.env_v2}/slo", json_data=slo_definition)

    async def update_slo(self, slo_id: str, slo_definition: dict) -> ApiResponse:
        """Update an existing SLO."""
        return await self._put(f"{self.env.env_v2}/slo/{slo_id}", json_data=slo_definition)

    async def delete_slo(self, slo_id: str) -> ApiResponse:
        """Delete an SLO."""
        return await self._delete(f"{self.env.env_v2}/slo/{slo_id}")

    # ========================================================================
    # ENVIRONMENT API v2 - AUDIT LOG (paginated)
    # ========================================================================

    async def get_audit_log(self, from_ts: str = "now-14d", to_ts: str = "now",
                            filter_str: str = "") -> list:
        """Get audit log entries with pagination."""
        params = {"from": from_ts, "to": to_ts, "pageSize": 500}
        if filter_str:
            params["filter"] = filter_str
        return await self._paginate_v2(
            f"{self.env.env_v2}/auditlogs", params=params, items_key="auditLogs",
        )

    # ========================================================================
    # ENVIRONMENT API v2 - NETWORK ZONES (not available in GUI)
    # ========================================================================

    async def list_network_zones(self) -> ApiResponse:
        """List all network zones."""
        return await self._get(f"{self.env.env_v2}/networkZones")

    async def get_network_zone(self, zone_id: str) -> ApiResponse:
        """Get details for a network zone."""
        return await self._get(f"{self.env.env_v2}/networkZones/{zone_id}")

    async def create_network_zone(self, zone_id: str, description: str = "",
                                  alternative_zones: list[str] | None = None) -> ApiResponse:
        """Create a network zone."""
        payload = {"description": description}
        if alternative_zones:
            payload["alternativeZones"] = alternative_zones
        return await self._put(f"{self.env.env_v2}/networkZones/{zone_id}", json_data=payload)

    async def delete_network_zone(self, zone_id: str) -> ApiResponse:
        """Delete a network zone."""
        return await self._delete(f"{self.env.env_v2}/networkZones/{zone_id}")

    # ========================================================================
    # ENVIRONMENT API v2 - ACTIVEGATES (limited in GUI)
    # ========================================================================

    async def list_activegates(self) -> list:
        """List all ActiveGates with pagination."""
        return await self._paginate_v2(
            f"{self.env.env_v2}/activeGates", items_key="activeGates",
        )

    async def get_activegate(self, ag_id: str) -> ApiResponse:
        """Get details for a specific ActiveGate."""
        return await self._get(f"{self.env.env_v2}/activeGates/{ag_id}")

    # ========================================================================
    # ENVIRONMENT API v2 - EXTENSIONS 2.0 (partially in GUI)
    # ========================================================================

    async def list_extensions(self) -> list:
        """List all Extensions 2.0."""
        return await self._paginate_v2(
            f"{self.env.env_v2}/extensions", params={"pageSize": 50}, items_key="extensions",
        )

    async def get_extension(self, extension_id: str) -> ApiResponse:
        """Get extension details."""
        return await self._get(f"{self.env.env_v2}/extensions/{extension_id}")

    async def list_extension_instances(self, extension_id: str) -> list:
        """List monitoring configurations for an extension."""
        return await self._paginate_v2(
            f"{self.env.env_v2}/extensions/{extension_id}/monitoringConfigurations",
            items_key="items",
        )

    # ========================================================================
    # ENVIRONMENT API v2 - LOG MANAGEMENT (not fully in GUI)
    # ========================================================================

    async def search_logs(self, query: str = "", from_ts: str = "now-2h",
                          to_ts: str = "now", limit: int = 1000,
                          sort: str = "timestamp") -> list:
        """
        Search log records.
        query: DQL-like log query, e.g. 'status="ERROR" AND content="OutOfMemory"'

        NOTE: Log Monitoring v2 search/export/aggregate endpoints are deprecated
        as of SaaS 1.331 (EOL end of 2027). For Grail-based environments, prefer
        the Grail Query API with DQL. This endpoint remains functional until EOL.
        """
        params = {
            "from": from_ts, "to": to_ts,
            "limit": limit, "sort": sort,
        }
        if query:
            params["query"] = query

        return await self._paginate_v2(
            f"{self.env.env_v2}/logs/search", params=params, items_key="results",
        )

    async def get_log_custom_attributes(self) -> ApiResponse:
        """List custom log attributes (not in GUI)."""
        return await self._get(f"{self.env.env_v2}/logs/custom-attributes")

    async def store_log(self, log_entries: list[dict]) -> ApiResponse:
        """
        Ingest custom log lines via API (not available in GUI).
        Each entry: {"content": "...", "log.source": "...", "severity": "INFO|WARN|ERROR"}
        """
        return await self._post(
            f"{self.env.env_v2}/logs/ingest",
            json_data=log_entries,
            headers={**self.env.api_header(), "Content-Type": "application/json; charset=utf-8"},
        )

    # ========================================================================
    # ENVIRONMENT API v2 - SECURITY PROBLEMS (not fully in GUI)
    # ========================================================================

    async def get_security_problems(self, security_problem_selector: str = "") -> list:
        """List security problems (vulnerabilities) with pagination."""
        params = {"pageSize": 500}
        if security_problem_selector:
            params["securityProblemSelector"] = security_problem_selector
        return await self._paginate_v2(
            f"{self.env.env_v2}/securityProblems", params=params, items_key="securityProblems",
        )

    async def get_security_problem(self, problem_id: str) -> ApiResponse:
        """Get details for a security problem."""
        return await self._get(f"{self.env.env_v2}/securityProblems/{problem_id}")

    async def mute_security_problem(self, problem_id: str, reason: str,
                                    comment: str = "") -> ApiResponse:
        """Mute a security problem (not easily done in GUI)."""
        return await self._post(
            f"{self.env.env_v2}/securityProblems/{problem_id}/mute",
            json_data={"reason": reason, "comment": comment},
        )

    # ========================================================================
    # ENVIRONMENT API v2 - TOKEN MANAGEMENT (not in GUI)
    # ========================================================================
    # Note: list/get/delete are handled by self.api_tokens (CrudV2).
    # create_api_token has custom params, so it stays as a dedicated method.

    async def create_api_token(self, name: str, scopes: list[str],
                               expiration_date: str | None = None) -> ApiResponse:
        """Create a new API token with specific scopes."""
        payload = {"name": name, "scopes": scopes}
        if expiration_date:
            payload["expirationDate"] = expiration_date
        return await self._post(f"{self.env.env_v2}/apiTokens", json_data=payload)

    # ========================================================================
    # ENVIRONMENT API v2 - SYNTHETIC MONITORS (bulk ops not in GUI)
    # ========================================================================

    async def list_synthetic_monitors(self) -> ApiResponse:
        """List all synthetic monitors."""
        return await self._get(f"{self.env.env_v1}/synthetic/monitors")

    async def get_synthetic_monitor(self, monitor_id: str) -> ApiResponse:
        return await self._get(f"{self.env.env_v1}/synthetic/monitors/{monitor_id}")

    async def toggle_synthetic_monitor(self, monitor_id: str, enabled: bool) -> ApiResponse:
        """Enable or disable a synthetic monitor."""
        return await self._put(
            f"{self.env.env_v1}/synthetic/monitors/{monitor_id}",
            json_data={"enabled": enabled},
        )

    # ========================================================================
    # ENVIRONMENT API v2 - RELEASES (not in GUI)
    # ========================================================================

    async def get_releases(self, from_ts: str = "now-30d", to_ts: str = "now") -> list:
        """Get software release information."""
        return await self._paginate_v2(
            f"{self.env.env_v2}/releases",
            params={"from": from_ts, "to": to_ts, "pageSize": 500},
            items_key="releases",
        )

    # ========================================================================
    # ENVIRONMENT API v2 - BUSINESS EVENTS (not in GUI)
    # ========================================================================

    async def ingest_biz_event(self, events: list[dict]) -> ApiResponse:
        """
        Ingest business events for Business Observability.
        Each event: {"type": "com.mycompany.checkout", "data": {...}}
        """
        return await self._post(
            f"{self.env.env_v2}/bizevents/ingest",
            json_data=events,
            headers={**self.env.api_header(), "Content-Type": "application/cloudevents-batch+json"},
        )

    # ========================================================================
    # ENVIRONMENT API v2 - DAVIS EVENTS (not in GUI)
    # ========================================================================

    async def get_events(self, event_selector: str = "",
                         from_ts: str = "now-2h", to_ts: str = "now") -> list:
        """
        Get Davis events with pagination.
        event_selector: e.g. 'eventType("ERROR_EVENT")'
        """
        params = {"from": from_ts, "to": to_ts, "pageSize": 500}
        if event_selector:
            params["eventSelector"] = event_selector
        return await self._paginate_v2(f"{self.env.env_v2}/events", params=params, items_key="events")

    async def ingest_event(self, event_type: str, title: str,
                           entity_selector: str = "", properties: dict | None = None,
                           timeout_minutes: int = 15) -> ApiResponse:
        """
        Ingest a custom event (not available in GUI).
        event_type: CUSTOM_INFO, CUSTOM_ALERT, CUSTOM_ANNOTATION, CUSTOM_CONFIGURATION, CUSTOM_DEPLOYMENT
        """
        payload = {
            "eventType": event_type,
            "title": title,
            "timeout": timeout_minutes,
        }
        if entity_selector:
            payload["entitySelector"] = entity_selector
        if properties:
            payload["properties"] = properties
        return await self._post(f"{self.env.env_v2}/events/ingest", json_data=payload)
