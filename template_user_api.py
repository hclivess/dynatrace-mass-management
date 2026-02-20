import json

import requests

from secrets import get_tokens

tokens = get_tokens("secrets.json")

account = tokens["account_management"]["account"]
secret = tokens["account_management"]["secret"]
user_email = 'dynatest@forvia.com'

# get bearer token
bearer_url = "https://sso.dynatrace.com/sso/oauth2/token"
bearer_raw = requests.post(data={"grant_type": "client_credentials",
                                 "client_id": "dt0s02.UFG3HIBP",
                                 "client_secret": secret,
                                 "scope": "account-idm-read account-idm-write",
                                 "resource": f"urn:dtaccount:{account}"},
                           url=bearer_url)

bearer_fetched = json.loads(bearer_raw.text)
bearer_token = bearer_fetched["access_token"]
print(f"Fetched bearer token: {bearer_token}")
# /get bearer token

# list all users
users_url = f"https://api.dynatrace.com/iam/v1/accounts/{account}/users"

bearer_raw = requests.get(url=users_url,
                          headers={"Authorization": f"Bearer {bearer_token}",
                                   "Content-Type": "application/json"})

users_fetched = bearer_raw.text
print(f"Fetched users: {users_fetched}")
# /list all users

# list all groups
groups_url = f"https://api.dynatrace.com/iam/v1/accounts/{account}/groups"

groups_raw = requests.get(url=groups_url,
                          headers={"Authorization": f"Bearer {bearer_token}",
                                   "Content-Type": "application/json"})

groups_fetched = groups_raw.text
print(f"List of all groups: {groups_fetched}")
# /list all groups

# add new user

new_user = requests.post(data={'email': user_email},
                         url=users_url,
                         headers={"Authorization": f"Bearer {bearer_token}"})

new_user_fetched = new_user.status_code
if new_user_fetched == 201:
    print(f"Added user {user_email} successfully")
else:
    print(f"Issue adding user: {new_user_fetched}")
# /add new user


# add user to group "read only"
group_ids = json.dumps(["8be889a3-791c-4792-ba35-e403d3906176"])  # read only group
groups_url = f"https://api.dynatrace.com/iam/v1/accounts/{account}/users/{user_email}"
groups_raw = requests.post(url=groups_url,
                           headers={"Authorization": f"Bearer {bearer_token}",
                                    "Content-Type": "application/json"},
                           data=group_ids)

groups_fetched = groups_raw.status_code

print(group_ids)
print(groups_raw.text)
print(groups_url)

if groups_fetched in [200, 201]:
    print(f"Added user {user_email} to user groups {group_ids} successfully")
else:
    print(f"Issue adding user to groups: {groups_fetched}")
# /add user to group "read only"

# delete user

delete_user_url = f"https://api.dynatrace.com/iam/v1/accounts/{account}/users/{user_email}"
deleted_user = requests.delete(url=delete_user_url,
                               headers={"Authorization": f"Bearer {bearer_token}",
                                        "Content-Type": "application/json"})

deleted_user_fetched = deleted_user.status_code
if deleted_user_fetched in [200, 201]:
    print(f"Deleted user {user_email} successfully")
else:
    print(f"Issue deleting user: {deleted_user_fetched}")

# /delete user
