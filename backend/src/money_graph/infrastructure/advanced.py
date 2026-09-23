from collections import Counter, defaultdict
from datetime import timedelta
from itertools import islice
from statistics import median
from typing import Any

import networkx as nx

from money_graph.application.ports import Dataset


def temporal_patterns(dataset: Dataset) -> list[dict[str, Any]]:
    incoming: dict[int, dict[Any, float]] = defaultdict(lambda: defaultdict(float))
    outgoing: dict[int, dict[Any, float]] = defaultdict(lambda: defaultdict(float))
    payers: dict[tuple[int, Any], set[int]] = defaultdict(set)
    daily_count: Counter[tuple[int, Any]] = Counter()
    daily_sum: dict[tuple[int, Any], float] = defaultdict(float)
    dates = [tx.date for tx in dataset.transactions]
    for tx in dataset.transactions:
        incoming[tx.dst][tx.date] += tx.sum_kzt
        outgoing[tx.src][tx.date] += tx.sum_kzt
        payers[tx.dst, tx.date].add(tx.src)
        for gid in (tx.src, tx.dst):
            daily_count[gid, tx.date] += 1
            daily_sum[gid, tx.date] += tx.sum_kzt
    results = []
    for gid, by_day in incoming.items():
        for received_day, received in by_day.items():
            for delta in (0, 1, 2):
                sent_day = received_day + timedelta(days=delta)
                sent = outgoing[gid].get(sent_day, 0.0)
                if sent:
                    results.append({"kind": "rapid_transit", "gid": gid,
                                    "received_date": received_day.isoformat(), "sent_date": sent_day.isoformat(),
                                    "received_kzt": round(received, 2), "sent_kzt": round(sent, 2),
                                    "days": delta})
    for (gid, day), sources in payers.items():
        if len(sources) >= 2:
            results.append({"kind": "synchronized_inflow", "gid": gid, "date": day.isoformat(),
                            "n_payers": len(sources), "payer_gids": sorted(sources),
                            "sum_kzt": round(incoming[gid][day], 2)})
    if dates:
        span = max(1, (max(dates) - min(dates)).days + 1)
        total_counts = Counter()
        for (gid, day), count in daily_count.items():
            total_counts[gid] += count
        for (gid, day), count in daily_count.items():
            baseline = total_counts[gid] / span
            if count >= 3 and count >= 3 * baseline:
                results.append({"kind": "activity_spike", "gid": gid, "date": day.isoformat(),
                                "n_tx": count, "sum_kzt": round(daily_sum[gid, day], 2),
                                "daily_baseline": round(baseline, 2), "threshold_multiplier": 3})
    return sorted(results, key=lambda x: (x["gid"], x["kind"], x.get("date", x.get("received_date", ""))))


def routes_and_cycles(graph: nx.DiGraph) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    routes = []
    for middle in graph.nodes:
        for src in graph.predecessors(middle):
            first = graph[src][middle]
            if first["n_tx"] < 2:
                continue
            for dst in graph.successors(middle):
                second = graph[middle][dst]
                if second["n_tx"] >= 2 and src != dst:
                    routes.append({"src": src, "via": middle, "dst": dst,
                                   "observed_repetitions_min": min(first["n_tx"], second["n_tx"]),
                                   "first_kzt": first["sum_kzt"], "second_kzt": second["sum_kzt"],
                                   "limitation": "Повторяются рёбра, связь между конкретными переводами не установлена"})
    routes.sort(key=lambda x: (-x["observed_repetitions_min"], x["src"], x["via"], x["dst"]))
    cycles = []
    for cycle in islice(nx.simple_cycles(graph, length_bound=4), 100):
        if len(cycle) >= 2:
            edges = [(cycle[i], cycle[(i + 1) % len(cycle)]) for i in range(len(cycle))]
            cycles.append({"gids": cycle, "n_edges": len(cycle),
                           "edge_sums_kzt": [graph[a][b]["sum_kzt"] for a, b in edges],
                           "limitation": "Цикл связей не доказывает возврат тех же денег"})
    return routes[:100], cycles


