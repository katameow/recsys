from __future__ import annotations

from typing import Any, Dict, Optional
from pydantic import BaseModel


class AuthContext(BaseModel):
    """Represents the authenticated principal derived from a JWT."""

    subject: str
    role: str
    email: Optional[str]
    refresh_hash: Optional[str]
    session_id: Optional[str]
    issued_at: Optional[int]
    expires_at: Optional[int]
    raw_token: str
    claims: Dict[str, Any]

    @property
    def is_admin(self) -> bool:
        return self.role.lower() == "admin"

    @property
    def is_guest(self) -> bool:
        return self.role.lower() == "guest"
