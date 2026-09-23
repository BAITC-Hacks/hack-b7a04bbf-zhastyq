from fastapi.testclient import TestClient

from money_graph.bootstrap import build_api


def test_cards_add_linked_advice_without_changing_graph_csv_or_legacy_fields(
    tmp_path, payloads, fake_model
):
    with TestClient(build_api(tmp_path / "versions", language_model=fake_model)) as client:
        upload = client.post(
            "/api/analyze",
            files={name: (f"{name}.parquet", content) for name, content in payloads.items()},
        )
        assert upload.status_code == 200
        graph = client.get("/api/analysis").json()
        exports = {
            name: client.get(f"/api/exports/{name}").content
            for name in ("nodes_roles.csv", "clusters.csv", "top_nodes.csv")
        }
        expected_specific = {
            "100000000000000001": ["SEED_INCOMING_INCOMPLETE", "OUTFLOW_EXCEEDS_INFLOW"],
            "100000000000000002": [],
            "100000000000000003": ["DEPTH_BOUNDARY"],
            "100000000000000004": ["SEED_INCOMING_INCOMPLETE", "ISOLATED_NODE"],
        }
        for node in graph["nodes"]:
            gid = node["gid"]
            response = client.get(f"/api/nodes/{gid}")
            assert response.status_code == 200
            card = response.json()
            assert set(card) == {
                "analysis_id",
                "node",
                "incoming",
                "outgoing",
                "limitations",
                "data_gaps",
                "next_requests",
            }
            assert card["node"] == node
            assert isinstance(card["node"]["gid"], str)
            assert card["analysis_id"] == graph["analysis_id"]
            assert card["incoming"] == [e for e in graph["edges"] if e["dst"] == gid]
            assert card["outgoing"] == [e for e in graph["edges"] if e["src"] == gid]
            assert card["limitations"][:2] == [
                "Наблюдаются только внутрибанковские переводы за июль 2026 от 5000 KZT; "
                "полный баланс неизвестен",
                "Роль и оценки — гипотезы для проверки, не вероятность и не вывод о виновности",
            ]
            general = ["INTRABANK_ONLY", "AMOUNT_THRESHOLD", "LIMITED_PERIOD"]
            if "OUTFLOW_EXCEEDS_INFLOW" not in expected_specific[gid]:
                general.append("BALANCES_UNAVAILABLE")
            codes = [gap["code"] for gap in card["data_gaps"]]
            assert codes == expected_specific[gid] + general
            assert codes == [item["gap_code"] for item in card["next_requests"]]
            assert len(set(codes)) == len(codes)
            for gap, request in zip(card["data_gaps"], card["next_requests"], strict=True):
                assert set(gap) == {"code", "description", "evidence"}
                assert set(request) == {"gap_code", "request", "reason"}
                assert all(isinstance(value, str) and value for value in gap.values())
                assert all(isinstance(value, str) and value for value in request.values())
            assert client.get(f"/api/nodes/{gid}").json() == card
        assert client.get("/api/analysis").json() == graph
        for name, content in exports.items():
            assert client.get(f"/api/exports/{name}").content == content
        assert fake_model.calls == []
