from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    analysis_id: StrictStr = Field(min_length=1, max_length=128)
    question: StrictStr = Field(min_length=1, max_length=2000)
    context_gids: list[Annotated[StrictStr, Field(pattern=r"^-?[0-9]{1,19}$")]] = Field(
        default_factory=list,
        max_length=5,
    )

    @field_validator("question", mode="before")
    @classmethod
    def strip_question(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ReferenceResponse(BaseModel):
    gid: str
    facts: list[str]


class AskResponse(BaseModel):
    analysis_id: str
    answer: str
    references: list[ReferenceResponse]
    limitations: list[str]
