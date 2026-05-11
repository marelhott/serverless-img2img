import runpod

from worker.handler import handler


runpod.serverless.start({"handler": handler})

