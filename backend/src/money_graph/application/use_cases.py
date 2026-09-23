import re
from dataclasses import replace
from typing import Any, Mapping
from uuid import uuid4

from .ports import Analysis, DatasetReader, GraphAnalyzer, LanguageModel, Publisher


class AnalysisError(ValueError):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


class AnalysisService:
    def __init__(self, reader: DatasetReader, analyzer: GraphAnalyzer, publisher: Publisher, model: LanguageModel | None):
        self.reader = reader
        self.analyzer = analyzer
        self.publisher = publisher
        self.model = model
        self._active = publisher.load()

    def analyze(self, paths: Mapping[str, str]) -> Analysis:
        dataset = self.reader.read(paths)
        result = replace(self.analyzer.analyze(dataset), analysis_id=uuid4().hex[:12])
        self.publisher.publish(result)
        self._active = result
        return result

    def current(self) -> Analysis:
        if self._active is None:
            raise AnalysisError("NO_ANALYSIS", "Анализ ещё не выполнен")
        return self._active

    def node_card(self, gid: int) -> dict[str, Any]:
        analysis = self.current()
        node = next((item for item in analysis.nodes if item["gid"] == gid), None)
        if node is None:
            raise AnalysisError("GID_NOT_FOUND", f"gid {gid} отсутствует в текущем анализе")
        incoming = sorted((edge for edge in analysis.edges if edge["dst"] == gid), key=lambda e: -e["sum_kzt"])
        outgoing = sorted((edge for edge in analysis.edges if edge["src"] == gid), key=lambda e: -e["sum_kzt"])
        return {"analysis_id": analysis.analysis_id, "node": node, "incoming": incoming[:50], "outgoing": outgoing[:50],
                "incoming_total": len(incoming), "outgoing_total": len(outgoing),
                "limitations": self._limitations(node)}

    def ask(self, analysis_id: str, question: str, context_gids: list[int]) -> dict[str, Any]:
        analysis = self.current()
        if analysis_id != analysis.analysis_id:
            raise AnalysisError("STALE_ANALYSIS", "Анализ изменился; обновите страницу")
        if self.model is None:
            raise AnalysisError("AI_UNAVAILABLE", "Настройте доступ к модели через переменные окружения")
        if not question.strip():
            raise AnalysisError("INVALID_QUESTION", "Вопрос не может быть пустым")
        if len(context_gids) > 5:
            raise AnalysisError("INVALID_QUESTION", "Укажите не более пяти context_gids за один вопрос")
        if any(gid not in {n["gid"] for n in analysis.nodes} for gid in context_gids):
            raise AnalysisError("GID_NOT_FOUND", "Один из context_gids отсутствует в анализе")
        facts, referenced = self._facts(analysis, question, context_gids)
        limitations = ["Видны только внутрибанковские переводы от seed на 4 колена за период выгрузки; переводы ниже 5000 KZT и внешние поступления не видны."]
        selected = facts["selected_nodes"]
        if any(node["is_seed"] for node in selected):
            limitations.append("Входящие суммы seed неполны из-за способа сбора графа.")
        if any(node["truncated_by_depth"] for node in selected):
            limitations.append("Нулевой исходящий поток на четвёртом колене означает границу наблюдения, а не подтверждённого получателя.")
        answer = self.model.answer(question, facts, limitations)
        known = {n["gid"] for n in analysis.nodes}
        mentioned = {int(x) for x in re.findall(r"\b\d{15,20}\b", answer)}
        if not any(re.search(rf"\b{gid}\b", answer) for gid in referenced):
            raise AnalysisError("AI_UNAVAILABLE", "Модель не сослалась на gid из выбранных фактов")
        if not mentioned.issubset(known & referenced):
            raise AnalysisError("AI_UNAVAILABLE", "Модель назвала gid вне выбранных фактов")
        references = [{"gid": gid, "facts": self._reference_facts(analysis, gid)} for gid in sorted(referenced)]
        return {"analysis_id": analysis_id, "answer": answer, "references": references, "limitations": limitations}

    def _facts(self, analysis: Analysis, question: str, gids: list[int]) -> tuple[dict[str, Any], set[int]]:
        by_gid = {n["gid"]: n for n in analysis.nodes}
        if not gids:
            gids = [int(token) for token in re.findall(r"\b\d{1,20}\b", question) if int(token) in by_gid]
        if not gids:
            raise AnalysisError("INVALID_QUESTION", "Выберите gid для вопроса")
        selected = list(dict.fromkeys(gids))[:5]
        edges = sorted((e for e in analysis.edges if e["src"] in selected), key=lambda e: -e["sum_kzt"])[:20]
        recipients = {e["dst"] for e in edges}
        fields = ("gid", "depth", "is_seed", "role", "role_score", "priority_score", "in_deg", "out_deg",
                  "in_kzt", "out_kzt", "in_tx", "out_tx", "truncated_by_depth", "evidence")
        compact = lambda node: {field: node[field] for field in fields}
        kind = "top_explanation" if "топ" in question.lower() or "почему" in question.lower() else "money_flow"
        if "seed" in question.lower() or "сид" in question.lower():
            kind = "seed_recipients"
        facts = {"question_kind": kind, "selected_nodes": [compact(by_gid[gid]) for gid in selected], "outgoing_edges": edges,
                 "recipients": [compact(by_gid[gid]) for gid in sorted(recipients)],
                 "top_positions": [t for t in analysis.top_nodes if t["gid"] in selected]}
        return facts, set(selected) | recipients

    @staticmethod
    def _reference_facts(analysis: Analysis, gid: int) -> list[str]:
        node = next(n for n in analysis.nodes if n["gid"] == gid)
        return [f"in_deg={node['in_deg']}", f"out_deg={node['out_deg']}",
                f"in_kzt={node['in_kzt']:.0f}", f"out_kzt={node['out_kzt']:.0f}"]

    @staticmethod
    def _limitations(node: dict[str, Any]) -> list[str]:
        result = ["Учитываются только наблюдаемые внутрибанковские переводы от seed."]
        if node["is_seed"]:
            result.append("Входящие seed неполны; запросите внешние поступления.")
        if node["truncated_by_depth"]:
            result.append("Исходящие за четвёртым коленом неизвестны; запросите следующий уровень переводов.")
        return result
