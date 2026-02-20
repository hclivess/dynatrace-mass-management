import requests
import json
from secrets import get_tokens


def fetch_url(url):
    fetched = requests.get(url, headers=header)
    text = json.loads(fetched.text)
    return text

environments = get_tokens("secrets.json")["environments"]

for env in environments:
    if env["name"] == "ShopFloor":
        account = env["account"]
        secret = env["secret"]
    
header = {
    "Authorization": f"Api-Token {secret}"}

text_schemas = fetch_url(f"https://{account}.live.dynatrace.com/api/v2/settings/schemas")
#print(json.dumps(text_schemas, indent=2))

schema_ids = []
for item in text_schemas["items"]:
    schema_ids.append(item["schemaId"])

objects = fetch_url(
    f"https://{account}.live.dynatrace.com/api/v2/settings/objects?schemaIds={','.join(schema_ids)}")
#print(json.dumps(objects, indent=2))

values = fetch_url(
    f"https://{account}.live.dynatrace.com/api/v2/settings/effectiveValues?schemaIds=builtin:anomaly-detection.services&scope=environment")
#print(json.dumps(values, indent=2))

tags = fetch_url(f"https://{account}.live.dynatrace.com/api/config/v1/autoTags")
#print(json.dumps(tags, indent=2))

autotag_ids = []
for item in tags["values"]:
    autotag_ids.append(item["id"])

for item in autotag_ids:
    tags_details = fetch_url(f"https://{account}.live.dynatrace.com/api/config/v1/autoTags/{item}")
    print(json.dumps(tags_details, indent=2))
