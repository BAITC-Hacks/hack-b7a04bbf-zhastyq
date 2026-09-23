from dataclasses import replace
from decimal import Decimal

import pytest

from money_graph.application.dto.active_analysis import NodeView
from money_graph.application.dto.question import ModelAnswer
from money_graph.application.exceptions import ApiError, LanguageModelError
from money_graph.application.use_cases.ask_question import AskQuestion
from money_graph.application.use_cases.get_analysis import GetAnalysis
from money_graph.application.use_cases.question_context import (
    MAX_CONTEXT_BYTES,
    build_question_context,
)
from money_graph.domain.entities.edge import Edge

GID_A = 100000000000000001
GID_B = 100000000000000002
GID_C = 100000000000000003


class Store:
    def __init__(self, snapshot):
        self.snapshot = snapshot

    def get(self):
        return self.snapshot


@pytest.fixture
def store(analysis_snapshot):
    return Store(analysis_snapshot)


@pytest.fixture
def ask(store, fake_model):
    return AskQuestion(GetAnalysis(store), fake_model)


def test_correct_answer_server_facts_and_consistent_context(ask, store, fake_model):
    original = store.snapshot
    result = ask.execute("current", "  Почему в топе?  ", (GID_A,))
    assert result.analysis_id == "current"
    assert result.references[0].gid == str(GID_A)
    assert "Роль: peripheral" in result.references[0].facts
    assert "Исходящих контрагентов: 1" in result.references[0].facts
    assert any("seed" in text for text in result.limitations)
    question, context = fake_model.calls[0]
    assert question == "Почему в топе?"
    assert {n.gid for n in context.nodes} == {str(GID_A), str(GID_B)}
    assert context.nodes[0].selected is True
    assert context.nodes[0].top_rank == 1
    assert context.edges[0].src == str(GID_A) and context.edges[0].dst == str(GID_B)
    assert context.edges[0].sum_kzt == "10000"
    assert store.snapshot is original


def test_recipient_reference_is_allowed(ask, fake_model):
    fake_model.reply = ModelAnswer(
        f"Получатель gid={GID_B}: 10000 KZT по наблюдаемой связи.", (str(GID_B),)
    )
    answer = ask.execute("current", "Кому переводит выбранный узел?", (GID_A,))
    assert answer.references[0].gid == str(GID_B)
    assert any(f"{GID_A} → {GID_B}" in fact for fact in answer.references[0].facts)


@pytest.mark.parametrize("question", ["", " \n\t", "x" * 2001])
def test_invalid_question(ask, fake_model, question):
    with pytest.raises(ApiError) as error:
        ask.execute("current", question, (GID_A,))
    assert error.value.code == "INVALID_QUESTION"
    assert fake_model.calls == []


def test_question_length_after_strip(ask, fake_model):
    ask.execute("current", " " * 20 + "x" * 2000 + " " * 20, (GID_A,))
    assert len(fake_model.calls[0][0]) == 2000


@pytest.mark.parametrize("gids", [(), (999,), (GID_A,) * 2, tuple(range(6)), (True,)])
def test_invalid_context(ask, fake_model, gids):
    with pytest.raises(ApiError) as error:
        ask.execute("current", "Почему?", gids)
    assert error.value.code == "INVALID_QUESTION"
    if not gids:
        assert "на графе" in error.value.message
    assert fake_model.calls == []


def test_stale_before_model(ask, fake_model):
    with pytest.raises(ApiError) as error:
        ask.execute("old", "Почему?", (GID_A,))
    assert error.value.code == "STALE_ANALYSIS"
    assert fake_model.calls == []


def test_no_analysis(fake_model):
    with pytest.raises(ApiError) as error:
        AskQuestion(GetAnalysis(Store(None)), fake_model).execute("old", "Почему?", (GID_A,))
    assert error.value.code == "NO_ANALYSIS"
    assert fake_model.calls == []


@pytest.mark.parametrize("fails", [False, True])
def test_analysis_replaced_during_model(ask, store, fake_model, fails):
    fake_model.callback = lambda: setattr(
        store, "snapshot", replace(store.snapshot, analysis_id="new")
    )
    if fails:
        fake_model.error = LanguageModelError("failure")
    with pytest.raises(ApiError) as error:
        ask.execute("current", "Почему?", (GID_A,))
    assert error.value.code == "STALE_ANALYSIS"


@pytest.mark.parametrize(
    "reply",
    [
        ModelAnswer("", (str(GID_A),)),
        ModelAnswer(" ", (str(GID_A),)),
        ModelAnswer("x" * 6001, (str(GID_A),)),
        ModelAnswer("Текст", ()),
        ModelAnswer("Текст", (str(GID_C),)),
        ModelAnswer("Текст", ("999",)),
        ModelAnswer("Текст", (str(GID_A), str(GID_A))),
        ModelAnswer("Выдуманный gid=999", (str(GID_A),)),
        ModelAnswer("Клиент 100000000000000999 получает деньги", (str(GID_A),)),
        ModelAnswer("Текст", (GID_A,)),
        {"answer": "Произвольная структура"},
    ],
)
def test_invalid_model_output_rejected(ask, fake_model, reply):
    fake_model.reply = reply
    with pytest.raises(ApiError) as error:
        ask.execute("current", "Почему?", (GID_A,))
    assert error.value.code == "AI_UNAVAILABLE"
    assert len(fake_model.calls) == 1


def test_model_error_is_sanitized(ask, fake_model):
    fake_model.error = LanguageModelError("private provider diagnostic")
    with pytest.raises(ApiError) as error:
        ask.execute("current", "Почему?", (GID_A,))
    assert error.value.code == "AI_UNAVAILABLE"
    assert "private" not in error.value.message


def test_missing_configuration(store):
    ask = AskQuestion(GetAnalysis(store), None)
    assert ask.ai_configured is False
    with pytest.raises(ApiError) as error:
        ask.execute("current", "Почему?", (GID_A,))
    assert error.value.code == "AI_UNAVAILABLE"


def test_context_boundaries_direction_order_and_truncation(analysis_snapshot):
    template = analysis_snapshot.nodes[1].analysis
    neighbors = tuple(
        NodeView(replace(template, features=replace(template.features, gid=100 + i)), True)
        for i in range(40)
    )
    edges = tuple(Edge(GID_A, 100 + i, Decimal(5000 + i), 1, 1) for i in range(40))
    snapshot = replace(
        analysis_snapshot, nodes=(analysis_snapshot.nodes[0], *neighbors), edges=edges
    )
    context = build_question_context(snapshot, (GID_A,))
    assert len(context.nodes) == 6 and len(context.edges) == 5
    assert context.edges[0].dst == "139"
    assert context.total_related_edges == 40
    assert any("5 из 40" in note for note in context.limitations)
    assert len(context.to_json().encode()) <= MAX_CONTEXT_BYTES
    assert (
        build_question_context(replace(snapshot, edges=tuple(reversed(edges))), (GID_A,)) == context
    )


def test_context_byte_limit(analysis_snapshot):
    first = analysis_snapshot.nodes[0]
    huge = replace(
        first,
        analysis=replace(
            first.analysis,
            decision=replace(first.analysis.decision, evidence="ж" * MAX_CONTEXT_BYTES),
        ),
    )
    with pytest.raises(ApiError) as error:
        build_question_context(
            replace(analysis_snapshot, nodes=(huge, *analysis_snapshot.nodes[1:])), (GID_A,)
        )
    assert error.value.code == "INVALID_QUESTION"
