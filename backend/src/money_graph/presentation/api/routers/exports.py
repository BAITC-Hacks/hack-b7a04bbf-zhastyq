from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from money_graph.presentation.api.dependencies import ApiServices, services

router = APIRouter(prefix="/api/exports", tags=["exports"])


@router.get("/{name:path}", response_class=FileResponse)
def download(name: str, use_cases: Annotated[ApiServices, Depends(services)]) -> FileResponse:
    exported = use_cases.export.execute(name)
    return FileResponse(
        exported.path,
        media_type="text/csv; charset=utf-8",
        filename=exported.name,
        headers={"X-Analysis-Id": exported.analysis_id},
    )
