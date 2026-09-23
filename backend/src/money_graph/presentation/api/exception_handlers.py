from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from money_graph.application.exceptions import ApiError

STATUS_CODES = {
    "NO_ANALYSIS": 404,
    "GID_NOT_FOUND": 404,
    "EXPORT_NOT_FOUND": 404,
    "INVALID_SCHEMA": 422,
    "FILE_TOO_LARGE": 413,
    "ANALYSIS_BUSY": 409,
}


def error_response(
    code: str, message: str, status: int, details: dict[str, str | int | list[str]] | None = None
) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {"code": code, "message": message, "details": details or {}},
        },
    )


def register_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def application_error(request: Request, error: ApiError) -> JSONResponse:
        return error_response(error.code, error.message, STATUS_CODES[error.code], error.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        fields = [".".join(str(part) for part in item["loc"]) for item in error.errors()]
        return error_response(
            "INVALID_SCHEMA",
            "Проверьте обязательные поля и параметры запроса",
            422,
            {"fields": fields},
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException) -> JSONResponse:
        if error.status_code == 413:
            return error_response("FILE_TOO_LARGE", "Превышен допустимый размер запроса", 413)
        if error.status_code in (400, 422):
            return error_response("INVALID_SCHEMA", "Некорректная multipart-форма", 422)
        if error.status_code == 404 and request.url.path.startswith("/api/exports/"):
            return error_response("EXPORT_NOT_FOUND", "Файл экспорта не найден", 404)
        return error_response(
            "NOT_FOUND" if error.status_code == 404 else "HTTP_ERROR",
            "Запрос не поддерживается",
            error.status_code,
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, error: Exception) -> JSONResponse:
        return error_response("INTERNAL_ERROR", "Не удалось обработать запрос", 500)
