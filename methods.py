import json
import re
import time
import requests


def get_emails_from_text(emails_raw):
    email_re = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'
    emails = re.findall(email_re, emails_raw)
    return emails


def delete_user(bearer_header, user_email, users):
    delete_user_url = f"https://api.dynatrace.com/iam/v1/accounts/{users.account}/users/{user_email}"
    deleted_user = requests.delete(url=delete_user_url,
                                   headers=bearer_header)

    deleted_user_fetched = deleted_user.status_code
    if 200 < deleted_user_fetched:
        return True
    else:
        return False


def add_user(bearer_token, user_email, users):
    new_user = requests.post(data={'email': user_email},
                             url=f"https://api.dynatrace.com/iam/v1/accounts/{users.account}/users",
                             headers={"Authorization": f"Bearer {bearer_token}"})

    new_user_fetched = new_user.status_code
    if 200 < new_user_fetched < 300:
        return True
    else:
        return False


def assign_group(bearer_token, user_email, group_ids, users):
    groups_url = f"https://api.dynatrace.com/iam/v1/accounts/{users.account}/users/{user_email}"
    groups_raw = requests.post(url=groups_url,
                               headers={"Authorization": f"Bearer {bearer_token}",
                                        "Content-Type": "application/json"},
                               data=json.dumps(group_ids))

    groups_fetched = groups_raw.status_code
    if 200 < groups_fetched < 300:
        return True
    else:
        return False


def get_tenant_token(dt_token, account):
    token_url = f"https://{account}.live.dynatrace.com/api/v1/deployment/installer/agent/connectioninfo"
    token_raw = requests.get(url=token_url,
                             headers={f"Authorization": f"Api-Token {dt_token}"})

    return token_raw.text


def get_hosts(dt_token, account):
    months_7 = 18489500
    months_7_ago = (int(time.time()) - months_7) * 1000

    hosts_url = f"https://{account}.live.dynatrace.com/api/v1/oneagents?startTimestamp={months_7_ago}"
    hosts_raw = requests.get(url=hosts_url,
                             headers={f"Authorization": f"Api-Token {dt_token}"})
    print(hosts_raw.text)
    return hosts_raw.text


def get_custom_host_tags(dt_token, account):
    custom_host_tags_url = f"https://{account}.live.dynatrace.com/api/v2/tags?entitySelector=type(%22HOST%22)"
    custom_host_tags_raw = requests.get(url=custom_host_tags_url,
                                        headers={f"Authorization": f"Api-Token {dt_token}"})

    return custom_host_tags_raw.text


def get_audit_log(dt_token, account):
    audit_log_url = f"https://{account}.live.dynatrace.com/api/v2/auditlogs"
    audit_log_raw = requests.get(url=audit_log_url,
                                 headers={f"Authorization": f"Api-Token {dt_token}"})

    return audit_log_raw.text


def get_entities(dt_token, account):
    entities_url = f"https://{account}.live.dynatrace.com/api/v2/entityTypes"
    entities_raw = requests.get(url=entities_url,
                                headers={f"Authorization": f"Api-Token {dt_token}"})

    return entities_raw.text


def get_request_names(dt_token, account):
    request_names_url = f"https://{account}.live.dynatrace.com/api/config/v1/service/requestNaming"
    request_names_raw = requests.get(url=request_names_url,
                                     headers={f"Authorization": f"Api-Token {dt_token}"})

    returned = json.loads(request_names_raw.text)["values"]
    for item in returned:
        item["details"] = json.loads(get_request_name_details(id=item["id"],
                                                              dt_token=dt_token,
                                                              account=account))
        print(item)

    return returned


def get_request_name_details(dt_token, account, id):
    request_name_url = f"https://{account}.live.dynatrace.com/api/config/v1/service/requestNaming/{id}"
    request_name_raw = requests.get(url=request_name_url,
                                    headers={f"Authorization": f"Api-Token {dt_token}"})

    print(request_name_raw.text)
    return request_name_raw.text


def add_request_name(dt_token, account, data):
    requests_url = f"https://{account}.live.dynatrace.com/api/config/v1/service/requestNaming/"
    requests_raw = requests.post(url=requests_url,
                                 headers={f"Authorization": f"Api-Token {dt_token}",
                                          "Content-Type": "application/json",
                                          },

                                 data=data)

    print(requests_raw.text)
    return requests_raw.status_code


def delete_request_name(dt_token, account, id):
    requests_url = f"https://{account}.live.dynatrace.com/api/config/v1/service/requestNaming/{id}"
    requests_raw = requests.delete(url=requests_url,
                                   headers={f"Authorization": f"Api-Token {dt_token}"})

    print(requests_raw.text)
    return requests_raw.status_code


