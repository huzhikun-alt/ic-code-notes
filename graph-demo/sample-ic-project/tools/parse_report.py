import os
import json
from utils import normalize
import missing_module

def main(path):
    with open(path) as fh:
        data = json.load(fh)
    return normalize(data)
