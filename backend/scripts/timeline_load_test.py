"""
Simple load test for timeline publishing.

Usage:
  python backend/scripts/timeline_load_test.py [--redis REDIS_URL] [--concurrency N] [--events M]

If REDIS_URL is provided, the script will try to use RedisCacheAdapter; otherwise it uses the InMemoryCacheAdapter.
This script publishes M events across N concurrent tasks and reports throughput and max latency.
"""

import argparse
import asyncio
import time
from statistics import mean

from backend.app.utils.timeline import publish_timeline_event, clear_in_memory_timelines
from backend.app.cache.adapters import InMemoryCacheAdapter, RedisCacheAdapter


async def worker(adapter, query_hash, events, idx, results):
    latencies = []
    for i in range(events):
        t0 = time.perf_counter()
        ev = await publish_timeline_event(adapter, query_hash=query_hash, step="load.test.event", payload={"i": i, "worker": idx})
        lat = time.perf_counter() - t0
        latencies.append(lat)
        results.append(lat)
        # optional tiny sleep to avoid extremely tight loop
        await asyncio.sleep(0)
    return latencies


async def main(redis_url: str | None, concurrency: int, events: int):
    total = concurrency * events
    if redis_url:
        print(f"Attempting to use Redis at {redis_url}")
        try:
            adapter = RedisCacheAdapter(redis_url)
        except Exception as exc:
            print("Failed to create Redis adapter, falling back to InMemory:", exc)
            adapter = InMemoryCacheAdapter()
    else:
        adapter = InMemoryCacheAdapter()

    query_hash = f"load-test-{int(time.time())}"
    await clear_in_memory_timelines(query_hash)

    results = []
    tasks = [worker(adapter, query_hash, events, idx, results) for idx in range(concurrency)]
    start = time.perf_counter()
    await asyncio.gather(*tasks)
    elapsed = time.perf_counter() - start

    print(f"Published {total} events in {elapsed:.2f}s")
    print(f"Throughput: {total/elapsed:.2f} events/s")
    if results:
        print(f"Latency (ms): min={min(results)*1000:.2f} avg={mean(results)*1000:.2f} p95={sorted(results)[int(len(results)*0.95)]*1000:.2f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--redis", help="Redis URL (optional)")
    parser.add_argument("--concurrency", type=int, default=5, help="Number of concurrent workers")
    parser.add_argument("--events", type=int, default=100, help="Events per worker")
    args = parser.parse_args()

    asyncio.run(main(args.redis, args.concurrency, args.events))
