from typing import Annotated

from fastapi import APIRouter, Depends

from money_graph.presentation.api.dependencies import ApiServices, services
from money_graph.presentation.api.schemas.analysis import HealthResponse

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(use_cases: Annotated[ApiServices, Depends(services)]) -> HealthResponse:
    return HealthResponse(
        analysis_ready=use_cases.analysis.optional() is not None,
        ai_configured=use_cases.ask.ai_configured,
    )
