import tempfile
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.datastructures import UploadFile

from money_graph.application.use_cases import AnalysisError, AnalysisService
from money_graph.infrastructure.publisher import FilePublisher


class AskRequest(BaseModel):
    analysis_id: str
    question: str
    context_gids: list[int] = Field(default_factory=list)


def create_app(service: AnalysisService, publisher: FilePublisher) -> FastAPI:
    app = FastAPI(title="Граф денег")

    @app.exception_handler(AnalysisError)
    async def analysis_error(request: Request, exc: AnalysisError):
        status = {"NO_ANALYSIS": 404, "GID_NOT_FOUND": 404, "STALE_ANALYSIS": 409,
                  "AI_UNAVAILABLE": 503, "INVALID_QUESTION": 422}.get(exc.code, 422)
        return JSONResponse(status_code=status, content={"error": {"code": exc.code,
                            "message": str(exc), "details": exc.details}})

    @app.exception_handler(RequestValidationError)
    async def request_error(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"error": {"code": "INVALID_SCHEMA",
                            "message": "Неверный формат запроса", "details": {"errors": exc.errors()}}})

    @app.get("/api/health")
    def health():
        try:
            service.current()
            ready = True
        except AnalysisError:
            ready = False
        return {"status": "ok", "analysis_ready": ready, "ai_configured": service.model is not None}

    @app.get("/api/analysis")
    def analysis():
        return service.current().screen()

    @app.post("/api/analyze")
    async def analyze(request: Request):
        form = await request.form()
        required = {"nodes", "edges", "transactions"}
        supplied = set(form.keys())
        missing = sorted(required - supplied)
        if missing:
            raise AnalysisError("INVALID_SCHEMA", f"Не хватает файлов: {', '.join(missing)}", {"missing_files": missing})
        if supplied != required or any(len(form.getlist(name)) != 1 for name in required):
            raise AnalysisError("INVALID_SCHEMA", "Требуются ровно три поля: nodes, edges, transactions")
        with tempfile.TemporaryDirectory(prefix="money-graph-upload-") as folder:
            paths = {}
            for name in sorted(required):
                upload = form[name]
                if not isinstance(upload, UploadFile) or not upload.filename:
                    raise AnalysisError("INVALID_SCHEMA", f"Поле {name} должно содержать файл")
                suffix = Path(upload.filename).suffix.lower()
                if suffix not in {".csv", ".parquet"}:
                    raise AnalysisError("INVALID_SCHEMA", f"{name}: требуется .csv или .parquet")
                path = Path(folder) / f"{name}{suffix}"
                path.write_bytes(await upload.read())
                paths[name] = str(path)
            result = service.analyze(paths)
        return {"analysis_id": result.analysis_id, "status": "ready", "summary": result.summary,
                "analysis_url": "/api/analysis"}

    @app.get("/api/nodes/{gid}")
    def node(gid: int):
        return service.node_card(gid)

    @app.post("/api/ask")
    def ask(body: AskRequest):
        try:
            return service.ask(body.analysis_id, body.question, body.context_gids)
        except RuntimeError:
            raise AnalysisError("AI_UNAVAILABLE", "Модель сейчас недоступна") from None

    @app.get("/api/exports/{name}")
    def export(name: str):
        service.current()
        try:
            path = publisher.export_path(name)
        except ValueError:
            raise AnalysisError("GID_NOT_FOUND", "Неизвестная выгрузка") from None
        return FileResponse(path, media_type="text/csv; charset=utf-8", filename=name)

    return app
