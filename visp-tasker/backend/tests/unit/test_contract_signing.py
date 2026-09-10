"""Contract signatures must include drawn evidence and an archived document."""

import hashlib
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.models.verification import ConsentType
from src.services import legalConsentService as consent_service
from src.services import legalPdfService as pdf_service


CONTRACTS = [ConsentType.CUSTOMER_SERVICE_AGREEMENT, ConsentType.PROVIDER_IC_AGREEMENT]


@pytest.mark.parametrize("customer,provider,expected", [
    (True, False, [ConsentType.CUSTOMER_SERVICE_AGREEMENT]),
    (False, True, [ConsentType.PROVIDER_IC_AGREEMENT]),
    (True, True, [ConsentType.PROVIDER_IC_AGREEMENT, ConsentType.CUSTOMER_SERVICE_AGREEMENT]),
])
async def test_pending_contracts_require_drawing_for_each_role(mock_db, customer, provider, expected):
    from src.api.routes.consents import pending_consents

    user = SimpleNamespace(
        id=uuid.uuid4(), role_customer=customer, role_provider=provider,
        first_name="Jane", last_name="Doe", email="jane@example.test",
    )
    legacy = SimpleNamespace(
        signed_full_name=None, signature_svg=None, signature_image_path=None,
        document_path=None, document_hash=None,
    )
    with patch.object(consent_service, "check_consent", AsyncMock(return_value=legacy)):
        pending = await pending_consents(mock_db, user)
    assert [item.consent_type for item in pending.pending] == expected
    assert all(item.requires_signature for item in pending.pending)
    assert pending.suggested_legal_name == "Jane Doe"
    assert pending.account_email == user.email


async def test_both_account_still_requires_customer_contract_after_provider_signs(mock_db):
    from src.api.routes.consents import pending_consents

    async def latest(_db, _user_id, consent_type):
        if consent_type == ConsentType.PROVIDER_IC_AGREEMENT:
            return SimpleNamespace(
                signed_full_name="Jane Doe", signature_svg="<svg/>",
                signature_image_path="signature.png", document_path="signed.pdf",
                document_hash="a" * 64,
            )
        return None

    user = SimpleNamespace(
        id=uuid.uuid4(), role_customer=True, role_provider=True,
        first_name="Jane", last_name="Doe", email="jane@example.test",
    )
    with patch.object(consent_service, "check_consent", latest):
        pending = await pending_consents(mock_db, user)
    assert [item.consent_type for item in pending.pending] == [ConsentType.CUSTOMER_SERVICE_AGREEMENT]


@pytest.mark.parametrize("consent_type", CONTRACTS)
async def test_sign_endpoint_rejects_missing_signature(mock_db, consent_type):
    from fastapi import HTTPException
    from src.api.routes.consents import ConsentSignRequest, sign_legal_document

    body = ConsentSignRequest(
        consent_type=consent_type, signed_full_name="Jane Doe", document_hash="a" * 64,
    )
    with pytest.raises(HTTPException) as error:
        await sign_legal_document(body, mock_db, SimpleNamespace(id=uuid.uuid4()), None, None)
    assert error.value.status_code == 400
    assert error.value.detail == "signature_required"
    mock_db.add.assert_not_called()


@pytest.mark.parametrize("consent_type", CONTRACTS)
@pytest.mark.parametrize("missing", ["signature_svg", "signature_image_path", "document_path", "document_hash"])
async def test_unsigned_or_unarchived_acceptance_is_pending(mock_db, consent_type, missing):
    record = SimpleNamespace(
        consent_version="1.0", signed_full_name="Jane Doe", signature_svg="<svg/>",
        signature_image_path="contracts/signature.png", document_path="contracts/signed.pdf",
        document_hash="a" * 64,
    )
    setattr(record, missing, None)
    with patch.object(consent_service, "check_consent", AsyncMock(return_value=record)):
        assert not await consent_service.has_valid_signature(mock_db, uuid.uuid4(), consent_type)


