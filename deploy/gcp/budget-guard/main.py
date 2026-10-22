"""Budget kill switch: stop every running VM in the project once spending
reaches STOP_AT.

Cloud Billing publishes the month's cost for the budget to Pub/Sub several
times a day, whether or not a threshold was crossed. Stopping (not deleting)
keeps the disk and its data; a stopped VM has no compute charge and releases
its ephemeral public IP.
"""

import base64
import json
import os

import functions_framework
from google.cloud import compute_v1

PROJECT = os.environ["PROJECT_ID"]
STOP_AT = float(os.environ.get("STOP_AT", "0.75"))


@functions_framework.cloud_event
def guard(event) -> None:
    notification = json.loads(base64.b64decode(event.data["message"]["data"]))
    cost = float(notification["costAmount"])
    if cost < STOP_AT:
        print(f"Cost {cost:.2f} is below {STOP_AT:.2f}; nothing to do.")
        return

    client = compute_v1.InstancesClient()
    for zone, scoped in client.aggregated_list(project=PROJECT):
        for instance in scoped.instances:
            if instance.status == "RUNNING":
                print(f"Cost {cost:.2f} reached {STOP_AT:.2f}; stopping {instance.name}.")
                client.stop(
                    project=PROJECT, zone=zone.removeprefix("zones/"), instance=instance.name
                )
