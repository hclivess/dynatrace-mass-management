import json

def get_tokens(file):
    with open(file, "r") as token_file:
        return json.load(token_file)