@pytest.mark.parametrize("consent_type", CONTRACTS)
async def test_signed_older_contract_remains_valid(mock_db, consent_type):
    record = SimpleNamespace(
        consent_version="1.0", signed_full_name="Jane Doe", signature_svg="<svg/>",
        signature_image_path="contracts/signature.png", document_path="contracts/signed.pdf",
        document_hash="a" * 64,
    )
    with patch.object(consent_service, "check_consent", AsyncMock(return_value=record)):
        assert await consent_service.has_valid_signature(mock_db, uuid.uuid4(), consent_type)


@pytest.mark.parametrize("consent_type", CONTRACTS)
async def test_service_refuses_contract_without_drawing(mock_db, consent_type):
    with patch.object(pdf_service, "persist_contract", return_value=("test.pdf", "a" * 64, None)), \
            pytest.raises(ValueError, match="signature_required"):
        await consent_service.sign_consent(
            mock_db, user_id=uuid.uuid4(), account_email="jane@example.test",
            consent_type=consent_type, signed_full_name="Jane Doe",
            document_hash=consent_service.get_document_metadata(consent_type)["hash"],
        )
    mock_db.add.assert_not_called()


@pytest.mark.parametrize("consent_type", CONTRACTS)
def test_pdf_ends_with_one_completed_acceptance_form_and_signature(consent_type):
    meta = consent_service.get_document_metadata(consent_type)
    party = "Customer" if consent_type == ConsentType.CUSTOMER_SERVICE_AGREEMENT else "Service Provider"
    record = pdf_service.AcceptanceRecord(
        legal_name="Jane Doe", account_email="jane@example.test", consent_id=uuid.uuid4(),
        user_id=uuid.uuid4(), document_version=meta["version"], text_hash=meta["hash"],
        accepted_at=datetime(2026, 9, 10, 16, tzinfo=timezone.utc), party_label=party,
    )
    signature = pdf_service.SignatureData(320, 140, [[[10, 20], [60, 80], [120, 30]]])
    with patch.object(pdf_service, "_render_table", wraps=pdf_service._render_table) as tables:
        pdf, png = pdf_service.build_signed_contract(
            markdown=meta["text"], record=record, signature=signature,
            running_head="VISP", footer_note="Test contract",
        )
    acceptance_tables = [
        call.args[2] for call in tables.call_args_list
        if any("Legal Name" in row[0] for row in call.args[2])
    ]
    assert len(acceptance_tables) == 1
    assert acceptance_tables[0][0][1] == "Jane Doe"
    assert any(row[1] == "jane@example.test" for row in acceptance_tables[0])
    assert any("2026-09-10 12:00:00 EDT" in row[1] for row in acceptance_tables[0])
    assert pdf.startswith(b"%PDF-")
    assert b"/Subtype /Image" in pdf
    assert png.startswith(b"\x89PNG")


@pytest.mark.parametrize("consent_type", CONTRACTS)
async def test_signed_pdf_is_the_same_archive_downloaded_by_admin(mock_db, monkeypatch, tmp_path, consent_type):
    from src.api.routes.admin import admin_download_signed_contract

    monkeypatch.setattr(pdf_service, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(pdf_service, "CONTRACT_DIR", tmp_path / "contracts")
    signature = pdf_service.SignatureData(320, 140, [[[10, 20], [60, 80], [120, 30]]])
    meta = consent_service.get_document_metadata(consent_type)
    record = await consent_service.sign_consent(
        mock_db, user_id=uuid.uuid4(), account_email="jane@example.test",
        consent_type=consent_type, signed_full_name="Jane Doe", business_name="Example Ltd",
        document_hash=meta["hash"], signature=signature, ip_address="127.0.0.1",
    )
    mock_db.add.assert_called_once_with(record)
    assert record.signature_svg == signature.to_svg()
    assert record.consent_text == meta["text"]
    assert record.consent_text_hash == meta["hash"]
    assert (tmp_path / record.signature_image_path).is_file()
    mock_db.get.return_value = record
    response = await admin_download_signed_contract(record.id, mock_db, SimpleNamespace())
    assert response.media_type == "application/pdf"
    assert response.path == tmp_path / record.document_path
    assert hashlib.sha256(response.path.read_bytes()).hexdigest() == record.document_hash
