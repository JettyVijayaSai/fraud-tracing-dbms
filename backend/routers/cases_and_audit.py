from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from config import get_db_connection

router = APIRouter(prefix="/api", tags=["Cases, Workflow & Audit Trail"])

class CreateCaseRequest(BaseModel):
    case_title: str = Field(..., min_length=3, max_length=200)
    assigned_to: Optional[str] = "investigator_user"
    priority: Optional[str] = Field("HIGH", pattern="^(LOW|MEDIUM|HIGH|CRITICAL)$")
    alert_ids: Optional[List[int]] = []

class AddNoteRequest(BaseModel):
    author_role: Optional[str] = "investigator_role"
    note_text: str = Field(..., min_length=1)

class MakeDecisionRequest(BaseModel):
    account_id: int = Field(..., gt=0)
    decision_type: str = Field(..., pattern="^(FREEZE|CLEAR)$")
    rationale: str = Field(..., min_length=5)
    decided_by: Optional[str] = "investigator_user"

@router.post("/cases", status_code=status.HTTP_201_CREATED)
def create_case(req: CreateCaseRequest):
    """Creates an investigation case and attaches flagged alerts."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO investigation_cases (case_title, assigned_to, priority, status)
                VALUES (%s, %s, %s, 'OPEN')
                RETURNING case_id, case_title, assigned_to, priority, status, created_at;
                """,
                (req.case_title, req.assigned_to, req.priority)
            )
            case_data = cur.fetchone()
            case_id = case_data["case_id"]

            if req.alert_ids:
                for aid in req.alert_ids:
                    cur.execute(
                        """
                        INSERT INTO case_alerts (case_id, alert_id)
                        VALUES (%s, %s)
                        ON CONFLICT DO NOTHING;
                        """,
                        (case_id, aid)
                    )
                    # Update alert status to IN_REVIEW
                    cur.execute("UPDATE alerts SET status = 'IN_REVIEW' WHERE alert_id = %s;", (aid,))

            # Append audit log
            cur.execute(
                """
                SELECT fn_append_audit_log(
                    'investigator_role',
                    'CASE_CREATED',
                    'investigation_cases',
                    %s::text,
                    %s::jsonb
                );
                """,
                (case_id, psycopg.types.json.Jsonb({"title": req.case_title, "alert_ids": req.alert_ids, "priority": req.priority}))
            )
            conn.commit()
            return case_data

@router.get("/cases")
def list_cases():
    """List all open and active investigation cases."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.case_id, c.case_title, c.assigned_to, c.status, c.priority, c.created_at, c.updated_at,
                       COUNT(DISTINCT ca.alert_id) AS total_alerts
                FROM investigation_cases c
                LEFT JOIN case_alerts ca ON c.case_id = ca.case_id
                GROUP BY c.case_id
                ORDER BY c.case_id DESC;
                """
            )
            return cur.fetchall()

@router.get("/cases/{case_id}")
def get_case(case_id: int):
    """Retrieve complete case dossier with alerts, notes, and freeze/clear decisions."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM investigation_cases WHERE case_id = %s;", (case_id,))
            case_data = cur.fetchone()
            if not case_data:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Case {case_id} not found")

            # Alerts
            cur.execute(
                """
                SELECT a.alert_id, a.txn_id, a.account_id, a.rule_code, a.risk_score, a.explanation, a.evidence_query, a.status
                FROM case_alerts ca
                JOIN alerts a ON ca.alert_id = a.alert_id
                WHERE ca.case_id = %s;
                """,
                (case_id,)
            )
            alerts = cur.fetchall()

            # Notes
            cur.execute(
                """
                SELECT note_id, author_role, note_text, created_at
                FROM case_notes
                WHERE case_id = %s
                ORDER BY note_id ASC;
                """,
                (case_id,)
            )
            notes = cur.fetchall()

            # Decisions
            cur.execute(
                """
                SELECT decision_id, account_id, decision_type, rationale, decided_by, decided_at
                FROM decisions
                WHERE case_id = %s
                ORDER BY decision_id ASC;
                """,
                (case_id,)
            )
            decisions = cur.fetchall()

            return {
                "case": case_data,
                "alerts": alerts,
                "notes": notes,
                "decisions": decisions
            }

@router.post("/cases/{case_id}/notes", status_code=status.HTTP_201_CREATED)
def add_case_note(case_id: int, req: AddNoteRequest):
    """Appends an investigative note to the case and commits an audit log entry."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO case_notes (case_id, author_role, note_text)
                VALUES (%s, %s, %s)
                RETURNING note_id, case_id, author_role, note_text, created_at;
                """,
                (case_id, req.author_role, req.note_text)
            )
            note = cur.fetchone()

            cur.execute(
                """
                SELECT fn_append_audit_log(
                    %s,
                    'NOTE_ADDED',
                    'case_notes',
                    %s::text,
                    %s::jsonb
                );
                """,
                (req.author_role, note["note_id"], psycopg.types.json.Jsonb({"case_id": case_id, "text": req.note_text}))
            )
            conn.commit()
            return note

@router.post("/cases/{case_id}/decisions", status_code=status.HTTP_201_CREATED)
def make_investigation_decision(case_id: int, req: MakeDecisionRequest):
    """
    Executes a binding investigator decision (FREEZE or CLEAR):
    1. Writes to decisions table.
    2. Updates accounts table status ('FROZEN' or 'ACTIVE').
    3. Appends cryptographically hashed audit log row.
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # 1. Record decision
            cur.execute(
                """
                INSERT INTO decisions (case_id, account_id, decision_type, rationale, decided_by)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING decision_id, case_id, account_id, decision_type, rationale, decided_by, decided_at;
                """,
                (case_id, req.account_id, req.decision_type, req.rationale, req.decided_by)
            )
            decision = cur.fetchone()

            # 2. Update account status
            new_status = 'FROZEN' if req.decision_type == 'FREEZE' else 'ACTIVE'
            cur.execute(
                "UPDATE accounts SET status = %s WHERE account_id = %s;",
                (new_status, req.account_id)
            )

            # 3. Append to SHA-256 Hash Chained Audit Log
            cur.execute(
                """
                SELECT fn_append_audit_log(
                    'investigator_role',
                    %s,
                    'accounts',
                    %s::text,
                    %s::jsonb
                );
                """,
                (
                    f"ACCOUNT_{req.decision_type}D",
                    str(req.account_id),
                    psycopg.types.json.Jsonb({
                        "case_id": case_id,
                        "decision_id": decision["decision_id"],
                        "decision_type": req.decision_type,
                        "new_account_status": new_status,
                        "rationale": req.rationale,
                        "decided_by": req.decided_by
                    })
                )
            )
            conn.commit()
            return decision

@router.get("/audit/verify")
def verify_audit_chain():
    """
    Executes fn_verify_audit_chain() to mathematically recalculate the SHA-256
    hash-chain links and detect any unauthorized row mutations or deletions.
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM fn_verify_audit_chain();")
            return cur.fetchone()

@router.get("/audit/logs")
def list_audit_logs(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    """Fetch immutable, hash-chained audit log records."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT audit_id, actor_role, action_type, target_entity, target_id,
                       payload, prev_hash, row_hash, created_at
                FROM audit_log
                ORDER BY audit_id DESC
                LIMIT %s OFFSET %s;
                """,
                (limit, offset)
            )
            return cur.fetchall()
