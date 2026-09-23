from money_graph.application.ports import Analysis, Dataset
from money_graph.application.use_cases import AnalysisError, AnalysisService
from money_graph.domain.models import Node


class Reader:
    def read(self, paths):
        if "nodes" not in paths:
            raise ValueError("missing nodes")
        return Dataset((Node(123456789012345, 4, False),), (), ())


class Analyzer:
    def analyze(self, dataset):
        return Analysis("", {"n_nodes": len(dataset.nodes)}, [{"gid": 123456789012345, "is_seed": False,
            "truncated_by_depth": True, "in_deg": 1, "out_deg": 0, "in_kzt": 10000.0, "out_kzt": 0.0}], [], [], [])


class Publisher:
    def __init__(self):
        self.value = None
        self.fail = False

    def load(self):
        return self.value

    def publish(self, analysis):
        if self.fail:
            raise OSError("disk full")
        self.value = analysis


class Model:
    def answer(self, question, facts, limitations):
        return f"gid {facts['selected_nodes'][0]['gid']}: вход 10000 KZT; граница наблюдения."


def test_atomic_active_analysis_and_card():
    publisher = Publisher()
    service = AnalysisService(Reader(), Analyzer(), publisher, Model())
    first = service.analyze({"nodes": "example"})
    assert service.node_card(123456789012345)["node"]["gid"] == 123456789012345
    assert "четвёртым" in service.node_card(123456789012345)["limitations"][-1]
    publisher.fail = True
    try:
        service.analyze({"nodes": "example"})
    except OSError:
        pass
    assert service.current().analysis_id == first.analysis_id


def test_question_checks_version_and_known_gid():
    service = AnalysisService(Reader(), Analyzer(), Publisher(), Model())
    result = service.analyze({"nodes": "example"})
    response = service.ask(result.analysis_id, "Почему в топе?", [123456789012345])
    assert response["references"][0]["gid"] == 123456789012345
    try:
        service.ask("old", "Почему?", [123456789012345])
    except AnalysisError as exc:
        assert exc.code == "STALE_ANALYSIS"
    else:
        assert False
