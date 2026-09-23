import re
from typing import Annotated

from fastapi import APIRouter, Depends

from money_graph.application.exceptions import ApiError
from money_graph.presentation.api.dependencies import ApiServices, services
from money_graph.presentation.api.schemas.analysis import NodeCardResponse, card_response

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


@router.get("/{gid}", response_model=NodeCardResponse)
def get_node(gid: str, use_cases: Annotated[ApiServices, Depends(services)]) -> NodeCardResponse:
    if re.fullmatch(r"-?[0-9]{1,19}", gid) is None or not -(2**63) <= int(gid) < 2**63:
        raise ApiError("INVALID_SCHEMA", "gid должен быть десятичным int64", {"field": "gid"})
    return card_response(use_cases.node.execute(int(gid)))
