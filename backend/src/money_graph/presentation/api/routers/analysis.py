from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from money_graph.application.dto.active_analysis import DatasetUpload
from money_graph.application.exceptions import ApiError
from money_graph.presentation.api.dependencies import ApiServices, services
from money_graph.presentation.api.schemas.analysis import (
    AnalysisResponse,
    UploadResponse,
    analysis_response,
    summary_response,
)

router = APIRouter(prefix="/api", tags=["analysis"])


@router.post("/analyze", response_model=UploadResponse)
async def upload_analysis(
    request: Request,
    use_cases: Annotated[ApiServices, Depends(services)],
    nodes: Annotated[UploadFile, File(description="nodes.parquet, максимум 25 MiB")],
    edges: Annotated[UploadFile, File(description="edges.parquet, максимум 25 MiB")],
    transactions: Annotated[UploadFile, File(description="transactions.parquet, максимум 25 MiB")],
) -> UploadResponse:
    form = await request.form()
    if sorted(key for key, _ in form.multi_items()) != ["edges", "nodes", "transactions"]:
        raise ApiError("INVALID_SCHEMA", "Нужны ровно три файла: nodes, edges, transactions")
    uploads = (
        DatasetUpload("nodes", nodes.filename or "", nodes.file),
        DatasetUpload("edges", edges.filename or "", edges.file),
        DatasetUpload("transactions", transactions.filename or "", transactions.file),
    )
    snapshot = await run_in_threadpool(use_cases.publish.execute, uploads)
    return UploadResponse(analysis_id=snapshot.analysis_id, summary=summary_response(snapshot))


@router.get("/analysis", response_model=AnalysisResponse)
def current_analysis(use_cases: Annotated[ApiServices, Depends(services)]) -> AnalysisResponse:
    return analysis_response(use_cases.analysis.execute())
