import csv
import io
from collections import defaultdict
from datetime import date

import pyarrow as pa
import pyarrow.parquet as pq
from fastapi.testclient import TestClient

from money_graph.bootstrap import build_api

A, B, C, D = 100000000000000001, 100000000000000002, 100000000000000003, 100000000000000004


def upload(client, transactions):
    aggregate = defaultdict(list)
    for src, dst, _day, amount in transactions:
        aggregate[src, dst].append(amount)
    tables = {
        "nodes": pa.table(
            {"gid": [A, B, C, D], "depth": [0, 1, 1, 1], "is_seed": [True, False, False, False]}
        ),
        "edges": pa.Table.from_pylist(
            [
                {"src": src, "dst": dst, "sum_kzt": sum(amounts), "n_tx": len(amounts), "depth": 1}
                for (src, dst), amounts in aggregate.items()
            ],
            schema=pa.schema(
                [
                    ("src", pa.int64()),
                    ("dst", pa.int64()),
                    ("sum_kzt", pa.float64()),
                    ("n_tx", pa.int64()),
                    ("depth", pa.int8()),
                ]
            ),
        ),
        "transactions": pa.Table.from_pylist(
            [
                {"src": src, "dst": dst, "date": date(2026, 7, day), "sum_kzt": amount}
                for src, dst, day, amount in transactions
            ],
            schema=pa.schema(
                [
                    ("src", pa.int64()),
                    ("dst", pa.int64()),
                    ("date", pa.date32()),
                    ("sum_kzt", pa.float64()),
                ]
            ),
        ),
    }
    files = {}
    for name, table in tables.items():
        stream = io.BytesIO()
        pq.write_table(table, stream)
        files[name] = (f"{name}.parquet", stream.getvalue())
    response = client.post("/api/analyze", files=files)
    assert response.status_code == 200, response.text
    return response.json()


def test_temporal_contract_precise_senders_and_no_recalculation(tmp_path, monkeypatch, fake_model):
    transactions = [(B, A, 1, 5000.0)] * 3 + [(C, A, 1, 5000.0), (D, A, 1, 5000.0)]
    transactions += [(A, B, 2, 5000.0)] * 2
    with TestClient(build_api(tmp_path / "versions", language_model=fake_model)) as client:
        uploaded = upload(client, transactions)
        publisher = client.app.state.services.publish

        def forbidden(*args):
            raise AssertionError("GET must not reread Parquet or recalculate the analysis")

        monkeypatch.setattr(publisher._analyzer, "execute", forbidden)
        monkeypatch.setattr(publisher._analyzer._reader, "read", forbidden)
        graph = client.get("/api/analysis").json()
        assert graph["temporal_summary"] == {
            "rapid_outflow": 1,
            "synchronized_inflow": 1,
            "activity_spike": 1,
            "n_nodes": 1,
        }
        card = client.get(f"/api/nodes/{A}").json()
        assert card["analysis_id"] == uploaded["analysis_id"]
        assert card["node"] == next(node for node in graph["nodes"] if node["gid"] == str(A))
        patterns = card["temporal_patterns"]
        assert patterns["total_count"] == 3 and patterns["truncated"] is False
        rapid, synchronized, spike = patterns["items"]
        assert rapid["kind"] == "rapid_outflow" and rapid["date"] == "2026-07-01"
        assert rapid["incoming_n_tx"] == 5 and rapid["incoming_sum_kzt"] == 25000
        assert rapid["outgoing_days"] == [
            {"date": "2026-07-02", "interval_days": 1, "n_tx": 2, "sum_kzt": 10000}
        ]
        assert synchronized["kind"] == "synchronized_inflow"
        assert synchronized["sender_gids"] == [str(B), str(C), str(D)]
        assert float(C) == float(D) and str(C) != str(D)
        assert spike["kind"] == "activity_spike" and spike["period_n_tx"] == 7
        assert spike["period_days"] == 31 and spike["n_tx"] == 5
        assert all(item["explanation"] and item["limitations"] for item in patterns["items"])
        assert client.get(f"/api/nodes/{A}").json() == card
        schemas = client.get("/openapi.json").json()["components"]["schemas"]
        item_schema = schemas["TemporalPatternsResponse"]["properties"]["items"]["items"]
        assert item_schema["discriminator"]["propertyName"] == "kind"
        assert len(item_schema["oneOf"]) == 3
        assert fake_model.calls == []
        expected_headers = {
            "nodes_roles.csv": [
                "gid",
                "role",
                "role_score",
                "cluster_id",
                "priority_score",
                "evidence",
            ],
            "clusters.csv": [
                "cluster_id",
                "n_nodes",
                "n_seed",
                "sum_kzt_internal",
                "top_gids",
                "hypothesis",
            ],
            "top_nodes.csv": ["rank", "gid", "role", "priority_score", "why"],
        }
        for name, header in expected_headers.items():
            response = client.get(f"/api/exports/{name}")
            assert response.status_code == 200
            assert next(csv.reader(io.StringIO(response.text))) == header


def test_card_cap_and_summary_count_all_observations_before_truncation(tmp_path):
    transactions = [(src, A, day, 5000.0) for day in range(1, 32) for src in (B, C, D)]
    transactions += [(A, B, day, 25000.0) for day in range(1, 32)]
    with TestClient(build_api(tmp_path / "versions")) as client:
        upload(client, transactions)
        graph = client.get("/api/analysis").json()
        assert graph["temporal_summary"] == {
            "rapid_outflow": 60,
            "synchronized_inflow": 31,
            "activity_spike": 0,
            "n_nodes": 2,
        }
        card = client.get(f"/api/nodes/{A}").json()["temporal_patterns"]
        assert card["total_count"] == 61 and card["truncated"] is True
        assert len(card["items"]) == 50
        assert [(item["date"], item["kind"]) for item in card["items"]] == [
            (f"2026-07-{day:02d}", kind)
            for day in range(1, 26)
            for kind in ("rapid_outflow", "synchronized_inflow")
        ]
        upload(client, list(reversed(transactions)))
        assert client.get(f"/api/nodes/{A}").json()["temporal_patterns"] == card
        assert client.get("/api/analysis").json()["temporal_summary"] == graph["temporal_summary"]


def test_empty_transactions_and_isolated_node_http(tmp_path):
    with TestClient(build_api(tmp_path / "versions")) as client:
        upload(client, [])
        assert client.get("/api/analysis").json()["temporal_summary"] == {
            "rapid_outflow": 0,
            "synchronized_inflow": 0,
            "activity_spike": 0,
            "n_nodes": 0,
        }
        assert client.get(f"/api/nodes/{A}").json()["temporal_patterns"] == {
            "items": [],
            "total_count": 0,
            "truncated": False,
        }
