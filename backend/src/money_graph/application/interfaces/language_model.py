from typing import Protocol

from money_graph.application.dto.question import ModelAnswer, QuestionContext


class LanguageModel(Protocol):
    @property
    def configured(self) -> bool: ...

    def answer(self, question: str, context: QuestionContext) -> ModelAnswer: ...