def add_custom_host_tags(dt_token, account, hostname, tag_key, tag_value):
    """This should ideally be based on IDs instead of host names to prevent potential collision"""
    custom_host_tags_url = f"https://{account}.live.dynatrace.com/api/v2/tags?entitySelector=type(%22HOST%22),entityName.equals({hostname})"
    print(custom_host_tags_url)
    custom_host_tags_raw = requests.post(url=custom_host_tags_url,
                                         headers={f"Authorization": f"Api-Token {dt_token}",
                                                  "Content-Type": "application/json"},

                                         data=json.dumps({"tags": [{"key": f"{tag_key}",
                                                                    "value": f"{tag_value}"}]}))

    return custom_host_tags_raw.text


def remove_custom_host_tag(dt_token, account, hostname, tag_key):
    """This should ideally be based on IDs instead of host names to prevent potential collision"""

    custom_host_tags_url = f"https://{account}.live.dynatrace.com/api/v2/tags?entitySelector=entityName.equals({hostname}),type(%22HOST%22),tag(%22{tag_key}%22)&key={tag_key}&deleteAllWithKey=true"
    custom_host_tags_raw = requests.delete(url=custom_host_tags_url,
                                           headers={f"Authorization": f"Api-Token {dt_token}",
                                                    "Content-Type": "application/json"})
    return custom_host_tags_raw.text


def get_bearer_header(bearer_token):
    bearer_header = {"Authorization": f"Bearer {bearer_token}"}
    return bearer_header


def enable_host(host_id, dt_token, account):
    get_monitoring_mode_url = f"https://{account}.live.dynatrace.com/api/config/v1/hosts/{host_id}"
    get_monitoring_mode_raw = requests.get(url=get_monitoring_mode_url,
                                           headers={f"Authorization": f"Api-Token {dt_token}",
                                                    "Content-Type": "application/json"})

    get_monitoring_mode=json.loads(get_monitoring_mode_raw.text)
    monitoringMode = (get_monitoring_mode["monitoringConfig"]["monitoringMode"])

    enable_url = f"https://{account}.live.dynatrace.com/api/config/v1/hosts/{host_id}/monitoring"
    enable_raw = requests.put(url=enable_url,
                              data=json.dumps({"body": "MonitoringConfig", "monitoringEnabled": True,
                                               "monitoringMode": monitoringMode}),
                              headers={f"Authorization": f"Api-Token {dt_token}",
                                       "Content-Type": "application/json"})

    return {"status": enable_raw.status_code,
            "monitoringMode": monitoringMode}


def disable_host(host_id, dt_token, account):
    get_monitoring_state_url = f"https://{account}.live.dynatrace.com/api/config/v1/hosts/{host_id}"
    get_monitoring_state_raw = requests.get(url=get_monitoring_state_url,
                                            headers={"Authorization": f"Api-Token {dt_token}",
                                                     "Content-Type": "application/json"})

    monitoring_config = json.loads(get_monitoring_state_raw.text)["monitoringConfig"]
    monitoring_enabled = monitoring_config["monitoringEnabled"]
    monitoring_mode = monitoring_config["monitoringMode"]

    if monitoring_enabled:
        disable_url = f"https://{account}.live.dynatrace.com/api/config/v1/hosts/{host_id}/monitoring"
        disable_raw = requests.put(url=disable_url,
                                   data=json.dumps({"monitoringEnabled": False,
                                                    "monitoringMode": monitoring_mode}),
                                   headers={"Authorization": f"Api-Token {dt_token}",
                                            "Content-Type": "application/json"})

        return disable_raw.status_code
    else:
        return "Already disabled, skipped"


def get_bearer_token(users) -> str:
    bearer_url = "https://sso.dynatrace.com/sso/oauth2/token"
    bearer_raw = requests.post(data={"grant_type": "client_credentials",
                                     "client_id": "dt0s02.UFG3HIBP",
                                     "client_secret": users.secret,
                                     "scope": "account-idm-read account-idm-write",
                                     "resource": f"urn:dtaccount:{users.account}"},
                               url=bearer_url)

    bearer_fetched = json.loads(bearer_raw.text)
    bearer_token = bearer_fetched["access_token"]
    return bearer_token


def list_groups(bearer_header, users) -> list:
    groups_url = f"https://api.dynatrace.com/iam/v1/accounts/{users.account}/groups"

    groups_raw = requests.get(url=groups_url,
                              headers=bearer_header)

    groups_fetched = json.loads(groups_raw.text)

    nice_groups = []

    for item in groups_fetched["items"]:
        nice_groups.append({"name": item["name"],
                            "uuid": item["uuid"]})

    return nice_groups
