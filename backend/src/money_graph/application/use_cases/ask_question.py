import re

from money_graph.application.dto.question import (
    AnswerReference,
    ModelAnswer,
    QuestionAnswer,
    QuestionContext,
)
from money_graph.application.exceptions import ApiError, LanguageModelError
from money_graph.application.interfaces.language_model import LanguageModel
from money_graph.application.use_cases.get_analysis import GetAnalysis
from money_graph.application.use_cases.question_context import (
    build_question_context,
    reference_facts,
)

MAX_QUESTION_LENGTH = 2000
MAX_CONTEXT_GIDS = 5
MAX_ANSWER_LENGTH = 6000


def _validate_answer(reply: ModelAnswer, context: QuestionContext) -> None:
    if not isinstance(reply, ModelAnswer) or not isinstance(reply.answer, str):
        raise LanguageModelError("Invalid answer structure")
    if not 1 <= len(reply.answer.strip()) <= MAX_ANSWER_LENGTH:
        raise LanguageModelError("Invalid answer length")
    if not isinstance(reply.referenced_gids, tuple) or not 1 <= len(reply.referenced_gids) <= 10:
        raise LanguageModelError("Invalid references")
    allowed = {node.gid for node in context.nodes}
    if any(type(gid) is not str or gid not in allowed for gid in reply.referenced_gids):
        raise LanguageModelError("Unverified node")
    if len(set(reply.referenced_gids)) != len(reply.referenced_gids):
        raise LanguageModelError("Duplicate references")
    mentioned = set(re.findall(r"(?i)\bgid\s*[:=#]?\s*(-?[0-9]+)", reply.answer))
    mentioned.update(re.findall(r"(?<![0-9])-?[0-9]{16,19}(?![0-9])", reply.answer))
    if not mentioned <= set(reply.referenced_gids):
        raise LanguageModelError("Unreferenced identifiers in answer")


class AskQuestion:
    def __init__(self, analysis: GetAnalysis, model: LanguageModel | None) -> None:
        self._analysis = analysis
        self._model = model

    @property
    def ai_configured(self) -> bool:
        return self._model is not None and self._model.configured

    def _check_current(self, analysis_id: str) -> None:
        if self._analysis.execute().analysis_id != analysis_id:
            raise ApiError("STALE_ANALYSIS", "Анализ изменился во время ответа; обновите граф")

    def execute(
        self,
        analysis_id: str,
        question: str,
        context_gids: tuple[int, ...],
    ) -> QuestionAnswer:
        snapshot = self._analysis.execute()
        if analysis_id != snapshot.analysis_id:
            raise ApiError("STALE_ANALYSIS", "Анализ изменился; обновите граф и повторите вопрос")
        question = question.strip()
        if not 1 <= len(question) <= MAX_QUESTION_LENGTH:
            raise ApiError("INVALID_QUESTION", "Вопрос должен содержать от 1 до 2000 символов")
        if not context_gids:
            raise ApiError("INVALID_QUESTION", "Выберите от 1 до 5 узлов на графе")
        if len(context_gids) > MAX_CONTEXT_GIDS or len(set(context_gids)) != len(context_gids):
            raise ApiError("INVALID_QUESTION", "Выберите не более 5 различных gid")
        existing = {node.analysis.features.gid for node in snapshot.nodes}
        if any(type(gid) is not int or gid not in existing for gid in context_gids):
            raise ApiError("INVALID_QUESTION", "Один из выбранных gid отсутствует в анализе")
        if not self.ai_configured:
            raise ApiError("AI_UNAVAILABLE", "AI не настроен: проверьте настройки OpenAI")
        context = build_question_context(snapshot, context_gids)
        assert self._model is not None
        try:
            reply = self._model.answer(question, context)
            self._check_current(analysis_id)
            _validate_answer(reply, context)
        except LanguageModelError:
            self._check_current(analysis_id)
            raise ApiError("AI_UNAVAILABLE", "Не удалось получить корректный ответ AI") from None
        nodes = {node.gid: node for node in context.nodes}
        return QuestionAnswer(
            analysis_id,
            reply.answer.strip(),
            tuple(
                AnswerReference(gid, reference_facts(nodes[gid], context.edges))
                for gid in reply.referenced_gids
            ),
            context.limitations,
        )
