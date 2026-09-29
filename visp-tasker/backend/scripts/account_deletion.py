"""Borrados de cuenta a mano: listar, purgar y restaurar.

    ./venv/bin/python scripts/account_deletion.py list
    ./venv/bin/python scripts/account_deletion.py purge            # las vencidas
    ./venv/bin/python scripts/account_deletion.py purge --user EMAIL_O_ID   # una ya
    ./venv/bin/python scripts/account_deletion.py restore EMAIL

`purge` hace lo mismo que la tarea de fondo (`src/jobs/accountPurge.py`); existe
para no depender de que esa tarea esté viva. `restore` es lo que hace soporte
cuando alguien escribe dentro de los 30 días.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid

sys.path.insert(0, ".")

from sqlalchemy import select  # noqa: E402

from src.api.deps import async_session_factory  # noqa: E402
from src.models import AccountDeletion, User  # noqa: E402
from src.services import account_deletion_service as svc  # noqa: E402


async def _find_user(db, ref: str) -> User:
    try:
        user = await db.get(User, uuid.UUID(ref))
    except ValueError:
        user = (
            await db.execute(select(User).where(User.email == ref.lower().strip()))
        ).scalars().first()
    if user is None:
        sys.exit(f"No existe el usuario {ref}")
    return user


async def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p = sub.add_parser("purge")
    p.add_argument("--user", help="email o id: purga esa cuenta aunque no hayan pasado 30 días")
    r = sub.add_parser("restore")
    r.add_argument("user", help="email o id")
    args = ap.parse_args()

    async with async_session_factory() as db:
        if args.cmd == "list":
            rows = (
                await db.execute(
                    select(AccountDeletion, User.email)
                    .join(User, User.id == AccountDeletion.user_id)
                    .order_by(AccountDeletion.requested_at.desc())
                )
            ).all()
            for rec, email in rows:
                estado = (
                    "PURGADA" if rec.purged_at else "RESTAURADA" if rec.restored_at
                    else f"purga el {rec.purge_after:%Y-%m-%d}"
                )
                print(f"{rec.requested_at:%Y-%m-%d %H:%M}  {email:<45} {estado}"
                      + (f"  [{rec.purge_notes}]" if rec.purge_notes else ""))
            if not rows:
                print("No hay cuentas borradas.")
        elif args.cmd == "purge":
            user_id = (await _find_user(db, args.user)).id if args.user else None
            print(await svc.purge_due_accounts(db, user_id=user_id))
            await db.commit()
        elif args.cmd == "restore":
            user = await _find_user(db, args.user)
            rec = await svc.restore_account(db, user)
            await db.commit()
            print(f"Restaurada {user.email} (borrada el {rec.requested_at:%Y-%m-%d}).")


if __name__ == "__main__":
    asyncio.run(main())
