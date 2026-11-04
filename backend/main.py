import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import psycopg
from psycopg.rows import dict_row

from config import init_db_pool, close_db_pool, DATABASE_URL
from routers.transactions import router as txn_router
from routers.alerts_and_tracing import router as alert_router
from routers.cases_and_audit import router as case_router
from routers.metrics import router as metrics_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("fraud-tracing-backend")

# Active WebSocket connections for live alert broadcasting
active_websockets: Set[WebSocket] = set()

async def listen_postgres_notifications():
    """
    Background worker that runs LISTEN on 'fraud_alerts_channel'
    and pushes real-time alert notifications to connected WebSockets.
    """
    while True:
        try:
            # Use async psycopg connection for asynchronous NOTIFY reception
            async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as aconn:
                await aconn.execute("LISTEN fraud_alerts_channel;")
                logger.info("Subscribed to PostgreSQL LISTEN channel: fraud_alerts_channel")
                gen = aconn.notifies()
                async for notify in gen:
                    raw_payload = notify.payload
                    logger.info("Received PostgreSQL NOTIFY payload: %s", raw_payload)
                    dead_sockets = set()
                    for ws in active_websockets:
                        try:
                            await ws.send_text(raw_payload)
                        except Exception:
                            dead_sockets.add(ws)
                    for ds in dead_sockets:
                        active_websockets.discard(ds)
        except Exception as e:
            logger.warning("Notification listener disconnected (%s). Reconnecting in 3s...", e)
            await asyncio.sleep(3)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize connection pool & background listener
    logger.info("Initializing database connection pool...")
    init_db_pool(min_size=2, max_size=20)
    listener_task = asyncio.create_task(listen_postgres_notifications())
    yield
    # Shutdown: cancel task & close pool
    logger.info("Shutting down backend and closing database pool...")
    listener_task.cancel()
    close_db_pool()

app = FastAPI(
    title="PostgreSQL Fraud Detection & Temporal Money Tracing Engine",
    description="Database-Centric AML Layer: Double-Entry Ledger, Recursive Haircut Tracing, and SHA-256 Audit Chain",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(txn_router)
app.include_router(alert_router)
app.include_router(case_router)
app.include_router(metrics_router)

@app.websocket("/ws/alerts")
async def websocket_alerts_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.add(websocket)
    logger.info("Investigator WebSocket connected. Total clients: %d", len(active_websockets))
    try:
        while True:
            # Keep-alive loop; can also receive pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_websockets.discard(websocket)
        logger.info("Investigator WebSocket disconnected. Remaining clients: %d", len(active_websockets))

@app.get("/health")
def healthcheck():
    return {"status": "HEALTHY", "system": "PostgreSQL Fraud Tracing DBMS API"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
