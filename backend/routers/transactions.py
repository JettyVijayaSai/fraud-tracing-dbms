from decimal import Decimal
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
import psycopg
from config import get_db_connection

router = APIRouter(prefix="/api", tags=["Transactions & Accounts"])

class PaymentRequest(BaseModel):
    idem_key: str = Field(..., min_length=4, max_length=128, description="Unique idempotency key")
    from_account: int = Field(..., gt=0, description="Source account ID")
    to_account: int = Field(..., gt=0, description="Destination account ID")
    amount: Decimal = Field(..., gt=0, decimal_places=2, description="Transfer amount")
    txn_type: Optional[str] = Field("TRANSFER", max_length=32, description="Transaction type")

class PaymentResponse(BaseModel):
    status: str
    txn_id: int
    idem_key: str
    from_account: int
    to_account: int
    amount: float
    txn_type: str
    created_at: str

@router.post("/transactions", response_model=dict, status_code=status.HTTP_200_OK)
def process_payment(req: PaymentRequest):
    """
    Executes an ACID, idempotent double-entry payment transfer via PostgreSQL sp_process_payment().
    Guarantees replay-safe execution and atomic ledger entry balance.
    """
    if req.from_account == req.to_account:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source and destination accounts must differ")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT sp_process_payment(
                        %s::varchar,
                        %s::bigint,
                        %s::bigint,
                        %s::numeric,
                        %s::varchar
                    ) AS result;
                    """,
                    (req.idem_key, req.from_account, req.to_account, float(req.amount), req.txn_type)
                )
                res = cur.fetchone()
                conn.commit()
                return res["result"]
    except psycopg.errors.UniqueViolation as e:
        # 409 Conflict when idempotency key is reused with different request payload
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Idempotency conflict: {str(e).strip()}"
        )
    except psycopg.Error as e:
        err_msg = str(e).strip()
        if "Insufficient funds" in err_msg or "55000" in getattr(e, "sqlstate", ""):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=err_msg)
        if "not active" in err_msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=err_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err_msg)

@router.get("/transactions")
def list_transactions(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    """Fetch paginated historical transactions."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT txn_id, idem_key, from_account, to_account, amount, txn_type, created_at
                FROM transactions
                ORDER BY txn_id DESC
                LIMIT %s OFFSET %s;
                """,
                (limit, offset)
            )
            rows = cur.fetchall()
            return {"total": len(rows), "transactions": rows}

@router.get("/accounts/{account_id}")
def get_account(account_id: int):
    """Retrieve account details including customer info and cached balance."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.account_id, a.customer_id, a.status, a.cached_balance, a.opened_at,
                       c.first_name, c.last_name, c.email, c.risk_tier
                FROM accounts a
                JOIN customers c ON a.customer_id = c.customer_id
                WHERE a.account_id = %s;
                """,
                (account_id,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Account {account_id} not found")
            return row

@router.get("/accounts")
def list_accounts(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    """List accounts with status and balance."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.account_id, a.customer_id, a.status, a.cached_balance, a.opened_at,
                       c.first_name, c.last_name, c.email, c.risk_tier
                FROM accounts a
                JOIN customers c ON a.customer_id = c.customer_id
                ORDER BY a.account_id ASC
                LIMIT %s OFFSET %s;
                """,
                (limit, offset)
            )
            return cur.fetchall()
