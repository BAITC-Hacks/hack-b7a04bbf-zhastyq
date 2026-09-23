from typing import Annotated

from fastapi import APIRouter, Depends

from money_graph.application.exceptions import ApiError
from money_graph.presentation.api.dependencies import ApiServices, services
from money_graph.presentation.api.schemas.question import AskRequest, AskResponse, ReferenceResponse

router = APIRouter(prefix="/api", tags=["AI"])


@router.post("/ask", response_model=AskResponse)
def ask(payload: AskRequest, use_cases: Annotated[ApiServices, Depends(services)]) -> AskResponse:
    gids = tuple(int(gid) for gid in payload.context_gids)
    if any(not -(2**63) <= gid < 2**63 for gid in gids):
        raise ApiError("INVALID_QUESTION", "gid должен быть десятичным int64")
    result = use_cases.ask.execute(payload.analysis_id, payload.question, gids)
    return AskResponse(
        analysis_id=result.analysis_id,
        answer=result.answer,
        references=[
            ReferenceResponse(gid=ref.gid, facts=list(ref.facts)) for ref in result.references
        ],
        limitations=list(result.limitations),
    )