def detect_anomalies(dataset: Dataset, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_pair: dict[tuple[int, int], list[float]] = defaultdict(list)
    for tx in dataset.transactions:
        by_pair[tx.src, tx.dst].append(tx.sum_kzt)
    findings = []
    for (src, dst), values in by_pair.items():
        near_floor = [value for value in values if 5000 <= value < 10000]
        if len(near_floor) >= 3 and sum(near_floor) >= 20000:
            findings.append({"kind": "observed_splitting", "gid": src, "dst": dst,
                             "n_tx": len(near_floor), "sum_kzt": round(sum(near_floor), 2),
                             "range_kzt": [5000, 10000], "min_count": 3,
                             "limitation": "Переводы ниже 5000 KZT не наблюдаются"})
    by_depth: dict[int, list[int]] = defaultdict(list)
    for row in rows:
        by_depth[row["depth"]].append(row["out_deg"])
    for row in rows:
        baseline = median(by_depth[row["depth"]])
        threshold = max(3.0, 3 * baseline)
        if row["out_deg"] >= threshold and row["out_deg"] > baseline:
            findings.append({"kind": "unusual_out_degree", "gid": row["gid"],
                             "depth": row["depth"], "out_deg": row["out_deg"],
                             "depth_median": baseline, "threshold": threshold,
                             "peer_count": len(by_depth[row["depth"]])})
    return sorted(findings, key=lambda x: (x["gid"], x["kind"]))


def robustness(graph: nx.DiGraph, rows: list[dict[str, Any]]) -> dict[str, Any]:
    top_n = min(5, max(1, len(rows) // 100))
    selected = sorted(rows, key=lambda x: (-x["priority_score"], x["gid"]))[:top_n]
    before = [len(group) for group in nx.weakly_connected_components(graph)]
    reduced = graph.copy()
    reduced.remove_nodes_from(row["gid"] for row in selected)
    after = [len(group) for group in nx.weakly_connected_components(reduced)]
    return {"top_n": top_n, "removed_gids": [row["gid"] for row in selected],
            "selection": "Наибольший priority_score, при равенстве меньший gid",
            "before": {"n_components": len(before), "largest_component": max(before, default=0)},
            "after": {"n_components": len(after), "largest_component": max(after, default=0)}}


def enrich(dataset: Dataset, graph: nx.DiGraph, rows: list[dict[str, Any]]) -> dict[str, Any]:
    temporal = temporal_patterns(dataset)
    routes, cycles = routes_and_cycles(graph)
    anomalies = detect_anomalies(dataset, rows)
    by_gid_temporal: dict[int, list[dict[str, Any]]] = defaultdict(list)
    by_gid_anomaly: dict[int, list[dict[str, Any]]] = defaultdict(list)
    by_gid_route: dict[int, list[dict[str, Any]]] = defaultdict(list)
    by_gid_cycle: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for item in temporal:
        by_gid_temporal[item["gid"]].append(item)
    for item in anomalies:
        by_gid_anomaly[item["gid"]].append(item)
    for item in routes:
        for gid in (item["src"], item["via"], item["dst"]):
            by_gid_route[gid].append(item)
    for item in cycles:
        for gid in item["gids"]:
            by_gid_cycle[gid].append(item)
    for row in rows:
        gid = row["gid"]
        gaps = ["Нет внешних межбанковских переводов и операций ниже 5000 KZT"]
        next_request = "Запросить внешние переводы и остатки по счёту"
        if row["truncated_by_depth"]:
            gaps.append("Исходящие после четвёртого колена неизвестны")
            next_request = "Запросить исходящие переводы следующего колена для gid"
        elif row["is_seed"]:
            gaps.append("Входящие seed из-за пределов выборки неизвестны")
            next_request = "Запросить полную историю входящих переводов seed"
        row["temporal_patterns"] = by_gid_temporal[gid][:20]
        row["anomalies"] = by_gid_anomaly[gid][:20]
        row["routes"] = by_gid_route[gid][:20]
        row["cycles"] = by_gid_cycle[gid][:20]
        row["data_gaps"] = gaps
        row["next_request"] = f"{next_request} {gid}"
    return {"temporal_patterns": temporal[:500], "repeated_routes": routes,
            "cycles": cycles, "anomalies": anomalies[:500], "robustness": robustness(graph, rows),
            "limitations": ["Маршруты и циклы описывают связи, а не трассировку одних и тех же денег"]}
