import os
from contextlib import contextmanager
from typing import Generator
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DB_HOST = os.getenv("POSTGRES_HOST", "localhost")
DB_PORT = os.getenv("POSTGRES_PORT", "5432")
DB_NAME = os.getenv("POSTGRES_DB", "fraud_tracing_db")
DB_USER = os.getenv("POSTGRES_USER", "postgres")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "postgrespassword")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Global connection pool initialized on startup
pool: ConnectionPool = None

def get_connection_string() -> str:
    return DATABASE_URL

def init_db_pool(min_size: int = 4, max_size: int = 20) -> ConnectionPool:
    global pool
    if pool is None or pool.closed:
        pool = ConnectionPool(
            conninfo=DATABASE_URL,
            min_size=min_size,
            max_size=max_size,
            kwargs={"row_factory": dict_row, "autocommit": False}
        )
    return pool

def close_db_pool():
    global pool
    if pool and not pool.closed:
        pool.close()

@contextmanager
def get_db_connection() -> Generator[psycopg.Connection, None, None]:
    global pool
    if pool is None or pool.closed:
        init_db_pool()
    with pool.connection() as conn:
        yield conn

@contextmanager
def get_direct_connection(autocommit: bool = True) -> Generator[psycopg.Connection, None, None]:
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=autocommit)
    try:
        yield conn
    finally:
        conn.close()
